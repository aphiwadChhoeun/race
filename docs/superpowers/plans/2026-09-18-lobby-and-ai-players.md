# Lobby and AI Players Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lobby that seats 3–6 players, each human or AI, and make AI seats play themselves.

**Architecture:** Game state and actions move out of `RaceGame.tsx` into a `useRaceGame` hook whose actions return what happened, so an AI turn can be one async function that awaits each step instead of an effect reacting to state. The AI's *decision* is a pure function in `src/game/ai.ts` with no React in it. Rules are untouched.

**Tech Stack:** TypeScript, React 19, three.js, cannon-es, Vitest, Vite.

**Spec:** [docs/superpowers/specs/2026-09-18-lobby-and-ai-players-design.md](../specs/2026-09-18-lobby-and-ai-players-design.md)

## Global Constraints

- Seat count is 3–6. `MIN_SEATS = 3`, `MAX_SEATS = 6`. The two-player game is replaced.
- Seat palette, in order: Red `#e2574c`, Blue `#4c7fe2`, Green `#4caf6d`, Amber `#d99b3f`, Violet `#9b6bd6`, Teal `#3fb4b4`. Seats 1–2 keep the colours the two-player game used.
- `MAX_REROLL_VALUE = 76` — the best value a reroll can produce, because any cross after the first throw busts, so `XX` (77) is unreachable on a reroll.
- AI decision order: (1) no legal slot → reroll; (2) no reachable target on the board → place highest legal slot; (3) this value evicts something → place highest legal slot that evicts; (4) otherwise reroll.
- `decideAi(board, value)` takes **no** roll-number parameter. The strategy's "on the first roll" is descriptive, not conditional.
- AI pause between actions: 700ms. Defensive reroll cap: 30 per turn, treated as a bust.
- While an AI seat plays, human controls are disabled and bidding slots are not clickable.
- No rule changes. `src/game/bidding.ts` and all of `src/dice/` keep their current behaviour.
- `npm test`, `npm run typecheck` and `npm run build` must all be clean before every commit.

---

### Task 1: Seats

The roster vocabulary the lobby builds and the game consumes.

**Files:**
- Create: `src/game/seats.ts`
- Create: `src/game/seats.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type SeatKind = 'human' | 'ai'`; `type Seat = { name: string; color: string; kind: SeatKind }`; `MIN_SEATS = 3`; `MAX_SEATS = 6`; `SEAT_PALETTE: readonly { name: string; color: string }[]`; `defaultRoster(count: number): Seat[]`.

- [ ] **Step 1: Write the failing tests**

Create `src/game/seats.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { MAX_SEATS, MIN_SEATS, SEAT_PALETTE, defaultRoster } from './seats'

describe('SEAT_PALETTE', () => {
  test('holds one identity per seat the game can seat', () => {
    expect(SEAT_PALETTE).toHaveLength(MAX_SEATS)
  })

  test('keeps the colours the two-player game used for the first two seats', () => {
    expect(SEAT_PALETTE[0]).toEqual({ name: 'Red', color: '#e2574c' })
    expect(SEAT_PALETTE[1]).toEqual({ name: 'Blue', color: '#4c7fe2' })
  })

  test('gives every seat a distinct name and colour', () => {
    expect(new Set(SEAT_PALETTE.map((s) => s.name)).size).toBe(MAX_SEATS)
    expect(new Set(SEAT_PALETTE.map((s) => s.color)).size).toBe(MAX_SEATS)
  })
})

describe('defaultRoster', () => {
  test('takes identities from the palette in order', () => {
    expect(defaultRoster(3).map((s) => s.name)).toEqual(['Red', 'Blue', 'Green'])
  })

  test('seats one human and fills the rest with AI', () => {
    expect(defaultRoster(4).map((s) => s.kind)).toEqual(['human', 'ai', 'ai', 'ai'])
  })

  test('seats the largest table the game allows', () => {
    expect(defaultRoster(MIN_SEATS)).toHaveLength(3)
    expect(defaultRoster(MAX_SEATS)).toHaveLength(6)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './seats'`.

- [ ] **Step 3: Write the implementation**

Create `src/game/seats.ts`:

```ts
/**
 * Who sits at the table.
 *
 * A seat is chosen in the lobby and never changes during a game. The game
 * itself only cares about `kind`, to decide whether a turn waits for a click
 * or plays itself.
 */

export type SeatKind = 'human' | 'ai'

export type Seat = {
  name: string
  color: string
  kind: SeatKind
}

export const MIN_SEATS = 3
export const MAX_SEATS = 6

/**
 * Seat identities, in turn order. The first two keep the colours the
 * two-player game used, so a returning player recognises them.
 */
export const SEAT_PALETTE: readonly { name: string; color: string }[] = [
  { name: 'Red', color: '#e2574c' },
  { name: 'Blue', color: '#4c7fe2' },
  { name: 'Green', color: '#4caf6d' },
  { name: 'Amber', color: '#d99b3f' },
  { name: 'Violet', color: '#9b6bd6' },
  { name: 'Teal', color: '#3fb4b4' },
]

/** A table of `count` seats: you, and AI for the rest. */
export function defaultRoster(count: number): Seat[] {
  return SEAT_PALETTE.slice(0, count).map((seat, index) => ({
    ...seat,
    kind: index === 0 ? 'human' : 'ai',
  }))
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS — 50 tests (44 existing + 6 new), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/game/seats.ts src/game/seats.test.ts
git commit -m "Add the seat roster the lobby builds"
```

---

### Task 2: The AI's decision

The heart of the feature, and the only part with interesting logic. Pure, no React.

**Files:**
- Create: `src/game/ai.ts`
- Create: `src/game/ai.test.ts`

**Interfaces:**
- Consumes: `legalSlots`, `placeBid`, `type Board` from `./bidding`; `DOUBLE_X` in tests.
- Produces: `MAX_REROLL_VALUE = 76`; `type AiAction = { kind: 'place'; slot: number } | { kind: 'reroll' }`; `decideAi(board: Board, value: number): AiAction`.

- [ ] **Step 1: Write the failing tests**

Create `src/game/ai.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { DOUBLE_X, emptyBoard, type Board } from './bidding'
import { decideAi } from './ai'

/** Builds a board from `{ slot: value }`, each bid owned by a distinct player. */
function board(bids: Record<number, number>): Board {
  const next = emptyBoard()
  let player = 0
  for (const [slot, value] of Object.entries(bids)) {
    next[Number(slot)] = { value, player: player++ }
  }
  return next
}

describe('decideAi', () => {
  test('takes the highest slot that still knocks someone off', () => {
    // 63 is legal on 0-4 and on 6; only 0-4 evict the 42 sitting on slot 5.
    expect(decideAi(board({ 5: 42 }), 63)).toEqual({ kind: 'place', slot: 4 })
  })

  test('prefers a slot that evicts over a higher one that does not', () => {
    // Slot 6 is legal but has nothing above it to knock off; slot 2 evicts.
    expect(decideAi(board({ 3: 20 }), 55)).toEqual({ kind: 'place', slot: 2 })
  })

  test('rerolls when a target exists but this value cannot reach it', () => {
    expect(decideAi(board({ 2: 65 }), 33)).toEqual({ kind: 'reroll' })
  })

  test('settles on the highest slot when the only bid sits on slot 0', () => {
    // Nothing is below slot 0, so that bid can never be evicted — there is
    // nothing to chase, and rerolling would only risk a bust.
    expect(decideAi(board({ 0: 21 }), 53)).toEqual({ kind: 'place', slot: 6 })
  })

  test('settles rather than chasing a 76, which no reroll can beat', () => {
    // Beating 76 needs 77, and 77 is XX, which a reroll can never produce.
    expect(decideAi(board({ 1: 76 }), 53)).toEqual({ kind: 'place', slot: 0 })
  })

  test('settles on the highest slot when the track is empty', () => {
    expect(decideAi(emptyBoard(), 31)).toEqual({ kind: 'place', slot: 6 })
  })

  test('rerolls when no slot is legal at all', () => {
    expect(decideAi(board({ 0: 66 }), 21)).toEqual({ kind: 'reroll' })
  })

  test('places a double cross on the highest evicting slot, with no special case', () => {
    expect(decideAi(board({ 5: 42 }), DOUBLE_X)).toEqual({ kind: 'place', slot: 4 })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test src/game/ai.test.ts`
Expected: FAIL — `Cannot find module './ai'`.

- [ ] **Step 3: Write the implementation**

Create `src/game/ai.ts`:

```ts
import { legalSlots, placeBid, type Board } from './bidding'

/**
 * The best value a reroll can produce.
 *
 * `XX` (77) beats everything, but only an opening throw can make one — after
 * that a cross busts. So 7 with 6 is the real ceiling, and a standing 76 is
 * unbeatable in practice even though a 77 would beat it on paper.
 */
export const MAX_REROLL_VALUE = 76

export type AiAction = { kind: 'place'; slot: number } | { kind: 'reroll' }

/**
 * Whether the board holds anything worth chasing.
 *
 * A bid is a target only if some achievable roll could actually take it: there
 * must be an empty slot below it where a `MAX_REROLL_VALUE` would be both
 * legal and a strict improvement. Two cases fail that and would otherwise trap
 * the AI into rerolling to a bust every turn for as long as the bid stands — a
 * bid on slot 0, which has nothing beneath it, and a bid of 76, which nothing
 * reachable beats.
 */
function hasReachableTarget(board: Board): boolean {
  const reach = legalSlots(board, MAX_REROLL_VALUE)

  return board.some((bid, slot) => {
    if (!bid || bid.value >= MAX_REROLL_VALUE) return false
    return reach.some((open) => open < slot)
  })
}

/**
 * What the AI does with the value it just rolled.
 *
 * Deliberately ignorant of how many times it has thrown this turn: the
 * strategy is the same on every throw, and a throw count would only invite
 * someone to branch on it.
 */
export function decideAi(board: Board, value: number): AiAction {
  const legal = legalSlots(board, value)
  if (legal.length === 0) return { kind: 'reroll' }

  // `legalSlots` returns ascending, so the last entry is always the highest.
  const highest = (slots: number[]) => slots[slots.length - 1]

  if (!hasReachableTarget(board)) return { kind: 'place', slot: highest(legal) }

  // Ask the real rule which placements evict, rather than reimplementing it.
  // The owner id is irrelevant to eviction, so any value will do.
  const evicting = legal.filter((slot) => placeBid(board, slot, value, -1).evicted.length > 0)
  if (evicting.length === 0) return { kind: 'reroll' }

  return { kind: 'place', slot: highest(evicting) }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test && npm run typecheck`
Expected: PASS — 58 tests, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/game/ai.ts src/game/ai.test.ts
git commit -m "Add the AI's bidding decision"
```

---

### Task 3: Extract the game into a hook, over N seats

A refactor with no behaviour change for human play, plus the switch from a hardcoded pair of players to a roster. Nothing here is AI-aware; Task 4 adds that.

**The reason this task exists:** an AI turn awaits several dice animations in sequence. The callbacks it invokes were built in an earlier render, so their closed-over `players` and `board` are stale by the time the second or third step runs. `RaceGame` already works around this by hand-threading `currentBoard` and `currentPosition` into `throwDiceFor`. The hook generalises that into a ref mirror written synchronously by every action, so the actions can be called in sequence from an async script and still see the truth.

**Files:**
- Create: `src/game/useRaceGame.ts`
- Modify: `src/game/RaceGame.tsx` (becomes rendering only, takes a `roster` prop)
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `Seat` from `./seats`; everything `RaceGame.tsx` already imports from `./bidding`, `./dice`, `../dice`.
- Produces: `TRACK_LENGTH = 30`; `type Player = Seat & { position: number }`; `type Pending = { value: number; faces: Face[]; legal: number[]; throws: number }`; `type TurnOutcome = { kind: 'won' } | { kind: 'bust' } | { kind: 'decide'; value: number; board: Board; legal: number[] }`; `useRaceGame(roster: Seat[])` returning `{ players, board, turn, pending, winner, log, recording, playId, rolling, settle, startTurn, reroll, place, pass, reset }` where `startTurn: () => Promise<TurnOutcome>`, `reroll: () => Promise<TurnOutcome>`, `place: (slot: number) => void`, `pass: () => void`, `reset: () => void`.

- [ ] **Step 1: Create the hook**

Create `src/game/useRaceGame.ts`:

```ts
import { useCallback, useRef, useState } from 'react'
import { useDiceRoll, type Face } from '../dice'
import {
  bidLabel,
  collectBid,
  doubleBonus,
  emptyBoard,
  legalSlots,
  placeBid,
  resolveRoll,
  type Board,
} from './bidding'
import { RACE_DICE } from './dice'
import type { Seat } from './seats'

export const TRACK_LENGTH = 30

export type Player = Seat & { position: number }

/** The dice have landed and the thrower owes the board a decision. */
export type Pending = {
  value: number
  faces: Face[]
  legal: number[]
  /** Throws made this turn. The first is safe; a cross on any later one busts. */
  throws: number
}

/** What a throw did, for a caller driving a turn without reading state. */
export type TurnOutcome =
  | { kind: 'won' }
  | { kind: 'bust' }
  | { kind: 'decide'; value: number; board: Board; legal: number[] }

function seatPlayers(roster: Seat[]): Player[] {
  return roster.map((seat) => ({ ...seat, position: 0 }))
}

/**
 * The whole game: state for rendering, and actions that also report what they
 * did.
 *
 * Actions return a `TurnOutcome` because an AI turn is an async script that
 * awaits a dice animation between steps. By the time step two runs, the
 * callback it calls was created in an earlier render and its closed-over state
 * is stale — so actions read from `live`, a mirror written synchronously
 * before each `setState`, and hand back what happened rather than expecting
 * the caller to go looking in state for it.
 */
export function useRaceGame(roster: Seat[]) {
  const [players, setPlayers] = useState<Player[]>(() => seatPlayers(roster))
  const [board, setBoard] = useState<Board>(emptyBoard)
  const [turn, setTurn] = useState(0)
  const [pending, setPending] = useState<Pending | null>(null)
  const [winner, setWinner] = useState<number | null>(null)
  const [log, setLog] = useState<string[]>([`${roster[0].name} to throw.`])

  const { recording, playId, rolling, roll, settle } = useDiceRoll(RACE_DICE)

  const live = useRef({
    players: seatPlayers(roster),
    board: emptyBoard(),
    turn: 0,
    winner: null as number | null,
    pending: null as Pending | null,
  })

  const writePlayers = useCallback((next: Player[]) => {
    live.current.players = next
    setPlayers(next)
  }, [])

  const writeBoard = useCallback((next: Board) => {
    live.current.board = next
    setBoard(next)
  }, [])

  const writeTurn = useCallback((next: number) => {
    live.current.turn = next
    setTurn(next)
  }, [])

  const writeWinner = useCallback((next: number | null) => {
    live.current.winner = next
    setWinner(next)
  }, [])

  const writePending = useCallback((next: Pending | null) => {
    live.current.pending = next
    setPending(next)
  }, [])

  const say = useCallback((...lines: string[]) => {
    setLog((previous) => [...lines, ...previous].slice(0, 6))
  }, [])

  /** Moves `index` by `spaces`, returning true when that wins the game. */
  const advance = useCallback(
    (index: number, spaces: number) => {
      const position = Math.min(TRACK_LENGTH, live.current.players[index].position + spaces)
      writePlayers(
        live.current.players.map((player, i) => (i === index ? { ...player, position } : player)),
      )
      return { position, won: position >= TRACK_LENGTH }
    },
    [writePlayers],
  )

  const endTurn = useCallback(() => {
    writePending(null)
    writeTurn((live.current.turn + 1) % live.current.players.length)
  }, [writePending, writeTurn])

  const throwDice = useCallback(
    async (throws: number): Promise<TurnOutcome> => {
      const current = live.current.turn
      const mover = live.current.players[current].name
      const faces = await roll()
      const rolled = resolveRoll(faces, throws === 1)

      if (rolled.kind === 'bust') {
        say(`${mover} rerolled into a cross and busts — no bid.`)
        endTurn()
        return { kind: 'bust' }
      }

      // A matching pair of numbers pays its value in spaces before any bidding,
      // and the bid goes ahead as well. Those spaces are banked: busting on a
      // later throw never takes them back.
      const bonus = doubleBonus(faces)
      if (bonus > 0) {
        const moved = advance(current, bonus)
        if (moved.won) {
          writeWinner(current)
          // A reroll leaves a decision standing; a won game must not keep
          // offering slots to place on.
          writePending(null)
          say(`${mover} threw double ${bonus} and reaches ${TRACK_LENGTH} — ${mover} wins!`)
          return { kind: 'won' }
        }
        say(`${mover} threw double ${bonus} and moves to ${moved.position}.`)
      }

      const currentBoard = live.current.board
      const legal = legalSlots(currentBoard, rolled.value)
      writePending({ value: rolled.value, faces, legal, throws })
      return { kind: 'decide', value: rolled.value, board: currentBoard, legal }
    },
    [advance, endTurn, roll, say, writePending, writeWinner],
  )

  const startTurn = useCallback(async (): Promise<TurnOutcome> => {
    if (live.current.winner !== null || live.current.pending !== null) return { kind: 'bust' }

    const current = live.current.turn
    const mover = live.current.players[current].name

    // A bid that survived until its owner's turn pays out: the slot it sits on
    // is how far they move, and it leaves the track either way.
    const collected = collectBid(live.current.board, current)
    writeBoard(collected.board)

    if (collected.slot !== null) {
      const moved = advance(current, collected.slot)
      if (moved.won) {
        writeWinner(current)
        say(`${mover} won slot ${collected.slot} and reaches ${TRACK_LENGTH} — ${mover} wins!`)
        return { kind: 'won' }
      }
      say(`${mover} won slot ${collected.slot} and moves to ${moved.position}.`)
    } else {
      say(`${mover} had no bid standing.`)
    }

    return throwDice(1)
  }, [advance, say, throwDice, writeBoard, writeWinner])

  const reroll = useCallback(async (): Promise<TurnOutcome> => {
    const current = live.current.pending
    if (!current || live.current.winner !== null) return { kind: 'bust' }
    return throwDice(current.throws + 1)
  }, [throwDice])

  const place = useCallback(
    (slot: number) => {
      const current = live.current.pending
      if (!current || live.current.winner !== null || !current.legal.includes(slot)) return

      const index = live.current.turn
      const mover = live.current.players[index].name
      const { board: next, evicted } = placeBid(live.current.board, slot, current.value, index)

      writeBoard(next)
      say(
        ...evicted.map(
          (bid) =>
            `${live.current.players[bid.player].name}'s ${bidLabel(bid.value)} on ${bid.slot} is knocked off.`,
        ),
        `${mover} bids ${bidLabel(current.value)} on slot ${slot}.`,
      )
      endTurn()
    },
    [endTurn, say, writeBoard],
  )

  const pass = useCallback(() => {
    if (!live.current.pending) return
    say(`${live.current.players[live.current.turn].name} gives up the throw — no bid.`)
    endTurn()
  }, [endTurn, say])

  const reset = useCallback(() => {
    live.current = {
      players: seatPlayers(roster),
      board: emptyBoard(),
      turn: 0,
      winner: null,
      pending: null,
    }
    setPlayers(live.current.players)
    setBoard(live.current.board)
    setTurn(0)
    setPending(null)
    setWinner(null)
    setLog([`${roster[0].name} to throw.`])
  }, [roster])

  return {
    players,
    board,
    turn,
    pending,
    winner,
    log,
    recording,
    playId,
    rolling,
    settle,
    startTurn,
    reroll,
    place,
    pass,
    reset,
  }
}
```

- [ ] **Step 2: Rewrite `RaceGame.tsx` as rendering only**

Replace the whole of `src/game/RaceGame.tsx` with:

```tsx
import { useMemo, useState } from 'react'
import { DiceTable } from '../dice'
import { SLOTS, bidLabel, faceLabel } from './bidding'
import { DIE_COLORS } from './dice'
import type { Seat } from './seats'
import { TRACK_LENGTH, useRaceGame } from './useRaceGame'
import './race.css'

export type RaceGameProps = {
  roster: Seat[]
  onExit: () => void
}

export function RaceGame({ roster, onExit }: RaceGameProps) {
  const game = useRaceGame(roster)
  const [muted, setMuted] = useState(false)

  const { players, board, turn, pending, winner, log } = game
  const active = players[turn]
  const slots = useMemo(() => Array.from({ length: SLOTS }, (_, slot) => slot), [])

  return (
    <div className="race">
      <header className="race__header">
        <h1>Race</h1>
        <div className="race__header-right">
          <label className="race__toggle">
            <input type="checkbox" checked={!muted} onChange={(e) => setMuted(!e.target.checked)} />
            Sound
          </label>
          <button className="race__exit" onClick={onExit}>
            Lobby
          </button>
        </div>
      </header>

      <div className="race__track" role="list" aria-label="Race track">
        {players.map((player, index) => (
          <div className="race__lane" key={player.name} role="listitem">
            <span className="race__lane-name" style={{ color: player.color }}>
              {player.name}
              {player.kind === 'ai' && <span className="race__lane-tag">AI</span>}
            </span>
            <div className="race__lane-tiles">
              <div
                className="race__lane-fill"
                style={{
                  width: `${(player.position / TRACK_LENGTH) * 100}%`,
                  background: player.color,
                }}
              />
              <div
                className="race__token"
                style={{
                  left: `${(player.position / TRACK_LENGTH) * 100}%`,
                  background: player.color,
                  outline: turn === index && winner === null ? '2px solid #fff' : 'none',
                }}
              />
            </div>
            <span className="race__lane-score">
              {player.position}/{TRACK_LENGTH}
            </span>
          </div>
        ))}
      </div>

      <div className="race__bids">
        <h2 className="race__bids-title">
          {pending
            ? `${active.name} threw ${pending.faces.map(faceLabel).join(' and ')} — place ${bidLabel(pending.value)}`
            : 'Bidding track'}
        </h2>
        <div className="race__bids-row">
          {slots.map((slot) => {
            const bid = board[slot]
            const selectable = pending?.legal.includes(slot) ?? false
            const owner = bid ? players[bid.player] : null

            return (
              <button
                key={slot}
                className="race__slot"
                onClick={() => game.place(slot)}
                disabled={!selectable}
                aria-label={
                  bid
                    ? `Slot ${slot}, ${players[bid.player].name} bidding ${bidLabel(bid.value)}`
                    : `Slot ${slot}, empty`
                }
                style={{
                  borderColor: owner ? owner.color : undefined,
                  background: owner ? `${owner.color}22` : undefined,
                }}
              >
                <span className="race__slot-steps">{slot}</span>
                <span className="race__slot-bid" style={{ color: owner?.color }}>
                  {bid ? bidLabel(bid.value) : selectable ? '+' : '—'}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="race__table">
        <DiceTable
          recording={game.recording}
          playId={game.playId}
          volume={muted ? 0 : 0.45}
          onSettle={game.settle}
          dieColors={DIE_COLORS}
        />
      </div>

      <div className="race__controls">
        {winner !== null ? (
          <>
            <button className="race__roll" onClick={game.reset}>
              {players[winner].name} wins — play again
            </button>
            <button className="race__roll race__roll--quiet" onClick={onExit}>
              Back to lobby
            </button>
          </>
        ) : pending ? (
          <>
            <button className="race__roll" onClick={game.reroll} disabled={game.rolling}>
              {game.rolling ? 'Rolling…' : 'Reroll (a cross busts)'}
            </button>
            {pending.legal.length === 0 && (
              <button
                className="race__roll race__roll--quiet"
                onClick={game.pass}
                disabled={game.rolling}
              >
                Give up the throw
              </button>
            )}
          </>
        ) : (
          <button className="race__roll" onClick={game.startTurn} disabled={game.rolling}>
            {game.rolling ? 'Rolling…' : `Throw for ${active.name}`}
          </button>
        )}
      </div>

      {/* Screen readers get the result announced once the dice have settled. */}
      <p className="race__status" role="status">
        {game.rolling ? 'Rolling the dice.' : log[0]}
      </p>

      <ul className="race__log">
        {log.slice(1).map((entry, index) => (
          <li key={index}>{entry}</li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 3: Point `App.tsx` at a fixed roster for now**

Task 5 replaces this with the lobby. For this task, keep the app runnable:

```tsx
import { RaceGame } from './game/RaceGame'
import { defaultRoster } from './game/seats'

const ROSTER = defaultRoster(3).map((seat) => ({ ...seat, kind: 'human' as const }))

export default function App() {
  return <RaceGame roster={ROSTER} onExit={() => {}} />
}
```

- [ ] **Step 4: Add the two new styles**

Append to `src/game/race.css`:

```css
.race__header-right {
  display: flex;
  align-items: center;
  gap: 14px;
}

.race__exit {
  padding: 5px 12px;
  border: 1px solid #4a453c;
  border-radius: 7px;
  background: none;
  color: #9d968a;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.race__exit:hover {
  border-color: #6f6857;
  color: #cfc8b9;
}

/* Marks an AI seat on the track, so you always know who is playing itself. */
.race__lane-tag {
  margin-left: 5px;
  padding: 1px 4px;
  border-radius: 4px;
  background: #2f2c27;
  color: #8e877b;
  font-size: 9px;
  letter-spacing: 0.08em;
  vertical-align: middle;
}
```

- [ ] **Step 5: Verify**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS — 58 tests unchanged (this task adds none), no type errors, build succeeds.

The refactor has no unit tests because it changes no logic: every rule it moves is already covered by the 58 tests in `bidding.test.ts`, `ai.test.ts`, `seats.test.ts` and the dice suites. Confirm by hand in the browser that a three-player human game still plays: throw, place, collect, reroll, bust, dead-end pass.

- [ ] **Step 6: Commit**

```bash
git add src/game/useRaceGame.ts src/game/RaceGame.tsx src/game/race.css src/App.tsx
git commit -m "Move the game into a hook and seat N players"
```

---

### Task 4: AI turns

**Files:**
- Create: `src/game/useAiTurns.ts`
- Modify: `src/game/RaceGame.tsx`

**Interfaces:**
- Consumes: `decideAi` from `./ai`; `type TurnOutcome`, `type Player` from `./useRaceGame`.
- Produces: `useAiTurns(game): boolean` — true while an AI seat is playing.

**Two traps in this hook — the obvious implementation is wrong twice:**

1. **Do not put `pending` in the effect's trigger.** The natural condition is
   "it's an AI's turn and nothing is pending", but `pending` becomes non-null
   the moment the AI throws — mid-script. An effect keyed on that tears down
   and cancels its own turn after the first throw, and the AI never places.
   Trigger on `turn`, the seat's kind, and `winner` only.
2. **`turn` must be in the deps, not just a derived boolean.** With two AI
   seats in a row, an `isAiTurn` boolean stays `true` across the handover, the
   deps never change, the effect never re-runs, and the second AI never plays.

- [ ] **Step 1: Write the driver**

Create `src/game/useAiTurns.ts`:

```ts
import { useEffect, useRef, useState } from 'react'
import { decideAi } from './ai'
import type { Player, TurnOutcome } from './useRaceGame'

/** Long enough to read the log line, short enough that six seats don't drag. */
const AI_PAUSE_MS = 700

/**
 * Defensive only. The AI rerolls until it can outbid, and every reroll busts
 * on 11/36, so a turn terminates with probability 1 — this just stops a
 * pathological board from spinning forever.
 */
const MAX_AI_REROLLS = 30

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type Driveable = {
  players: Player[]
  turn: number
  winner: number | null
  startTurn: () => Promise<TurnOutcome>
  reroll: () => Promise<TurnOutcome>
  place: (slot: number) => void
}

/**
 * Plays a turn for an AI seat when one comes round.
 *
 * A turn is a single async script rather than an effect reacting to each state
 * change: it is a sequence, and driving a sequence from re-entrant effects is
 * how races get in. The effect only *starts* the script, guarded by a ref so a
 * re-render cannot start a second one.
 *
 * What the effect watches matters. It deliberately does NOT watch `pending`:
 * that turns non-null the moment the AI throws, so an effect keyed on it would
 * tear down its own turn mid-script. And it watches `turn` itself rather than
 * a derived "is it an AI's turn" boolean, because that boolean stays `true`
 * across a handover between two AI seats — the deps would never change and the
 * second AI would never play.
 */
export function useAiTurns(game: Driveable): boolean {
  const [thinking, setThinking] = useState(false)
  const running = useRef(false)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const { players, turn, winner, startTurn, reroll, place } = game
  const seatKind = players[turn]?.kind
  const over = winner !== null

  useEffect(() => {
    if (over || seatKind !== 'ai' || running.current) return
    running.current = true

    const run = async () => {
      setThinking(true)
      await sleep(AI_PAUSE_MS)

      let outcome = await startTurn()

      for (let rerolls = 0; rerolls < MAX_AI_REROLLS; rerolls++) {
        if (!alive.current || outcome.kind !== 'decide') break

        await sleep(AI_PAUSE_MS)
        const action = decideAi(outcome.board, outcome.value)

        if (action.kind === 'place') {
          place(action.slot)
          break
        }
        outcome = await reroll()
      }

      setThinking(false)
      running.current = false
    }

    void run()
  }, [turn, seatKind, over, place, reroll, startTurn])

  return thinking
}
```

- [ ] **Step 2: Wire it into `RaceGame.tsx`**

Add the import:

```tsx
import { useAiTurns } from './useAiTurns'
```

Call it just below `useRaceGame`:

```tsx
  const game = useRaceGame(roster)
  const aiThinking = useAiTurns(game)
```

Then gate the human controls on it. Replace the controls block's non-winner branches so both are disabled while the AI plays, and the throw button reads differently:

```tsx
        ) : pending ? (
          <>
            <button
              className="race__roll"
              onClick={game.reroll}
              disabled={game.rolling || aiThinking}
            >
              {game.rolling ? 'Rolling…' : 'Reroll (a cross busts)'}
            </button>
            {pending.legal.length === 0 && (
              <button
                className="race__roll race__roll--quiet"
                onClick={game.pass}
                disabled={game.rolling || aiThinking}
              >
                Give up the throw
              </button>
            )}
          </>
        ) : (
          <button
            className="race__roll"
            onClick={game.startTurn}
            disabled={game.rolling || aiThinking}
          >
            {game.rolling ? 'Rolling…' : aiThinking ? `${active.name} is thinking…` : `Throw for ${active.name}`}
          </button>
        )}
```

And stop a stray click landing on an AI's bidding decision — change the slot button's `disabled`:

```tsx
                disabled={!selectable || aiThinking}
```

Finally, say who is thinking. The throw button only renders when nothing is
pending, so it cannot carry this on its own — during an AI's reroll phase the
controls show a disabled Reroll instead. Put it on the status line, which is
always present and is what screen readers announce:

```tsx
      <p className="race__status" role="status">
        {game.rolling
          ? 'Rolling the dice.'
          : aiThinking
            ? `${active.name} is thinking…`
            : log[0]}
      </p>
```

- [ ] **Step 3: Verify**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS — 58 tests, no type errors, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/game/useAiTurns.ts src/game/RaceGame.tsx
git commit -m "Let AI seats play their own turns"
```

---

### Task 5: The lobby

**Files:**
- Create: `src/game/Lobby.tsx`
- Create: `src/game/lobby.css`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `MIN_SEATS`, `MAX_SEATS`, `SEAT_PALETTE`, `defaultRoster`, `type Seat`, `type SeatKind` from `./seats`.
- Produces: `Lobby({ onStart }: { onStart: (roster: Seat[]) => void })`.

- [ ] **Step 1: Write the lobby**

Create `src/game/Lobby.tsx`:

```tsx
import { useState } from 'react'
import { MAX_SEATS, MIN_SEATS, defaultRoster, type Seat, type SeatKind } from './seats'
import './lobby.css'

export type LobbyProps = {
  onStart: (roster: Seat[]) => void
}

const COUNTS = Array.from({ length: MAX_SEATS - MIN_SEATS + 1 }, (_, i) => MIN_SEATS + i)

export function Lobby({ onStart }: LobbyProps) {
  const [roster, setRoster] = useState<Seat[]>(() => defaultRoster(MIN_SEATS))

  /** Resizing keeps the kinds already chosen for the seats that survive. */
  const resize = (count: number) => {
    setRoster((previous) =>
      defaultRoster(count).map((seat, index) => ({
        ...seat,
        kind: previous[index]?.kind ?? seat.kind,
      })),
    )
  }

  const setKind = (index: number, kind: SeatKind) => {
    setRoster((previous) =>
      previous.map((seat, i) => (i === index ? { ...seat, kind } : seat)),
    )
  }

  return (
    <div className="lobby">
      <h1 className="lobby__title">Race</h1>
      <p className="lobby__blurb">
        Bid for position on a seven-slot track. Outbid from below, or get knocked off.
      </p>

      <div className="lobby__section">
        <h2 className="lobby__label" id="lobby-count">
          Players
        </h2>
        <div className="lobby__counts" role="group" aria-labelledby="lobby-count">
          {COUNTS.map((count) => (
            <button
              key={count}
              className="lobby__count"
              aria-pressed={roster.length === count}
              onClick={() => resize(count)}
            >
              {count}
            </button>
          ))}
        </div>
      </div>

      <div className="lobby__section">
        <h2 className="lobby__label">Seats</h2>
        <ul className="lobby__seats">
          {roster.map((seat, index) => (
            <li className="lobby__seat" key={seat.name}>
              <span className="lobby__dot" style={{ background: seat.color }} />
              <span className="lobby__name">{seat.name}</span>
              <div className="lobby__kinds" role="group" aria-label={`${seat.name} is played by`}>
                <button
                  className="lobby__kind"
                  aria-pressed={seat.kind === 'human'}
                  onClick={() => setKind(index, 'human')}
                >
                  Human
                </button>
                <button
                  className="lobby__kind"
                  aria-pressed={seat.kind === 'ai'}
                  onClick={() => setKind(index, 'ai')}
                >
                  AI
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <button className="lobby__start" onClick={() => onStart(roster)}>
        Start race
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Style it**

Create `src/game/lobby.css`:

```css
.lobby {
  width: min(460px, 100%);
  display: flex;
  flex-direction: column;
  gap: 22px;
}

.lobby__title {
  margin: 0;
  font-size: 26px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #e8e3d6;
}

.lobby__blurb {
  margin: -14px 0 0;
  color: #8e877b;
  font-size: 13px;
  line-height: 1.5;
}

.lobby__section {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.lobby__label {
  margin: 0;
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #8e877b;
}

.lobby__counts {
  display: flex;
  gap: 8px;
}

.lobby__count {
  width: 42px;
  padding: 9px 0;
  border: 1px solid #2f2c27;
  border-radius: 8px;
  background: #1b1916;
  color: #9d968a;
  font: inherit;
  cursor: pointer;
  transition: border-color 120ms ease, color 120ms ease, background 120ms ease;
}

.lobby__count:hover {
  border-color: #6f6857;
}

/* `aria-pressed` is the selected state, so the styling reads off it directly
   rather than duplicating the same fact in a class. */
.lobby__count[aria-pressed='true'] {
  border-color: #d9d2c0;
  background: #24211c;
  color: #f0ece0;
}

.lobby__seats {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.lobby__seat {
  display: grid;
  grid-template-columns: 12px 1fr auto;
  align-items: center;
  gap: 11px;
  padding: 8px 12px;
  border: 1px solid #2f2c27;
  border-radius: 9px;
  background: #1b1916;
}

.lobby__dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
}

.lobby__name {
  font-size: 14px;
  color: #cfc8b9;
}

.lobby__kinds {
  display: flex;
  gap: 5px;
}

.lobby__kind {
  padding: 5px 11px;
  border: 1px solid #2f2c27;
  border-radius: 6px;
  background: none;
  color: #7e776c;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: border-color 120ms ease, color 120ms ease, background 120ms ease;
}

.lobby__kind:hover {
  border-color: #6f6857;
}

.lobby__kind[aria-pressed='true'] {
  border-color: #d9d2c0;
  background: #24211c;
  color: #f0ece0;
}

.lobby__start {
  padding: 13px 30px;
  border: none;
  border-radius: 10px;
  background: linear-gradient(#f0ece0, #d9d2c0);
  color: #23211d;
  font: inherit;
  font-weight: 600;
  letter-spacing: 0.02em;
  cursor: pointer;
  box-shadow: 0 3px 0 #a79f8c, 0 6px 16px rgb(0 0 0 / 0.35);
  transition: transform 90ms ease, box-shadow 90ms ease;
}

.lobby__start:hover {
  transform: translateY(-1px);
}

.lobby__start:active {
  transform: translateY(2px);
  box-shadow: 0 1px 0 #a79f8c, 0 3px 8px rgb(0 0 0 / 0.3);
}
```

- [ ] **Step 3: Switch screens in `App.tsx`**

Replace `src/App.tsx` with:

```tsx
import { useState } from 'react'
import { Lobby } from './game/Lobby'
import { RaceGame } from './game/RaceGame'
import type { Seat } from './game/seats'

export default function App() {
  const [roster, setRoster] = useState<Seat[] | null>(null)

  // Returning to the lobby sets this back to null, which unmounts RaceGame —
  // so the next race always starts from fresh state with no key needed.
  if (!roster) return <Lobby onStart={setRoster} />

  return <RaceGame roster={roster} onExit={() => setRoster(null)} />
}
```

- [ ] **Step 4: Verify**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS — 58 tests, no type errors, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/game/Lobby.tsx src/game/lobby.css src/App.tsx
git commit -m "Add a lobby for seating 3-6 human and AI players"
```

---

### Task 6: Verify in the browser, and document

**Files:**
- Modify: `README.md`
- Others only if a defect turns up.

- [ ] **Step 1: Start the preview**

Use `preview_start` with `{name: "race-dev"}`. Confirm the served `cwd` is this checkout before trusting anything you see — a server pointed at a different directory will happily show you unchanged code.

- [ ] **Step 2: Exercise the lobby**

- 3 through 6 are selectable, and the seat list grows and shrinks to match
- Each seat toggles Human / AI independently, and the choice survives a resize
- Colours and names match the palette: Red, Blue, Green, Amber, Violet, Teal
- Start race enters the game with the chosen roster; AI seats are tagged on the track

- [ ] **Step 3: Watch a 3-seat game with 2 AI**

Confirm: AI turns start on their own; the log narrates each AI action; human controls are disabled while an AI plays; play returns to the human seat afterwards.

Then confirm each AI behaviour at least once, driving extra turns if needed:
- an AI **places on the highest evicting slot** when it can outbid
- an AI **busts** after rerolling
- an AI **settles immediately** when the track is empty or holds nothing evictable

- [ ] **Step 4: Play a 6-seat game to a win**

Six seats with one human. Confirm the track renders six lanes legibly, the game reaches a winner, and both "play again" and "Back to lobby" work.

- [ ] **Step 5: Check for errors**

`read_console_messages` with `onlyErrors: true` and `preview_logs` with `level: "error"`. Both must be empty. Note that HMR errors logged *while* files were being edited are historical — reload and re-check rather than reporting them.

- [ ] **Step 6: Update the README**

Add a section after "The game" describing the lobby and the AI:

```markdown
## Players

Three to six seats, each human or AI, chosen in the lobby before a race.

An AI seat plays the same rules with one strategy: if anything on the board can
be outbid, it rerolls until it can outbid it, then takes the **highest** slot
that knocks someone off. If nothing can be outbid — an empty track, or a board
whose only bids are unreachable — it settles for the highest legal slot.

"Unreachable" is doing real work there. A bid on slot 0 can never be evicted,
because outbidding needs a *lower* slot and none exists. Neither can a standing
`76`, because beating it needs `77`, and `77` is `XX`, which a reroll can never
produce. Without treating both as nothing-to-chase, an AI would reroll into a
bust every turn for as long as such a bid stood.

The strategy is deliberately aggressive: rerolling busts on 11/36, so an AI
that cannot outbid will often end its turn with nothing. It still banks any
doubles it rolls on the way.
```

- [ ] **Step 7: Final check and commit**

Run: `npm test && npm run typecheck && npm run build`

```bash
git add README.md
git commit -m "Document the lobby and the AI strategy"
```

Commit any defect fixes found in this task with their own message.

---

## Notes for the executor

- **The ref mirror in `useRaceGame` is load-bearing, not defensive.** An AI turn calls `startTurn()`, awaits a ~3s animation, then calls `reroll()` — and that `reroll` is the callback instance from a render that happened before the throw. Reading React state inside it returns the pre-throw board and positions. Every action writes `live.current` *before* `setState` so the next step in the sequence sees the truth. Do not "simplify" the actions to read state directly.
- **Task 3 has no new tests and that is correct.** It moves logic without changing it, and the rules it moves are already covered by `bidding.test.ts`. Do not invent tests for React state plumbing; verify it in the browser.
- **`decideAi` reuses `placeBid` to ask which placements evict** rather than reimplementing the eviction rule, passing `-1` as the owner id because eviction does not depend on who owns the bid. Keep it that way — a second copy of that rule is how the two drift apart.
- **Test counts** assume you start from 44 passing tests. They reach 50 after Task 1 and 58 after Task 2, then stay there.
