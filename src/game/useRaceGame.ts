import { useCallback, useRef, useState } from 'react'
import { useDiceRoll, type Face } from '../dice'
import {
  bidLabel,
  collectBid,
  doubleBonus,
  emptyBoard,
  legalSlots,
  placeBid,
  resolveRoll,
  type Board,
} from './bidding'
import { RACE_DICE } from './dice'
import type { Seat } from './seats'

export const TRACK_LENGTH = 30

export type Player = Seat & { position: number }

/** The dice have landed and the thrower owes the board a decision. */
export type Pending = {
  value: number
  faces: Face[]
  legal: number[]
  /** Throws made this turn. The first is safe; a cross on any later one busts. */
  throws: number
}

/** What a throw did, for a caller driving a turn without reading state. */
export type TurnOutcome =
  | { kind: 'won' }
  | { kind: 'bust' }
  | { kind: 'decide'; value: number; board: Board; legal: number[] }

function seatPlayers(roster: Seat[]): Player[] {
  return roster.map((seat) => ({ ...seat, position: 0 }))
}

/**
 * The whole game: state for rendering, and actions that also report what they
 * did.
 *
 * Actions return a `TurnOutcome` because an AI turn is an async script that
 * awaits a dice animation between steps. By the time step two runs, the
 * callback it calls was created in an earlier render and its closed-over state
 * is stale — so actions read from `live`, a mirror written synchronously
 * before each `setState`, and hand back what happened rather than expecting
 * the caller to go looking in state for it.
 */
export function useRaceGame(roster: Seat[]) {
  const [players, setPlayers] = useState<Player[]>(() => seatPlayers(roster))
  const [board, setBoard] = useState<Board>(emptyBoard)
  const [turn, setTurn] = useState(0)
  const [pending, setPending] = useState<Pending | null>(null)
  const [winner, setWinner] = useState<number | null>(null)
  const [log, setLog] = useState<string[]>([`${roster[0].name} to throw.`])

  const { recording, playId, rolling, roll, settle } = useDiceRoll(RACE_DICE)

  const live = useRef({
    players: seatPlayers(roster),
    board: emptyBoard(),
    turn: 0,
    winner: null as number | null,
    pending: null as Pending | null,
  })

  const writePlayers = useCallback((next: Player[]) => {
    live.current.players = next
    setPlayers(next)
  }, [])

  const writeBoard = useCallback((next: Board) => {
    live.current.board = next
    setBoard(next)
  }, [])

  const writeTurn = useCallback((next: number) => {
    live.current.turn = next
    setTurn(next)
  }, [])

  const writeWinner = useCallback((next: number | null) => {
    live.current.winner = next
    setWinner(next)
  }, [])

  const writePending = useCallback((next: Pending | null) => {
    live.current.pending = next
    setPending(next)
  }, [])

  const say = useCallback((...lines: string[]) => {
    setLog((previous) => [...lines, ...previous].slice(0, 6))
  }, [])

  /** Moves `index` by `spaces`, returning true when that wins the game. */
  const advance = useCallback(
    (index: number, spaces: number) => {
      const position = Math.min(TRACK_LENGTH, live.current.players[index].position + spaces)
      writePlayers(
        live.current.players.map((player, i) => (i === index ? { ...player, position } : player)),
      )
      return { position, won: position >= TRACK_LENGTH }
    },
    [writePlayers],
  )

  const endTurn = useCallback(() => {
    writePending(null)
    writeTurn((live.current.turn + 1) % live.current.players.length)
  }, [writePending, writeTurn])

  const throwDice = useCallback(
    async (throws: number): Promise<TurnOutcome> => {
      const current = live.current.turn
      const mover = live.current.players[current].name
      const faces = await roll()
      const rolled = resolveRoll(faces, throws === 1)

      if (rolled.kind === 'bust') {
        say(`${mover} rerolled into a cross and busts — no bid.`)
        endTurn()
        return { kind: 'bust' }
      }

      // A matching pair of numbers pays its value in spaces before any bidding,
      // and the bid goes ahead as well. Those spaces are banked: busting on a
      // later throw never takes them back.
      const bonus = doubleBonus(faces)
      if (bonus > 0) {
        const moved = advance(current, bonus)
        if (moved.won) {
          writeWinner(current)
          // A reroll leaves a decision standing; a won game must not keep
          // offering slots to place on.
          writePending(null)
          say(`${mover} threw double ${bonus} and reaches ${TRACK_LENGTH} — ${mover} wins!`)
          return { kind: 'won' }
        }
        say(`${mover} threw double ${bonus} and moves to ${moved.position}.`)
      }

      const currentBoard = live.current.board
      const legal = legalSlots(currentBoard, rolled.value)
      writePending({ value: rolled.value, faces, legal, throws })
      return { kind: 'decide', value: rolled.value, board: currentBoard, legal }
    },
    [advance, endTurn, roll, say, writePending, writeWinner],
  )

  const startTurn = useCallback(async (): Promise<TurnOutcome> => {
    if (live.current.winner !== null || live.current.pending !== null) return { kind: 'bust' }

    const current = live.current.turn
    const mover = live.current.players[current].name

    // A bid that survived until its owner's turn pays out: the slot it sits on
    // is how far they move, and it leaves the track either way.
    const collected = collectBid(live.current.board, current)
    writeBoard(collected.board)

    if (collected.slot !== null) {
      const moved = advance(current, collected.slot)
      if (moved.won) {
        writeWinner(current)
        say(`${mover} won slot ${collected.slot} and reaches ${TRACK_LENGTH} — ${mover} wins!`)
        return { kind: 'won' }
      }
      say(`${mover} won slot ${collected.slot} and moves to ${moved.position}.`)
    } else {
      say(`${mover} had no bid standing.`)
    }

    return throwDice(1)
  }, [advance, say, throwDice, writeBoard, writeWinner])

  const reroll = useCallback(async (): Promise<TurnOutcome> => {
    const current = live.current.pending
    if (!current || live.current.winner !== null) return { kind: 'bust' }
    return throwDice(current.throws + 1)
  }, [throwDice])

  const place = useCallback(
    (slot: number) => {
      const current = live.current.pending
      if (!current || live.current.winner !== null || !current.legal.includes(slot)) return

      const index = live.current.turn
      const mover = live.current.players[index].name
      const { board: next, evicted } = placeBid(live.current.board, slot, current.value, index)

      writeBoard(next)
      say(
        ...evicted.map(
          (bid) =>
            `${live.current.players[bid.player].name}'s ${bidLabel(bid.value)} on ${bid.slot} is knocked off.`,
        ),
        `${mover} bids ${bidLabel(current.value)} on slot ${slot}.`,
      )
      endTurn()
    },
    [endTurn, say, writeBoard],
  )

  const pass = useCallback(() => {
    if (!live.current.pending) return
    say(`${live.current.players[live.current.turn].name} gives up the throw — no bid.`)
    endTurn()
  }, [endTurn, say])

  const reset = useCallback(() => {
    live.current = {
      players: seatPlayers(roster),
      board: emptyBoard(),
      turn: 0,
      winner: null,
      pending: null,
    }
    setPlayers(live.current.players)
    setBoard(live.current.board)
    setTurn(0)
    setPending(null)
    setWinner(null)
    setLog([`${roster[0].name} to throw.`])
  }, [roster])

  return {
    players,
    board,
    turn,
    pending,
    winner,
    log,
    recording,
    playId,
    rolling,
    settle,
    startTurn,
    reroll,
    place,
    pass,
    reset,
  }
}
