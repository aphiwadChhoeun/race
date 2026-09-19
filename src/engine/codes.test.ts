import { describe, expect, test } from 'vitest'
import { CODE_ALPHABET, CODE_LENGTH, newCode, normaliseCode } from './codes'

describe('room codes', () => {
  /* The code's whole job is to survive being read down a phone line. */
  test('leaves out the characters people mishear', () => {
    for (const char of 'ILO01') expect(CODE_ALPHABET).not.toContain(char)
  })

  test('draws codes of the right shape', () => {
    for (let i = 0; i < 200; i++) {
      const code = newCode()
      expect(code).toHaveLength(CODE_LENGTH)
      for (const char of code) expect(CODE_ALPHABET).toContain(char)
    }
  })

  test('does not keep drawing the same code', () => {
    const drawn = new Set(Array.from({ length: 200 }, newCode))
    expect(drawn.size).toBeGreaterThan(150)
  })

  test('spreads codes over the whole alphabet', () => {
    const seen = new Set([...Array.from({ length: 400 }, newCode).join('')])
    expect(seen.size).toBe(CODE_ALPHABET.length)
  })

  test('accepts what a person actually types', () => {
    expect(normaliseCode(' ab2c ')).toBe('AB2C')
    expect(normaliseCode('AB2C')).toBe('AB2C')
  })

  test('refuses anything that is not a code', () => {
    expect(normaliseCode('AB2')).toBeNull()
    expect(normaliseCode('AB2CD')).toBeNull()
    expect(normaliseCode('AB2I')).toBeNull()
    expect(normaliseCode('')).toBeNull()
  })
})
