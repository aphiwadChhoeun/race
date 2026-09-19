import { describe, expect, test } from 'vitest'
import { MAX_SEATS, MIN_SEATS, SEAT_PALETTE, defaultRoster } from './seats'

describe('SEAT_PALETTE', () => {
  test('holds one identity per seat the game can seat', () => {
    expect(SEAT_PALETTE).toHaveLength(MAX_SEATS)
  })

  test('leads with the two snails a returning player recognises', () => {
    expect(SEAT_PALETTE[0]).toEqual({ name: 'Turbo', color: '#ff5a4e', ink: '#c2291d' })
    expect(SEAT_PALETTE[1]).toEqual({ name: 'Zippy', color: '#2e9bff', ink: '#0a5fae' })
  })

  test('gives every seat a distinct name and colour', () => {
    expect(new Set(SEAT_PALETTE.map((s) => s.name)).size).toBe(MAX_SEATS)
    expect(new Set(SEAT_PALETTE.map((s) => s.color)).size).toBe(MAX_SEATS)
  })

  /* The shell colour is for fills and the ink for text: a seat that shipped
     with only one of them would render a name in a shade tuned to be bright
     against grass, not readable on cream. */
  test('gives every seat both a shell colour and a darker ink', () => {
    for (const seat of SEAT_PALETTE) {
      expect(seat.color).toMatch(/^#[0-9a-f]{6}$/)
      expect(seat.ink).toMatch(/^#[0-9a-f]{6}$/)
      expect(seat.ink).not.toBe(seat.color)
    }
  })
})

describe('defaultRoster', () => {
  test('takes identities from the palette in order', () => {
    expect(defaultRoster(3).map((s) => s.name)).toEqual(['Turbo', 'Zippy', 'Pesto'])
  })

  test('seats one human and fills the rest with AI', () => {
    expect(defaultRoster(4).map((s) => s.kind)).toEqual(['human', 'ai', 'ai', 'ai'])
  })

  test('seats the largest table the game allows', () => {
    expect(defaultRoster(MIN_SEATS)).toHaveLength(3)
    expect(defaultRoster(MAX_SEATS)).toHaveLength(6)
  })
})
