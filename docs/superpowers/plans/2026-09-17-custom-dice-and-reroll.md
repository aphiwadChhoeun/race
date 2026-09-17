# Custom Dice and Reroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the two dice different non-standard faces including a bust symbol, and let players reroll as often as they dare.

**Architecture:** The physics engine keeps drawing a uniform face *id* 1–6 and rotating it up, exactly as today; a per-die lookup turns that id into the symbol drawn and scored. So the fairness argument in `labeling.ts` is untouched and only the paint changes. Roll resolution (bust / `XX` / normal) is a pure function in the game's rules module; the existing bid comparison and eviction logic needs no changes at all.

**Tech Stack:** TypeScript, React 19, three.js (rendering), cannon-es (physics), Vitest (tests), Vite.

**Spec:** [docs/superpowers/specs/2026-09-17-custom-dice-and-reroll-design.md](../specs/2026-09-17-custom-dice-and-reroll-design.md)

## Global Constraints

- Die A faces, in face-id order 1–6: `1, 2, 3, X, 5, 6` (no 4).
- Die B faces, in face-id order 1–6: `1, 2, 3, 4, X, 7` (no 5, no 6).
- Face arrays are always ordered `[dieA, dieB]`. Only B can show 4 or 7; only A can show 5 or 6. Every test hand must be one these dice can actually produce.
- `DOUBLE_X = 77`, one above the `76` ceiling. It is displayed as `XX` and never as a number.
- Normal bid values run `10`–`76`: the two faces read high digit first, with `X` counting as `0` on the first throw only.
- Any `X` on any throw after a turn's first ends the turn with no bid.
- Do not modify the symmetry machinery in `src/dice/labeling.ts` — `AXES`, `BASE`, `ROTATIONS`, `labelingWith`, `valueOnAxis`, `faceBasis`. Adding a key to the cosmetic `PIP_LAYOUT` table in that file is expected and fine.
- Run `npm test` and `npm run typecheck` before every commit. Both must be clean.

---

### Task 1: Face vocabulary for the dice module

The dice module needs a type for "what a face shows" before anything else can
use it. This lives in `src/dice/` rather than `src/game/` because the renderer
and the physics recorder both need it, and the dice module must not depend on
the game.

**Files:**
- Create: `src/dice/faces.ts`
- Create: `src/dice/faces.test.ts`
- Modify: `src/dice/index.ts:1-8` (add exports)

**Interfaces:**
- Consumes: nothing.
- Produces: `type Face = number | 'x'`; `type DieFaces = readonly [Face, Face, Face, Face, Face, Face]`; `const STANDARD_DIE: DieFaces`; `faceOf(die: DieFaces, faceId: number): Face`; `pipCount(face: Face): number`; `pipTotal(die: DieFaces): number`.

- [ ] **Step 1: Write the failing tests**

Create `src/dice/faces.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { STANDARD_DIE, faceOf, pipCount, pipTotal, type DieFaces } from './faces'

const QUIRKY: DieFaces = [1, 2, 3, 'x', 5, 6]

describe('faceOf', () => {
  test('reads a face id as a one-based index into the die', () => {
    expect(faceOf(STANDARD_DIE, 4)).toBe(4)
  })

  test('returns whatever the die actually carries, not the face id', () => {
    expect(faceOf(QUIRKY, 4)).toBe('x')
  })
})

describe('pipCount', () => {
  test('is the number itself for a numbered face', () => {
    expect(pipCount(7)).toBe(7)
  })

  test('is zero for a cross, which is drawn with bars instead', () => {
    expect(pipCount('x')).toBe(0)
  })
})

describe('pipTotal', () => {
  test('counts a standard die at 21', () => {
    expect(pipTotal(STANDARD_DIE)).toBe(21)
  })

  test('skips the cross face', () => {
    expect(pipTotal(QUIRKY)).toBe(17)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './faces'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/dice/faces.ts`:

```ts
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
```

- [ ] **Step 4: Add the exports**

In `src/dice/index.ts`, add after the existing `labeling` exports:

```ts
export { STANDARD_DIE, faceOf, pipCount, pipTotal } from './faces'
export type { Face, DieFaces } from './faces'
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS — 20 tests (14 existing + 6 new), no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/dice/faces.ts src/dice/faces.test.ts src/dice/index.ts
git commit -m "Add per-die face vocabulary to the dice module"
```

---

### Task 2: Roll resolution — bust, XX, and X-as-zero

The rules half of the change. Pure functions, no React, no physics.

`bidValue` stays in place for now because `RaceGame.tsx` still calls it; Task 5
deletes it once the component has moved to `resolveRoll`. Keeping it means the
tree typechecks at the end of this task.

**Files:**
- Create: `src/game/dice.ts`
- Modify: `src/game/bidding.ts` (add to the top of the file, above `bidValue`)
- Modify: `src/game/bidding.test.ts` (append)

**Interfaces:**
- Consumes: `Face` from Task 1 (`import type { Face } from '../dice'`).
- Produces: `const DOUBLE_X = 77`; `type Roll = { kind: 'bust' } | { kind: 'bid'; value: number }`; `resolveRoll(faces: Face[], isFirstRoll: boolean): Roll`; `bidLabel(value: number): string`. From `src/game/dice.ts`: `DIE_A`, `DIE_B`, `RACE_DICE: readonly DieFaces[]`, `DIE_COLORS: number[]`.

- [ ] **Step 1: Write the failing tests**

Append to `src/game/bidding.test.ts`:

```ts
describe('resolveRoll', () => {
  test('reads an opening throw high digit first', () => {
    expect(resolveRoll([5, 3], true)).toEqual({ kind: 'bid', value: 53 })
  })

  test('puts the higher digit first even when it is the second die', () => {
    expect(resolveRoll([3, 7], true)).toEqual({ kind: 'bid', value: 73 })
  })

  test('counts a cross on the opening throw as zero', () => {
    expect(resolveRoll([6, 'x'], true)).toEqual({ kind: 'bid', value: 60 })
  })

  test('counts a cross as zero whichever die shows it', () => {
    expect(resolveRoll(['x', 4], true)).toEqual({ kind: 'bid', value: 40 })
  })

  test('makes two crosses on the opening throw the strongest bid in the game', () => {
    expect(resolveRoll(['x', 'x'], true)).toEqual({ kind: 'bid', value: DOUBLE_X })
  })

  test('busts on a cross once the opening throw is past', () => {
    expect(resolveRoll([6, 'x'], false)).toEqual({ kind: 'bust' })
  })

  test('busts on two crosses after the opening throw, with no jackpot', () => {
    expect(resolveRoll(['x', 'x'], false)).toEqual({ kind: 'bust' })
  })

  test('scores a clean reroll normally', () => {
    expect(resolveRoll([5, 7], false)).toEqual({ kind: 'bid', value: 75 })
  })
})

describe('DOUBLE_X', () => {
  test('outbids the highest ordinary value', () => {
    expect(DOUBLE_X).toBeGreaterThan(76)
  })

  test('may be placed on any empty slot, since nothing can evict it', () => {
    expect(legalSlots(board({ 2: 76 }), DOUBLE_X)).toEqual([0, 1, 3, 4, 5, 6])
  })

  test('knocks off every higher slot when placed low', () => {
    const { evicted } = placeBid(board({ 4: 76, 6: 66 }), 1, DOUBLE_X, 9)
    expect(evicted.map((bid) => bid.slot)).toEqual([4, 6])
  })
})

describe('bidLabel', () => {
  test('shows a double cross as XX rather than its numeric stand-in', () => {
    expect(bidLabel(DOUBLE_X)).toBe('XX')
  })

  test('shows an ordinary value as its digits', () => {
    expect(bidLabel(53)).toBe('53')
  })
})
```

Update the import at the top of `src/game/bidding.test.ts` to:

```ts
import {
  DOUBLE_X,
  bidLabel,
  bidValue,
  collectBid,
  emptyBoard,
  legalSlots,
  placeBid,
  resolveRoll,
  type Board,
} from './bidding'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — 13 new tests failing on `resolveRoll is not a function` / `DOUBLE_X` undefined. The 14 existing tests still pass.

- [ ] **Step 3: Write minimal implementation**

Add to the top of `src/game/bidding.ts`, immediately after any existing imports:

```ts
import type { Face } from '../dice'

/**
 * Both dice showing a cross on the opening throw: the strongest bid there is.
 *
 * Stored one above the `76` ceiling so it wins through the ordinary comparison
 * in `legalSlots` and `placeBid` — those two know nothing about it. Rendered as
 * `XX` by `bidLabel`, never as a number.
 */
export const DOUBLE_X = 77

export type Roll = { kind: 'bust' } | { kind: 'bid'; value: number }

/**
 * What a throw is worth.
 *
 * The opening throw of a turn is safe: a cross on it is merely a zero digit,
 * and two are a jackpot. Every throw after that is the gamble — one cross and
 * the turn is over.
 */
export function resolveRoll(faces: Face[], isFirstRoll: boolean): Roll {
  const crosses = faces.filter((face) => face === 'x').length

  if (crosses > 0 && !isFirstRoll) return { kind: 'bust' }
  if (crosses > 0 && crosses === faces.length) return { kind: 'bid', value: DOUBLE_X }

  const digits = faces.map((face) => (face === 'x' ? 0 : face)).sort((a, b) => b - a)
  return { kind: 'bid', value: digits[0] * 10 + digits[1] }
}

/** How a bid value is written on the board. */
export function bidLabel(value: number): string {
  return value === DOUBLE_X ? 'XX' : String(value)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test && npm run typecheck`
Expected: PASS — 33 tests, no type errors.

- [ ] **Step 5: Define the game's two dice**

Create `src/game/dice.ts`:

```ts
import type { DieFaces } from '../dice'

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

/** Bone for A, slate for B — the dice have to be told apart at a glance. */
export const DIE_COLORS = [0xf4eee2, 0x4a5160]
```

- [ ] **Step 6: Run typecheck and commit**

Run: `npm test && npm run typecheck`
Expected: PASS — 33 tests, no type errors.

```bash
git add src/game/bidding.ts src/game/bidding.test.ts src/game/dice.ts
git commit -m "Resolve rolls into a bid, a bust, or the double-cross jackpot"
```

---

### Task 3: Throw specific dice instead of a count

`throwDice` and `useDiceRoll` currently take a die *count*. They take die specs
instead, and each outcome reports both the face id that landed and what that id
shows.

Watch for a shadowing trap: inside `throwDice`, `const { world, dice } =
getSimulator(count)` destructures the cannon-es *bodies* into a local called
`dice`. The new parameter is also called `dice`, so the local must be renamed to
`bodies` — it is used at seven points in that function.

**Files:**
- Modify: `src/dice/physics.ts:50-72` (types), `src/dice/physics.ts:191-320` (`throwDice`)
- Modify: `src/dice/useDiceRoll.ts:1-98`
- Modify: `src/dice/index.ts`
- Modify: `README.md` (the dice-module usage example)

**Interfaces:**
- Consumes: `Face`, `DieFaces`, `faceOf` from Task 1.
- Produces: `throwDice(dice: readonly DieFaces[], seed: number): Recording`; `DieOutcome = { faceId: number; face: Face; labeling: Labeling }`; `Recording.dice: readonly DieFaces[]`; `useDiceRoll(dice: readonly DieFaces[]): DiceTray`; `DiceTray = { recording, playId, rolling, faces: Face[], roll: () => Promise<Face[]>, settle: () => void }`.

- [ ] **Step 1: Write the failing test**

Create `src/dice/physics.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { throwDice } from './physics'
import { STANDARD_DIE, type DieFaces } from './faces'

const DIE_A: DieFaces = [1, 2, 3, 'x', 5, 6]
const DIE_B: DieFaces = [1, 2, 3, 4, 'x', 7]

describe('throwDice', () => {
  test('records one outcome per die, in the order given', () => {
    const recording = throwDice([DIE_A, DIE_B], 1234)
    expect(recording.outcomes).toHaveLength(2)
    expect(recording.dieCount).toBe(2)
  })

  test('resolves each face id through the die that rolled it', () => {
    const recording = throwDice([DIE_A, DIE_B], 99)
    expect(recording.outcomes[0].face).toBe(DIE_A[recording.outcomes[0].faceId - 1])
    expect(recording.outcomes[1].face).toBe(DIE_B[recording.outcomes[1].faceId - 1])
  })

  test('keeps the draw uniform over the six face ids', () => {
    const counts = new Map<number, number>()
    for (let i = 0; i < 1200; i++) {
      const id = throwDice([STANDARD_DIE], i).outcomes[0].faceId
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    expect([...counts.keys()].sort()).toEqual([1, 2, 3, 4, 5, 6])
    // 200 expected per face; a fair die clears this bound essentially always.
    for (const n of counts.values()) expect(n).toBeGreaterThan(120)
  })

  test('labels every axis with a distinct face id', () => {
    const { labeling } = throwDice([DIE_B], 7).outcomes[0]
    expect([...labeling].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test src/dice/physics.test.ts`
Expected: FAIL — `throwDice` rejects an array argument; `outcomes[0].face` is undefined.

- [ ] **Step 3: Change the types in `src/dice/physics.ts`**

Add to the imports at the top of the file:

```ts
import { faceOf, type DieFaces, type Face } from './faces'
```

Replace the `DieOutcome` type (currently lines 50–55) with:

```ts
export type DieOutcome = {
  /** Which of the die's six faces landed up — decided by the CSPRNG, not here. */
  faceId: number
  /** What that face id shows on the die that rolled it. */
  face: Face
  /** Which face id sits on each local axis, for the renderer to dress. */
  labeling: Labeling
}
```

In the `Recording` type, add after `dieCount: number`:

```ts
  /** The dice this throw was made with, in order. */
  dice: readonly DieFaces[]
```

- [ ] **Step 4: Change `throwDice`**

Replace the signature and first three lines of the body:

```ts
export function throwDice(dice: readonly DieFaces[], seed: number): Recording {
  const count = dice.length
  const faceIds = rollFaces(count)
  const { world, dice: bodies } = getSimulator(count)
```

Then within that function rename every remaining use of the old local `dice`
(the cannon-es bodies) to `bodies`. There are six:

```ts
    for (const body of bodies) body.addEventListener('collide', onCollide)
    launch(bodies, rng)
          const body = bodies[d]
      if (stepIndex > 60 && isStill(bodies)) {
    for (const body of bodies) body.removeEventListener('collide', onCollide)
    const ups = bodies.map(restingUp)
    const onTable = bodies.every(
```

Replace the `outcomes` construction with:

```ts
  const outcomes: DieOutcome[] = chosen.ups.map((up, index) => ({
    faceId: faceIds[index],
    face: faceOf(dice[index], faceIds[index]),
    labeling: labelingWith(up.axis, faceIds[index]),
  }))
```

And add `dice` to the returned record, next to `dieCount`:

```ts
  return {
    dieCount: count,
    dice,
    frameCount: chosen.frameCount,
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test src/dice/physics.test.ts`
Expected: PASS — 4 tests. `src/dice/useDiceRoll.ts` will not typecheck yet; that is the next step.

- [ ] **Step 6: Change `useDiceRoll`**

Rewrite `src/dice/useDiceRoll.ts` to take dice specs. The tray reports `faces`
rather than `values`/`total`: the sum of a hand containing a cross has no
meaning, and nothing consumes it.

```ts
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
```

- [ ] **Step 7: Update the README's dice-module example**

In `README.md`, the usage example under "## The dice" calls `useDiceRoll(2)` and
sums two faces. Replace the example body with:

```tsx
import { DiceTable, useDiceRoll, STANDARD_DIE } from './dice'

const DICE = [STANDARD_DIE, STANDARD_DIE]

function Turn() {
  const { recording, playId, rolling, roll, settle } = useDiceRoll(DICE)

  const takeTurn = async () => {
    const faces = await roll() // resolves when the dice stop moving
    score(faces)               // Face[] — a number, or 'x' on a custom die
  }

  return (
    <>
      <DiceTable recording={recording} playId={playId} onSettle={settle} />
      <button onClick={takeTurn} disabled={rolling}>Throw</button>
    </>
  )
}
```

- [ ] **Step 8: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: tests PASS (37). Typecheck FAILS on `src/game/RaceGame.tsx` and
`src/dice/DiceTable.tsx`, which still expect the old API — Tasks 4 and 5 fix
those. Do not "fix" them here.

- [ ] **Step 9: Commit**

```bash
git add src/dice/physics.ts src/dice/physics.test.ts src/dice/useDiceRoll.ts src/dice/index.ts README.md
git commit -m "Throw specific dice rather than a count of them"
```

---

### Task 4: Draw sevens and crosses

The renderer has to draw two faces it has never drawn: a 7, and a cross. It also
has to stop assuming every die spends all 21 pips.

Three concrete hazards:
- `PIPS_PER_DIE = 21` is a constant and a standard die consumes exactly 21, so
  `applyLabeling` never has to hide a leftover. Both new dice use 17, so four
  pips would hang in whatever position they last held. Leftovers must be hidden
  explicitly.
- One `bodyMaterial` is shared by every die, so per-die colour needs one
  material each.
- `PIP_LAYOUT` is keyed by the value drawn. It needs a `7`.

**Files:**
- Modify: `src/dice/labeling.ts:142-174` (add `PIP_LAYOUT[7]`)
- Modify: `src/dice/DiceTable.tsx:17-45` (constants, `DieView`, props), `:186-230` (die construction and dressing), `:313-332` (`applyLabeling` → `applyFaces`)

**Interfaces:**
- Consumes: `Recording.dice`, `DieOutcome.labeling` from Task 3; `pipTotal`, `type DieFaces`, `type Face` from Task 1.
- Produces: `DiceTableProps` gains `dieColors?: number[]`.

- [ ] **Step 1: Add the seven-pip layout**

In `src/dice/labeling.ts`, add a `7` entry to `PIP_LAYOUT` after the `6` entry:

```ts
  // Two columns of three plus a centre. The centre pip is the only thing
  // distinguishing a 7 from a 6 at a glance, so it matters that it is there.
  7: [
    [-D, D],
    [D, D],
    [-D, 0],
    [D, 0],
    [-D, -D],
    [D, -D],
    [0, 0],
  ],
```

- [ ] **Step 2: Add the cross-bar geometry and per-die materials**

In `src/dice/DiceTable.tsx`, replace the `PIPS_PER_DIE` constant (line 20–21)
with cross-bar dimensions:

```ts
/** A cross is two bars at right angles, sized to sit inside the pip footprint. */
const BAR_LENGTH = 0.6
const BAR_WIDTH = 0.11
const BAR_DEPTH = 0.06
/** Bars per cross face, and cross faces are the only thing that needs them. */
const BARS_PER_CROSS = 2
```

Extend `DieView` (lines 23–26) to carry bars:

```ts
type DieView = {
  group: THREE.Group
  pips: THREE.Mesh[]
  bars: THREE.Mesh[]
}
```

Add `barGeometry` to `Stage` (after `pipGeometry`):

```ts
  barGeometry: THREE.BufferGeometry
```

Add the prop to `DiceTableProps`:

```ts
  /** Body colour per die, defaulting to bone white. */
  dieColors?: number[]
```

and accept it in the component signature:

```ts
export function DiceTable({ recording, playId, volume = 0.45, onSettle, dieColors }: DiceTableProps) {
```

- [ ] **Step 3: Build the bar geometry alongside the pip geometry**

Where `pipGeometry` is created (around line 141):

```ts
    const pipGeometry = new THREE.SphereGeometry(PIP_RADIUS, 16, 12)
    const barGeometry = new THREE.BoxGeometry(BAR_LENGTH, BAR_WIDTH, BAR_DEPTH)
```

Add `barGeometry` to the stage object literal that follows it, and dispose it
next to `pipGeometry.dispose()` in the cleanup:

```ts
      barGeometry.dispose()
```

- [ ] **Step 4: Build dice with their own colour, pip pool, and bars**

Replace the die-construction effect body (lines 186–221) with:

```ts
    if (stage.dice.length === recording.dieCount) return

    for (const die of stage.dice) stage.scene.remove(die.group)
    stage.dice = []

    const pipMaterial = new THREE.MeshStandardMaterial({
      color: 0x191920,
      roughness: 0.45,
      metalness: 0.05,
    })
    // Crosses are the bust mark, so they read in red rather than pip-black.
    const barMaterial = new THREE.MeshStandardMaterial({
      color: 0xb3382f,
      roughness: 0.4,
      metalness: 0.05,
    })
    stage.materials.push(pipMaterial, barMaterial)

    for (let i = 0; i < recording.dieCount; i++) {
      const faces = recording.dice[i]
      const bodyMaterial = new THREE.MeshStandardMaterial({
        color: dieColors?.[i] ?? 0xf4eee2,
        roughness: 0.34,
        metalness: 0.02,
      })
      stage.materials.push(bodyMaterial)

      const group = new THREE.Group()
      const body = new THREE.Mesh(stage.dieGeometry, bodyMaterial)
      body.castShadow = true
      body.receiveShadow = true
      group.add(body)

      const pips: THREE.Mesh[] = []
      for (let p = 0; p < pipTotal(faces); p++) {
        const pip = new THREE.Mesh(stage.pipGeometry, pipMaterial)
        // Pips don't cast shadows: at this scale the maps only produce speckle.
        pip.castShadow = false
        group.add(pip)
        pips.push(pip)
      }

      const crossFaces = faces.filter((face) => face === 'x').length
      const bars: THREE.Mesh[] = []
      for (let b = 0; b < crossFaces * BARS_PER_CROSS; b++) {
        const bar = new THREE.Mesh(stage.barGeometry, barMaterial)
        bar.castShadow = false
        group.add(bar)
        bars.push(bar)
      }

      stage.scene.add(group)
      stage.dice.push({ group, pips, bars })
    }
  }, [recording, dieColors])
```

Add the import for `pipTotal` at the top of the file:

```ts
import { pipTotal, type DieFaces, type Face } from './faces'
```

- [ ] **Step 5: Dress each die from its own faces**

Change the dressing effect (around line 228) to pass the die's faces:

```ts
    recording.outcomes.forEach((outcome, index) => {
      const die = stage.dice[index]
      if (die) applyFaces(die, outcome.labeling, recording.dice[index])
    })
```

Replace `applyLabeling` (lines 313–332) with:

```ts
/**
 * Places pips and cross-bars according to which face id sits on which axis.
 *
 * A die only carries as many pips as its faces need, and only the faces it
 * actually has, so anything left over from a previous dressing is hidden rather
 * than abandoned in place.
 */
function applyFaces(die: DieView, labeling: Labeling, faces: DieFaces) {
  let pipCursor = 0
  let barCursor = 0
  // Sit the marks slightly proud of the surface, like an inlaid spot.
  const pipDepth = DIE_HALF - 0.035
  const barDepth = DIE_HALF - 0.012

  for (let axisIndex = 0; axisIndex < AXES.length; axisIndex++) {
    const axis = AXES[axisIndex]
    const face: Face = faces[labeling[axisIndex] - 1]
    const { u, v } = faceBasis(axis)

    const place = (mesh: THREE.Mesh, depth: number, du: number, dv: number) => {
      mesh.position.set(
        axis[0] * depth + u[0] * du * PIP_SPREAD + v[0] * dv * PIP_SPREAD,
        axis[1] * depth + u[1] * du * PIP_SPREAD + v[1] * dv * PIP_SPREAD,
        axis[2] * depth + u[2] * du * PIP_SPREAD + v[2] * dv * PIP_SPREAD,
      )
      mesh.visible = true
    }

    if (face === 'x') {
      // The face's own basis, so the bars lie in its plane whatever axis it is.
      const basis = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(u[0], u[1], u[2]),
        new THREE.Vector3(v[0], v[1], v[2]),
        new THREE.Vector3(axis[0], axis[1], axis[2]),
      )
      for (const angle of [Math.PI / 4, -Math.PI / 4]) {
        const bar = die.bars[barCursor++]
        if (!bar) break
        place(bar, barDepth, 0, 0)
        bar.setRotationFromMatrix(basis)
        bar.rotateZ(angle)
      }
      continue
    }

    for (const [du, dv] of PIP_LAYOUT[face]) {
      const pip = die.pips[pipCursor++]
      if (!pip) break
      place(pip, pipDepth, du, dv)
    }
  }

  for (let i = pipCursor; i < die.pips.length; i++) die.pips[i].visible = false
  for (let i = barCursor; i < die.bars.length; i++) die.bars[i].visible = false
}
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: only `src/game/RaceGame.tsx` errors remain (Task 5 fixes those).
`src/dice/` must be clean.

- [ ] **Step 7: Commit**

```bash
git add src/dice/labeling.ts src/dice/DiceTable.tsx
git commit -m "Draw seven-pip and cross faces, and colour dice individually"
```

---

### Task 5: Reroll, bust, and pass in the turn

Wires the rules into the component. The turn gains a decision point: place,
reroll, or — only when nothing is legal — pass.

Pass is deliberately not offered when a legal slot exists. A bid can only help
its owner, so there is never a reason to decline one, and the button would be a
misclick hazard rather than a choice.

`bidValue` and its test become dead here and are deleted.

**Files:**
- Modify: `src/game/RaceGame.tsx`
- Modify: `src/game/race.css` (append)
- Modify: `src/game/bidding.ts` (delete `bidValue`)
- Modify: `src/game/bidding.test.ts` (delete the `bidValue` describe block and its import)
- Modify: `README.md` ("The game" section)

**Interfaces:**
- Consumes: `resolveRoll`, `bidLabel`, `DOUBLE_X` (Task 2); `RACE_DICE`, `DIE_COLORS` (Task 2); `useDiceRoll(dice)`, `DiceTray.faces` (Task 3); `DiceTableProps.dieColors` (Task 4).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Delete `bidValue` and its test**

Remove the `bidValue` function from `src/game/bidding.ts`, and remove the
`describe('bidValue', ...)` block from `src/game/bidding.test.ts` along with
`bidValue` from that file's import list.

Run: `npm test`
Expected: PASS — 36 tests (one `bidValue` test gone).

- [ ] **Step 2: Rewrite the turn in `src/game/RaceGame.tsx`**

Replace the imports and the turn logic. The `Pending` state gains the faces
rolled and the throw count; `takeTurn` and a new `reroll` share a throw helper.

Imports become:

```ts
import { useCallback, useMemo, useState } from 'react'
import { DiceTable, useDiceRoll, type Face } from '../dice'
import {
  SLOTS,
  bidLabel,
  collectBid,
  emptyBoard,
  legalSlots,
  placeBid,
  resolveRoll,
  type Board,
} from './bidding'
import { DIE_COLORS, RACE_DICE } from './dice'
import './race.css'
```

Replace the `Pending` type with:

```ts
/** The dice have landed and the thrower owes the board a decision. */
type Pending = {
  value: number
  faces: Face[]
  legal: number[]
  /** Throws made this turn. The first is safe; a cross on any later one busts. */
  throws: number
}
```

Change the tray to the real dice:

```ts
  const { recording, playId, rolling, roll, settle } = useDiceRoll(RACE_DICE)
```

Add a shared throw helper above `takeTurn`, and rewrite `takeTurn`:

```ts
  /**
   * Throws, and either hands the player a decision or ends their turn.
   *
   * `throws` is the number of throws this turn *including* this one, so the
   * opening throw passes 1 — the only throw on which a cross is survivable.
   */
  const throwDiceFor = useCallback(
    async (current: number, currentBoard: Board, throws: number) => {
      const mover = players[current].name
      const faces = await roll()
      const rolled = resolveRoll(faces, throws === 1)

      if (rolled.kind === 'bust') {
        say(`${mover} rerolled into a cross and busts — no bid.`)
        setPending(null)
        setTurn((current + 1) % players.length)
        return
      }

      setPending({
        value: rolled.value,
        faces,
        legal: legalSlots(currentBoard, rolled.value),
        throws,
      })
    },
    [players, roll, say],
  )

  const takeTurn = useCallback(async () => {
    if (winner !== null || pending !== null) return

    const current = turn
    const mover = players[current].name

    // A bid that survived until its owner's turn pays out: the slot it sits on
    // is how far they move, and it leaves the track either way.
    const collected = collectBid(board, current)
    setBoard(collected.board)

    if (collected.slot !== null) {
      const position = Math.min(TRACK_LENGTH, players[current].position + collected.slot)
      setPlayers((previous) =>
        previous.map((player, index) => (index === current ? { ...player, position } : player)),
      )

      if (position >= TRACK_LENGTH) {
        setWinner(current)
        say(`${mover} won slot ${collected.slot} and reaches ${TRACK_LENGTH} — ${mover} wins!`)
        return
      }

      say(`${mover} won slot ${collected.slot} and moves to ${position}.`)
    } else {
      say(`${mover} had no bid standing.`)
    }

    await throwDiceFor(current, collected.board, 1)
  }, [board, pending, players, say, throwDiceFor, turn, winner])

  const reroll = useCallback(async () => {
    if (!pending || winner !== null) return
    await throwDiceFor(turn, board, pending.throws + 1)
  }, [board, pending, throwDiceFor, turn, winner])

  const pass = useCallback(() => {
    if (!pending) return
    say(`${players[turn].name} gives up the throw — no bid.`)
    setPending(null)
    setTurn((turn + 1) % players.length)
  }, [pending, players, say, turn])
```

In `choose`, render the value through `bidLabel`:

```ts
      say(
        ...evicted.map(
          (bid) =>
            `${players[bid.player].name}'s ${bidLabel(bid.value)} on ${bid.slot} is knocked off.`,
        ),
        `${mover} bids ${bidLabel(pending.value)} on slot ${slot}.`,
      )
```

- [ ] **Step 3: Show the decision in the UI**

Change the bidding-track heading to describe the throw, using `bidLabel`:

```tsx
        <h2 className="race__bids-title">
          {pending
            ? `${active.name} threw ${pending.faces.join(' and ')} — place ${bidLabel(pending.value)}`
            : 'Bidding track'}
        </h2>
```

Render slot bids through `bidLabel`:

```tsx
                <span className="race__slot-bid" style={{ color: owner?.color }}>
                  {bid ? bidLabel(bid.value) : selectable ? '+' : '—'}
                </span>
```

and the slot's `aria-label`:

```tsx
                aria-label={
                  bid
                    ? `Slot ${slot}, ${players[bid.player].name} bidding ${bidLabel(bid.value)}`
                    : `Slot ${slot}, empty`
                }
```

Pass the die colours to the table:

```tsx
        <DiceTable
          recording={recording}
          playId={playId}
          volume={muted ? 0 : 0.45}
          onSettle={settle}
          dieColors={DIE_COLORS}
        />
```

Replace the controls block with one that offers reroll and, at a dead end, pass:

```tsx
      <div className="race__controls">
        {winner !== null ? (
          <button className="race__roll" onClick={reset}>
            {players[winner].name} wins — play again
          </button>
        ) : pending ? (
          <>
            <button className="race__roll" onClick={reroll} disabled={rolling}>
              {rolling ? 'Rolling…' : 'Reroll (a cross busts)'}
            </button>
            {pending.legal.length === 0 && (
              <button className="race__roll race__roll--quiet" onClick={pass} disabled={rolling}>
                Give up the throw
              </button>
            )}
          </>
        ) : (
          <button className="race__roll" onClick={takeTurn} disabled={rolling}>
            {rolling ? 'Rolling…' : `Throw for ${active.name}`}
          </button>
        )}
      </div>
```

- [ ] **Step 4: Style the secondary button and the controls row**

Append to `src/game/race.css`:

```css
.race__controls {
  gap: 10px;
}

/* The secondary choice at a dead end: available, but not the obvious click. */
.race__roll--quiet {
  background: none;
  border: 1px solid #4a453c;
  color: #9d968a;
  box-shadow: none;
}

.race__roll--quiet:hover:not(:disabled) {
  border-color: #6f6857;
  color: #cfc8b9;
}
```

- [ ] **Step 5: Verify tests and types**

Run: `npm test && npm run typecheck`
Expected: PASS — 36 tests, no type errors anywhere.

- [ ] **Step 6: Update the README's game rules**

In `README.md`, under "## The game", replace the dice and turn description so it
matches. Add after the bidding-track paragraph:

```markdown
### The dice

The two dice are not interchangeable:

| Die | Faces |
| --- | --- |
| A | `1, 2, 3, X, 5, 6` |
| B | `1, 2, 3, 4, X, 7` |

Only B can roll a 4 or the game's single 7; only A can roll a 5 or 6. Each
carries one `X`.

A turn's **first** throw is safe: an `X` on it counts as zero, so A=6 with B=`X`
bids `60`. Two X's on the first throw is `XX` — the strongest bid in the game,
beaten by nothing.

After that first throw you may **reroll as often as you like**, but any `X` on
any later throw **busts**: your turn ends with no bid. A reroll throws both dice
and busts 11/36 of the time, so roughly a third of the time you lose the bid you
already had. That is the whole gamble.

Busting does not undo the move you collected at the start of the turn — that bid
was already won.
```

And update the turn list so step 2 reads:

```markdown
2. **Throw** both dice, then decide: place the value on a legal slot, reroll and
   risk the bust, or — only if no slot is legal — give up the throw.
```

- [ ] **Step 7: Commit**

```bash
git add src/game/RaceGame.tsx src/game/race.css src/game/bidding.ts src/game/bidding.test.ts README.md
git commit -m "Let players reroll for a better bid, at the risk of busting"
```

---

### Task 6: Verify the whole thing in the browser

The rules are unit-tested; the dice art and the turn flow are not, and cannot
usefully be. Drive the real app.

**Files:** none modified unless a defect turns up.

- [ ] **Step 1: Start the preview**

Use `preview_start` with `{name: "race-dev"}`. Note the returned `tabId`.

- [ ] **Step 2: Confirm the dice look right**

Throw once and screenshot. Check every one of these:
- the two dice are visibly different colours
- no floating or orphaned pips anywhere
- a `7` face, when it appears, has a centre pip and reads as seven
- an `X` face shows two red crossed bars, not pips

Reroll several times to bring different faces up. Face ids 4 on die A and 5 on
die B are the crosses; die B's face id 6 is the 7.

- [ ] **Step 3: Confirm the turn flow**

Exercise each path and read the log after each:
- a first throw containing one `X` scores as a zero digit (e.g. `60`), and is
  placeable
- a reroll that busts ends the turn with no bid and passes play on
- a reroll that survives replaces the value, and the legal slots update
- `XX`, if you can get one, is placeable on every empty slot and evicts
  everything above wherever you put it
- "Give up the throw" appears **only** when no slot is legal

- [ ] **Step 4: Confirm nothing is broken**

Run `read_console_messages` with `onlyErrors: true` and `preview_logs` with
`level: "error"`. Both must be empty.

- [ ] **Step 5: Final check and commit any fixes**

Run: `npm test && npm run typecheck && npm run build`
Expected: all clean.

Commit any defect fixes found in this task with their own message.

---

## Notes for the executor

- **The spec says `labeling.ts` changes by zero lines.** That claim is about the
  symmetry machinery — `AXES`, `BASE`, `ROTATIONS`, `labelingWith`,
  `valueOnAxis`, `faceBasis` — which must not be touched, because the fairness
  argument rests on it. `PIP_LAYOUT` happens to live in the same file but is
  cosmetic pip-position data; Task 4 adds a `7` key to it and that is expected.
- **Test counts** quoted in the expected output assume you start from 14 passing
  tests (the current state of `src/game/bidding.test.ts`). They land at 36 after
  Task 5 deletes the `bidValue` test.
- **Do not reintroduce `DiceTray.total`.** Summing a hand that can contain a
  cross has no meaning. Nothing consumes it.
- **`dieColors` is in the die-construction effect's dependency list but the
  effect's early return means a colour change alone won't rebuild the dice.**
  That is fine — `DIE_COLORS` is a module constant. Don't restructure the effect
  to chase it.
- **This repo has no ESLint.** If you find yourself reaching for an
  `eslint-disable` comment, write a plain comment explaining the reasoning
  instead.
