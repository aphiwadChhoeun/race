# Snail Dash

A 3–6 snail dice race with a real rigid-body physics simulation behind the dice.
Play it against the AI, or share a four-letter code and race someone real.

```bash
npm install
```

```bash
npm run dev
```

Built on [cannon-es](https://github.com/pmndrs/cannon-es) for the physics and
[three.js](https://threejs.org/) for the rendering, and hosted on Cloudflare —
one Worker for the app and a Durable Object per room. See
[Playing with friends](#playing-with-friends) and [Deploying](#deploying).

```bash
npm test
```

## The game

The race track runs `0…30` and the first player to reach or pass it wins. You
never move by what you rolled, though — you move by what you successfully *bid*.

Alongside the track sits a **bidding track** of seven slots labelled `0…6` —
the lawn draws them as leaves, but slot is the word the code and the rules use.
A slot's label is how far its occupant will move; each slot holds at most one
bid.

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
   decide: place the value on an empty slot, or reroll and risk the bust.
3. **Place** the value on any empty slot. Every bid on a *higher* slot for a
   *strictly lower* value is knocked off the track.

That last clause is the whole game. Slot 6 pays the most and is the most
exposed: it can be taken away by any bigger value placed anywhere beneath it.
Slot 0 can never be evicted and is worth nothing — but occupying it denies
everyone else the strongest outbidding position.

**Emptiness is the only placement rule.** A slot is yours to take if nobody is
on it, whatever your value and whatever is standing elsewhere on the track. You
may drop a `12` on slot 6 with a `60` sitting on slot 2 and gamble that your
turn comes round before anyone beats it. That is a bad bet, not an illegal one —
the rules let you make it.

Ties are safe in both directions, since eviction needs a strictly higher value.
And there is always somewhere to go: six seats at most, seven slots, one bid per
player, so at least one slot is always empty. A throw is never wasted for want
of a place to put it.

The rules themselves are a pure module, [`bidding.ts`](src/engine/bidding.ts),
with the edge cases pinned down in [`bidding.test.ts`](src/engine/bidding.test.ts),
and the turn flow around them is [`engine.ts`](src/engine/engine.ts) — a total
function from a state and an intent to the beats a player watches.
[`RaceGame.tsx`](src/game/RaceGame.tsx) only renders.

Everything under [`src/engine/`](src/engine) is plain TypeScript with no React,
no three and no cannon-es in it, because the same files run inside a Cloudflare
Worker when you race a friend. [`purity.test.ts`](src/engine/purity.test.ts)
enforces that: the barrel in `src/dice/index.ts` re-exports the renderer and the
physics, and a single value import through it would put both in the Worker
bundle with nothing failing to show for it.

## Players

Three to six seats, each human or AI, chosen in the lobby before a race. The
snails are Turbo, Zippy, Pesto, Toffee, Bubbles and Minty, in that turn order.

Each carries two shades of its hue, not one: a saturated `color` for the shell,
the slime trail and the lane token, and a darker `ink` for its name and its
bids. The theme is light, so a shell bright enough to read as a cartoon on
grass is a name too pale to read on cream — one colour cannot do both jobs, and
[`seats.test.ts`](src/engine/seats.test.ts) holds every seat to having both.

An AI seat plays the same rules with one strategy: if anything on the board can
be outbid, it rerolls until it can outbid it, then takes the **highest** slot
that knocks someone off. If nothing can be outbid — an empty track, or a board
whose only bids are unreachable — it settles for the highest slot it can
actually *hold*: the highest empty slot that no standing bid already beats from
below. Only when every empty slot is undercut does it take the highest one
anyway, since an evictable bid still beats no bid at all.

That preference is the AI's judgement, not a rule. The rules would happily let
it drop a `12` on slot 6 under a `60`; it declines because that bid is free for
anyone to take.

"Unreachable" is doing real work here. A bid on slot 0 can never be evicted,
because outbidding needs a *lower* slot and none exists. Neither can a standing
`76`, because beating it needs `77`, and `77` is `XX`, which a reroll can never
produce. Without treating both as nothing-to-chase, an AI would reroll into a
bust every turn for as long as such a bid stood.

The strategy is deliberately aggressive: rerolling busts on 11/36, so an AI
that cannot outbid will often end its turn with nothing. It still banks any
doubles it rolls on the way.

## Playing with friends

Open a lawn, and you get a four-letter code and a link. Send either. Anyone who
arrives takes the next free snail; every snail nobody claims is played by the
AI, so two of you and a code is a real race — you never have to round up a third
person.

The code leaves out `I`, `L`, `O`, `0` and `1`. It exists to be read down a
phone, and those are the characters people mishear.

A room is **server-authoritative**. A Cloudflare Durable Object holds the one
true game state, draws every throw, and checks every move against one rule: you
may act when it is the turn of a seat you own. Nobody can rig a roll from
devtools, because no browser decides what the dice did.

Clients are handed **snapshots, not rules**. Each message is what just happened
plus the whole state afterwards, so a browser has nothing to compute and
therefore nothing to get wrong. Drift is not a bug that gets handled here; it
is unrepresentable.

What crosses the wire for a throw is `{ seed, faceIds }` — enough for every
client to run the physics itself and watch the same dice tumble the same way.
The server never runs a simulation.

**If someone drops**, their seat is marked *away* and the AI plays it only when
its turn actually comes round. A ten-second wifi blip between your turns costs
you nothing, and coming back on the same link puts you straight back in your
snail. The race never stalls on a dead laptop, and nobody loses their snail for
closing a lid.

**A room closes when the race starts.** A snail appearing at turn nine is not a
race anyone asked for, and seating a latecomer in an AI's place would hand them
a position they did not earn.

Solo play runs the *same* room through a transport that skips the network, so
there is one turn-driving path rather than two — and playing on your own
exercises the code that runs online.

## Deploying

Hosted on Cloudflare: one Worker serves the app and its rooms.

```bash
npm run deploy
```

To work on it, run the app and the Worker side by side. Vite proxies `/api` to
`wrangler dev`, so you get real Durable Objects and HMR at once:

```bash
npm run dev
```

```bash
npm run dev:worker
```

Solo play needs only the first.

### What it costs

Nothing, for a game among friends. The Workers Free plan allows 100,000
requests a day and 13,000 GB-s of Durable Object duration, and static assets are
free, unlimited, and never counted. A full race is a few hundred requests.

Three decisions keep it there:

- **WebSockets, not polling.** Messages on an open socket are not billed per
  message. Polling once a second would burn ~86,000 requests a day for a single
  player.
- **Hibernation.** State is written to storage after every change, so an idle
  room may hibernate and stops billing duration.
- **AI turns resolve in one burst.** No timers, so no billed wakeups. The
  pauses that make a turn readable happen on the client, which has to animate
  the dice anyway.

Rooms are disposable. One is reaped two hours after it goes quiet, which is the
only timer in the system.

## The dice module

Everything dice-related lives in [`src/dice/`](src/dice/). Drop it into any React
app:

```tsx
import { DiceTable, useDiceRoll, STANDARD_DIE } from './dice'
import { randomSeed, rollFaces } from './dice/random'

const DICE = [STANDARD_DIE, STANDARD_DIE]

function Turn() {
  const { recording, playId, rolling, faces, play, settle } = useDiceRoll(DICE)

  const takeTurn = async () => {
    // A throw is a seed and a set of faces. Decide it wherever the authority
    // lives — here, or on a server — and every client that plays the same pair
    // watches the same tumble.
    await play({ seed: randomSeed(), faceIds: rollFaces(DICE.length) })
    score(faces) // Face[] — a number, or 'x' on a custom die
  }

  return (
    <>
      <DiceTable recording={recording} playId={playId} onSettle={settle} />
      <button onClick={takeTurn} disabled={rolling}>Throw</button>
    </>
  )
}
```

`useDiceRoll` decides nothing. It simulates the throw it is handed and resolves
when playback ends, which is what lets a room hand the same throw to six
browsers and have all six agree.

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
darkens whatever is behind it by 38%, so the lightness of `.race__table` decides
how strongly the dice read. The sunlit grass it carries sits around 82 luma, so
a shadow lands about 31 luma darker than the turf around it — roughly four times
what the near-black backdrop this theme replaced could give, and the one real
dividend of going light: the dice sit *on* the lawn rather than hovering in a
void. Going much darker is where they start to float again. See the note on
`.race__table` in [`race.css`](src/game/race.css). To drop shadows entirely,
remove the catcher block in `DiceTable.tsx` and set `shadowMap.enabled = false`.

The dice themselves are cream and sky ([`dice.ts`](src/engine/dice.ts)), and both
stay light on purpose: pips are near-black and a cross is red, so a dark die
body would swallow the marks the game is read from.

## Accessibility and interruption

- `prefers-reduced-motion: reduce` skips playback and shows the settled dice.
  Every ambient animation in the theme — the eyestalk bob, the active snail's
  hop, the winner's wiggle, the beckoning leaves, the throbbing win button —
  lives inside a `prefers-reduced-motion: no-preference` block, so the whole
  board goes still with it and nothing moves that wasn't asked for.
- The game announces the outcome through a `role="status"` region once the dice
  settle.
- Snails are `aria-hidden`: every one of them sits beside its seat's name in
  text, so announcing the SVG too would only say the name twice.
- An interrupted throw shows the outcome it was heading for and still reports the
  settle, so state and pixels never disagree and the tray can't get stuck.
- Pressing Throw mid-roll is ignored rather than restarting — that would let a
  player reroll for free.

## Verification

**Build and run:** `tsc --noEmit` passes clean under `strict`, `noUnusedLocals`
and `verbatimModuleSyntax`; `vite build` succeeds (812 kB JS, 225 kB gzipped —
mostly three.js, so the chunk-size warning is expected). The dev server runs and
the game plays: a throw logged "Turbo bids 72 on slot 6" while the dice on
screen showed exactly 2 and 7, which exercises the physics recording, the
relabelling, the pip placement and the turn logic together. A later turn had
Zippy roll a double 1, bank the step, and place `73` on slot 5 to knock Turbo's
`72` off slot 6 — eviction, the double bonus and the slime trail in one turn.

**Rooms** were driven against a real Durable Object under `wrangler dev`, both
from a script and from two browser tabs. A host created a room and a guest
joined by link; the guest was refused both a start ("Only the host can start.")
and a throw out of turn ("Not your turn."); the host's throw arrived at *both*
clients as the same `collected, threw` beats, so the guest replays the identical
dice; and closing the guest's tab left its seat reading `human, away` rather
than flipping it to AI.

Two bugs were found that way and are worth recording, because neither produced
an error:

- **A reconnect stranded the player reconnecting.** The returning socket says
  hello before the old socket's `close` arrives, so the late close wiped the
  identity the new one had just established — they showed as *away* seconds
  after coming back, with nothing to correct it until their next turn. A token
  is now only gone when it has no socket left. A refresh, a tab restore and a
  flaky network all hit this; React StrictMode just made it happen every time.
- **The animation queue emptied itself mid-turn.** `useDiceRoll` returned a
  fresh object each render, so the subscription effect resubscribed on every
  render and its cleanup dropped the queued beats. A race would simply stop, in
  silence. The tray is memoised and the subscription now depends on the
  transport alone.

The track geometry was measured rather than eyeballed: at 0/30 the snail sits
2px inside its lane's left border and at 30/30 2px inside the right, so the
`translateX(calc(var(--p) * -1%))` trick keeps it in the lane at both ends
without a hard-coded half-width to drift out of sync with the SVG.

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
