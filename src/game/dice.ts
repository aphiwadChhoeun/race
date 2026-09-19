/**
 * Cream for A, sky for B — the dice have to be told apart at a glance.
 *
 * Both stay light on purpose. The pips are near-black and a cross is red
 * (`DiceTable.tsx`), so a dark die body would swallow the very marks the game
 * is read from; the old slate B was already the dimmer of the two. Against the
 * sunlit grass of `.race__table`, cream and sky both keep their edges.
 *
 * Which faces a die carries is a rule and lives in `engine/dice.ts`, where the
 * Worker can read it. What colour it is painted is not, and lives here.
 */
export const DIE_COLORS = [0xfff6e3, 0x9fd8f2]
