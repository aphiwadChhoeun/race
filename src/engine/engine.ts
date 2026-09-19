import { bidLabel, collectBid, doubleBonus, legalSlots, placeBid, resolveRoll } from './bidding'
import {
  TRACK_LENGTH,
  facesOf,
  type GameEvent,
  type GameIntent,
  type GameState,
  type Roll,
  type Step,
} from './state'

/** Newest first, same as the panel reads it. */
function say(state: GameState, ...lines: string[]): GameState {
  return { ...state, log: [...lines, ...state.log].slice(0, 6) }
}

/** Moves `seat` by `spaces`, reporting whether that wins the race. */
function move(state: GameState, seat: number, spaces: number) {
  const position = Math.min(TRACK_LENGTH, state.players[seat].position + spaces)
  const players = state.players.map((player, index) =>
    index === seat ? { ...player, position } : player,
  )
  return { state: { ...state, players }, position, won: position >= TRACK_LENGTH }
}

function endTurn(state: GameState): GameState {
  return { ...state, pending: null, turn: (state.turn + 1) % state.players.length }
}

const step = (event: GameEvent, state: GameState): Step => ({ event, state })

/**
 * Throws, and leaves the board owing a decision.
 *
 * `throws` counts this throw: the first of a turn is safe, and a cross on any
 * later one busts.
 */
function throwStep(state: GameState, roll: Roll, throws: number): Step[] {
  const seat = state.turn
  const mover = state.players[seat].name
  const faces = facesOf(roll)
  const rolled = resolveRoll(faces, throws === 1)

  if (rolled.kind === 'bust') {
    const next = endTurn(say(state, `${mover} rerolled into a cross and busts — no bid.`))
    return [step({ kind: 'threw', seat, roll }, state), step({ kind: 'busted', seat }, next)]
  }

  // A matching pair of numbers pays its value in spaces before any bidding,
  // and the bid goes ahead as well. Those spaces are banked: busting on a
  // later throw never takes them back.
  const bonus = doubleBonus(faces)
  let next = state
  let bonusLine: string | null = null

  if (bonus > 0) {
    const moved = move(next, seat, bonus)
    next = moved.state
    if (moved.won) {
      // A reroll leaves a decision standing; a won game must not keep offering
      // slots to place on.
      const won = say(
        { ...next, winner: seat, pending: null },
        `${mover} threw double ${bonus} and reaches ${TRACK_LENGTH} — ${mover} wins!`,
      )
      return [step({ kind: 'threw', seat, roll }, next), step({ kind: 'won', seat }, won)]
    }
    bonusLine = `${mover} threw double ${bonus} and moves to ${moved.position}.`
  }

  const pending = { value: rolled.value, faces, legal: legalSlots(next.board), throws }
  const decided = say({ ...next, pending }, ...(bonusLine ? [bonusLine] : []))
  return [step({ kind: 'threw', seat, roll }, decided)]
}

/**
 * Advances the game by one intent, as the sequence of beats a player watches.
 *
 * Beats rather than a single new state because each one is something to see
 * happen: collecting a slot and the throw that follows it are a move and then
 * a throw, not one indivisible jump, and a log that gained three lines at once
 * would be a log nobody read.
 *
 * Total, and deliberately so. An intent that is not legal here returns no
 * steps and changes nothing — the room hands this whatever a client sent, and
 * an engine that threw on bad input would take the room down with it. It does
 * not decide *who* may send an intent; `room.ts` owns that, which keeps this a
 * pure function of the board.
 */
export function apply(state: GameState, intent: GameIntent): Step[] {
  if (state.winner !== null) return []

  switch (intent.kind) {
    case 'throw': {
      if (state.pending !== null) return []

      const seat = state.turn
      const mover = state.players[seat].name

      // A bid that survived until its owner's turn pays out: the slot it sits
      // on is how far they move, and it leaves the track either way.
      const collected = collectBid(state.board, seat)
      let next: GameState = { ...state, board: collected.board }

      if (collected.slot !== null) {
        const moved = move(next, seat, collected.slot)
        next = moved.state
        if (moved.won) {
          const won = say(
            { ...next, winner: seat },
            `${mover} won slot ${collected.slot} and reaches ${TRACK_LENGTH} — ${mover} wins!`,
          )
          return [step({ kind: 'collected', seat }, next), step({ kind: 'won', seat }, won)]
        }
        next = say(next, `${mover} won slot ${collected.slot} and moves to ${moved.position}.`)
      } else {
        next = say(next, `${mover} had no bid standing.`)
      }

      return [step({ kind: 'collected', seat }, next), ...throwStep(next, intent.roll, 1)]
    }

    case 'reroll': {
      if (!state.pending) return []
      return throwStep(state, intent.roll, state.pending.throws + 1)
    }

    case 'place': {
      const pending = state.pending
      if (!pending || !pending.legal.includes(intent.slot)) return []

      const seat = state.turn
      const mover = state.players[seat].name
      const { board, evicted } = placeBid(state.board, intent.slot, pending.value, seat)

      const next = endTurn(
        say(
          { ...state, board },
          ...evicted.map(
            (bid) =>
              `${state.players[bid.player].name}'s ${bidLabel(bid.value)} on ${bid.slot} is knocked off.`,
          ),
          `${mover} bids ${bidLabel(pending.value)} on slot ${intent.slot}.`,
        ),
      )
      return [step({ kind: 'bid', seat }, next)]
    }

    case 'pass': {
      if (!state.pending) return []
      const seat = state.turn
      const next = endTurn(say(state, `${state.players[seat].name} gives up the throw — no bid.`))
      return [step({ kind: 'passed', seat }, next)]
    }
  }
}
