/**
 * What a die's faces show.
 *
 * The physics engine works in face *ids* 1-6 — a fair draw picks one and a cube
 * symmetry rotates it face-up. What each id shows is a property of the die, not
 * of the engine, which is what lets a die carry a 7 or a cross without any of
 * the fairness reasoning in `labeling.ts` changing.
 */

/** A face shows a number of pips, or `'x'`: the bust mark. */
export type Face = number | 'x'

/** A die's six faces, indexed by face id — so index 0 is face id 1. */
export type DieFaces = readonly [Face, Face, Face, Face, Face, Face]

/** An ordinary Western die, for callers that just want 1-6. */
export const STANDARD_DIE: DieFaces = [1, 2, 3, 4, 5, 6]

/** What `faceId` shows on this die. */
export function faceOf(die: DieFaces, faceId: number): Face {
  return die[faceId - 1]
}

/** Pips this face draws. Crosses draw bars instead, so they draw none. */
export function pipCount(face: Face): number {
  return face === 'x' ? 0 : face
}

/** Pips a die needs in total — the size of its pip pool. */
export function pipTotal(die: DieFaces): number {
  return die.reduce<number>((sum, face) => sum + pipCount(face), 0)
}
