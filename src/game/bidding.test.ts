import { describe, expect, test } from 'vitest'
import {
  DOUBLE_X,
  bidLabel,
  collectBid,
  emptyBoard,
  legalSlots,
  placeBid,
  resolveRoll,
  type Board,
} from './bidding'

/** Builds a board from `{ slot: value }`, all bids owned by distinct players. */
function board(bids: Record<number, number>): Board {
  const next = emptyBoard()
  let player = 0
  for (const [slot, value] of Object.entries(bids)) {
    next[Number(slot)] = { value, player: player++ }
  }
  return next
}

describe('legalSlots', () => {
  test('offers every slot on an empty board', () => {
    expect(legalSlots(emptyBoard(), 21)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  test('excludes slots that already hold a bid', () => {
    expect(legalSlots(board({ 3: 21 }), 64)).toEqual([0, 1, 2, 4, 5, 6])
  })

  test('excludes slots above a higher bid, since arriving there is instant death', () => {
    expect(legalSlots(board({ 2: 51 }), 43)).toEqual([0, 1])
  })

  test('allows a slot above an equal bid, because eviction needs a strictly higher value', () => {
    expect(legalSlots(board({ 2: 43 }), 43)).toEqual([0, 1, 3, 4, 5, 6])
  })

  test('returns nothing when the lowest slots are locked up by bigger bids', () => {
    expect(legalSlots(board({ 0: 66 }), 21)).toEqual([])
  })
})

describe('placeBid', () => {
  test('puts the bid on the chosen slot', () => {
    const { board: next } = placeBid(emptyBoard(), 4, 32, 1)
    expect(next[4]).toEqual({ value: 32, player: 1 })
  })

  test('evicts every higher slot it beats', () => {
    const { board: next, evicted } = placeBid(board({ 2: 30, 5: 42, 6: 25 }), 3, 51, 9)
    expect(next[5]).toBeNull()
    expect(next[6]).toBeNull()
    expect(evicted).toEqual([
      { slot: 5, value: 42, player: 1 },
      { slot: 6, value: 25, player: 2 },
    ])
  })

  test('leaves a lower slot alone even when it holds a smaller bid', () => {
    const { board: next, evicted } = placeBid(board({ 2: 30 }), 4, 51, 9)
    expect(next[2]).toEqual({ value: 30, player: 0 })
    expect(evicted).toEqual([])
  })

  test('leaves a higher slot alone when its bid is bigger', () => {
    const { board: next, evicted } = placeBid(board({ 4: 51 }), 1, 43, 9)
    expect(next[4]).toEqual({ value: 51, player: 0 })
    expect(evicted).toEqual([])
  })

  test('leaves a higher slot alone when the bids tie', () => {
    const { board: next, evicted } = placeBid(board({ 4: 43 }), 1, 43, 9)
    expect(next[4]).toEqual({ value: 43, player: 0 })
    expect(evicted).toEqual([])
  })

  test('does not mutate the board it was given', () => {
    const before = board({ 5: 42 })
    placeBid(before, 1, 51, 9)
    expect(before[5]).toEqual({ value: 42, player: 0 })
  })
})

describe('collectBid', () => {
  test('reports the slot a surviving bid won and takes it off the track', () => {
    const before = board({ 0: 21, 4: 55 })
    const { board: next, slot } = collectBid(before, 1)
    expect(slot).toBe(4)
    expect(next[4]).toBeNull()
    expect(next[0]).toEqual({ value: 21, player: 0 })
  })

  test('reports no slot when the player was evicted', () => {
    expect(collectBid(board({ 0: 21 }), 5).slot).toBeNull()
  })
})

describe('resolveRoll', () => {
  test('reads an opening throw high digit first', () => {
    expect(resolveRoll([5, 3], true)).toEqual({ kind: 'bid', value: 53 })
  })

  test('puts the higher digit first even when it is the second die', () => {
    expect(resolveRoll([3, 7], true)).toEqual({ kind: 'bid', value: 73 })
  })

  test('counts a cross on the opening throw as zero', () => {
    expect(resolveRoll([6, 'x'], true)).toEqual({ kind: 'bid', value: 60 })
  })

  test('counts a cross as zero whichever die shows it', () => {
    expect(resolveRoll(['x', 4], true)).toEqual({ kind: 'bid', value: 40 })
  })

  test('makes two crosses on the opening throw the strongest bid in the game', () => {
    expect(resolveRoll(['x', 'x'], true)).toEqual({ kind: 'bid', value: DOUBLE_X })
  })

  test('busts on a cross once the opening throw is past', () => {
    expect(resolveRoll([6, 'x'], false)).toEqual({ kind: 'bust' })
  })

  test('busts on two crosses after the opening throw, with no jackpot', () => {
    expect(resolveRoll(['x', 'x'], false)).toEqual({ kind: 'bust' })
  })

  test('scores a clean reroll normally', () => {
    expect(resolveRoll([5, 7], false)).toEqual({ kind: 'bid', value: 75 })
  })
})

describe('DOUBLE_X', () => {
  test('outbids the highest ordinary value', () => {
    expect(DOUBLE_X).toBeGreaterThan(76)
  })

  test('may be placed on any empty slot, since nothing can evict it', () => {
    expect(legalSlots(board({ 2: 76 }), DOUBLE_X)).toEqual([0, 1, 3, 4, 5, 6])
  })

  test('knocks off every higher slot when placed low', () => {
    const { evicted } = placeBid(board({ 4: 76, 6: 66 }), 1, DOUBLE_X, 9)
    expect(evicted.map((bid) => bid.slot)).toEqual([4, 6])
  })
})

describe('bidLabel', () => {
  test('shows a double cross as XX rather than its numeric stand-in', () => {
    expect(bidLabel(DOUBLE_X)).toBe('XX')
  })

  test('shows an ordinary value as its digits', () => {
    expect(bidLabel(53)).toBe('53')
  })
})
