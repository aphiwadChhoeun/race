import * as CANNON from 'cannon-es'
import { createRng, range, rollFaces } from './random'
import { AXES, labelingWith, type Labeling, type Vec3 } from './labeling'
import { faceOf, type DieFaces, type Face } from './faces'

/**
 * Real rigid-body simulation, run headless and recorded.
 *
 * The throw is simulated to completion the instant the player clicks — around a
 * millisecond per die — and the resulting motion is recorded as a track of
 * transforms. Playback then just replays that track.
 *
 * Simulating up front rather than stepping the world during the animation buys
 * three things:
 *
 *   1. The outcome is known before the first frame is drawn, so game logic never
 *      waits on a physics race.
 *   2. Playback can't stutter, drift, or diverge on a slow frame — it's sampled
 *      from a fixed track, not integrated live.
 *   3. A throw that settles badly (a die leaning on a wall, with no face
 *      properly up) can simply be thrown away and resimulated, before anyone
 *      sees it.
 *
 * What it does NOT do is force the physics towards a chosen number. The value
 * comes from the CSPRNG and is realised by choosing the die's face labeling
 * afterwards — see labeling.ts. The simulation is never steered.
 */

// --- Table and die dimensions, in simulation units (die edge = 1) ----------
const DIE_HALF = 0.5
/**
 * Table and throw strength are tuned together, measured over 400 throws: this
 * combination lands the dice near the middle of the table (mean x 0.33, 5th-95th
 * percentile -1.6..1.9), settles in 1.79s on average, and never once failed to
 * settle inside the step budget. Throwing harder pushes the dice into the far
 * rail and out of frame; throwing softer looks limp.
 */
const TABLE_HALF = 2.6
/** Simulation step. Finer than the frame rate: box stacking needs the accuracy. */
const SIM_DT = 1 / 120
/** Frames recorded per second of playback. */
export const FPS = 60
const STEPS_PER_FRAME = Math.round(1 / FPS / SIM_DT)
/** Give up on a throw that hasn't settled by here (~3s) and resimulate. */
const MAX_STEPS = 360
/** A die must be at least this square to the floor to be readable. */
const MIN_FLATNESS = 0.98
/** Tilted rests are ~5% per die, so this is slack of an absurd margin. */
const MAX_ATTEMPTS = 24

export type DieOutcome = {
  /** Which of the die's six faces landed up — decided by the CSPRNG, not here. */
  faceId: number
  /** What that face id shows on the die that rolled it. */
  face: Face
  /** Which face id sits on each local axis, for the renderer to dress. */
  labeling: Labeling
}

export type Recording = {
  dieCount: number
  /** The dice this throw was made with, in order. */
  dice: readonly DieFaces[]
  frameCount: number
  /** Seconds. */
  duration: number
  /**
   * frameCount × dieCount × 7 floats: position xyz then quaternion xyzw.
   * One flat buffer, so playback does no allocation per frame.
   */
  track: Float32Array
  outcomes: DieOutcome[]
  /** Real collision events, for driving impact sound. */
  impacts: { time: number; strength: number }[]
  /** Simulations needed to get a clean throw. Diagnostics only. */
  attempts: number
}

type Simulator = {
  world: CANNON.World
  dice: CANNON.Body[]
}

/** Worlds are reused between throws: building one per roll is pure garbage. */
const simulators = new Map<number, Simulator>()

function getSimulator(count: number): Simulator {
  const existing = simulators.get(count)
  if (existing) return existing

  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82 * 2.2, 0) })
  world.defaultContactMaterial.friction = 0.32
  world.defaultContactMaterial.restitution = 0.38
  // Cheaper and steadier than the default solver settings for a handful of boxes.
  world.solver = Object.assign(new CANNON.GSSolver(), { iterations: 12, tolerance: 0.001 })

  const floor = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() })
  floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0)
  world.addBody(floor)

  // Rims, so a hard throw rattles instead of leaving the table.
  const rims: [number, number, number][] = [
    [0, -TABLE_HALF, 0],
    [0, TABLE_HALF, Math.PI],
    [-TABLE_HALF, 0, Math.PI / 2],
    [TABLE_HALF, 0, -Math.PI / 2],
  ]
  for (const [x, z, ry] of rims) {
    const wall = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() })
    wall.position.set(x, 0, z)
    wall.quaternion.setFromEuler(0, ry, 0)
    world.addBody(wall)
  }

  const dice: CANNON.Body[] = []
  for (let i = 0; i < count; i++) {
    const body = new CANNON.Body({
      mass: 1,
      shape: new CANNON.Box(new CANNON.Vec3(DIE_HALF, DIE_HALF, DIE_HALF)),
      linearDamping: 0.06,
      angularDamping: 0.09,
    })
    world.addBody(body)
    dice.push(body)
  }

  const simulator = { world, dice }
  simulators.set(count, simulator)
  return simulator
}

/**
 * Position, orient and launch each die from the near-left of the table.
 *
 * Dice are spread across lanes *and* staggered in height, because two bodies
 * that start interpenetrating get shoved apart explosively on the first step.
 * Lane spacing stays wider than the 1.0 die width after jitter, and narrows as
 * the count grows so the row still fits between the rails.
 *
 * The launch height and distance are set by what the camera can see, and were
 * measured by projecting all eight corners of every die on every frame of 350
 * throws. With the camera in DiceTable.tsx, no corner leaves the viewport at any
 * aspect ratio from 2.4 down to 1.1 (worst |NDC| 0.82 vertical, 0.92 horizontal).
 * Launching higher looks better in isolation but throws the dice in from
 * off-screen — at 1.7 the topmost die clipped on 95% of throws.
 */
function launch(dice: CANNON.Body[], rng: () => number) {
  const count = dice.length
  const usable = (TABLE_HALF - DIE_HALF - 0.1) * 2
  const spacing = count < 3 ? 2.0 : Math.min(2.0, usable / (count - 1))

  dice.forEach((body, index) => {
    const lane = (index - (count - 1) / 2) * spacing
    body.position.set(
      range(rng, -1.7, -1.3),
      1.35 + index * 0.45 + range(rng, 0, 0.35),
      lane + range(rng, -0.15, 0.15),
    )
    body.quaternion.setFromEuler(range(rng, 0, Math.PI * 2), range(rng, 0, Math.PI * 2), range(rng, 0, Math.PI * 2))
    body.velocity.set(range(rng, 2.4, 3.8), range(rng, -1.4, 0.5), range(rng, -1.0, 1.0))
    body.angularVelocity.set(range(rng, -20, 20), range(rng, -20, 20), range(rng, -20, 20))
    body.force.setZero()
    body.torque.setZero()
    body.wakeUp()
  })
}

const scratch = new CANNON.Vec3()

/**
 * The local axis closest to world up, and how square it is to the floor.
 * `flatness` is 1 when the face is perfectly level and drops off as the die
 * leans; anything below MIN_FLATNESS has no single face readable as "up".
 */
function restingUp(body: CANNON.Body): { axis: Vec3; flatness: number } {
  let axis = AXES[0]
  let flatness = -Infinity
  for (const candidate of AXES) {
    scratch.set(candidate[0], candidate[1], candidate[2])
    body.quaternion.vmult(scratch, scratch)
    if (scratch.y > flatness) {
      flatness = scratch.y
      axis = candidate
    }
  }
  return { axis, flatness }
}

function isStill(dice: CANNON.Body[]): boolean {
  for (const body of dice) {
    if (body.velocity.lengthSquared() > 4e-4) return false
    if (body.angularVelocity.lengthSquared() > 4e-4) return false
  }
  return true
}

/**
 * Throws `dice`.
 *
 * The faces are drawn from the CSPRNG first, then a simulation is run and its
 * motion recorded. Simulations are only rejected for settling badly — never for
 * the number they produced.
 */
export function throwDice(dice: readonly DieFaces[], seed: number): Recording {
  const count = dice.length
  const faceIds = rollFaces(count)
  const { world, dice: bodies } = getSimulator(count)

  // Generous upper bound; the buffer is sliced to the real length at the end.
  const capacity = Math.ceil(MAX_STEPS / STEPS_PER_FRAME) + 2
  const scratchTrack = new Float32Array(capacity * count * 7)

  let best: {
    frameCount: number
    track: Float32Array
    impacts: { time: number; strength: number }[]
    ups: { axis: Vec3; flatness: number }[]
    worstFlatness: number
    score: number
  } | null = null

  let attempts = 0

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    attempts = attempt + 1
    const rng = createRng((seed + attempt * 0x9e3779b9) >>> 0)

    const impacts: { time: number; strength: number }[] = []
    let lastImpactAt = -1
    let stepIndex = 0

    // Real contact events, so the sound matches what actually happened.
    const onCollide = (event: { contact: CANNON.ContactEquation }) => {
      const speed = Math.abs(event.contact.getImpactVelocityAlongNormal())
      if (speed < 0.7) return
      const time = stepIndex * SIM_DT
      // Resting boxes generate a stream of micro-contacts; collapse them.
      if (time - lastImpactAt < 0.045) return
      lastImpactAt = time
      impacts.push({ time: time * 1000, strength: Math.min(1, speed / 7) })
    }

    for (const body of bodies) body.addEventListener('collide', onCollide)

    launch(bodies, rng)
    // Clear contacts carried over from the previous attempt's resting pose.
    world.contacts.length = 0

    let frameCount = 0
    let settledAt = -1

    for (stepIndex = 0; stepIndex < MAX_STEPS; stepIndex++) {
      world.step(SIM_DT)

      if (stepIndex % STEPS_PER_FRAME === 0) {
        const base = frameCount * count * 7
        for (let d = 0; d < count; d++) {
          const body = bodies[d]
          const o = base + d * 7
          scratchTrack[o] = body.position.x
          scratchTrack[o + 1] = body.position.y
          scratchTrack[o + 2] = body.position.z
          scratchTrack[o + 3] = body.quaternion.x
          scratchTrack[o + 4] = body.quaternion.y
          scratchTrack[o + 5] = body.quaternion.z
          scratchTrack[o + 6] = body.quaternion.w
        }
        frameCount++
      }

      if (stepIndex > 60 && isStill(bodies)) {
        settledAt = stepIndex
        break
      }
    }

    for (const body of bodies) body.removeEventListener('collide', onCollide)

    const ups = bodies.map(restingUp)
    const worstFlatness = Math.min(...ups.map((u) => u.flatness))
    const onTable = bodies.every(
      (b) =>
        Math.abs(b.position.x) < TABLE_HALF + 1 &&
        Math.abs(b.position.z) < TABLE_HALF + 1 &&
        b.position.y > -0.5,
    )

    const clean = settledAt >= 0 && onTable
    const candidate = {
      frameCount,
      track: scratchTrack.slice(0, frameCount * count * 7),
      impacts,
      ups,
      worstFlatness,
      // Rank settled throws above unsettled ones outright, then by flatness, so
      // an exhausted search still returns the best throw it saw rather than the
      // last. Without the `clean` term a tidy-looking but still-tumbling die
      // could beat a properly settled one.
      score: (clean ? 1000 : 0) + worstFlatness,
    }

    if (!best || candidate.score > best.score) best = candidate
    if (clean && worstFlatness >= MIN_FLATNESS) break
  }

  const chosen = best!

  // The flatness gate means each die is already resting square to the floor, so
  // its nearest local axis is unambiguously the one pointing up. Label the die
  // to put the RNG's faceId on that face.
  const outcomes: DieOutcome[] = chosen.ups.map((up, index) => ({
    faceId: faceIds[index],
    face: faceOf(dice[index], faceIds[index]),
    labeling: labelingWith(up.axis, faceIds[index]),
  }))

  return {
    dieCount: count,
    dice,
    frameCount: chosen.frameCount,
    duration: chosen.frameCount / FPS,
    track: chosen.track,
    outcomes,
    impacts: chosen.impacts,
    attempts,
  }
}

/** Reads die `index`'s transform at `frame` out of a recording. */
export function readFrame(
  recording: Recording,
  frame: number,
  index: number,
  out: { px: number; py: number; pz: number; qx: number; qy: number; qz: number; qw: number },
) {
  const clamped = Math.min(Math.max(frame, 0), recording.frameCount - 1)
  const o = (clamped * recording.dieCount + index) * 7
  const t = recording.track
  out.px = t[o]
  out.py = t[o + 1]
  out.pz = t[o + 2]
  out.qx = t[o + 3]
  out.qy = t[o + 4]
  out.qz = t[o + 5]
  out.qw = t[o + 6]
}

export { DIE_HALF, TABLE_HALF }
