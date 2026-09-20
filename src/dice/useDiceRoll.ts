import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { randomSeed } from './random'
import { throwDice, type Recording } from './physics'
import { diceSignature, type DieFaces, type Face } from './faces'

/** A throw, decided elsewhere. Matches `Roll` in the engine. */
export type PlayableRoll = { seed: number; faceIds: number[] }

export type DiceTray = {
  /** The recording currently on the table. */
  recording: Recording
  /** 0 = initial pose. Each throw increments it; pass to <DiceTable>. */
  playId: number
  /** True from the moment `play()` is called until the dice come to rest. */
  rolling: boolean
  /** The faces showing. */
  faces: Face[]
  /** Plays a throw the room decided. Resolves once the dice stop moving. */
  play: (roll: PlayableRoll) => Promise<void>
  /** Pass to `<DiceTable onSettle>`. */
  settle: () => void
}

/**
 * Owns the dice on the table.
 *
 * It no longer decides anything. The room draws the seed and the faces — it is
 * the authority on what the dice did, and letting a browser decide its own
 * throw is letting a browser decide its own luck. This just simulates the
 * throw it is handed, which takes a couple of milliseconds, and resolves when
 * playback finishes, so turn logic reads as a straight line:
 *
 *   await tray.play(step.event.roll)
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
  const resolveRef = useRef<(() => void) | null>(null)

  // Re-dress the tray if the dice themselves change between rounds.
  //
  // Keyed on the signature rather than on `dice` itself: a caller passing an
  // inline array literal creates a new reference every render, which against a
  // reference comparison would re-throw the dice forever. `dice` is read inside
  // but deliberately not a dependency — `id` already covers every change to it.
  const id = diceSignature(dice)
  useEffect(() => {
    setState((previous) => {
      if (diceSignature(previous.recording.dice) === id) return previous
      const recording = throwDice(dice, randomSeed())
      facesRef.current = recording.outcomes.map((o) => o.face)
      return { recording, playId: 0 }
    })
  }, [id])

  const play = useCallback(
    (roll: PlayableRoll) => {
      // Ignore a second call mid-throw rather than restarting: dice that
      // change their mind look broken.
      if (rollingRef.current) return Promise.resolve()

      const recording = throwDice(dice, roll.seed, roll.faceIds)
      facesRef.current = recording.outcomes.map((o) => o.face)
      rollingRef.current = true
      setRolling(true)
      setState((previous) => ({ recording, playId: previous.playId + 1 }))

      return new Promise<void>((resolve) => {
        resolveRef.current = resolve
      })
      // As above: `id` stands in for `dice`, which is read but not a dependency.
    },
    [id],
  )

  const settle = useCallback(() => {
    if (!rollingRef.current) return
    rollingRef.current = false
    setRolling(false)
    const resolve = resolveRef.current
    resolveRef.current = null
    resolve?.()
  }, [])

  // Don't leave an awaiter hanging if the component unmounts mid-throw.
  useEffect(() => {
    return () => {
      resolveRef.current?.()
      resolveRef.current = null
    }
  }, [])

  // Memoised because callers keep the tray in effect dependencies. A fresh
  // object every render would re-run those effects on every render, and an
  // effect that tears something down on cleanup would then tear it down
  // constantly.
  return useMemo(
    () => ({
      recording: state.recording,
      playId: state.playId,
      rolling,
      faces: state.recording.outcomes.map((o) => o.face),
      play,
      settle,
    }),
    [state, rolling, play, settle],
  )
}
