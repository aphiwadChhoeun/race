import type { GameState, Step } from './state'

/** How a seat looks to everyone in the room. */
export type SeatView = {
  name: string
  color: string
  ink: string
  /** `ai` is a seat nobody has claimed; it plays itself. */
  kind: 'human' | 'ai'
  /** A human whose socket has gone. Never true of an AI seat. */
  away: boolean
}

export type RoomView = {
  code: string
  phase: 'lobby' | 'racing'
  /** The seat the host sits in. Only the host may start or resize. */
  host: number
  seats: SeatView[]
}

export type ClientMessage =
  /**
   * `claim` is which seats to take, and is how hotseat works: local play
   * claims every human seat with one token, and the authorisation rule then
   * needs no special case for it.
   *
   * A number takes that many free seats, lowest first — what an arrival over
   * the network wants, and the Worker forces it to 1, one browser one snail.
   * An array takes exactly those seats, which is what the lobby needs: it
   * lets you make seat 1 human and seat 0 an AI, so the seats cannot simply
   * be counted off from the front.
   */
  | { type: 'hello'; token: string; create?: boolean; size?: number; claim?: number | number[] }
  | { type: 'rename'; name: string }
  | { type: 'resize'; size: number }
  | { type: 'start' }
  | { type: 'throw' }
  | { type: 'reroll' }
  | { type: 'place'; slot: number }

export type ServerMessage =
  /**
   * You are in. `seats` is every seat this token owns — usually one, but
   * local play owns all of them, which is how hotseat works without the
   * authorisation rule needing a special case.
   *
   * `game` is non-null when you arrive mid-race: adopt it and jump to the
   * present rather than replaying what you missed.
   */
  | { type: 'welcome'; token: string; seats: number[]; room: RoomView; game: GameState | null }
  | { type: 'room'; room: RoomView }
  /**
   * Adopt this state now and drop anything queued.
   *
   * Sent when a race starts — there are no beats to watch on the way to the
   * starting line — and it is the same jump-to-the-present a reconnecting
   * player gets through `welcome`.
   */
  | { type: 'snapshot'; game: GameState }
  | { type: 'steps'; steps: Step[] }
  | { type: 'error'; reason: string; fatal: boolean }

/**
 * A message and who it goes to. `'all'` is every connected socket.
 *
 * The room never touches a socket — it returns these and lets the Durable
 * Object post them. That is what keeps the whole multiplayer brain testable
 * under plain vitest, with no Workers runner and nothing mocked.
 */
export type Outbox = { to: 'all' | string; message: ServerMessage }
