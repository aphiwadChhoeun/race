import { DOUBLE_X, legalSlots, placeBid, type Board } from './bidding'

/**
 * The best value a reroll can produce.
 *
 * `XX` (77) beats everything, but only an opening throw can make one — after
 * that a cross busts. So 7 with 6 is the real ceiling, and a standing 76 is
 * unbeatable in practice even though a 77 would beat it on paper. Derived
 * from `DOUBLE_X` rather than written as a bare 76, so the two stay in sync
 * if the board's jackpot value ever changes.
 */
export const MAX_REROLL_VALUE = DOUBLE_X - 1

export type AiAction = { kind: 'place'; slot: number } | { kind: 'reroll' }

/**
 * Whether the board holds anything worth chasing.
 *
 * A bid is a target only if some achievable roll could actually take it: there
 * must be an empty slot below it, and the bid must be beatable by a
 * `MAX_REROLL_VALUE`. Two cases fail that and would otherwise trap the AI into
 * rerolling to a bust every turn for as long as the bid stands — a bid on slot
 * 0, which has nothing beneath it, and a bid of 76, which nothing reachable
 * beats.
 */
function hasReachableTarget(board: Board): boolean {
  const open = legalSlots(board)

  return board.some((bid, slot) => {
    if (!bid || bid.value >= MAX_REROLL_VALUE) return false
    return open.some((empty) => empty < slot)
  })
}

/**
 * Empty slots that no standing bid already beats from below.
 *
 * The rules let a throw land anywhere empty, including above a bigger bid —
 * but a bid placed there is free for the taking, since anything beating this
 * value knocks it off from any of the slots beneath. This is the AI's
 * preference, not a rule: it still takes an exposed slot when nothing else is
 * left, because a bid that might be evicted still beats no bid at all.
 */
function holdableSlots(board: Board, value: number): number[] {
  const open: number[] = []
  let highestBelow = 0

  for (let slot = 0; slot < board.length; slot++) {
    if (value >= highestBelow && board[slot] === null) open.push(slot)
    const bid = board[slot]
    if (bid && bid.value > highestBelow) highestBelow = bid.value
  }

  return open
}

/**
 * What the AI does with the value it just rolled.
 *
 * Deliberately ignorant of how many times it has thrown this turn: the
 * strategy is the same on every throw, and a throw count would only invite
 * someone to branch on it.
 */
export function decideAi(board: Board, value: number): AiAction {
  const legal = legalSlots(board)

  // `legalSlots` returns ascending, so the last entry is always the highest.
  const highest = (slots: number[]) => slots[slots.length - 1]

  if (!hasReachableTarget(board)) {
    const holdable = holdableSlots(board, value)
    return { kind: 'place', slot: highest(holdable.length > 0 ? holdable : legal) }
  }

  // Ask the real rule which placements evict, rather than reimplementing it.
  // The owner id is irrelevant to eviction, so any value will do.
  const evicting = legal.filter((slot) => placeBid(board, slot, value, -1).evicted.length > 0)
  if (evicting.length === 0) return { kind: 'reroll' }

  return { kind: 'place', slot: highest(evicting) }
}
