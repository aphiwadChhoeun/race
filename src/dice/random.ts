/**
 * Randomness for the dice.
 *
 * Two distinct concerns, deliberately separated:
 *
 * 1. The *outcome* (which face lands up) must be fair. It uses the platform
 *    CSPRNG with rejection sampling, so every face has probability exactly 1/6.
 *    `Math.random() * 6 | 0` is not fair — its float has bias, and the
 *    naive byte version below without rejection would favour faces 1-4.
 *
 * 2. The *trajectory* (how the die tumbles) only needs to look varied. It uses
 *    a small seeded PRNG so a roll can be replayed frame-for-frame: handy for
 *    debugging an animation, or for replaying a networked opponent's throw.
 */

const hasCrypto =
  typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function'

/** A fair 1-6, via rejection sampling. */
export function rollFace(): number {
  return rollFaces(1)[0]
}

/** `count` fair dice in one pass. */
export function rollFaces(count: number): number[] {
  if (!hasCrypto) {
    // Non-secure fallback (very old browsers / some SSR shims). Still uniform.
    return Array.from({ length: count }, () => Math.floor(Math.random() * 6) + 1)
  }

  // 256 is not divisible by 6, so bytes >= 252 would skew the modulo.
  // Discard them and draw again — this is what makes the die fair.
  const limit = 252
  const out: number[] = []
  // getRandomValues throws above 65536 bytes per call, so draw in chunks. A
  // little slack over `count` covers the bytes rejected above.
  const buf = new Uint8Array(Math.min(65536, count + 8))

  while (out.length < count) {
    crypto.getRandomValues(buf)
    for (const byte of buf) {
      if (byte < limit) {
        out.push((byte % 6) + 1)
        if (out.length === count) break
      }
    }
  }

  return out
}

/** A random 32-bit seed for a trajectory. */
export function randomSeed(): number {
  if (!hasCrypto) return Math.floor(Math.random() * 0xffffffff)
  return crypto.getRandomValues(new Uint32Array(1))[0]
}

/** mulberry32 — tiny, fast, good enough for visual variety. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Uniform float in [min, max). */
export function range(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min)
}

/** Uniform integer in [min, max] inclusive. */
export function rangeInt(rng: () => number, min: number, max: number): number {
  return Math.floor(range(rng, min, max + 1))
}
