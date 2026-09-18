import { legalSlots, placeBid, type Board } from './bidding'

/**
 * The best value a reroll can produce.
 *
 * `XX` (77) beats everything, but only an opening throw can make one — after
 * that a cross busts. So 7 with 6 is the real ceiling, and a standing 76 is
 * unbeatable in practice even though a 77 would beat it on paper.
 */
export const MAX_REROLL_VALUE = 76

export type AiAction = { kind: 'place'; slot: number } | { kind: 'reroll' }

/**
 * Whether the board holds anything worth chasing.
 *
 * A bid is a target only if some achievable roll could actually take it: there
 * must be an empty slot below it where a `MAX_REROLL_VALUE` would be both
 * legal and a strict improvement. Two cases fail that and would otherwise trap
 * the AI into rerolling to a bust every turn for as long as the bid stands — a
 * bid on slot 0, which has nothing beneath it, and a bid of 76, which nothing
 * reachable beats.
 */
function hasReachableTarget(board: Board): boolean {
  const reach = legalSlots(board, MAX_REROLL_VALUE)

  return board.some((bid, slot) => {
    if (!bid || bid.value >= MAX_REROLL_VALUE) return false
    return reach.some((open) => open < slot)
  })
}

/**
 * What the AI does with the value it just rolled.
 *
 * Deliberately ignorant of how many times it has thrown this turn: the
 * strategy is the same on every throw, and a throw count would only invite
 * someone to branch on it.
 */
export function decideAi(board: Board, value: number): AiAction {
  const legal = legalSlots(board, value)
  if (legal.length === 0) return { kind: 'reroll' }

  // `legalSlots` returns ascending, so the last entry is always the highest.
  const highest = (slots: number[]) => slots[slots.length - 1]

  if (!hasReachableTarget(board)) return { kind: 'place', slot: highest(legal) }

  // Ask the real rule which placements evict, rather than reimplementing it.
  // The owner id is irrelevant to eviction, so any value will do.
  const evicting = legal.filter((slot) => placeBid(board, slot, value, -1).evicted.length > 0)
  if (evicting.length === 0) return { kind: 'reroll' }

  return { kind: 'place', slot: highest(evicting) }
}
