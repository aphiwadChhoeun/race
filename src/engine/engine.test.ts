import { describe, expect, test } from 'vitest'
import type { Face } from '../dice/faces'
import { DOUBLE_X } from './bidding'
import { DIE_A, DIE_B } from './dice'
import { apply } from './engine'
import { TRACK_LENGTH, startGame, type GameState, type Roll, type SeatState } from './state'

const seat = (name: string, kind: 'human' | 'ai' = 'human'): SeatState => ({
  name,
  color: '#000000',
  ink: '#000000',
  kind,
  position: 0,
  away: false,
})

const three = (): GameState => startGame([seat('A'), seat('B'), seat('C')])

/**
 * A roll that lands exactly `faces`.
 *
 * Looked up on the real dice rather than hand-written, so a test says what it
 * means — "throw a 6 and a 4" — and stays true if a die is ever re-cut.
 */
function roll(a: Face, b: Face): Roll {
  const ia = DIE_A.indexOf(a)
  const ib = DIE_B.indexOf(b)
  if (ia < 0 || ib < 0) throw new Error(`no such faces: ${String(a)}, ${String(b)}`)
  return { seed: 1, faceIds: [ia + 1, ib + 1] }
}

const last = (steps: { state: GameState }[]) => steps[steps.length - 1].state
const kinds = (steps: { event: { kind: string } }[]) => steps.map((s) => s.event.kind)

describe('apply', () => {
  test('opens a turn by collecting nothing, then throwing', () => {
    const steps = apply(three(), { kind: 'throw', roll: roll(6, 4) })
    expect(kinds(steps)).toEqual(['collected', 'threw'])
    expect(last(steps).pending?.value).toBe(64)
  })

  test('pays a standing bid its slot in spaces at the top of the turn', () => {
    const state = three()
    state.board[5] = { value: 40, player: 0 }
    const steps = apply(state, { kind: 'throw', roll: roll(6, 4) })
    expect(last(steps).players[0].position).toBe(5)
    expect(last(steps).board[5]).toBeNull()
  })

  test('banks a double before the bid, and keeps the bid open', () => {
    const steps = apply(three(), { kind: 'throw', roll: roll(3, 3) })
    expect(last(steps).players[0].position).toBe(3)
    expect(last(steps).pending?.value).toBe(33)
  })

  test('reads two crosses on the opening throw as the jackpot', () => {
    const steps = apply(three(), { kind: 'throw', roll: roll('x', 'x') })
    expect(last(steps).pending?.value).toBe(DOUBLE_X)
  })

  test('busts on a cross after the opening throw, ending the turn', () => {
    const opened = last(apply(three(), { kind: 'throw', roll: roll(6, 4) }))
    const steps = apply(opened, { kind: 'reroll', roll: roll('x', 2) })
    // Two beats, not one: you have to watch the cross land before being told
    // it cost you the turn.
    expect(kinds(steps)).toEqual(['threw', 'busted'])
    expect(last(steps).pending).toBeNull()
    expect(last(steps).turn).toBe(1)
  })

  /* Spaces from a double are paid before any bidding and never taken back —
     busting later costs the bid, not the ground already covered. */
  test('keeps the spaces a double paid even when a later throw busts', () => {
    const opened = last(apply(three(), { kind: 'throw', roll: roll(3, 3) }))
    const busted = last(apply(opened, { kind: 'reroll', roll: roll('x', 2) }))
    expect(busted.players[0].position).toBe(3)
  })

  test('places a bid, knocks off what it outbids, and hands over the turn', () => {
    const opened = three()
    opened.board[4] = { value: 21, player: 1 }
    const thrown = last(apply(opened, { kind: 'throw', roll: roll(6, 4) }))
    const state = last(apply(thrown, { kind: 'place', slot: 2 }))
    expect(state.board[2]).toEqual({ value: 64, player: 0 })
    expect(state.board[4]).toBeNull()
    expect(state.turn).toBe(1)
  })

  /* The log reads newest first, and an eviction is a consequence of the bid —
     so it sits above the bid that caused it. */
  test('narrates an eviction above the bid that caused it', () => {
    const opened = three()
    opened.board[4] = { value: 21, player: 1 }
    const thrown = last(apply(opened, { kind: 'throw', roll: roll(6, 4) }))
    const log = last(apply(thrown, { kind: 'place', slot: 2 })).log
    expect(log[0]).toContain("B's 21 on 4 is knocked off")
    expect(log[1]).toContain('A bids 64 on slot 2')
  })

  test('wins when a collected slot reaches the end of the track', () => {
    const state = three()
    state.players[0].position = TRACK_LENGTH - 3
    state.board[3] = { value: 40, player: 0 }
    const steps = apply(state, { kind: 'throw', roll: roll(6, 4) })
    expect(kinds(steps)).toEqual(['collected', 'won'])
    expect(last(steps).winner).toBe(0)
  })

  /* A win has to close the decision too. A throw that wins on a double while a
     bid is pending would otherwise leave slots live to click on a game that is
     already over. */
  test('closes any standing decision when a double wins the race', () => {
    const state = three()
    state.players[0].position = TRACK_LENGTH - 3
    const steps = apply(state, { kind: 'throw', roll: roll(3, 3) })
    expect(kinds(steps)).toEqual(['collected', 'threw', 'won'])
    expect(last(steps).winner).toBe(0)
    expect(last(steps).pending).toBeNull()
  })

  test('gives up the throw on a pass, with no bid and no movement', () => {
    const thrown = last(apply(three(), { kind: 'throw', roll: roll(6, 4) }))
    const steps = apply(thrown, { kind: 'pass' })
    expect(kinds(steps)).toEqual(['passed'])
    expect(last(steps).board.every((slot) => slot === null)).toBe(true)
    expect(last(steps).turn).toBe(1)
  })

  test('wraps the turn back round to the first seat', () => {
    let state = three()
    for (let seatIndex = 0; seatIndex < 3; seatIndex++) {
      state = last(apply(state, { kind: 'throw', roll: roll(6, 4) }))
      state = last(apply(state, { kind: 'place', slot: seatIndex }))
    }
    expect(state.turn).toBe(0)
  })

  /* Totality matters more here than anywhere else: the room hands this
     whatever a client sent, and an engine that threw would take the room's
     Durable Object down with it. */
  test('ignores an intent that is not legal in this state', () => {
    expect(apply(three(), { kind: 'place', slot: 2 })).toEqual([])
    expect(apply(three(), { kind: 'reroll', roll: roll(6, 4) })).toEqual([])
    expect(apply(three(), { kind: 'pass' })).toEqual([])
  })

  test('ignores every intent once the race is won', () => {
    const won: GameState = { ...three(), winner: 1 }
    expect(apply(won, { kind: 'throw', roll: roll(6, 4) })).toEqual([])
    expect(apply(won, { kind: 'place', slot: 0 })).toEqual([])
  })

  test('ignores a second throw while a decision is standing', () => {
    const thrown = last(apply(three(), { kind: 'throw', roll: roll(6, 4) }))
    expect(apply(thrown, { kind: 'throw', roll: roll(5, 2) })).toEqual([])
  })

  test('ignores a placement on a slot that is already taken', () => {
    const opened = three()
    opened.board[2] = { value: 21, player: 1 }
    const thrown = last(apply(opened, { kind: 'throw', roll: roll(6, 4) }))
    expect(apply(thrown, { kind: 'place', slot: 2 })).toEqual([])
  })

  test('leaves the state it was given untouched', () => {
    const state = three()
    const before = JSON.stringify(state)
    apply(state, { kind: 'throw', roll: roll(6, 4) })
    expect(JSON.stringify(state)).toBe(before)
  })
})
