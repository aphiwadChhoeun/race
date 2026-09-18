import { useCallback, useEffect, useRef, useState } from 'react'
import { randomSeed } from './random'
import { throwDice, type Recording } from './physics'
import type { DieFaces, Face } from './faces'

export type DiceTray = {
  /** The recording currently on the table. */
  recording: Recording
  /** 0 = initial pose. Each throw increments it; pass to <DiceTable>. */
  playId: number
  /** True from the moment `roll()` is called until the dice come to rest. */
  rolling: boolean
  /** The faces showing. */
  faces: Face[]
  /** Throws the dice. Resolves with the faces once they stop moving. */
  roll: () => Promise<Face[]>
  /** Pass to `<DiceTable onSettle>`. */
  settle: () => void
}

/** Identifies a set of dice by their faces, so inline specs don't re-throw. */
function signature(dice: readonly DieFaces[]): string {
  return dice.map((die) => die.join(',')).join('|')
}

/**
 * Owns the dice for a turn.
 *
 * `roll()` simulates the whole throw synchronously — a couple of milliseconds —
 * so the outcome exists before the first frame is drawn. It then resolves when
 * playback finishes, which lets turn logic read as a straight line:
 *
 *   const faces = await roll()
 *   bid(resolveRoll(faces, true))
 */
export function useDiceRoll(dice: readonly DieFaces[]): DiceTray {
  // Simulated in the initialiser so the dice have a real physical resting pose
  // on first paint, rather than a hand-placed one.
  const [state, setState] = useState(() => ({
    recording: throwDice(dice, randomSeed()),
    playId: 0,
  }))
  const [rolling, setRolling] = useState(false)

  const rollingRef = useRef(false)
  const facesRef = useRef<Face[]>(state.recording.outcomes.map((o) => o.face))
  const resolveRef = useRef<((faces: Face[]) => void) | null>(null)

  // Re-dress the tray if the dice themselves change between rounds.
  //
  // Keyed on the signature rather than on `dice` itself: a caller passing an
  // inline array literal creates a new reference every render, which against a
  // reference comparison would re-throw the dice forever. `dice` is read inside
  // but deliberately not a dependency — `id` already covers every change to it.
  const id = signature(dice)
  useEffect(() => {
    setState((previous) => {
      if (signature(previous.recording.dice) === id) return previous
      const recording = throwDice(dice, randomSeed())
      facesRef.current = recording.outcomes.map((o) => o.face)
      return { recording, playId: 0 }
    })
  }, [id])

  const roll = useCallback(() => {
    // Ignore a second press mid-throw rather than restarting: a roll that
    // changes its mind looks broken, and would let a player reroll for free.
    if (rollingRef.current) return Promise.resolve(facesRef.current)

    const recording = throwDice(dice, randomSeed())
    facesRef.current = recording.outcomes.map((o) => o.face)
    rollingRef.current = true
    setRolling(true)
    setState((previous) => ({ recording, playId: previous.playId + 1 }))

    return new Promise<Face[]>((resolve) => {
      resolveRef.current = resolve
    })
    // As above: `id` stands in for `dice`, which is read but not a dependency.
  }, [id])

  const settle = useCallback(() => {
    if (!rollingRef.current) return
    rollingRef.current = false
    setRolling(false)
    const resolve = resolveRef.current
    resolveRef.current = null
    resolve?.(facesRef.current)
  }, [])

  // Don't leave an awaiter hanging if the component unmounts mid-throw.
  useEffect(() => {
    return () => {
      resolveRef.current?.(facesRef.current)
      resolveRef.current = null
    }
  }, [])

  return {
    recording: state.recording,
    playId: state.playId,
    rolling,
    faces: state.recording.outcomes.map((o) => o.face),
    roll,
    settle,
  }
}
