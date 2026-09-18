import { describe, expect, test } from 'vitest'
import { MAX_SEATS, MIN_SEATS, SEAT_PALETTE, defaultRoster } from './seats'

describe('SEAT_PALETTE', () => {
  test('holds one identity per seat the game can seat', () => {
    expect(SEAT_PALETTE).toHaveLength(MAX_SEATS)
  })

  test('keeps the colours the two-player game used for the first two seats', () => {
    expect(SEAT_PALETTE[0]).toEqual({ name: 'Red', color: '#e2574c' })
    expect(SEAT_PALETTE[1]).toEqual({ name: 'Blue', color: '#4c7fe2' })
  })

  test('gives every seat a distinct name and colour', () => {
    expect(new Set(SEAT_PALETTE.map((s) => s.name)).size).toBe(MAX_SEATS)
    expect(new Set(SEAT_PALETTE.map((s) => s.color)).size).toBe(MAX_SEATS)
  })
})

describe('defaultRoster', () => {
  test('takes identities from the palette in order', () => {
    expect(defaultRoster(3).map((s) => s.name)).toEqual(['Red', 'Blue', 'Green'])
  })

  test('seats one human and fills the rest with AI', () => {
    expect(defaultRoster(4).map((s) => s.kind)).toEqual(['human', 'ai', 'ai', 'ai'])
  })

  test('seats the largest table the game allows', () => {
    expect(defaultRoster(MIN_SEATS)).toHaveLength(3)
    expect(defaultRoster(MAX_SEATS)).toHaveLength(6)
  })
})
