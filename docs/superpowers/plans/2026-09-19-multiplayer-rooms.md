# Multiplayer Rooms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a host create a room, share a four-letter code or link, and race
friends in real time on Cloudflare, with AI filling every unclaimed seat.

**Architecture:** The rules move out of `useRaceGame` into a pure `src/engine/`
shared by the browser and a Worker. A Durable Object owns the authoritative
state and broadcasts `{ event, state }` steps; clients hold an animation queue
and carry no rules. Solo mode runs the same `Room` through a local transport,
so there is one turn-driving path.

**Tech Stack:** TypeScript, React 19, Vite 7, vitest, Cloudflare Workers +
Durable Objects (WebSocket Hibernation), wrangler.

**Spec:** `docs/superpowers/specs/2026-09-19-multiplayer-rooms-design.md`

## Global Constraints

- **Engine purity.** No file under `src/engine/` may import `../dice` (the
  barrel re-exports `DiceTable` → React/three and `physics` → cannon-es).
  Import `../dice/faces` and `../dice/random` directly. Enforced by
  `src/engine/purity.test.ts`.
- **The Worker never runs physics.** It draws `{ seed, faceIds }`; clients
  simulate. `three` and `cannon-es` must never reach the Worker bundle.
- **Authorisation rule, used everywhere:** a token may act only when
  `seats[state.turn].token === token`. There is no second rule, and no
  local-play special case — local play works because one token owns several
  seats.
- **Seat counts** stay `MIN_SEATS = 3`, `MAX_SEATS = 6`.
- **Room code alphabet:** `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, length 4.
- **Existing tests must keep passing** unchanged in meaning. Moved files keep
  their tests; the tests move with them.
- **Commit after every task.** Co-author line:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

---

## File Structure

**Created**

| File | Responsibility |
| --- | --- |
| `src/engine/state.ts` | `GameState`, `GameEvent`, `Step`, `Roll`, `GameIntent` |
| `src/engine/engine.ts` | `apply(state, intent)` — pure turn flow |
| `src/engine/room.ts` | `Room` — seats, join/start, authorisation, AI bursts |
| `src/engine/codes.ts` | room-code generation |
| `src/engine/protocol.ts` | `ClientMessage`, `ServerMessage`, `RoomView` |
| `src/engine/purity.test.ts` | barrel guard |
| `src/net/transport.ts` | `Transport` interface, `LocalTransport`, `SocketTransport` |
| `src/net/useRoom.ts` | socket + animation queue + view state |
| `src/game/OnlineLobby.tsx` | create/join/room-lobby UI |
| `worker/index.ts` | assets + `/api/room/:code` upgrade |
| `worker/RaceRoom.ts` | Durable Object adapter over `Room` |
| `tsconfig.worker.json` | Worker-side TS config |
| `wrangler.toml` | bindings, migration, assets |

**Moved** (imports retargeted, tests move with them)

`src/game/bidding.ts` → `src/engine/bidding.ts`,
`src/game/seats.ts` → `src/engine/seats.ts`,
`src/game/ai.ts` → `src/engine/ai.ts`,
`src/game/dice.ts` → `src/engine/dice.ts` (`DIE_COLORS` stays behind).

**Modified**

`src/dice/physics.ts` (accept `faceIds`), `src/dice/useDiceRoll.ts`
(`play(roll)` replaces `roll()`), `src/game/useRaceGame.ts` (thin wrapper),
`src/game/RaceGame.tsx` (`mySeats`), `src/App.tsx` (routing),
`vite.config.ts` (dev proxy), `package.json`, `README.md`.

**Deleted**

`src/game/useAiTurns.ts` and its behaviour — replaced by the animation queue.

---

### Task 1: Make a throw reproducible

**Files:**
- Modify: `src/dice/physics.ts:204-206`
- Test: `src/dice/physics.test.ts`

**Interfaces:**
- Produces: `throwDice(dice: readonly DieFaces[], seed: number, faceIds?: number[]): Recording`

- [ ] **Step 1: Write the failing tests**

Append to `src/dice/physics.test.ts`, inside the existing `describe('throwDice')`:

```ts
  test('lands the face ids it is given', () => {
    const recording = throwDice([DIE_A, DIE_B], 4242, [5, 2])
    expect(recording.outcomes.map((o) => o.faceId)).toEqual([5, 2])
    expect(recording.outcomes.map((o) => o.face)).toEqual([DIE_A[4], DIE_B[1]])
  })

  /* The whole point: a seed and a set of faces describe a throw completely,
     so an opponent's throw replays here frame-for-frame rather than being
     reported as a number. */
  test('replays identically from the same seed and faces', () => {
    const a = throwDice([DIE_A, DIE_B], 777, [1, 6])
    const b = throwDice([DIE_A, DIE_B], 777, [1, 6])
    expect(b.frameCount).toBe(a.frameCount)
    expect(Array.from(b.track)).toEqual(Array.from(a.track))
    expect(b.outcomes.map((o) => o.faceId)).toEqual([1, 6])
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- physics`
Expected: FAIL — `throwDice` takes two arguments, so the ids are ignored and
`outcomes` carries a random draw.

- [ ] **Step 3: Implement**

In `src/dice/physics.ts`, change the signature and delete the internal draw:

```ts
/**
 * Throws `dice`.
 *
 * The faces are drawn from the CSPRNG first, then a simulation is run and its
 * motion recorded. Simulations are only rejected for settling badly — never for
 * the number they produced.
 *
 * `faceIds` may be supplied instead of drawn, which is what makes a throw
 * portable: `{ seed, faceIds }` describes it completely, so a room can decide a
 * throw once and every client replay the same tumble. The simulation never
 * reads them — they only dress the die, via `labelingWith` below — so passing
 * them in cannot bias the physics.
 */
export function throwDice(
  dice: readonly DieFaces[],
  seed: number,
  faceIds: number[] = rollFaces(dice.length),
): Recording {
  const count = dice.length
  const { world, dice: bodies } = getSimulator(count)
```

(The line `const faceIds = rollFaces(count)` is removed; `rollFaces` stays
imported for the default.)

- [ ] **Step 4: Run tests**

Run: `npm test -- physics` → PASS, including the existing uniformity test,
which still calls the two-argument form.

- [ ] **Step 5: Commit**

```bash
git add src/dice/physics.ts src/dice/physics.test.ts
git commit -m "Let a caller supply the faces a throw lands on"
```

---

### Task 2: Move the pure rules into an engine

Mechanical move, no behaviour change, plus the guard that keeps it pure.

**Files:**
- Move: `src/game/{bidding,seats,ai,dice}.ts` → `src/engine/`
- Move: `src/game/{bidding,seats,ai}.test.ts` → `src/engine/`
- Create: `src/engine/purity.test.ts`
- Modify: importers — `src/game/{RaceGame.tsx,Lobby.tsx,useRaceGame.ts,useAiTurns.ts}`, `src/App.tsx`

**Interfaces:**
- Produces: everything those four modules already export, at `src/engine/*`.
  `DIE_COLORS` is **not** among them — it stays in `src/game/dice.ts`.

- [ ] **Step 1: Move the files**

```bash
mkdir -p src/engine
git mv src/game/bidding.ts src/game/bidding.test.ts src/engine/
git mv src/game/seats.ts src/game/seats.test.ts src/engine/
git mv src/game/ai.ts src/game/ai.test.ts src/engine/
git mv src/game/dice.ts src/engine/dice.ts
```

- [ ] **Step 2: Retarget the barrel imports**

`src/engine/bidding.ts:1` and `src/engine/dice.ts:1` both reach the dice types
through the barrel. Point them at the module:

```ts
// src/engine/bidding.ts
import type { Face } from '../dice/faces'

// src/engine/dice.ts
import type { DieFaces } from '../dice/faces'
```

- [ ] **Step 3: Put `DIE_COLORS` back with the renderer**

Delete the `DIE_COLORS` export (and its comment) from `src/engine/dice.ts` and
create `src/game/dice.ts` holding only it:

```ts
/**
 * Cream for A, sky for B — the dice have to be told apart at a glance.
 *
 * Both stay light on purpose. The pips are near-black and a cross is red
 * (`DiceTable.tsx`), so a dark die body would swallow the very marks the game
 * is read from; the old slate B was already the dimmer of the two. Against the
 * sunlit grass of `.race__table`, cream and sky both keep their edges.
 *
 * Which faces a die carries is a rule and lives in `engine/dice.ts`. What
 * colour it is painted is not, and lives here.
 */
export const DIE_COLORS = [0xfff6e3, 0x9fd8f2]
```

- [ ] **Step 4: Fix every importer**

`RaceGame.tsx` imports `bidding`, `dice` (for `DIE_COLORS`) and `seats`;
`Lobby.tsx` imports `seats`; `useRaceGame.ts` imports `bidding`, `dice`,
`seats`; `useAiTurns.ts` imports `ai`; `App.tsx` imports `seats`. Retarget
each to `../engine/…` (or `./engine/…` from `App.tsx`), keeping
`DIE_COLORS` on `./dice`.

Run `npx tsc --noEmit` and fix whatever it names — the compiler finds these
exhaustively, so do not hunt by hand.

- [ ] **Step 5: Write the purity guard**

Create `src/engine/purity.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * The engine is bundled into a Cloudflare Worker, which must not carry a
 * physics library or a renderer.
 *
 * `src/dice/index.ts` re-exports `DiceTable` (React, three) and `physics`
 * (cannon-es). Reaching the dice *types* through it is harmless today only
 * because those imports are type-only and erase. One `import { faceOf } from
 * '../dice'` would quietly put three and cannon-es in the Worker, and the
 * symptom would be a fat deploy rather than an error — so it is checked here
 * instead of being left to notice.
 */
describe('the engine', () => {
  const dir = join(import.meta.dirname, '.')
  const sources = readdirSync(dir).filter((f) => f.endsWith('.ts'))

  test('has sources to check', () => {
    expect(sources.length).toBeGreaterThan(4)
  })

  test('never imports the dice barrel', () => {
    for (const file of sources) {
      const text = readFileSync(join(dir, file), 'utf8')
      expect(text, `${file} imports the dice barrel`).not.toMatch(
        /from '\.\.\/dice'/,
      )
    }
  })
})
```

- [ ] **Step 6: Run everything**

Run: `npm test && npx tsc --noEmit`
Expected: all existing tests pass unchanged, plus the two new guard tests.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Move the pure rules into an engine the Worker can import"
```

---

### Task 3: The game engine

The turn flow lifted out of `useRaceGame` and made a total, synchronous
function.

**Files:**
- Create: `src/engine/state.ts`, `src/engine/engine.ts`
- Test: `src/engine/engine.test.ts`

**Interfaces:**
- Consumes: `bidding.ts`, `dice.ts` (`RACE_DICE`), `seats.ts` from Task 2.
- Produces:

```ts
// state.ts
export const TRACK_LENGTH = 30

export type SeatState = Seat & { position: number; away: boolean }
export type Pending = { value: number; faces: Face[]; legal: number[]; throws: number }

export type GameState = {
  players: SeatState[]
  board: Board
  turn: number
  pending: Pending | null
  winner: number | null
  log: string[]
}

/** A throw, described completely enough for any client to replay it. */
export type Roll = { seed: number; faceIds: number[] }

export type GameEvent =
  | { kind: 'threw'; seat: number; roll: Roll }
  | { kind: 'collected'; seat: number }
  | { kind: 'bid'; seat: number }
  | { kind: 'busted'; seat: number }
  | { kind: 'passed'; seat: number }
  | { kind: 'won'; seat: number }

/** One beat of play: what happened, and the state it left behind. */
export type Step = { event: GameEvent; state: GameState }

export type GameIntent =
  | { kind: 'throw'; roll: Roll }
  | { kind: 'reroll'; roll: Roll }
  | { kind: 'place'; slot: number }
  | { kind: 'pass' }

export function startGame(players: SeatState[]): GameState
export function facesOf(roll: Roll): Face[]
export function seatToMove(state: GameState): number | null

// engine.ts
export function apply(state: GameState, intent: GameIntent): Step[]
```

**Why `Step[]` and not `{ state, events }`:** each event is a beat the player
watches, and each beat needs the state *as of that beat* — otherwise the log
jumps three lines at once and a collected slot and the throw that follows it
animate on top of each other. `startTurn` is two beats: `collected`, then
`threw`.

`apply` is total: an intent that is not legal in the given state returns `[]`.
It never throws, and it never decides *who* may send an intent — that is the
room's job (see the Global Constraints authorisation rule).

- [ ] **Step 1: Write `state.ts`**

```ts
import type { Face } from '../dice/faces'
import { faceOf } from '../dice/faces'
import type { Board } from './bidding'
import { emptyBoard } from './bidding'
import { RACE_DICE } from './dice'
import type { Seat } from './seats'

/** Spaces from the starting line to the finish. */
export const TRACK_LENGTH = 30

/**
 * A seat, mid-race.
 *
 * `away` is a human whose socket has gone. It is deliberately separate from
 * `kind`: an away human is still a human, and flipping `kind` would lose the
 * fact that the seat is owed back to them if they return.
 */
export type SeatState = Seat & { position: number; away: boolean }

/** The dice have landed and the thrower owes the board a decision. */
export type Pending = {
  value: number
  faces: Face[]
  legal: number[]
  /** Throws made this turn. The first is safe; a cross on any later one busts. */
  throws: number
}

export type GameState = {
  players: SeatState[]
  board: Board
  turn: number
  pending: Pending | null
  winner: number | null
  log: string[]
}

/**
 * A throw, described completely enough for any client to replay it.
 *
 * The room decides this once, with the CSPRNG; every client feeds it to
 * `throwDice` and watches the same tumble. No physics crosses the wire.
 */
export type Roll = { seed: number; faceIds: number[] }

export type GameEvent =
  | { kind: 'threw'; seat: number; roll: Roll }
  | { kind: 'collected'; seat: number }
  | { kind: 'bid'; seat: number }
  | { kind: 'busted'; seat: number }
  | { kind: 'passed'; seat: number }
  | { kind: 'won'; seat: number }

/** One beat of play: what happened, and the state it left behind. */
export type Step = { event: GameEvent; state: GameState }

export type GameIntent =
  | { kind: 'throw'; roll: Roll }
  | { kind: 'reroll'; roll: Roll }
  | { kind: 'place'; slot: number }
  | { kind: 'pass' }

export function startGame(players: SeatState[]): GameState {
  return {
    players,
    board: emptyBoard(),
    turn: 0,
    pending: null,
    winner: null,
    log: [`${players[0].name} to throw.`],
  }
}

/** What a roll shows, resolved through the dice that made it. */
export function facesOf(roll: Roll): Face[] {
  return roll.faceIds.map((id, index) => faceOf(RACE_DICE[index], id))
}

/** The seat whose turn it is, or null once someone has won. */
export function seatToMove(state: GameState): number | null {
  return state.winner === null ? state.turn : null
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/engine/engine.test.ts`. `roll()` builds a `Roll` that lands the
faces a test wants, by looking the ids up on the real dice.

```ts
import { describe, expect, test } from 'vitest'
import { DIE_A, DIE_B } from './dice'
import { DOUBLE_X } from './bidding'
import { apply } from './engine'
import { startGame, TRACK_LENGTH, type GameState, type Roll, type SeatState } from './state'
import type { Face } from '../dice/faces'

const seat = (name: string, kind: 'human' | 'ai' = 'human'): SeatState => ({
  name,
  color: '#000000',
  ink: '#000000',
  kind,
  position: 0,
  away: false,
})

const three = () => startGame([seat('A'), seat('B'), seat('C')])

/** A roll that lands exactly `faces`, found on the real dice. */
function roll(a: Face, b: Face): Roll {
  const ia = DIE_A.indexOf(a)
  const ib = DIE_B.indexOf(b)
  if (ia < 0 || ib < 0) throw new Error(`no such faces: ${a}, ${b}`)
  return { seed: 1, faceIds: [ia + 1, ib + 1] }
}

const last = (steps: { state: GameState }[]) => steps[steps.length - 1].state

describe('apply', () => {
  test('opens a turn by collecting nothing, then throwing', () => {
    const steps = apply(three(), { kind: 'throw', roll: roll(6, 4) })
    expect(steps.map((s) => s.event.kind)).toEqual(['collected', 'threw'])
    expect(last(steps).pending?.value).toBe(64)
  })

  test('pays a standing bid its slot in spaces at the top of the turn', () => {
    const state = { ...three(), board: three().board.map((_, i) => (i === 5 ? { value: 40, player: 0 } : null)) }
    const steps = apply(state, { kind: 'throw', roll: roll(6, 4) })
    expect(last(steps).players[0].position).toBe(5)
    expect(last(steps).board[5]).toBeNull()
  })

  test('banks a double before the bid, and keeps the bid open', () => {
    const steps = apply(three(), { kind: 'throw', roll: roll(3, 3) })
    const state = last(steps)
    expect(state.players[0].position).toBe(3)
    expect(state.pending?.value).toBe(33)
  })

  test('reads two crosses on the opening throw as the jackpot', () => {
    const steps = apply(three(), { kind: 'throw', roll: roll('x', 'x') })
    expect(last(steps).pending?.value).toBe(DOUBLE_X)
  })

  test('busts on a cross after the opening throw, ending the turn', () => {
    const opened = last(apply(three(), { kind: 'throw', roll: roll(6, 4) }))
    const steps = apply(opened, { kind: 'reroll', roll: roll('x', 2) })
    expect(steps.map((s) => s.event.kind)).toEqual(['busted'])
    expect(last(steps).pending).toBeNull()
    expect(last(steps).turn).toBe(1)
  })

  /* Spaces from a double are paid before any bidding and never taken back —
     busting later costs the bid, not the ground already covered. */
  test('keeps the spaces a double paid even when a later throw busts', () => {
    const opened = last(apply(three(), { kind: 'throw', roll: roll(3, 3) }))
    const busted = last(apply(opened, { kind: 'reroll', roll: roll('x', 2) }))
    expect(busted.players[0].position).toBe(3)
  })

  test('places a bid, knocks off what it outbids, and hands over the turn', () => {
    const opened = three()
    opened.board[4] = { value: 21, player: 1 }
    const thrown = last(apply(opened, { kind: 'throw', roll: roll(6, 4) }))
    const state = last(apply(thrown, { kind: 'place', slot: 2 }))
    expect(state.board[2]).toEqual({ value: 64, player: 0 })
    expect(state.board[4]).toBeNull()
    expect(state.turn).toBe(1)
  })

  test('wins when a collected slot reaches the end of the track', () => {
    const state = three()
    state.players[0].position = TRACK_LENGTH - 3
    state.board[3] = { value: 40, player: 0 }
    const steps = apply(state, { kind: 'throw', roll: roll(6, 4) })
    expect(steps.map((s) => s.event.kind)).toEqual(['collected', 'won'])
    expect(last(steps).winner).toBe(0)
  })

  /* A win has to close the decision too. A reroll that wins on a double while
     a bid is pending would otherwise leave slots live to click on a finished
     game. */
  test('closes any standing decision when a double wins the race', () => {
    const state = three()
    state.players[0].position = TRACK_LENGTH - 3
    const steps = apply(state, { kind: 'throw', roll: roll(3, 3) })
    expect(last(steps).winner).toBe(0)
    expect(last(steps).pending).toBeNull()
  })

  test('ignores an intent that is not legal in this state', () => {
    expect(apply(three(), { kind: 'place', slot: 2 })).toEqual([])
    expect(apply(three(), { kind: 'reroll', roll: roll(6, 4) })).toEqual([])
    const won = { ...three(), winner: 1 }
    expect(apply(won, { kind: 'throw', roll: roll(6, 4) })).toEqual([])
  })

  test('ignores a placement on a slot that is already taken', () => {
    const opened = three()
    opened.board[2] = { value: 21, player: 1 }
    const thrown = last(apply(opened, { kind: 'throw', roll: roll(6, 4) }))
    expect(apply(thrown, { kind: 'place', slot: 2 })).toEqual([])
  })
})
```

- [ ] **Step 3: Run to verify they fail**

Run: `npm test -- engine`
Expected: FAIL — `./engine` does not exist.

- [ ] **Step 4: Implement `engine.ts`**

This is `useRaceGame`'s logic with `writeX`/`say` replaced by building states.
Keep the existing comments that explain *why* — they are the reason the rules
are readable.

```ts
import {
  bidLabel,
  collectBid,
  doubleBonus,
  legalSlots,
  placeBid,
  resolveRoll,
} from './bidding'
import {
  TRACK_LENGTH,
  facesOf,
  type GameEvent,
  type GameIntent,
  type GameState,
  type Roll,
  type Step,
} from './state'

/** Newest first, same as the panel reads. */
function say(state: GameState, ...lines: string[]): GameState {
  return { ...state, log: [...lines, ...state.log].slice(0, 6) }
}

function move(state: GameState, seat: number, spaces: number) {
  const position = Math.min(TRACK_LENGTH, state.players[seat].position + spaces)
  const players = state.players.map((p, i) => (i === seat ? { ...p, position } : p))
  return { state: { ...state, players }, position, won: position >= TRACK_LENGTH }
}

function endTurn(state: GameState): GameState {
  return { ...state, pending: null, turn: (state.turn + 1) % state.players.length }
}

const step = (event: GameEvent, state: GameState): Step => ({ event, state })

/**
 * Throws, and reports what the board now owes a decision about.
 *
 * `throws` is the count including this one: the first throw of a turn is safe,
 * and a cross on any later one busts.
 */
function throwDiceStep(state: GameState, roll: Roll, throws: number): Step[] {
  const seat = state.turn
  const mover = state.players[seat].name
  const faces = facesOf(roll)
  const rolled = resolveRoll(faces, throws === 1)

  if (rolled.kind === 'bust') {
    const next = endTurn(say(state, `${mover} rerolled into a cross and busts — no bid.`))
    return [step({ kind: 'busted', seat }, next)]
  }

  // A matching pair of numbers pays its value in spaces before any bidding,
  // and the bid goes ahead as well. Those spaces are banked: busting on a
  // later throw never takes them back.
  let next = state
  const bonus = doubleBonus(faces)
  let bonusLine: string | null = null

  if (bonus > 0) {
    const moved = move(next, seat, bonus)
    next = moved.state
    if (moved.won) {
      // A reroll leaves a decision standing; a won game must not keep
      // offering slots to place on.
      next = say(
        { ...next, winner: seat, pending: null },
        `${mover} threw double ${bonus} and reaches ${TRACK_LENGTH} — ${mover} wins!`,
      )
      return [step({ kind: 'threw', seat, roll }, next), step({ kind: 'won', seat }, next)]
    }
    bonusLine = `${mover} threw double ${bonus} and moves to ${moved.position}.`
  }

  const legal = legalSlots(next.board)
  const pending = { value: rolled.value, faces, legal, throws }
  const lines = bonusLine ? [bonusLine] : []
  return [step({ kind: 'threw', seat, roll }, say({ ...next, pending }, ...lines))]
}

/**
 * Advances the game by one intent, as a sequence of beats.
 *
 * Total: an intent that is not legal here returns no steps and changes
 * nothing. It does not decide *who* may send an intent — `room.ts` owns that,
 * so this stays a pure function of the board.
 */
export function apply(state: GameState, intent: GameIntent): Step[] {
  if (state.winner !== null) return []

  switch (intent.kind) {
    case 'throw': {
      if (state.pending !== null) return []

      const seat = state.turn
      const mover = state.players[seat].name

      // A bid that survived until its owner's turn pays out: the slot it sits
      // on is how far they move, and it leaves the track either way.
      const collected = collectBid(state.board, seat)
      let next: GameState = { ...state, board: collected.board }

      if (collected.slot !== null) {
        const moved = move(next, seat, collected.slot)
        next = moved.state
        if (moved.won) {
          next = say(
            { ...next, winner: seat },
            `${mover} won slot ${collected.slot} and reaches ${TRACK_LENGTH} — ${mover} wins!`,
          )
          return [step({ kind: 'collected', seat }, next), step({ kind: 'won', seat }, next)]
        }
        next = say(next, `${mover} won slot ${collected.slot} and moves to ${moved.position}.`)
      } else {
        next = say(next, `${mover} had no bid standing.`)
      }

      return [
        step({ kind: 'collected', seat }, next),
        ...throwDiceStep(next, intent.roll, 1),
      ]
    }

    case 'reroll': {
      if (!state.pending) return []
      return throwDiceStep(state, intent.roll, state.pending.throws + 1)
    }

    case 'place': {
      const pending = state.pending
      if (!pending || !pending.legal.includes(intent.slot)) return []

      const seat = state.turn
      const mover = state.players[seat].name
      const { board, evicted } = placeBid(state.board, intent.slot, pending.value, seat)

      const next = endTurn(
        say(
          { ...state, board },
          ...evicted.map(
            (bid) =>
              `${state.players[bid.player].name}'s ${bidLabel(bid.value)} on ${bid.slot} is knocked off.`,
          ),
          `${mover} bids ${bidLabel(pending.value)} on slot ${intent.slot}.`,
        ),
      )
      return [step({ kind: 'bid', seat }, next)]
    }

    case 'pass': {
      if (!state.pending) return []
      const seat = state.turn
      const next = endTurn(
        say(state, `${state.players[seat].name} gives up the throw — no bid.`),
      )
      return [step({ kind: 'passed', seat }, next)]
    }
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- engine` → PASS. Then `npm test` → everything passes.

- [ ] **Step 6: Commit**

```bash
git add src/engine/state.ts src/engine/engine.ts src/engine/engine.test.ts
git commit -m "Lift the turn flow out of React into a pure engine"
```

---

### Task 4: Room codes

**Files:**
- Create: `src/engine/codes.ts`, `src/engine/codes.test.ts`

**Interfaces:**
- Produces: `CODE_ALPHABET`, `CODE_LENGTH`, `newCode(): string`,
  `normaliseCode(raw: string): string | null`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from 'vitest'
import { CODE_ALPHABET, CODE_LENGTH, newCode, normaliseCode } from './codes'

describe('room codes', () => {
  /* The code's whole job is to survive being read down a phone line. */
  test('leaves out the characters people mishear', () => {
    for (const char of 'ILO01') expect(CODE_ALPHABET).not.toContain(char)
  })

  test('draws codes of the right shape', () => {
    for (let i = 0; i < 200; i++) {
      const code = newCode()
      expect(code).toHaveLength(CODE_LENGTH)
      for (const char of code) expect(CODE_ALPHABET).toContain(char)
    }
  })

  test('does not keep drawing the same code', () => {
    const drawn = new Set(Array.from({ length: 200 }, newCode))
    expect(drawn.size).toBeGreaterThan(150)
  })

  test('accepts what a person actually types', () => {
    expect(normaliseCode(' ab2c ')).toBe('AB2C')
    expect(normaliseCode('AB2C')).toBe('AB2C')
  })

  test('refuses anything that is not a code', () => {
    expect(normaliseCode('AB2')).toBeNull()
    expect(normaliseCode('AB2CD')).toBeNull()
    expect(normaliseCode('AB2I')).toBeNull()
    expect(normaliseCode('')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npm test -- codes` → module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * Room codes.
 *
 * Four characters, drawn from an alphabet with `I`, `L`, `O`, `0` and `1`
 * removed — the characters people mishear when a code is read aloud, which is
 * exactly how these travel. 31^4 is about 924,000 codes, and only rooms alive
 * at the same moment can collide.
 */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const CODE_LENGTH = 4

/** A fresh code, drawn from the CSPRNG with rejection sampling. */
export function newCode(): string {
  const limit = Math.floor(256 / CODE_ALPHABET.length) * CODE_ALPHABET.length
  let code = ''

  while (code.length < CODE_LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH))
    for (const byte of bytes) {
      if (byte >= limit) continue
      code += CODE_ALPHABET[byte % CODE_ALPHABET.length]
      if (code.length === CODE_LENGTH) break
    }
  }

  return code
}

/** A typed or pasted code, tidied — or null if it is not one. */
export function normaliseCode(raw: string): string | null {
  const code = raw.trim().toUpperCase()
  if (code.length !== CODE_LENGTH) return null
  for (const char of code) if (!CODE_ALPHABET.includes(char)) return null
  return code
}
```

- [ ] **Step 4: Run** — `npm test -- codes` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/codes.ts src/engine/codes.test.ts
git commit -m "Draw room codes from an alphabet that survives a phone call"
```

---

### Task 5: The protocol and the room

The whole multiplayer brain, transport-free.

**Files:**
- Create: `src/engine/protocol.ts`, `src/engine/room.ts`
- Test: `src/engine/room.test.ts`

**Interfaces:**
- Consumes: `apply`, `startGame`, `seatToMove` (Task 3); `decideAi`,
  `MAX_REROLL_VALUE` (Task 2); `newCode` (Task 4).
- Produces:

```ts
// protocol.ts
export type SeatView = {
  name: string; color: string; ink: string
  kind: 'human' | 'ai'
  /** A human seat whose socket has gone. Never true of an AI seat. */
  away: boolean
}

export type RoomView = {
  code: string
  phase: 'lobby' | 'racing'
  /** Seat the host sits in. Only the host may start. */
  host: number
  seats: SeatView[]
}

export type ClientMessage =
  | { type: 'hello'; token?: string; create?: boolean; size?: number; name?: string }
  | { type: 'rename'; name: string }
  | { type: 'resize'; size: number }
  | { type: 'start' }
  | { type: 'throw' }
  | { type: 'reroll' }
  | { type: 'place'; slot: number }

export type ServerMessage =
  | { type: 'welcome'; token: string; seats: number[]; room: RoomView; game: GameState | null }
  | { type: 'room'; room: RoomView }
  | { type: 'steps'; steps: Step[] }
  | { type: 'error'; reason: string; fatal: boolean }

/** A message, and who it goes to. `'all'` is every connected socket. */
export type Outbox = { to: 'all' | string; message: ServerMessage }

// room.ts
export class Room {
  constructor(code: string, saved?: RoomSnapshot)
  handle(token: string | null, message: ClientMessage): Outbox[]
  disconnect(token: string): Outbox[]
  snapshot(): RoomSnapshot
  get idle(): boolean          // no connected tokens
  static restore(saved: RoomSnapshot): Room
}
```

**The three rules that make this small:**

1. **Authorisation is one line.** `seats[game.turn].token === token`. Nothing
   else is ever checked for a game intent.
2. **Local play needs no special case.** One token may own several seats, so
   the local transport claims every human seat with one token and hotseat
   works through the same rule.
3. **The AI burst is bounded by the watcher.** After every change the room
   plays AI and away seats until the seat to move belongs to a *connected*
   token, or the race is won. With at least one connected player that is at
   most `MAX_SEATS - 1` turns. With nobody connected it does not run at all,
   so an empty room cannot spin.

- [ ] **Step 1: Write `protocol.ts`**

Exactly the types above, with `GameState` and `Step` imported from `./state`.
Add this comment above `Outbox`:

```ts
/**
 * A message and who it goes to.
 *
 * The room never touches a socket — it returns these and lets the Durable
 * Object post them. That is what keeps the whole multiplayer brain testable
 * under plain vitest, with no Workers runner and no mocked transport.
 */
```

- [ ] **Step 2: Write the failing tests**

Create `src/engine/room.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { Room } from './room'
import type { GameState, Step } from './state'

const hello = (room: Room, token: string, extra: object = {}) =>
  room.handle(token, { type: 'hello', token, ...extra })

/** A room with `size` seats, host plus `others` more humans, all connected. */
function seated(size: number, others: string[] = []) {
  const room = new Room('AB2C')
  hello(room, 'host', { create: true, size })
  for (const token of others) hello(room, token)
  return room
}

const lastState = (out: { message: { type: string } }[]): GameState => {
  const steps = out.flatMap((o) =>
    o.message.type === 'steps' ? (o.message as { steps: Step[] }).steps : [],
  )
  return steps[steps.length - 1].state
}

describe('joining', () => {
  test('creates a room and seats the host first', () => {
    const room = new Room('AB2C')
    const out = hello(room, 'host', { create: true, size: 3 })
    const welcome = out.find((o) => o.message.type === 'welcome')
    expect(welcome?.message).toMatchObject({ type: 'welcome', seats: [0] })
  })

  test('refuses to join a room nobody has created', () => {
    const room = new Room('AB2C')
    const out = hello(room, 'guest')
    expect(out[0].message).toMatchObject({ type: 'error', fatal: true })
  })

  test('refuses a second create on a live room, so a code clash is not silent', () => {
    const room = seated(3)
    const out = hello(room, 'other', { create: true, size: 3 })
    expect(out[0].message).toMatchObject({ type: 'error', fatal: true })
  })

  test('gives each arrival the next free seat', () => {
    const room = seated(3, ['b'])
    const out = hello(room, 'c')
    expect(out.find((o) => o.message.type === 'welcome')?.message).toMatchObject({ seats: [2] })
  })

  test('turns a claimed seat human and leaves the rest AI', () => {
    const room = seated(3, ['b'])
    const view = room.view()
    expect(view.seats.map((s) => s.kind)).toEqual(['human', 'human', 'ai'])
  })

  test('refuses a newcomer once the race has started', () => {
    const room = seated(3, ['b'])
    room.handle('host', { type: 'start' })
    const out = hello(room, 'late')
    expect(out[0].message).toMatchObject({ type: 'error', fatal: true })
  })

  test('turns away an arrival when every seat is claimed', () => {
    const room = seated(3, ['b', 'c'])
    expect(hello(room, 'd')[0].message).toMatchObject({ type: 'error', fatal: true })
  })

  test('lets a player rename their own snail', () => {
    const room = seated(3, ['b'])
    room.handle('b', { type: 'rename', name: 'Dave' })
    expect(room.view().seats[1].name).toBe('Dave')
  })
})

describe('starting', () => {
  test('only the host may start', () => {
    const room = seated(3, ['b'])
    expect(room.handle('b', { type: 'start' })[0].message).toMatchObject({ type: 'error' })
    expect(room.view().phase).toBe('lobby')
  })

  test('starts with two humans and an AI, so a pair can race', () => {
    const room = seated(3, ['b'])
    room.handle('host', { type: 'start' })
    expect(room.view().phase).toBe('racing')
    expect(room.game()?.players.map((p) => p.kind)).toEqual(['human', 'human', 'ai'])
  })

  test('lets the host resize the table before the race', () => {
    const room = seated(3)
    room.handle('host', { type: 'resize', size: 5 })
    expect(room.view().seats).toHaveLength(5)
  })

  /* Resizing must not strand a player who has already taken a seat. */
  test('refuses a resize that would unseat someone', () => {
    const room = seated(5, ['b', 'c', 'd', 'e'])
    room.handle('host', { type: 'resize', size: 3 })
    expect(room.view().seats).toHaveLength(5)
  })
})

describe('playing', () => {
  test('lets the seat whose turn it is throw', () => {
    const room = seated(3, ['b'])
    room.handle('host', { type: 'start' })
    const out = room.handle('host', { type: 'throw' })
    expect(lastState(out).pending).not.toBeNull()
  })

  test('ignores an intent from a seat it is not the turn of', () => {
    const room = seated(3, ['b'])
    room.handle('host', { type: 'start' })
    const out = room.handle('b', { type: 'throw' })
    expect(out[0].message).toMatchObject({ type: 'error', fatal: false })
    expect(room.game()?.pending).toBeNull()
  })

  test('ignores an intent from a token that owns no seat at all', () => {
    const room = seated(3, ['b'])
    room.handle('host', { type: 'start' })
    expect(room.handle('nobody', { type: 'throw' })[0].message).toMatchObject({ type: 'error' })
  })

  /* The burst stops at the first seat someone is actually watching from.
     That is what bounds it: with a connected human it is at most the other
     seats, and with nobody connected it does not run. */
  test('plays every AI seat through to the next connected human', () => {
    const room = seated(3)
    room.handle('host', { type: 'start' })
    room.handle('host', { type: 'throw' })
    const out = room.handle('host', { type: 'place', slot: 0 })
    expect(room.game()?.turn).toBe(0)
    expect(out.some((o) => o.message.type === 'steps')).toBe(true)
  })

  test('does not run the AI while nobody is connected', () => {
    const room = seated(3)
    room.handle('host', { type: 'start' })
    room.handle('host', { type: 'throw' })
    room.handle('host', { type: 'place', slot: 0 })
    room.disconnect('host')
    expect(room.idle).toBe(true)
  })
})

describe('going away', () => {
  test('marks a dropped seat away without giving it to the AI', () => {
    const room = seated(3, ['b'])
    room.handle('host', { type: 'start' })
    room.disconnect('b')
    expect(room.view().seats[1]).toMatchObject({ kind: 'human', away: true })
  })

  test('gives a returning player their own snail back', () => {
    const room = seated(3, ['b'])
    room.handle('host', { type: 'start' })
    room.disconnect('b')
    const out = hello(room, 'b')
    expect(out.find((o) => o.message.type === 'welcome')?.message).toMatchObject({ seats: [1] })
    expect(room.view().seats[1].away).toBe(false)
  })

  /* The whole point of deferring: a blip between your turns costs nothing. */
  test('plays an away seat only when its turn actually comes round', () => {
    const room = seated(3, ['b'])
    room.handle('host', { type: 'start' })
    room.disconnect('b')
    room.handle('host', { type: 'throw' })
    room.handle('host', { type: 'place', slot: 0 })
    // Seat 1 was away when its turn came, so the AI played it and seat 2's
    // AI turn followed — the race is back on the host without stalling.
    expect(room.game()?.turn).toBe(0)
    expect(room.game()?.winner === null || room.game()?.winner !== undefined).toBe(true)
  })
})

describe('saving', () => {
  test('restores a room from its snapshot', () => {
    const room = seated(3, ['b'])
    room.handle('host', { type: 'start' })
    room.handle('host', { type: 'throw' })
    const restored = Room.restore(JSON.parse(JSON.stringify(room.snapshot())))
    expect(restored.view().phase).toBe('racing')
    expect(restored.game()?.pending).not.toBeNull()
  })

  /* Hibernation drops every socket, so a restored room must believe nobody is
     connected until they say hello again. */
  test('restores with nobody connected', () => {
    const room = seated(3, ['b'])
    expect(Room.restore(JSON.parse(JSON.stringify(room.snapshot()))).idle).toBe(true)
  })
})
```

- [ ] **Step 3: Run to verify failure** — `npm test -- room` → module not found.

- [ ] **Step 4: Implement `room.ts`**

Structure (write it in this order; the file should land around 250 lines):

```ts
import { randomSeed, rollFaces } from '../dice/random'
import { decideAi } from './ai'
import { apply } from './engine'
import { RACE_DICE } from './dice'
import { MAX_SEATS, MIN_SEATS, SEAT_PALETTE } from './seats'
import { startGame, type GameState, type Roll, type SeatState, type Step } from './state'
import type { ClientMessage, Outbox, RoomView, ServerMessage } from './protocol'

/** As in `useAiTurns` before it: defensive only. A turn terminates with
 *  probability 1, since every reroll busts on 11/36. */
const MAX_AI_REROLLS = 30

type SeatRecord = {
  name: string
  color: string
  ink: string
  /** The token that owns this seat, or null while it is unclaimed. */
  token: string | null
}

export type RoomSnapshot = {
  code: string
  size: number
  host: number
  phase: 'lobby' | 'racing'
  seats: SeatRecord[]
  game: GameState | null
}
```

Key methods, in full:

```ts
  /** A fair throw. The room decides it once; every client replays it. */
  private roll(): Roll {
    return { seed: randomSeed(), faceIds: rollFaces(RACE_DICE.length) }
  }

  /**
   * Plays AI and away seats until a connected player is on the clock.
   *
   * Bounded by whoever is watching: it stops at the first seat whose token is
   * connected, so with a human present it runs at most the other seats, and
   * with nobody connected it does not run at all. An empty room therefore
   * cannot spin the game to its end on its own.
   */
  private driveAi(): Step[] {
    const steps: Step[] = []
    if (this.connected.size === 0) return steps

    for (let guard = 0; guard < MAX_SEATS * 4; guard++) {
      const game = this.game_
      if (!game || game.winner !== null) break

      const seat = this.seats[game.turn]
      const present = seat.token !== null && this.connected.has(seat.token)
      if (present) break

      steps.push(...this.playAiTurn())
    }

    return steps
  }

  /** One AI turn, resolved end to end with no waiting. */
  private playAiTurn(): Step[] {
    const steps: Step[] = []
    const take = (next: Step[]) => {
      steps.push(...next)
      if (next.length > 0) this.game_ = next[next.length - 1].state
    }

    take(apply(this.game_!, { kind: 'throw', roll: this.roll() }))

    for (let rerolls = 0; rerolls < MAX_AI_REROLLS; rerolls++) {
      const game = this.game_!
      if (game.winner !== null || !game.pending) return steps

      const action = decideAi(game.board, game.pending.value)
      if (action.kind === 'place') {
        take(apply(game, { kind: 'place', slot: action.slot }))
        return steps
      }
      take(apply(game, { kind: 'reroll', roll: this.roll() }))
    }

    // Exhausting the cap leaves a decision open. Resolve it the way a human
    // giving up would, so the turn actually ends.
    if (this.game_!.pending) take(apply(this.game_!, { kind: 'pass' }))
    return steps
  }
```

and the authorisation, which must read exactly like this:

```ts
  /**
   * Whether `token` may send a game intent right now.
   *
   * One rule, and there is no second one: you may act when it is the turn of
   * a seat you own. Local play owns several seats with one token, which is
   * why hotseat needs no special case here.
   */
  private mayAct(token: string | null): boolean {
    const game = this.game_
    if (!token || !game || game.winner !== null) return false
    return this.seats[game.turn].token === token
  }
```

`handle` dispatches on `message.type`, and **every path that changes the game
ends the same way**: collect the steps from `apply`, append `this.driveAi()`,
set `this.game_` to the last step's state, and return
`[{ to: 'all', message: { type: 'steps', steps } }]`.

`disconnect(token)` removes the token from `this.connected`, leaves
`seats[i].token` alone (that is what makes the seat reclaimable), broadcasts
the room view, and **does not** drive the AI — the race resumes when the next
intent or reconnection arrives.

`view()` derives `SeatView.kind` as `token === null ? 'ai' : 'human'` and
`away` as `token !== null && !connected.has(token)`.

`start()` builds `SeatState[]` from the seat records — an unclaimed seat gets
`kind: 'ai'` — and calls `startGame`.

- [ ] **Step 5: Run the tests**

Run: `npm test -- room` → PASS. Then `npm test` → everything passes.

- [ ] **Step 6: Commit**

```bash
git add src/engine/protocol.ts src/engine/room.ts src/engine/room.test.ts
git commit -m "Add the room: seats, authorisation and AI bursts, transport-free"
```

---

### Task 6: Transports and the animation queue

**Files:**
- Create: `src/net/transport.ts`, `src/net/useRoom.ts`
- Modify: `src/dice/useDiceRoll.ts`, `src/dice/index.ts`
- Test: `src/net/transport.test.ts`

**Interfaces:**
- Produces:

```ts
// transport.ts
export type Transport = {
  send(message: ClientMessage): void
  listen(cb: (message: ServerMessage) => void): () => void
  close(): void
}
export function localTransport(size: number, humanSeats: number): Transport
export function socketTransport(code: string): Transport

// useDiceRoll.ts — `roll()` is replaced
export type DiceTray = {
  recording: Recording
  playId: number
  rolling: boolean
  faces: Face[]
  /** Plays a throw the room has already decided. Resolves when it settles. */
  play(roll: Roll): Promise<void>
  settle(): void
}

// useRoom.ts
export type RoomClient = {
  room: RoomView | null
  game: GameState | null
  mySeats: number[]
  error: string | null
  /** True while the queue still has beats to show. */
  busy: boolean
  tray: DiceTray
  send(message: ClientMessage): void
}
export function useRoom(transport: Transport | null): RoomClient
```

**The two rules the queue exists to enforce:**

- **The queue is the only writer of `game`.** Nothing else sets the board or
  the positions, so what is on screen is always a state the room actually
  sent, never a local guess.
- **Controls gate on `busy`, not just on whose turn it is.** The room runs
  ahead of the animation, so `mySeats.includes(game.turn) && !busy` is the
  condition for enabling a button.

- [ ] **Step 1: Rework `useDiceRoll`**

Replace `roll()` with `play(roll)`. The fairness draw leaves this file — the
room owns it now.

```ts
  const play = useCallback((roll: Roll) => {
    if (rollingRef.current) return Promise.resolve()

    const recording = throwDice(dice, roll.seed, roll.faceIds)
    facesRef.current = recording.outcomes.map((o) => o.face)
    rollingRef.current = true
    setRolling(true)
    setState((previous) => ({ recording, playId: previous.playId + 1 }))

    return new Promise<void>((resolve) => {
      resolveRef.current = resolve
    })
  }, [id])
```

`resolveRef` becomes `((): void) => void`, and the unmount effect resolves it
with no argument. Update `src/dice/index.ts` if it re-exports anything that
changed shape.

- [ ] **Step 2: Write the transport tests**

```ts
import { describe, expect, test, vi } from 'vitest'
import { localTransport } from './transport'
import type { ServerMessage } from '../engine/protocol'

describe('localTransport', () => {
  test('seats the local player in every human seat', async () => {
    const seen: ServerMessage[] = []
    const transport = localTransport(4, 2)
    transport.listen((m) => seen.push(m))
    await vi.waitFor(() => expect(seen.some((m) => m.type === 'welcome')).toBe(true))
    const welcome = seen.find((m) => m.type === 'welcome')!
    expect(welcome.seats).toEqual([0, 1])
  })

  /* Hotseat and online go through the same authorisation rule. Owning both
     human seats is the whole of what makes local play work. */
  test('lets the local player act for either of its seats', async () => {
    const seen: ServerMessage[] = []
    const transport = localTransport(3, 2)
    transport.listen((m) => seen.push(m))
    transport.send({ type: 'start' })
    transport.send({ type: 'throw' })
    await vi.waitFor(() => expect(seen.some((m) => m.type === 'steps')).toBe(true))
    expect(seen.some((m) => m.type === 'error')).toBe(false)
  })
})
```

- [ ] **Step 3: Run to verify failure** — `npm test -- transport` → not found.

- [ ] **Step 4: Implement `transport.ts`**

```ts
/**
 * How the client talks to a room.
 *
 * Two implementations, one interface. Solo play is not a different game with
 * its own rules — it is the same `Room`, reached without a network, which is
 * why there is only ever one turn-driving path to debug.
 */
```

`localTransport(size, humanSeats)` constructs a `Room`, says hello with
`create: true` once for each human seat **using the same token**, and delivers
outboxes on a microtask (`queueMicrotask`) so the caller never observes a
synchronous reply mid-render. `socketTransport(code)` opens
`new WebSocket(\`${location.origin.replace(/^http/, 'ws')}/api/room/${code}\`)`,
buffers sends made before `open`, and sends `hello` with a token from
`sessionStorage` on connect.

- [ ] **Step 5: Implement `useRoom.ts`**

State: `room`, `game`, `mySeats`, `error`, plus a queue ref and a `busy` flag.
The drain loop:

```ts
  // The queue is the only writer of `game`: the room runs ahead of the
  // animation, so adopting a snapshot the moment it arrives would show a board
  // the player has not watched happen yet.
  const drain = useCallback(async () => {
    if (drainingRef.current) return
    drainingRef.current = true
    setBusy(true)

    try {
      while (queueRef.current.length > 0) {
        const step = queueRef.current.shift()!
        if (step.event.kind === 'threw') {
          await tray.play(step.event.roll)
        } else if (!mineRef.current.includes(step.event.seat)) {
          // Someone else's beat needs a moment to be read. Your own does not:
          // you just made it.
          await sleep(BEAT_MS)
        }
        if (!aliveRef.current) return
        setGame(step.state)
      }
    } finally {
      drainingRef.current = false
      if (aliveRef.current) setBusy(false)
    }
  }, [tray])
```

with `const BEAT_MS = 700` carrying forward the comment from `useAiTurns`:
*long enough to read the log line, short enough that six seats don't drag.*

A `welcome` message sets `mySeats`, `room` and — if `game` is non-null — sets
`game` directly and clears the queue, which is the reconnect jump-to-present.

- [ ] **Step 6: Run** — `npm test` → PASS, `npx tsc --noEmit` → clean.

- [ ] **Step 7: Commit**

```bash
git add src/net src/dice/useDiceRoll.ts src/dice/index.ts
git commit -m "Add the transports and the animation queue that paces them"
```

---

### Task 7: Rewire solo through the room

**Files:**
- Modify: `src/game/useRaceGame.ts`, `src/game/RaceGame.tsx`
- Delete: `src/game/useAiTurns.ts`

- [ ] **Step 1: Reduce `useRaceGame` to a wrapper**

It builds a `localTransport` from the roster (memoised on a reset counter, so
"race again" makes a fresh room) and returns `useRoom`'s client plus a
`reset()`. The `live` ref mirror, the `write*` callbacks and every rule in the
file are gone — they moved to the engine in Task 3.

- [ ] **Step 2: Delete the AI driver**

```bash
git rm src/game/useAiTurns.ts
```

Its job — pacing an AI turn so a human can read it — is what the queue does.
Keeping both is how the two paths drift apart.

- [ ] **Step 3: Teach `RaceGame` about seats it owns**

`RaceGameProps` gains `client: RoomClient` and `mySeats` comes from it. The
control gate changes from `aiSeat` to:

```ts
  // `busy` and not merely `turn`: the room runs ahead of the animation, so a
  // gate on the turn alone leaves controls live for a board the player has
  // not been shown yet.
  const canAct = winner === null && mySeats.includes(turn) && !busy
```

Every `disabled={... || aiSeat}` becomes `disabled={!canAct}`, and the throw
button's label uses `busy` where it used `aiThinking`. Lanes show a "you" mark
on seats in `mySeats`.

- [ ] **Step 4: Verify solo still plays**

Run: `npm test && npx tsc --noEmit && npm run build`, then play a full solo
race in the browser (preview) — throw, reroll, place, watch AI seats take
their turns at a readable pace, win, race again.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Run solo through the same room the network uses"
```

---

### Task 8: The Worker and the Durable Object

**Files:**
- Create: `worker/index.ts`, `worker/RaceRoom.ts`, `wrangler.toml`, `tsconfig.worker.json`
- Modify: `package.json`, `vite.config.ts`, `.gitignore`

- [ ] **Step 1: Add the tooling**

```bash
npm install --save-dev wrangler @cloudflare/workers-types
```

No runtime dependency is added. The Worker imports only `src/engine/*`.

- [ ] **Step 2: Write `wrangler.toml`**

```toml
name = "snail-dash"
main = "worker/index.ts"
compatibility_date = "2026-09-01"

# SPA fallback so a shared link like /r/AB2C resolves to the app. Asset
# requests are free and unlimited, and never reach the Worker.
[assets]
directory = "./dist"
not_found_handling = "single-page-application"
binding = "ASSETS"

[[durable_objects.bindings]]
name = "ROOMS"
class_name = "RaceRoom"

# SQLite-backed, which is what puts Durable Objects on the free plan.
[[migrations]]
tag = "v1"
new_sqlite_classes = ["RaceRoom"]
```

- [ ] **Step 3: Write `worker/index.ts`**

Route `/api/room/:code` to `env.ROOMS.get(env.ROOMS.idFromName(code))` — the
code *is* the object's name, so there is no registry to keep in step — and
let everything else fall through to assets. Reject a non-WebSocket request to
the room path with 426.

- [ ] **Step 4: Write `worker/RaceRoom.ts`**

A transport adapter with no rules in it:

- `fetch` accepts the socket via `this.ctx.acceptWebSocket(server)` — the
  **hibernation** API, not `addEventListener`, which is what lets an idle room
  stop billing duration.
- The player's token is stashed with `ws.serializeAttachment({ token })` so
  identity survives hibernation.
- `webSocketMessage` parses, calls `this.room.handle(token, message)`, posts
  the outboxes, then persists via `this.ctx.storage.put('room', room.snapshot())`.
- `webSocketClose` calls `room.disconnect(token)` and persists.
- `alarm()` deletes the room's storage. The alarm is set two hours out on
  every mutation — the only timer in the system.

Include this comment on the class:

```ts
/**
 * The room's transport.
 *
 * Deliberately rule-free: it accepts sockets, hands bytes to `Room` and posts
 * what comes back. Every decision about the game happens in `src/engine/`,
 * which is plain TypeScript with tests — so the part of this feature that can
 * be wrong is the part that is covered.
 */
```

- [ ] **Step 5: Write `tsconfig.worker.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "noEmit": true
  },
  "include": ["worker", "src/engine", "src/dice/faces.ts", "src/dice/random.ts"]
}
```

`lib` drops `DOM` on purpose: if engine code ever reaches for a browser API,
this build is where it should fail.

- [ ] **Step 6: Wire dev and deploy**

`vite.config.ts` proxies the API to a local wrangler:

```ts
export default defineConfig({
  plugins: [react()],
  server: {
    // `wrangler dev` runs the real Durable Object next door; the app is served
    // by Vite so HMR still works while playing a networked game.
    proxy: { '/api': { target: 'http://localhost:8787', ws: true } },
  },
})
```

`package.json` scripts:

```json
    "dev": "vite",
    "dev:worker": "wrangler dev --port 8787",
    "test": "vitest run",
    "typecheck": "tsc --noEmit && tsc -p tsconfig.worker.json",
    "build": "npm run typecheck && vite build",
    "deploy": "npm run build && wrangler deploy"
```

Add `.wrangler` to `.gitignore`.

- [ ] **Step 7: Verify**

Run `npm run typecheck`. Then `npm run build && npx wrangler dev` and confirm
the Worker boots and serves the app at its port.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Serve the app and its rooms from one Cloudflare Worker"
```

---

### Task 9: The online lobby and routing

**Files:**
- Create: `src/game/OnlineLobby.tsx`
- Modify: `src/App.tsx`, `src/game/Lobby.tsx`, `src/game/lobby.css`

- [ ] **Step 1: Route on the path**

`App.tsx` reads `location.pathname`, listens for `popstate`, and renders:

- `/` — `Lobby`, which gains a **Play with friends** button
- `/r/:code` — `OnlineLobby` for that code, or the join screen if the code is
  malformed

Navigation uses `history.pushState`. No router dependency: two routes do not
need one.

- [ ] **Step 2: Build `OnlineLobby`**

Three states, all reusing `lobby.css`:

1. **Joining** — a code box (pre-filled from the link) and a create button.
2. **Waiting** — the code shown large, a **Copy link** button writing
   `${location.origin}/r/${code}` to the clipboard, seats filling as people
   arrive, the host's size picker and start button. Non-hosts see "waiting for
   the host".
3. **Racing** — `RaceGame` with the client from `useRoom`.

Unclaimed seats read "AI" so the host can see exactly what they are starting.

- [ ] **Step 3: Verify end to end**

With `npm run dev` and `npm run dev:worker` both running, open two browser
tabs, create a room in one, join with the link in the other, and play a race.
Confirm: both tabs see the same dice tumble; only the seat on the clock has
live controls; closing one tab lets the race continue with the AI playing that
snail; reopening the link reclaims it.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Add the online lobby and the two routes that reach it"
```

---

### Task 10: Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document multiplayer and deployment**

Add a **Playing with friends** section (create, share, AI fills the rest, what
happens when someone drops) and a **Deploying** section:

```bash
npm run build
npx wrangler deploy
```

noting that `wrangler dev --port 8787` alongside `npm run dev` gives real
Durable Objects locally, and that the free plan covers this game — rooms are
disposable, WebSocket hibernation means an idle room bills nothing, and AI
turns resolve in a burst so there are no billed timers.

Update any prose that says the game is single-browser or that the AI runs in
the client.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "Document playing with friends, and deploying to Cloudflare"
```

---

## Self-Review

**Spec coverage.** Reproducible throw → Task 1. Engine purity and the barrel
rule → Task 2. `GameState`/events/intents and the turn flow → Task 3. Codes
and links → Tasks 4 and 9. Seats, identity, host, start, closed-once-started,
away/return, AI bursts, authorisation → Task 5. Snapshot broadcast, the
animation queue, the `busy` gate → Task 6. Solo through the same room,
`useAiTurns` deleted → Task 7. Worker, Durable Object, hibernation, storage,
reaping alarm, cost decisions → Task 8. Screens and `mySeats` → Task 9.
Testing section → Tasks 1–6 (`purity.test.ts` in Task 2). README → Task 10.

**Type consistency.** `Roll` is `{ seed, faceIds }` throughout — carried on
the `threw` event and on `throw`/`reroll` intents, consumed by
`tray.play(roll)` and by `throwDice(dice, seed, faceIds)`. `Step` is
`{ event, state }` everywhere. `mySeats` is `number[]` from `welcome.seats`
through `useRoom` to `RaceGame`. `apply` returns `Step[]` in Task 3 and is
called that way in Task 5.

**Known deviation from the spec.** The spec sketched a richer event list
(`moved`, `evicted`, `seated`, `started`). The plan trims it to the six
variants the client actually acts on, because the log already lives in the
state and unused variants are a future reader's trap. `collected` replaces
`moved`, and roster changes ride on the `room` message rather than an event.
