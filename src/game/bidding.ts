import type { Face } from '../dice'

/**
 * Both dice showing a cross on the opening throw: the strongest bid there is.
 *
 * Stored one above the `76` ceiling so it wins through the ordinary comparison
 * in `legalSlots` and `placeBid` — those two know nothing about it. Rendered as
 * `XX` by `bidLabel`, never as a number.
 */
export const DOUBLE_X = 77

export type Roll = { kind: 'bust' } | { kind: 'bid'; value: number }

/**
 * What a throw is worth.
 *
 * The opening throw of a turn is safe: a cross on it is merely a zero digit,
 * and two are a jackpot. Every throw after that is the gamble — one cross and
 * the turn is over.
 */
export function resolveRoll(faces: Face[], isFirstRoll: boolean): Roll {
  const crosses = faces.filter((face) => face === 'x').length

  if (crosses > 0 && !isFirstRoll) return { kind: 'bust' }
  if (crosses > 0 && crosses === faces.length) return { kind: 'bid', value: DOUBLE_X }

  const digits = faces.map((face) => (face === 'x' ? 0 : face)).sort((a, b) => b - a)
  return { kind: 'bid', value: digits[0] * 10 + digits[1] }
}

/**
 * Spaces a throw moves its thrower for free, before any bidding.
 *
 * Two dice showing the same *number* pay that number. Two crosses never do:
 * on an opening throw they are the `XX` jackpot and on any later throw they
 * are a bust, so a cross is worth no movement either way. A bust and a paying
 * double are therefore mutually exclusive — a bust needs a cross present.
 *
 * With the game's dice this can only ever be 1, 2 or 3: those are the only
 * values die A and die B share.
 */
export function doubleBonus(faces: Face[]): number {
  const [first, second] = faces
  if (first === 'x' || first !== second) return 0
  return first
}

/** How a bid value is written on the board. */
export function bidLabel(value: number): string {
  return value === DOUBLE_X ? 'XX' : String(value)
}

/** How a single face is written for the player: the bust mark reads `X`. */
export function faceLabel(face: Face): string {
  return face === 'x' ? 'X' : String(face)
}

/** Slots on the bidding track. A slot's index is how far its winner moves. */
export const SLOTS = 7

export type Bid = {
  value: number
  player: number
}

/** One entry per slot, `null` where nothing has been bid. */
export type Board = (Bid | null)[]

export function emptyBoard(): Board {
  return Array.from({ length: SLOTS }, () => null)
}

/**
 * Where `value` may be placed.
 *
 * A slot is open when it is empty and no lower slot holds a bigger value —
 * landing under one would just be evicted on someone's next placement, so the
 * rules forbid it outright.
 */
export function legalSlots(board: Board, value: number): number[] {
  const open: number[] = []
  let highestBelow = 0

  for (let slot = 0; slot < board.length; slot++) {
    if (value >= highestBelow && board[slot] === null) open.push(slot)
    const bid = board[slot]
    if (bid && bid.value > highestBelow) highestBelow = bid.value
  }

  return open
}

export type Eviction = Bid & { slot: number }

/**
 * Drops `value` on `slot` and knocks off every bid it outbids — that is, every
 * bid sitting on a higher slot for a strictly lower value.
 *
 * Callers are expected to have checked `legalSlots` first.
 */
export function placeBid(
  board: Board,
  slot: number,
  value: number,
  player: number,
): { board: Board; evicted: Eviction[] } {
  const next = [...board]
  const evicted: Eviction[] = []

  next[slot] = { value, player }

  for (let above = slot + 1; above < next.length; above++) {
    const bid = next[above]
    if (!bid || bid.value >= value) continue
    evicted.push({ slot: above, ...bid })
    next[above] = null
  }

  return { board: next, evicted }
}

/**
 * Takes `player`'s surviving bid off the track at the top of their turn.
 *
 * `slot` is both where the bid sat and how many spaces they move; it is null
 * when someone outbid them before their turn came round.
 */
export function collectBid(board: Board, player: number): { board: Board; slot: number | null } {
  const slot = board.findIndex((bid) => bid?.player === player)
  if (slot === -1) return { board, slot: null }

  const next = [...board]
  next[slot] = null
  return { board: next, slot }
}
