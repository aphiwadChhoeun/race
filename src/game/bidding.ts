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

/** The value a pair of dice bids: the higher face first, so 3 and 5 read 53. */
export function bidValue(faces: number[]): number {
  const [high, low] = [...faces].sort((a, b) => b - a)
  return high * 10 + low
}
