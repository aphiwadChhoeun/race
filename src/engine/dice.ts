import type { DieFaces } from '../dice/faces'

/**
 * The two dice are deliberately not interchangeable: only B can roll a 4 or the
 * game's single 7, and only A can roll a 5 or 6. Each carries one cross, so any
 * given die shows one with probability 1/6.
 *
 * Faces are listed in face-id order, which keeps the standard die's
 * opposite-face pairing: A reads 1-6, 2-5, 3-x and B reads 1-7, 2-x, 3-4.
 */
export const DIE_A: DieFaces = [1, 2, 3, 'x', 5, 6]
export const DIE_B: DieFaces = [1, 2, 3, 4, 'x', 7]

/** Always in this order, so a face array is always `[dieA, dieB]`. */
export const RACE_DICE: readonly DieFaces[] = [DIE_A, DIE_B]
