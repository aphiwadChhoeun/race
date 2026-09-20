import { describe, expect, test, vi } from 'vitest'
import type { GameEvent, GameState, Step } from '../engine/state'
import { BEAT_MS, playBeats, type Beats } from './queue'

/** A state distinguishable only by its turn, which is all these tests read. */
const stateAt = (turn: number) => ({ turn }) as GameState

const beat = (event: GameEvent): Step => ({ event, state: stateAt(event.seat) })

const roll = { seed: 1, faceIds: [1, 1] }

/** Records what a drain did, in order. */
function spy(mine: number[] = [0]) {
  const done: string[] = []
  const beats: Beats = {
    play: async (r) => {
      done.push(`play:${r.seed}`)
    },
    pause: async (ms) => {
      done.push(`pause:${ms}`)
    },
    adopt: (state) => done.push(`adopt:${state.turn}`),
    isMine: (seat) => mine.includes(seat),
    alive: () => true,
  }
  return { done, beats }
}

describe('playBeats', () => {
  test('waits for the dice before showing what they did', async () => {
    const { done, beats } = spy()
    await playBeats([beat({ kind: 'threw', seat: 0, roll })], beats)
    expect(done).toEqual(['play:1', 'adopt:0'])
  })

  /* You just made it happen. Waiting to be told so reads as lag. */
  test('does not pause on your own beats', async () => {
    const { done, beats } = spy([0])
    await playBeats([beat({ kind: 'bid', seat: 0 })], beats)
    expect(done).toEqual(['adopt:0'])
  })

  test('pauses on somebody else’s, so it can be read', async () => {
    const { done, beats } = spy([0])
    await playBeats([beat({ kind: 'bid', seat: 1 })], beats)
    expect(done).toEqual([`pause:${BEAT_MS}`, 'adopt:1'])
  })

  test('shows a burst one beat at a time, in order', async () => {
    const { done, beats } = spy([0])
    await playBeats(
      [
        beat({ kind: 'bid', seat: 0 }),
        beat({ kind: 'collected', seat: 1 }),
        beat({ kind: 'threw', seat: 1, roll }),
        beat({ kind: 'bid', seat: 1 }),
      ],
      beats,
    )
    expect(done).toEqual([
      'adopt:0',
      `pause:${BEAT_MS}`,
      'adopt:1',
      'play:1',
      'adopt:1',
      `pause:${BEAT_MS}`,
      'adopt:1',
    ])
  })

  /* The room sends more while the last burst is still playing. Draining the
     array in place is what lets the running loop pick them up instead of a
     second loop racing it. */
  test('picks up beats that arrive mid-drain', async () => {
    const { done, beats } = spy([0])
    const queue: Step[] = [beat({ kind: 'bid', seat: 0 })]
    let arrived = false

    await playBeats(queue, {
      ...beats,
      adopt: (state) => {
        beats.adopt(state)
        if (arrived) return
        arrived = true
        queue.push(beat({ kind: 'bid', seat: 2 }))
      },
    })

    expect(done).toEqual(['adopt:0', `pause:${BEAT_MS}`, 'adopt:2'])
  })

  /* A queue that outlives its view must stop writing to it. */
  test('stops adopting once the view has gone', async () => {
    const { done, beats } = spy([0])
    let alive = true
    await playBeats([beat({ kind: 'bid', seat: 1 }), beat({ kind: 'bid', seat: 1 })], {
      ...beats,
      pause: async () => {
        done.push('pause')
        alive = false
      },
      alive: () => alive,
    })
    expect(done).toEqual(['pause'])
  })

  test('leaves nothing behind when it finishes', async () => {
    const { beats } = spy()
    const queue = [beat({ kind: 'bid', seat: 0 }), beat({ kind: 'bid', seat: 0 })]
    await playBeats(queue, beats)
    expect(queue).toHaveLength(0)
  })

  test('does nothing with an empty queue', async () => {
    const { done, beats } = spy()
    await playBeats([], beats)
    expect(done).toEqual([])
  })

  /* The real pause is a timer; these tests would otherwise take seconds. */
  test('really does wait when the pause really waits', async () => {
    vi.useFakeTimers()
    try {
      const { done, beats } = spy([0])
      const playing = playBeats([beat({ kind: 'bid', seat: 1 })], {
        ...beats,
        pause: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      })
      await vi.advanceTimersByTimeAsync(BEAT_MS)
      await playing
      expect(done).toEqual(['adopt:1'])
    } finally {
      vi.useRealTimers()
    }
  })
})
