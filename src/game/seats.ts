/**
 * Who sits at the table.
 *
 * A seat is chosen in the lobby and never changes during a game. The game
 * itself only cares about `kind`, to decide whether a turn waits for a click
 * or plays itself.
 */

export type SeatKind = 'human' | 'ai'

export type Seat = {
  name: string
  color: string
  kind: SeatKind
}

export const MIN_SEATS = 3
export const MAX_SEATS = 6

/**
 * Seat identities, in turn order. The first two keep the colours the
 * two-player game used, so a returning player recognises them.
 */
export const SEAT_PALETTE: readonly { name: string; color: string }[] = [
  { name: 'Red', color: '#e2574c' },
  { name: 'Blue', color: '#4c7fe2' },
  { name: 'Green', color: '#4caf6d' },
  { name: 'Amber', color: '#d99b3f' },
  { name: 'Violet', color: '#9b6bd6' },
  { name: 'Teal', color: '#3fb4b4' },
]

/** A table of `count` seats: you, and AI for the rest. */
export function defaultRoster(count: number): Seat[] {
  return SEAT_PALETTE.slice(0, count).map((seat, index) => ({
    ...seat,
    kind: index === 0 ? 'human' : 'ai',
  }))
}
