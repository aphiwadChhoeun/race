import type { GameState, Roll, Step } from '../engine/state'

/** Long enough to read the log line, short enough that six seats don't drag. */
export const BEAT_MS = 700

/** Everything draining a queue needs from the outside world. */
export type Beats = {
  /** Plays a throw. Resolves when the dice stop moving. */
  play: (roll: Roll) => Promise<void>
  pause: (ms: number) => Promise<void>
  /** Shows a state. The only way a state ever reaches the screen. */
  adopt: (state: GameState) => void
  /** Whether a seat belongs to this browser. */
  isMine: (seat: number) => boolean
  /** False once the view is gone, so a half-drained queue stops writing to it. */
  alive: () => boolean
}

/**
 * Shows a queue of beats, one at a time, at reading speed.
 *
 * The room resolves a turn the instant it is asked — an AI's whole turn
 * arrives as a single burst — while the player watches it unfold. This is the
 * gap between the two, and it holds the two rules that keep the screen honest:
 *
 * - **Only this adopts a state.** Nothing else writes the board or the
 *   positions, so what is shown is always a state the room actually sent, and
 *   never one the player has not watched happen.
 * - **Your own beats get no pause.** You just made them happen; waiting 700ms
 *   to be told so feels like lag, not pacing.
 *
 * `queue` is drained in place, so beats that arrive mid-drain are picked up by
 * the loop already running rather than starting a second one.
 */
export async function playBeats(queue: Step[], beats: Beats): Promise<void> {
  while (queue.length > 0) {
    const step = queue.shift()!

    if (step.event.kind === 'threw') {
      await beats.play(step.event.roll)
    } else if (!beats.isMine(step.event.seat)) {
      await beats.pause(BEAT_MS)
    }

    if (!beats.alive()) return
    beats.adopt(step.state)
  }
}
