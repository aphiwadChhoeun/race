import { randomSeed, rollFaces } from '../dice/random'
import { decideAi } from './ai'
import { RACE_DICE } from './dice'
import { apply } from './engine'
import { MAX_SEATS, MIN_SEATS, SEAT_PALETTE } from './seats'
import type { ClientMessage, Outbox, RoomView, ServerMessage, SeatView } from './protocol'
import { startGame, type GameState, type Roll, type SeatState, type Step } from './state'

/**
 * Defensive only, as it was in `useAiTurns` before it: the AI rerolls until it
 * can outbid and every reroll busts on 11/36, so a turn terminates with
 * probability 1. This just stops a pathological board spinning forever.
 */
const MAX_AI_REROLLS = 30

type SeatRecord = {
  name: string
  color: string
  ink: string
  /** The token that owns this seat, or null while nobody has claimed it. */
  token: string | null
}

export type RoomSnapshot = {
  code: string
  host: number
  phase: 'lobby' | 'racing'
  seats: SeatRecord[]
  game: GameState | null
}

const seatFromPalette = (index: number): SeatRecord => ({ ...SEAT_PALETTE[index], token: null })

/**
 * A room: who is sitting where, and whose turn it is to act.
 *
 * Transport-free on purpose. `handle` takes a token and a message and returns
 * messages to post; it never sees a socket. That is what lets the whole of
 * multiplayer be tested under plain vitest, and what leaves the Durable Object
 * with nothing in it that can be wrong.
 */
export class Room {
  private code: string
  private host = 0
  private phase: 'lobby' | 'racing' = 'lobby'
  private seats: SeatRecord[] = []
  private game_: GameState | null = null

  /**
   * Tokens with a socket open right now.
   *
   * Never persisted: hibernation evicts this object's own memory, not the
   * sockets themselves, so a restore starts blank and trusts the transport to
   * call `reconnect` for every socket it still holds. Without that, a seat
   * whose owner is silent only because it is not yet their turn would be
   * mistaken for one whose owner left, and handed to the AI.
   */
  private connected = new Set<string>()

  constructor(code: string) {
    this.code = code
  }

  static restore(saved: RoomSnapshot): Room {
    const room = new Room(saved.code)
    room.host = saved.host
    room.phase = saved.phase
    room.seats = saved.seats.map((seat) => ({ ...seat }))
    room.game_ = saved.game
    return room
  }

  snapshot(): RoomSnapshot {
    return {
      code: this.code,
      host: this.host,
      phase: this.phase,
      seats: this.seats.map((seat) => ({ ...seat })),
      game: this.game_,
    }
  }

  /** Nobody is watching. The Durable Object may hibernate; the AI must not run. */
  get idle(): boolean {
    return this.connected.size === 0
  }

  game(): GameState | null {
    return this.game_
  }

  view(): RoomView {
    const seats: SeatView[] = this.seats.map((seat, index) => ({
      name: this.game_?.players[index]?.name ?? seat.name,
      color: seat.color,
      ink: seat.ink,
      kind: seat.token === null ? 'ai' : 'human',
      away: seat.token !== null && !this.connected.has(seat.token),
    }))
    return { code: this.code, phase: this.phase, host: this.host, seats }
  }

  /** Every seat this token owns. Usually one; local play owns them all. */
  private seatsOf(token: string): number[] {
    return this.seats.flatMap((seat, index) => (seat.token === token ? [index] : []))
  }

  /**
   * Whether `token` may send a game intent right now.
   *
   * One rule, and there is deliberately no second one: you may act when it is
   * the turn of a seat you own. Local play owns several seats with a single
   * token, which is exactly why hotseat needs no special case here — and why
   * there is only one rule to get wrong.
   */
  private mayAct(token: string): boolean {
    const game = this.game_
    if (!game || game.winner !== null) return false
    return this.seats[game.turn].token === token
  }

  /** A fair throw. The room decides it once; every client replays it. */
  private roll(): Roll {
    return { seed: randomSeed(), faceIds: rollFaces(RACE_DICE.length) }
  }

  private error(token: string, reason: string, fatal = false): Outbox[] {
    return [{ to: token, message: { type: 'error', reason, fatal } }]
  }

  private broadcastRoom(): Outbox {
    return { to: 'all', message: { type: 'room', room: this.view() } }
  }

  handle(token: string, message: ClientMessage): Outbox[] {
    // A message from a token is proof its socket is open. Recording it here
    // rather than only in `hello` is what makes the room self-heal after
    // hibernation: a restored room starts with `connected` empty, and without
    // this the first message back would find nobody watching and the AI would
    // never take another turn.
    this.connected.add(token)

    switch (message.type) {
      case 'hello':
        return this.hello(token, message.create === true, message.size, message.claim ?? 1)
      case 'rename':
        return this.rename(token, message.name)
      case 'resize':
        return this.resize(token, message.size)
      case 'start':
        return this.start(token)
      case 'throw':
        return this.act(token, (game) => apply(game, { kind: 'throw', roll: this.roll() }))
      case 'reroll':
        return this.act(token, (game) => apply(game, { kind: 'reroll', roll: this.roll() }))
      case 'place':
        return this.act(token, (game) => apply(game, { kind: 'place', slot: message.slot }))
    }
  }

  private hello(
    token: string,
    create: boolean,
    size: number | undefined,
    claim: number | number[],
  ): Outbox[] {
    const mine = this.seatsOf(token)

    // A token that already owns seats is coming back, not arriving. This is
    // the whole of reconnection: the seat was never taken away, so there is
    // nothing to give back.
    if (mine.length > 0) return [this.welcome(token, mine), this.broadcastRoom()]

    if (create) {
      // A live room means two hosts drew the same code. Say so loudly, so the
      // client draws another rather than the two of them sharing a room.
      if (this.seats.length > 0) return this.error(token, 'That code is taken.', true)

      const count = size ?? MIN_SEATS
      if (count < MIN_SEATS || count > MAX_SEATS) {
        return this.error(token, `A race seats ${MIN_SEATS} to ${MAX_SEATS} snails.`, true)
      }

      this.seats = Array.from({ length: count }, (_, index) => seatFromPalette(index))
    } else if (this.seats.length === 0) {
      return this.error(token, 'No such room.', true)
    } else if (this.phase === 'racing') {
      // A snail that appears at turn nine is not a race anyone asked for, and
      // seating a latecomer in an AI's place hands them a position they did
      // not earn. Reconnection is handled above, so this only turns away
      // strangers.
      return this.error(token, 'That race has already started.', true)
    }

    const taken: number[] = []

    if (Array.isArray(claim)) {
      for (const seat of claim) {
        if (this.seats[seat]?.token !== null) continue
        this.seats[seat].token = token
        taken.push(seat)
      }
    } else {
      for (let wanted = 0; wanted < Math.max(1, claim); wanted++) {
        const free = this.seats.findIndex((seat) => seat.token === null)
        if (free === -1) break
        this.seats[free].token = token
        taken.push(free)
      }
    }

    if (taken.length === 0) return this.error(token, 'That race is full.', true)

    // The host is whoever made the room, not whoever sits in seat 0 — locally
    // you may well leave seat 0 to an AI and take seat 1 yourself.
    if (create) this.host = taken[0]

    return [this.welcome(token, taken), this.broadcastRoom()]
  }

  private welcome(token: string, seats: number[]): Outbox {
    const message: ServerMessage = {
      type: 'welcome',
      token,
      seats,
      room: this.view(),
      game: this.game_,
    }
    return { to: token, message }
  }

  private rename(token: string, name: string): Outbox[] {
    const mine = this.seatsOf(token)
    if (mine.length === 0) return this.error(token, 'You are not in this race.')

    const trimmed = name.trim().slice(0, 12)
    if (trimmed.length === 0) return this.error(token, 'A snail needs a name.')

    for (const seat of mine) {
      this.seats[seat].name = trimmed
      if (this.game_) this.game_.players[seat].name = trimmed
    }
    return [this.broadcastRoom()]
  }

  private resize(token: string, size: number): Outbox[] {
    if (this.phase !== 'lobby') return this.error(token, 'The race has started.')
    if (this.seats[this.host].token !== token) return this.error(token, 'Only the host can do that.')
    if (size < MIN_SEATS || size > MAX_SEATS) {
      return this.error(token, `A race seats ${MIN_SEATS} to ${MAX_SEATS} snails.`)
    }

    // Shrinking past someone who is already sitting down would throw them out
    // of a room they were invited to.
    const claimed = this.seats.reduce(
      (highest, seat, index) => (seat.token !== null ? index : highest),
      0,
    )
    if (size <= claimed) return this.error(token, 'Someone is sitting in that seat.')

    const next = Array.from({ length: size }, (_, index) => seatFromPalette(index))
    for (let index = 0; index < Math.min(size, this.seats.length); index++) {
      next[index] = this.seats[index]
    }
    this.seats = next
    return [this.broadcastRoom()]
  }

  private start(token: string): Outbox[] {
    if (this.phase !== 'lobby') return this.error(token, 'The race has started.')
    if (this.seats[this.host].token !== token) return this.error(token, 'Only the host can start.')

    // Every seat nobody claimed plays itself, which is what lets two friends
    // and an AI make a legal race without the host thinking about it.
    const players: SeatState[] = this.seats.map((seat) => ({
      name: seat.name,
      color: seat.color,
      ink: seat.ink,
      kind: seat.token === null ? 'ai' : 'human',
      position: 0,
      away: false,
    }))

    this.phase = 'racing'
    this.game_ = startGame(players)

    // The starting line is not something to watch happen, so it goes out as a
    // snapshot rather than a beat. Any AI seats ahead of the first human then
    // follow as steps.
    return [
      this.broadcastRoom(),
      { to: 'all', message: { type: 'snapshot', game: this.game_ } },
      ...this.publish(this.driveAi()),
    ]
  }

  /** A game intent, once the sender has been shown to own the seat on the clock. */
  private act(token: string, play: (game: GameState) => Step[]): Outbox[] {
    if (this.phase !== 'racing' || !this.game_) return this.error(token, 'The race has not started.')
    if (!this.mayAct(token)) return this.error(token, 'Not your turn.')

    const steps = this.take(play(this.game_))
    if (steps.length === 0) return this.error(token, 'You cannot do that now.')

    return this.publish([...steps, ...this.driveAi()])
  }

  /** Runs `steps`, advancing the room's own state to where they end. */
  private take(steps: Step[]): Step[] {
    if (steps.length > 0) this.game_ = steps[steps.length - 1].state
    return steps
  }

  private publish(steps: Step[]): Outbox[] {
    if (steps.length === 0) return []
    return [{ to: 'all', message: { type: 'steps', steps } }]
  }

  /**
   * Plays AI and away seats until a connected player is on the clock.
   *
   * Bounded by whoever is watching. It stops at the first seat whose owner has
   * a socket open, so with a human present it runs at most the other seats;
   * with nobody connected it does not run at all, so an empty room cannot
   * quietly play itself to the finish. The guard below is for the degenerate
   * case where a watcher owns no seat at all.
   */
  private driveAi(): Step[] {
    const steps: Step[] = []
    if (this.idle) return steps

    for (let guard = 0; guard < MAX_SEATS * 2; guard++) {
      const game = this.game_
      if (!game || game.winner !== null) break

      const seat = this.seats[game.turn]
      const watching = seat.token !== null && this.connected.has(seat.token)
      if (watching) break

      const turn = this.playAiTurn()
      if (turn.length === 0) break
      steps.push(...turn)
    }

    return steps
  }

  /**
   * One AI turn, resolved end to end with no waiting.
   *
   * The pauses that make a turn readable belong to the client, which has to
   * animate the dice anyway — doing them here would mean a timer per beat, and
   * a timer is a billed wakeup.
   */
  private playAiTurn(): Step[] {
    const steps: Step[] = []
    const take = (next: Step[]) => {
      steps.push(...this.take(next))
      return next.length > 0
    }

    if (!take(apply(this.game_!, { kind: 'throw', roll: this.roll() }))) return steps

    for (let rerolls = 0; rerolls < MAX_AI_REROLLS; rerolls++) {
      const game = this.game_!
      if (game.winner !== null || !game.pending) return steps

      const action = decideAi(game.board, game.pending.value)
      if (action.kind === 'place') {
        take(apply(game, { kind: 'place', slot: action.slot }))
        return steps
      }
      take(apply(game, { kind: 'reroll', roll: this.roll() }))
    }

    // Exhausting the cap leaves a decision standing. Resolve it with the same
    // action a human giving up uses, so the turn actually ends.
    if (this.game_!.pending) take(apply(this.game_!, { kind: 'pass' }))
    return steps
  }

  /**
   * A socket closed.
   *
   * The seat keeps its token — that is what makes it reclaimable, and what
   * stops a ten-second wifi blip costing anyone their snail. The AI takes over
   * only when the seat's turn actually comes round, which `driveAi` decides
   * from `connected`, not from anything set here.
   */
  disconnect(token: string): Outbox[] {
    if (!this.connected.delete(token)) return []
    return [this.broadcastRoom()]
  }

  /**
   * A socket the transport still holds, told to the room rather than
   * discovered by it.
   *
   * Called once per socket right after a restore, before anything the socket
   * sends is handled. Without it, only whoever happens to speak first after a
   * hibernation-wake would count as connected, and every other seat's owner —
   * silent purely because it is not their turn — would look exactly like one
   * who left, and lose their turn to the AI while still sitting there.
   */
  reconnect(token: string): void {
    this.connected.add(token)
  }
}
