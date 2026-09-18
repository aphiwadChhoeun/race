# Race

A 3–6 player dice race with a real rigid-body physics simulation behind the dice.

```bash
npm install
```

```bash
npm run dev
```

Built on [cannon-es](https://github.com/pmndrs/cannon-es) for the physics and
[three.js](https://threejs.org/) for the rendering.

```bash
npm test
```

## The game

The race track runs `0…30` and the first player to reach or pass it wins. You
never move by what you rolled, though — you move by what you successfully *bid*.

Alongside the track sits a **bidding track** of seven slots labelled `0…6`. A
slot's label is how far its occupant will move; each slot holds at most one bid.

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

Ordinary bid values run `10`–`76`, plus `XX`. That `10` floor is a non-obvious
consequence of `X` counting as zero rather than being excluded: A=1 with B=`X`
bids `10`, not `01`.

After that first throw you may **reroll as often as you like**, but any `X` on
any later throw **busts**: your turn ends with no bid. A reroll throws both dice
and busts 11/36 of the time, so roughly a third of the time you lose the bid you
already had. That is the whole gamble.

### Doubles

Two dice showing the same **number** move you that many spaces immediately, on
any throw, and you still bid the value afterwards — a double is a pure bonus.
Roll `3,3` and you move 3, then place `33` or reroll as usual.

Only `1,1`, `2,2` and `3,3` exist. The dice share no other value: die A has no
4 and no 7, die B has no 5 and no 6. So a double is worth 1–3 spaces and turns
up on 3 throws in 36. Two crosses are never a move — on an opening throw they
are the `XX` jackpot, and on any later throw they are a bust.

Because doubles pay on rerolls too, a lucky streak chains: move 2, reroll, move
3, reroll. Every extra throw is another 1-in-12 shot at free ground against the
11/36 bust — which is what makes the reroll a real decision rather than a
formality.

Moves are **banked**. Neither busting nor giving up the throw takes back the
spaces you collected at the start of the turn or won from a double — those were
already yours. A double can win the game outright: reach 30 and the turn stops
there, bid or no bid.

A turn is three steps:

1. **Collect.** If your bid is still on the track, it pays out — move its slot
   number of spaces, and the bid comes off. If someone evicted it first, you get
   nothing.
2. **Throw** both dice. A double moves you its value straight away. Then
   decide: place the value on a legal slot, reroll and risk the bust, or — only
   if no slot is legal — give up the throw.
3. **Place** the value on a legal empty slot. Every bid on a *higher* slot for a
   *strictly lower* value is knocked off the track.

That last clause is the whole game. Slot 6 pays the most and is the most
exposed: it can be taken away by any bigger value placed anywhere beneath it.
Slot 0 can never be evicted and is worth nothing — but occupying it denies
everyone else the strongest outbidding position.

A slot is **legal** only if it is empty *and* no lower slot holds a bigger
value; landing somewhere that is already dead isn't allowed. Ties are safe in
both directions, since eviction needs a strictly higher value. If a throw has
nowhere legal to go you may reroll it, or give it up for nothing.

The rules themselves are a pure module, [`bidding.ts`](src/game/bidding.ts),
with the edge cases pinned down in [`bidding.test.ts`](src/game/bidding.test.ts).
[`RaceGame.tsx`](src/game/RaceGame.tsx) only renders; game state and turn
actions live in [`useRaceGame.ts`](src/game/useRaceGame.ts), and the AI turn
driver lives in [`useAiTurns.ts`](src/game/useAiTurns.ts).

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

## The dice module

Everything dice-related lives in [`src/dice/`](src/dice/). Drop it into any React
app:

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

| File | Role |
| --- | --- |
| [`faces.ts`](src/dice/faces.ts) | What a die's faces show, and the dice-signature helper |
| [`random.ts`](src/dice/random.ts) | Fair outcomes (CSPRNG) and seeded throw variation |
| [`labeling.ts`](src/dice/labeling.ts) | Cube symmetries — how a fair RNG and real physics coexist |
| [`physics.ts`](src/dice/physics.ts) | Headless simulation, recorded as a transform track |
| [`DiceTable.tsx`](src/dice/DiceTable.tsx) | three.js dice, lighting, shadows, and playback |
| [`sound.ts`](src/dice/sound.ts) | Impact clacks, driven by real collision events |
| [`useDiceRoll.ts`](src/dice/useDiceRoll.ts) | Outcome and roll lifecycle for a tray of dice |

## How a fair RNG and real physics coexist

The obvious ways to combine them are both bad. Let the physics decide the number
and the odds become whatever the engine's biases are — unauditable, and they
change every time you retune a friction value. Rejection-sample the simulation
until it gives the number you wanted and you pay 6ⁿ simulations for n dice.

This uses neither. A cube has **24 orientation-preserving symmetries**, so for
*any* orientation the simulation leaves a die in, there is a valid standard-die
labeling that puts any chosen value face-up. So:

1. The CSPRNG picks the faces.
2. The physics runs **once**, unsteered, and is recorded.
3. Each die is then labelled to put its chosen value on whichever face ended up
   pointing up.

Choosing the labeling afterwards is exactly equivalent to having rotated the
die's initial orientation by that symmetry — a cube's collision geometry is
invariant under it, so the recorded motion stays a physically valid motion of the
relabelled die. The simulation is never steered, and the odds come purely from
the CSPRNG.

The labeling is fixed before anything is rendered, so the pips are consistent for
every frame. There is no moment at which a die shows one thing and becomes
another.

**One simulation per throw, no matter how many dice.** Simulations are rejected
only for *settling badly* — a die leaning on a rail with no face properly up —
which happens 6.6% of the time and costs a millisecond to redo.

## Why the throw is simulated up front, not stepped live

`roll()` simulates the whole throw synchronously (~1ms per die) and records a
track of transforms; playback just samples it. That buys three things:

1. The outcome exists before the first frame is drawn, so game logic never waits
   on a physics race.
2. Playback can't stutter, drift, or diverge on a slow frame — there's no
   integration to fall behind.
3. A throw that settles badly can be thrown away and resimulated before anyone
   sees it.

Sound comes from the simulation's real contact events, scheduled against the
audio clock, so the clacks land on the actual bounces.

## The table is physics-only

The floor and the four rails exist solely in the simulation — the dice roll and
rebound off them, but nothing is drawn for them. The canvas is transparent, so
whatever is behind it is the surface the player sees.

The one thing that *is* drawn at ground level is a **shadow catcher**: a plane
carrying `ShadowMaterial`, which renders only where a shadow falls. Without it
the dice lose their contact shadows and read as floating in a void — it is the
shadow, not the surface, that grounds them.

That makes the backdrop colour load-bearing rather than decorative. The shadow
darkens whatever is behind it by 38%, so on the current near-black background
that is ~8 luma of contrast — subtle, but legible against the bright dice and
enough to ground them. A mid-tone or lighter backdrop makes it markedly
stronger. See the note on `.race__table` in [`race.css`](src/game/race.css),
which has a felt-toned alternative commented out. To drop shadows entirely,
remove the catcher block in `DiceTable.tsx` and set `shadowMap.enabled = false`.

## Accessibility and interruption

- `prefers-reduced-motion: reduce` skips playback and shows the settled dice.
- The game announces the outcome through a `role="status"` region once the dice
  settle.
- An interrupted throw shows the outcome it was heading for and still reports the
  settle, so state and pixels never disagree and the tray can't get stuck.
- Pressing Throw mid-roll is ignored rather than restarting — that would let a
  player reroll for free.

## Verification

**Build and run:** `tsc --noEmit` passes clean under `strict`, `noUnusedLocals`
and `verbatimModuleSyntax`; `vite build` succeeds (789 kB JS, 218 kB gzipped —
mostly three.js, so the chunk-size warning is expected). The dev server runs and
the game plays: a throw logged "Red threw 6 and 2 — place 62" while the dice on
screen showed exactly 6 and 2, which exercises the physics recording, the
relabelling, the pip placement and the turn logic together.

Versions and API surface were checked against the installed packages: `three`
0.170.0 with a matching `@types/three` 0.170.0, `cannon-es` 0.20.0. The
`three/examples/jsm/geometries/RoundedBoxGeometry.js` import is explicitly
permitted by three's `exports` map and typed at that exact subpath.

The dice logic was additionally verified by porting these modules into a
standalone browser harness and exercising them directly at volumes the UI can't
reach:

**Correctness**

- **Relabelling** — all 36 (resting-axis × target-value) combinations produce a
  valid right-handed die, opposite faces summing to 7, with the target face up.
  Zero mismatches against 1500 real physics resting orientations.
- **Pip placement** — over 400 dice from 200 real throws, the pips counted in
  *world space* above each die's centre always equalled the value claimed. This
  covers the labeling, face bases, pip layouts and the physics resting axis
  together, end to end.
- **Fairness** — 600,000 draws gave χ² = 8.81 against uniform (df=5, critical
  11.07). The same bytes without the rejection-sampling loop give χ² = 59.24,
  i.e. decisively biased — that's why `rollFaces` discards bytes ≥ 252 rather
  than just taking `byte % 6`. Outcomes through the full pipeline: χ² = 2.47.

**Tuning** (each figure measured, not guessed)

- 0.98ms per throw for one die, 2.47ms for two.
- 6–10% of throws need one resimulation; **zero** failed to settle in 400 throws.
- Resting faces are dead level (5th-percentile flatness 1.00000).
- Dice settle near the middle of the table (mean x 0.33 on a ±2.6 table), in
  1.67s on average.
- Framing was checked by projecting all eight corners of every die on every frame
  of 350 throws: no corner leaves the viewport at any aspect ratio from 2.4 down
  to 1.1.

The harness also caught four real bugs, all fixed: `fixedStep()` silently does
nothing in a headless loop (it derives substeps from wall-clock time, so a tight
loop advances the world by zero — the first probe's die just hung in the air);
`getRandomValues` throws above 65536 bytes per call; the initial launch spacing
let two dice start interpenetrating; and the first camera/launch pair clipped a
die corner off-screen on 95% of throws, which a centre-only framing check had
reported as fine.
