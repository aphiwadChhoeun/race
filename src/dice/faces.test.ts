import { describe, expect, test } from 'vitest'
import { STANDARD_DIE, faceOf, pipCount, pipTotal, type DieFaces } from './faces'

const QUIRKY: DieFaces = [1, 2, 3, 'x', 5, 6]

describe('faceOf', () => {
  test('reads a face id as a one-based index into the die', () => {
    expect(faceOf(STANDARD_DIE, 4)).toBe(4)
  })

  test('returns whatever the die actually carries, not the face id', () => {
    expect(faceOf(QUIRKY, 4)).toBe('x')
  })
})

describe('pipCount', () => {
  test('is the number itself for a numbered face', () => {
    expect(pipCount(7)).toBe(7)
  })

  test('is zero for a cross, which is drawn with bars instead', () => {
    expect(pipCount('x')).toBe(0)
  })
})

describe('pipTotal', () => {
  test('counts a standard die at 21', () => {
    expect(pipTotal(STANDARD_DIE)).toBe(21)
  })

  test('skips the cross face', () => {
    expect(pipTotal(QUIRKY)).toBe(17)
  })
})
