# Custom dice faces and the reroll gamble

Two changes to Race, which currently throws a pair of standard 1–6 dice and
scores them as a single bid value:

1. The two dice get **different, non-standard faces**, one of them a bust
   symbol (`X`).
2. A player may **reroll as often as they like**, but every reroll risks
   busting the turn.

Together these turn the bid from a dealt hand into a press-your-luck decision.

## The dice

| Die | Faces | Notes |
| --- | --- | --- |
| A | `1, 2, 3, X, 5, 6` | no 4 |
| B | `1, 2, 3, 4, X, 7` | no 5 or 6; the only 7 in the game |

Each die still has six equally likely faces. `X` therefore comes up on either
die with probability 1/6.

The two dice are visually distinguished by **body colour** — they are not
interchangeable, and a player has to know which one can roll a 7.

## Roll resolution

A turn's first throw is safe. Every throw after it is a gamble.

| Condition | Result |
| --- | --- |
| Any `X`, on any throw after the first | **Bust** — no bid, turn ends |
| Both dice `X`, on the first throw | **`XX`** — the strongest value in the game |
| One `X`, on the first throw | That die counts as `0` |
| No `X` | Normal |

A normal value is the two faces read **high digit first**, whichever die each
came from: A=5 with B=3 gives `53`, and A=3 with B=7 gives `73`. With `X` as
zero on the first throw, A=6 with B=`X` gives `60`, and A=`X` with B=4 gives
`40`.

Because the dice carry different faces, a digit often identifies its die: only
B can show 4 or 7, and only A can show 5 or 6.

Values run `10`–`76`. `XX` sits above all of them and is beaten by nothing.

### Representing `XX`

`XX` is stored as the number **77** — one above the `76` ceiling — and rendered
as the string `XX`, never as a number.

This is deliberate: it means `XX` beats every other bid through the *existing*
comparison in `legalSlots` and `placeBid`, which need no changes and keep their
current tests. Two `XX` bids tie, and ties do not evict, which is consistent
with how every other tie already behaves.

### Odds

| Event | Probability |
| --- | --- |
| A reroll busts | 11/36 ≈ 30.6% |
| First throw is `XX` | 1/36 ≈ 2.8% |
| A throw contains a 7 | 1/6 ≈ 16.7% |

Roughly: you bust on a bit under a third of rerolls. That is the price of
trading a mediocre bid for a better one.

## The turn

1. **Collect.** Unchanged. If your bid survived, move its slot number of spaces
   and take it off the track. Reaching 30 ends the game here.
2. **Throw.** Resolve per the table above.
3. **Decide.** Place the value on a legal slot, or reroll, or — only when no
   slot is legal — pass. Placing or passing ends the turn; rerolling returns to
   step 2.

A bust at step 2 ends the turn immediately with no bid. It does **not** undo
the move collected at step 1: that bid was already won.

A reroll always throws **both** dice and replaces the whole result. A player
cannot keep one die.

Pass is offered **only** when the current value has no legal slot. With a legal
slot available there is never a reason to decline it — a bid can only help its
owner — so the button would be a misclick hazard rather than a choice.

## Module design

### Face-id indirection

The fairness argument in `labeling.ts` is the load-bearing idea in this
codebase: a CSPRNG picks a value, the physics picks a motion, and a cube
symmetry reconciles them without ever rejecting a simulation.

That argument is preserved exactly, by changing nothing in `labeling.ts`.

The engine keeps working in **face IDs** 1–6 — the RNG picks one uniformly,
`labelingWith` rotates it face-up — and each die carries a lookup from face ID
to the symbol actually drawn and scored. Only the paint changes; the geometry,
the symmetry group, and the uniformity of the draw are untouched.

A consequence to note: face IDs retain the standard die's opposite-face
pairing, so die A reads 1↔6, 2↔5, 3↔`X` and die B reads 1↔7, 2↔`X`, 3↔4. No
particular arrangement was specified and any consistent one is valid; this is
the one players will see.

Two rejected alternatives:

- **Parameterise `BASE` per die.** `BASE` encodes "opposite faces sum to 7" and
  "1-2-3 counter-clockwise" — properties with no meaning for a die reading
  `1,2,3,4,X,7`. More churn, no benefit.
- **Map symbols in the game layer only.** The engine would stay standard 1–6
  and the rules would translate, so die A would *show* a 4 while scoring an
  `X`. Unacceptable.

### `src/game/bidding.ts`

`bidValue` is replaced by a resolver that folds in the bust and jackpot rules:

```ts
type Face = number | 'x'

type Roll =
  | { kind: 'bust' }
  | { kind: 'bid'; value: number }

function resolveRoll(faces: Face[], isFirstRoll: boolean): Roll
```

Plus `DOUBLE_X = 77` and `bidLabel(value): string`, which returns `'XX'` for
`DOUBLE_X` and the number otherwise.

`legalSlots`, `placeBid`, `collectBid` and `emptyBoard` are unchanged.

### `src/dice/` — engine

`throwDice` and `useDiceRoll` currently take a die *count*. They take **die
specs** instead:

```ts
type DieFaces = readonly [Face, Face, Face, Face, Face, Face]  // by face ID

throwDice(dice: readonly DieFaces[], seed: number): Recording
useDiceRoll(dice: readonly DieFaces[]): DiceTray
```

`Recording` gains `dice` (the specs it was thrown with). `DieOutcome.value:
number` becomes `faceId: number` plus the resolved `face: Face`.

`DiceTray.values: number[]` and `DiceTray.total: number` are replaced by
`faces: Face[]`, and `roll()` resolves to `Face[]`. `total` is dropped rather
than generalised: the sum of a hand containing `X` has no meaning, and nothing
consumes it. The README's dice-module example uses `total`'s premise and is
updated with it.

### `src/dice/` — renderer

- `PIP_LAYOUT[7]` — the 6 layout plus a centre pip; the centre is what
  distinguishes it from a 6 at a glance.
- **`X` faces** are drawn as two crossed bars in a contrasting red, not as
  pips. A bust has to be unmistakable, and any pip arrangement resembling a
  cross would read as a 5.
- **Per-die body colour.** `DiceTable` currently builds one shared
  `bodyMaterial`; it gains an optional `dieColors` prop and one material per
  die.
- **Unused pips must be hidden.** `PIPS_PER_DIE` is 21 today and a standard die
  consumes all 21, so `applyLabeling` never leaves a stale mesh. Both new dice
  use only 17, so the four leftovers would hang in their previous positions.
  The pool is sized from the specs and the remainder explicitly hidden.

### `src/game/RaceGame.tsx`

The pending-placement state grows a roll counter and a reroll action; the
bidding track renders bid labels via `bidLabel`. A bust logs and advances the
turn. Everything about the track, collection and eviction is unchanged.

## Testing

`resolveRoll` is pure and gets the same test-first treatment as the rest of
`bidding.ts`:

Face arrays are ordered `[dieA, dieB]`, so every case below has to be a hand
those two dice can actually produce:

- first throw, no `X`: `[5, 3]` → 53
- first throw where the *second* die is higher: `[3, 7]` → 73
- first throw, one `X`: `[6, 'x']` → 60; `['x', 4]` → 40
- first throw, both `X` → `DOUBLE_X`
- reroll with any `X` → bust, including both-`X`
- reroll with no `X` → a normal value
- `DOUBLE_X` is legal on every empty slot and evicts every lower bid

Engine: face IDs resolve to the right symbol for each die, and the draw stays
uniform over the six IDs.

Renderer and turn flow: verified in the browser preview, including a bust, a
successful reroll, and an `XX`.

## Out of scope

Player count, the 0–30 track, the bidding track's size, and the eviction rules
are all unchanged. No AI opponent.
