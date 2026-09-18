import { describe, expect, test } from 'vitest'
import { throwDice } from './physics'
import { STANDARD_DIE, type DieFaces } from './faces'

const DIE_A: DieFaces = [1, 2, 3, 'x', 5, 6]
const DIE_B: DieFaces = [1, 2, 3, 4, 'x', 7]

describe('throwDice', () => {
  test('records one outcome per die, in the order given', () => {
    const recording = throwDice([DIE_A, DIE_B], 1234)
    expect(recording.outcomes).toHaveLength(2)
    expect(recording.dieCount).toBe(2)
  })

  test('resolves each face id through the die that rolled it', () => {
    const recording = throwDice([DIE_A, DIE_B], 99)
    expect(recording.outcomes[0].face).toBe(DIE_A[recording.outcomes[0].faceId - 1])
    expect(recording.outcomes[1].face).toBe(DIE_B[recording.outcomes[1].faceId - 1])
  })

  test('keeps the draw uniform over the six face ids', () => {
    const counts = new Map<number, number>()
    for (let i = 0; i < 1200; i++) {
      const id = throwDice([STANDARD_DIE], i).outcomes[0].faceId
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    expect([...counts.keys()].sort()).toEqual([1, 2, 3, 4, 5, 6])
    // 200 expected per face; a fair die clears this bound essentially always.
    for (const n of counts.values()) expect(n).toBeGreaterThan(120)
  })

  test('labels every axis with a distinct face id', () => {
    const { labeling } = throwDice([DIE_B], 7).outcomes[0]
    expect([...labeling].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6])
  })
})
