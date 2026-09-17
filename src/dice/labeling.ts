/**
 * Which value sits on which face of a cube.
 *
 * This module is what lets a fair RNG coexist with genuine physics.
 *
 * A cube has 24 orientation-preserving symmetries, so for *any* orientation the
 * simulation leaves a die in, there is a valid standard-die labeling that puts
 * any chosen value face-up. Choosing the labeling after the simulation is
 * exactly equivalent to having rotated the die's initial orientation by that
 * symmetry: a cube's collision geometry is invariant under it, so the recorded
 * motion remains a physically valid motion of the relabelled die.
 *
 * The consequence is the whole reason for doing it this way: we never reject a
 * simulation for landing on the "wrong" number. The CSPRNG picks the value, the
 * physics picks the motion, and neither has to compromise. One simulation per
 * throw, no matter how many dice are on the table.
 *
 * The labeling is fixed before anything is rendered, so the pips are consistent
 * for every frame of the animation — there is no moment at which a die shows
 * one thing and then becomes another.
 */

export type Vec3 = readonly [number, number, number]
export type Vec2 = readonly [number, number]

/** The six face normals in die-local space. */
export const AXES: Vec3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
]

/** Value on each local axis, indexed to match `AXES`. */
export type Labeling = readonly [number, number, number, number, number, number]

type Matrix3 = readonly [Vec3, Vec3, Vec3]

/**
 * A standard Western die: opposite faces sum to 7, and 1-2-3 run
 * counter-clockwise about their shared vertex (equivalently, the axis of 1
 * crossed with the axis of 2 gives the axis of 3).
 */
const BASE: Labeling = [3, 4, 1, 6, 2, 5]

function axisIndex(v: Vec3): number {
  for (let i = 0; i < AXES.length; i++) {
    const a = AXES[i]
    if (Math.abs(a[0] - v[0]) < 1e-6 && Math.abs(a[1] - v[1]) < 1e-6 && Math.abs(a[2] - v[2]) < 1e-6) {
      return i
    }
  }
  return -1
}

function apply(m: Matrix3, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ]
}

function transpose(m: Matrix3): Matrix3 {
  return [
    [m[0][0], m[1][0], m[2][0]],
    [m[0][1], m[1][1], m[2][1]],
    [m[0][2], m[1][2], m[2][2]],
  ]
}

/**
 * The 24 rotations of a cube: signed permutation matrices with determinant +1.
 * The 24 with determinant -1 are reflections, which would produce a
 * mirror-image die (1-2-3 clockwise), so they're excluded.
 */
const ROTATIONS: Matrix3[] = (() => {
  const permutations = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ]
  const result: Matrix3[] = []
  for (const p of permutations) {
    for (let bits = 0; bits < 8; bits++) {
      const signs = [bits & 1 ? -1 : 1, bits & 2 ? -1 : 1, bits & 4 ? -1 : 1]
      const rows: number[][] = [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ]
      for (let i = 0; i < 3; i++) rows[i][p[i]] = signs[i]
      const m = rows as unknown as Matrix3
      const d =
        m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
        m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
        m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
      if (Math.round(d) === 1) result.push(m)
    }
  }
  return result
})()

/** Index into `AXES` of the axis carrying `value` in the base labeling. */
function baseAxisOf(value: number): number {
  return BASE.indexOf(value)
}

/**
 * A labeling that puts `value` on the face pointing along `upAxis`.
 *
 * `upAxis` must be one of `AXES` — i.e. the die's resting orientation must
 * already have been snapped to the nearest axis. Returns the base labeling if
 * asked for something impossible, which cannot happen for valid input.
 */
export function labelingWith(upAxis: Vec3, value: number): Labeling {
  const want = AXES[baseAxisOf(value)]
  const rotation = ROTATIONS.find((m) => axisIndex(apply(m, want)) === axisIndex(upAxis))
  if (!rotation) return BASE

  // Labeling is the base labeling pulled back through the rotation.
  const inverse = transpose(rotation)
  const labels = AXES.map((axis) => BASE[axisIndex(apply(inverse, axis))])
  return labels as unknown as Labeling
}

/** The value showing on the face pointing along `axis`. */
export function valueOnAxis(labeling: Labeling, axis: Vec3): number {
  return labeling[axisIndex(axis)]
}

/**
 * Pip positions in face-local (u, v) coordinates, each component in [-1, 1].
 * The renderer maps these onto whichever face carries the value.
 */
const D = 0.54
export const PIP_LAYOUT: Record<number, Vec2[]> = {
  1: [[0, 0]],
  2: [
    [-D, D],
    [D, -D],
  ],
  3: [
    [-D, D],
    [0, 0],
    [D, -D],
  ],
  4: [
    [-D, D],
    [D, D],
    [-D, -D],
    [D, -D],
  ],
  5: [
    [-D, D],
    [D, D],
    [0, 0],
    [-D, -D],
    [D, -D],
  ],
  6: [
    [-D, D],
    [D, D],
    [-D, 0],
    [D, 0],
    [-D, -D],
    [D, -D],
  ],
}

/**
 * An in-plane basis for each face, right-handed with respect to the normal
 * (u × v = normal), so pip layouts are never mirrored.
 */
export function faceBasis(axis: Vec3): { u: Vec3; v: Vec3 } {
  const [x, y, z] = axis
  if (Math.abs(y) > 0.5) {
    // Top/bottom faces: pick a basis that keeps the layout upright from above.
    return y > 0 ? { u: [1, 0, 0], v: [0, 0, -1] } : { u: [1, 0, 0], v: [0, 0, 1] }
  }
  if (Math.abs(x) > 0.5) {
    return x > 0 ? { u: [0, 0, -1], v: [0, 1, 0] } : { u: [0, 0, 1], v: [0, 1, 0] }
  }
  return z > 0 ? { u: [1, 0, 0], v: [0, 1, 0] } : { u: [-1, 0, 0], v: [0, 1, 0] }
}
