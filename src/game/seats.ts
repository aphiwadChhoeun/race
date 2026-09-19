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
  /** The snail's shell colour: fills, trails and tokens. Vibrant, not legible. */
  color: string
  /** A darker cast of `color` for text, which `color` is too bright to carry. */
  ink: string
  kind: SeatKind
}

export const MIN_SEATS = 3
export const MAX_SEATS = 6

/**
 * Seat identities, in turn order.
 *
 * Every seat carries two shades of one hue because the theme is light: a
 * saturated `color` bright enough to read as a cartoon shell against grass,
 * and an `ink` dark enough to clear 4.5:1 on the cream card its name sits on.
 * One colour cannot do both jobs — a shell bright enough to be fun is a name
 * too pale to read.
 */
export const SEAT_PALETTE: readonly { name: string; color: string; ink: string }[] = [
  { name: 'Turbo', color: '#ff5a4e', ink: '#c2291d' },
  { name: 'Zippy', color: '#2e9bff', ink: '#0a5fae' },
  { name: 'Pesto', color: '#57d13c', ink: '#2b7a1b' },
  { name: 'Toffee', color: '#ffb020', ink: '#a66200' },
  { name: 'Bubbles', color: '#a86bff', ink: '#6b2fc4' },
  { name: 'Minty', color: '#1fd1c1', ink: '#0a7f74' },
]

/** A table of `count` seats: you, and AI for the rest. */
export function defaultRoster(count: number): Seat[] {
  return SEAT_PALETTE.slice(0, count).map((seat, index) => ({
    ...seat,
    kind: index === 0 ? 'human' : 'ai',
  }))
}
