# A lobby, 3–6 players, and AI opponents

Race is currently a fixed two-player hotseat game: `RaceGame` hardcodes its
roster, owns all state, and advances only when a human clicks. Three changes:

1. A **lobby** screen where you choose 3–6 seats before playing.
2. Each seat is **human or AI**.
3. **AI seats play themselves**, using the strategy below.

## The lobby

Player count 3–6. Each seat toggles Human / AI. Names and colours are assigned
automatically from a fixed six-seat palette — no editing, no persistence.

| Seat | Name | Colour |
| --- | --- | --- |
| 1 | Red | `#e2574c` |
| 2 | Blue | `#4c7fe2` |
| 3 | Green | `#4caf6d` |
| 4 | Amber | `#d99b3f` |
| 5 | Violet | `#9b6bd6` |
| 6 | Teal | `#3fb4b4` |

Seats 1 and 2 keep the colours the two-player game already used.

An all-AI roster is allowed. It costs nothing to permit and makes the game
watchable, which is useful for judging the AI. The two-player game is replaced:
3 is the new minimum.

Turn order is seat order, starting at seat 1. Winning offers **Play again**
(same roster) and **Back to lobby**.

## The AI

### Strategy

> Roll. If there is a bid on the track, reroll until you can outbid. Otherwise
> bid the highest slot on the first roll.

Concretely, given the board and the value just rolled, in this order:

1. If **no slot is legal**, reroll — there is nothing to decide between.
2. If **no bid on the board can be evicted by any achievable roll**, there is
   nothing to outbid — place on the **highest legal slot**.
3. If placing this value would evict at least one bid, place it on the
   **highest legal slot that evicts something**.
4. Otherwise **reroll**.

Step 2 is checked against the board alone, never against the current roll — the
question it answers is "is there anything here worth chasing?", which does not
depend on what this particular throw produced.

`decideAi(board, value)` deliberately takes **no roll-number parameter**. The
strategy's "on the first roll" is descriptive, not conditional: it just notes
that on an empty track the AI settles immediately. The same rule applies to
every throw, so passing a throw count would be an unused argument inviting
someone to branch on it.

An `XX` (77) on an AI's opening throw needs no special case: it beats every
value, so it evicts wherever it lands and falls out of step 3 naturally.

### What "can be evicted by any achievable roll" means

Eviction requires placing a strictly higher value on a *lower* slot. Two
situations make a bid permanently safe, and both would otherwise trap the AI
into rerolling until it busts, every turn, for as long as the bid stands:

- **A bid on slot 0.** No slot is below it, so nothing can ever evict it.
- **A bid of 76 — or one whose lower slots are blocked.** The highest value a
  reroll can produce is `76`: a reroll cannot make `XX`, because any cross after
  the first throw is a bust. So a standing `76` is unbeatable in practice even
  though a `77` would beat it on paper.

So a bid of value `v` at slot `s` counts as a target only if some empty slot
`t < s` exists where a `76` would be both legal and winning — that is,
`76 > v` and `76 >= ` the highest value below `t`.

Getting this wrong does not produce a wrong move so much as a dead AI: it would
reroll into a bust on every turn while an unbeatable bid sits on the board,
advancing only on doubles.

### Worked example

```
Board: 42 on slot 5
AI rolls 63

legal slots        0 1 2 3 4 . 6     (5 is taken; 6 is legal since 63 >= 42)
evicts something   0 1 2 3 4 . .     (slot 6 has nothing above it to evict)
                           ^
                           highest → place 63 on slot 4, knocking off 42
```

### Reroll safety

The AI's reroll loop terminates because every reroll busts with probability
11/36. A defensive cap of 30 rerolls per turn guards against a pathological
loop; reaching it is vanishingly unlikely and is treated as a bust.

### Pacing

AI turns run automatically with a ~700ms pause between actions — long enough to
read the log line, short enough that a six-seat round does not drag. The dice
animation already supplies most of the pacing; the pause covers the decisions
that happen between throws.

While an AI seat is playing, the human-facing controls are disabled and the
bidding-track slots are not clickable, so a stray click cannot act on an AI's
turn. The status line says which AI is thinking.

## Structure

### The problem

A human turn is: click → `await roll()` → click a slot. An AI turn is the same
steps with no clicks and possibly many rerolls, each carrying a dice animation.
Today all of this lives in `RaceGame.tsx` as `useCallback`s that read React
state and write it back — state an async AI script cannot read reliably
mid-sequence.

### The approach: actions that return their outcome

Game state and actions move into a `useRaceGame` hook. Its actions both update
state *and return what happened*, so an AI turn can be a single async function
that awaits each step and reads the result directly rather than from stale
state. This is the pattern `RaceGame` already uses internally, where
`throwDiceFor` takes the board and position as parameters for exactly this
reason.

```ts
export type TurnOutcome =
  | { kind: 'won' }
  | { kind: 'bust' }
  | { kind: 'decide'; value: number; board: Board; legal: number[] }

type RaceGame = {
  // state for rendering
  players: Player[]
  board: Board
  turn: number
  pending: Pending | null
  winner: number | null
  log: string[]
  // dice tray, passed through to <DiceTable>
  recording: Recording
  playId: number
  rolling: boolean
  settle: () => void
  // actions
  startTurn: () => Promise<TurnOutcome>   // collect, move, then throw
  reroll: () => Promise<TurnOutcome>
  place: (slot: number) => void
  pass: () => void
  reset: () => void
}
```

The UI ignores the return values; the AI script branches on them.

Two alternatives were rejected:

- **An effect that reacts to each state change.** Less refactoring, but a
  multi-step turn driven by re-entrant effects is race-prone, and the shape is
  wrong: a turn is a sequence, not a reaction.
- **A pure game engine outside React.** Most testable, but it means rewriting
  state management that already works to gain what extracting one pure decision
  function gains anyway.

### Files

| File | Responsibility |
| --- | --- |
| `src/game/seats.ts` | `Seat` type, the six-seat palette, roster construction |
| `src/game/ai.ts` | `decideAi(board, value): AiAction` — pure, no React |
| `src/game/useRaceGame.ts` | Game state and the actions above |
| `src/game/useAiTurns.ts` | Runs an AI seat's turn when it comes round |
| `src/game/Lobby.tsx`, `lobby.css` | The lobby screen |
| `src/game/RaceGame.tsx` | Rendering only; takes a roster prop |
| `src/App.tsx` | Switches between lobby and game |

`RaceGame.tsx` has grown to roughly 280 lines carrying state, turn logic and UI
together. Splitting the state out is not incidental tidying — it is what makes
an AI driver possible at all.

### Unchanged

Every rule: the `0–30` track, the seven-slot bidding track, bid values and the
`XX` sentinel, eviction, legality, busting, doubles. `bidding.ts` gains nothing
but is read by the new AI module. `src/dice/` is untouched.

## Testing

`decideAi` is pure and gets test-first treatment, against hand-built boards:

- places on the highest legal slot that evicts, with several evicting slots
  available (the worked example above)
- prefers an evicting slot over a higher non-evicting one
- rerolls when targets exist but this value reaches none of them
- treats a board whose only bid sits on slot 0 as nothing to chase, and places
  on the highest legal slot
- treats a standing `76` the same way, since no reroll can beat it
- rerolls when no slot is legal, even though a target exists
- places an `XX` on the highest evicting slot, with no special-casing

The lobby, the AI turn loop and the pacing are verified by driving the real app
in a browser: a 3-seat and a 6-seat game, at least one AI bust, at least one AI
eviction, and a completed game.

## Consequences worth stating

- **With 6 seats, up to 6 of the 7 slots can be occupied.** Dead ends — a throw
  with no legal slot — become common, so human players will see "Give up the
  throw" far more often than in the two-player game.
- **The AI busts often by design.** It rerolls whenever it cannot outbid, and a
  reroll busts on 11/36. This is the chosen strategy, not a defect.

## Out of scope

Networked play, persisted lobby settings, editable names or colours, AI
difficulty levels, and any change to the rules themselves.
