import { describe, expect, test } from 'vitest'
import { DOUBLE_X, emptyBoard, type Board } from './bidding'
import { decideAi } from './ai'

/** Builds a board from `{ slot: value }`, each bid owned by a distinct player. */
function board(bids: Record<number, number>): Board {
  const next = emptyBoard()
  let player = 0
  for (const [slot, value] of Object.entries(bids)) {
    next[Number(slot)] = { value, player: player++ }
  }
  return next
}

describe('decideAi', () => {
  test('takes the highest slot that still knocks someone off', () => {
    // 63 is legal on 0-4 and on 6; only 0-4 evict the 42 sitting on slot 5.
    expect(decideAi(board({ 5: 42 }), 63)).toEqual({ kind: 'place', slot: 4 })
  })

  test('prefers a slot that evicts over a higher one that does not', () => {
    // Slot 6 is legal but has nothing above it to knock off; slot 2 evicts.
    expect(decideAi(board({ 3: 20 }), 55)).toEqual({ kind: 'place', slot: 2 })
  })

  test('rerolls when a target exists but this value cannot reach it', () => {
    expect(decideAi(board({ 2: 65 }), 33)).toEqual({ kind: 'reroll' })
  })

  test('settles on the highest slot when the only bid sits on slot 0', () => {
    // Nothing is below slot 0, so that bid can never be evicted — there is
    // nothing to chase, and rerolling would only risk a bust.
    expect(decideAi(board({ 0: 21 }), 53)).toEqual({ kind: 'place', slot: 6 })
  })

  test('settles rather than chasing a 76, which no reroll can beat', () => {
    // Beating 76 needs 77, and 77 is XX, which a reroll can never produce.
    expect(decideAi(board({ 1: 76 }), 53)).toEqual({ kind: 'place', slot: 0 })
  })

  test('settles on the highest slot when the track is empty', () => {
    expect(decideAi(emptyBoard(), 31)).toEqual({ kind: 'place', slot: 6 })
  })

  test('rerolls when no slot is legal at all', () => {
    expect(decideAi(board({ 0: 66 }), 21)).toEqual({ kind: 'reroll' })
  })

  test('places a double cross on the highest evicting slot, with no special case', () => {
    expect(decideAi(board({ 5: 42 }), DOUBLE_X)).toEqual({ kind: 'place', slot: 4 })
  })
})
