import { faceOf, type Face } from '../dice/faces'
import { emptyBoard, type Board } from './bidding'
import { RACE_DICE } from './dice'
import type { Seat } from './seats'

/** Spaces from the starting line to the finish. */
export const TRACK_LENGTH = 30

/**
 * A seat, mid-race.
 *
 * `away` is a human whose socket has gone. It is deliberately a field of its
 * own rather than flipping `kind` to `'ai'`: an away human is still a human,
 * and the seat is owed back to them if they return. The room plays an away
 * seat with the AI when its turn comes round, which is a decision about *this
 * turn*, not a change of who the seat belongs to.
 */
export type SeatState = Seat & { position: number; away: boolean }

/** The dice have landed and the thrower owes the board a decision. */
export type Pending = {
  value: number
  faces: Face[]
  legal: number[]
  /** Throws made this turn. The first is safe; a cross on any later one busts. */
  throws: number
}

export type GameState = {
  players: SeatState[]
  board: Board
  turn: number
  pending: Pending | null
  winner: number | null
  log: string[]
}

/**
 * A throw, described completely enough for any client to replay it.
 *
 * The room decides this once, from the CSPRNG; every client feeds it to
 * `throwDice` and watches the same tumble land on the same faces. No physics
 * crosses the wire, and no client gets a say in the outcome.
 */
export type Roll = { seed: number; faceIds: number[] }

/**
 * A beat of play.
 *
 * The events carry no detail beyond who caused them — the state's `log`
 * already says what happened, and duplicating it here would be two places to
 * keep in step. What a client needs from an event is whether to animate
 * (`threw` carries the roll) and whose beat it is, so it knows whether to
 * pause for it.
 */
export type GameEvent =
  | { kind: 'threw'; seat: number; roll: Roll }
  | { kind: 'collected'; seat: number }
  | { kind: 'bid'; seat: number }
  | { kind: 'busted'; seat: number }
  | { kind: 'passed'; seat: number }
  | { kind: 'won'; seat: number }

/** What happened, and the state it left behind. */
export type Step = { event: GameEvent; state: GameState }

export type GameIntent =
  | { kind: 'throw'; roll: Roll }
  | { kind: 'reroll'; roll: Roll }
  | { kind: 'place'; slot: number }
  | { kind: 'pass' }

export function startGame(players: SeatState[]): GameState {
  return {
    players,
    board: emptyBoard(),
    turn: 0,
    pending: null,
    winner: null,
    log: [`${players[0].name} to throw.`],
  }
}

/** What a roll shows, resolved through the dice that made it. */
export function facesOf(roll: Roll): Face[] {
  return roll.faceIds.map((id, index) => faceOf(RACE_DICE[index], id))
}
