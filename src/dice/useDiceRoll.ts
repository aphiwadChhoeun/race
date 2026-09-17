import { useCallback, useEffect, useRef, useState } from 'react'
import { randomSeed } from './random'
import { throwDice, type Recording } from './physics'

export type DiceTray = {
  /** The recording currently on the table. */
  recording: Recording
  /** 0 = initial pose. Each throw increments it; pass to <DiceTable>. */
  playId: number
  /** True from the moment `roll()` is called until the dice come to rest. */
  rolling: boolean
  /** The faces showing. */
  values: number[]
  total: number
  /** Throws the dice. Resolves with the faces once they stop moving. */
  roll: () => Promise<number[]>
  /** Pass to `<DiceTable onSettle>`. */
  settle: () => void
}

/**
 * Owns the dice for a turn.
 *
 * `roll()` simulates the whole throw synchronously — a couple of milliseconds —
 * so the outcome exists before the first frame is drawn. It then resolves when
 * playback finishes, which lets turn logic read as a straight line:
 *
 *   const faces = await roll()
 *   advance(player, sum(faces))
 */
export function useDiceRoll(count = 1): DiceTray {
  // Simulated in the initialiser so the dice have a real physical resting pose
  // on first paint, rather than a hand-placed one.
  const [state, setState] = useState(() => ({
    recording: throwDice(count, randomSeed()),
    playId: 0,
  }))
  const [rolling, setRolling] = useState(false)

  const rollingRef = useRef(false)
  const valuesRef = useRef<number[]>(state.recording.outcomes.map((o) => o.value))
  const resolveRef = useRef<((values: number[]) => void) | null>(null)

  // Resize the tray if `count` changes between rounds.
  useEffect(() => {
    setState((previous) => {
      if (previous.recording.dieCount === count) return previous
      const recording = throwDice(count, randomSeed())
      valuesRef.current = recording.outcomes.map((o) => o.value)
      return { recording, playId: 0 }
    })
  }, [count])

  const roll = useCallback(() => {
    // Ignore a second press mid-throw rather than restarting: a roll that
    // changes its mind looks broken, and would let a player reroll.
    if (rollingRef.current) return Promise.resolve(valuesRef.current)

    const recording = throwDice(count, randomSeed())
    valuesRef.current = recording.outcomes.map((o) => o.value)
    rollingRef.current = true
    setRolling(true)
    setState((previous) => ({ recording, playId: previous.playId + 1 }))

    return new Promise<number[]>((resolve) => {
      resolveRef.current = resolve
    })
  }, [count])

  const settle = useCallback(() => {
    if (!rollingRef.current) return
    rollingRef.current = false
    setRolling(false)
    const resolve = resolveRef.current
    resolveRef.current = null
    resolve?.(valuesRef.current)
  }, [])

  // Don't leave an awaiter hanging if the component unmounts mid-throw.
  useEffect(() => {
    return () => {
      resolveRef.current?.(valuesRef.current)
      resolveRef.current = null
    }
  }, [])

  const values = state.recording.outcomes.map((o) => o.value)

  return {
    recording: state.recording,
    playId: state.playId,
    rolling,
    values,
    total: values.reduce((sum, value) => sum + value, 0),
    roll,
    settle,
  }
}
