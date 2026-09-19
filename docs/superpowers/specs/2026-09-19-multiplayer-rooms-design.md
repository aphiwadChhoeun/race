# Multiplayer rooms, shared by code or link

Snail Dash is a single browser tab. Every seat that is not you is an AI, and
the rules, the dice and the turn order all live in `useRaceGame`, a React hook.
This adds **rooms**: a host creates one, shares a four-letter code or a link,
and friends take the seats. Unclaimed seats stay AI.

The game itself does not change — same board, same dice, same rules. What
changes is where the rules run and who is allowed to make a move.

## The shape of the change

Three facts about the existing code decide most of the design.

**The dice are already replayable.** `throwDice(dice, seed)` simulates a throw
to completion and records the motion. The trajectory comes from a seeded
mulberry32 PRNG, so the same seed produces the same tumble frame-for-frame —
`random.ts` says so in as many words, and names a networked opponent's throw as
the reason. The one gap: the *faces* are drawn from the CSPRNG inside
`throwDice`, so a seed alone does not reproduce a throw.

That gap is one line wide. `faceIds` is drawn at the top of `throwDice` and
then used only to *dress* the die — `labelingWith` picks which face id sits on
each axis so the chosen face rests upward. The physics never reads it. So:

```ts
export function throwDice(
  dice: readonly DieFaces[],
  seed: number,
  faceIds: number[] = rollFaces(dice.length),
): Recording
```

and `{ seed, faceIds }` is a complete, portable description of a throw.

**The server therefore never runs physics.** It draws fair faces and a seed;
each client simulates locally and sees an identical tumble. `cannon-es` and
`three` stay in the browser bundle, out of the Worker entirely.

**The rules are already pure.** `bidding.ts`, `ai.ts`, `seats.ts` and
`dice/faces.ts` import nothing but each other — no DOM, no React, no physics.
They run in a Worker unchanged. What is *not* pure is the turn flow, which is
tangled into `useRaceGame`'s `useState` calls and its `live` ref mirror. That
has to come out.

## Who decides what

The room is **server-authoritative**. A Durable Object holds the one true
`GameState`, draws the dice, validates every intent and rejects anything
illegal. Nobody can rig a roll from devtools, and no single player leaving can
take the game down with them.

Clients receive **snapshots, not rules**. Each broadcast is
`{ event, state }`: the event says what just happened and carries anything
needed to animate it, the state is the whole authoritative game state
afterwards. A snapshot is a few hundred bytes — smaller than the machinery
that would be needed to avoid sending one.

The alternative, lockstep replay, sends only the action and lets each client
re-derive the state from its own copy of the engine. It saves perhaps 200 bytes
a message and costs a permanent obligation: two engines that must stay
bit-identical forever, where any divergence is a silent desync that nothing
corrects. Not a trade worth making at this size.

Because the client carries no rules, drift is not a bug to be handled. It is
unrepresentable.

## The engine

The rules and the turn flow move into a pure module, shared verbatim by the
browser and the Worker.

```
src/engine/
  bidding.ts    moved from src/game/, imports retargeted
  seats.ts      moved from src/game/, unchanged
  ai.ts         moved from src/game/, unchanged
  dice.ts       moved from src/game/ — RACE_DICE, which faces exist
  state.ts      GameState, Event, Intent
  engine.ts     apply(state, intent) -> { state, events }
  room.ts       Room: seats, join/leave/start, drives AI turns
  codes.ts      room-code generation
  protocol.ts   client <-> server messages
```

`dice/faces.ts` does **not** move. It is dice-domain, five files import it, and
the engine can simply reach for it.

### The barrel is off limits to the engine

`src/dice/index.ts` re-exports `DiceTable` (React, three) and `physics`
(cannon-es). `bidding.ts` currently reaches `Face` through it —
`import type { Face } from '../dice'` — and `game/dice.ts` reaches `DieFaces`
the same way. Both are type-only, so both erase at compile time and nothing is
wrong today. But one careless value import through that barrel would pull
three and cannon-es into the Worker bundle, and the failure would be a fat
deploy rather than an error.

So: **engine modules import `../dice/faces` directly and never `../dice`.**
The two existing imports are retargeted as the files move, and a guard test
asserts no file under `src/engine/` imports the barrel. It is a grep, it costs
nothing, and it catches the one mistake that is easy to make here.

`DIE_COLORS` stays behind with the renderer when `game/dice.ts` moves — which
face a die carries is a rule, what colour it is painted is not.

`engine.ts` is the turn flow lifted out of `useRaceGame` and made a function.
It is total and synchronous: no promises, no animation, no React. Where the
hook today writes state through `writeBoard` and narrates through `say`, the
engine returns a new state and a list of events.

`room.ts` sits above it and owns everything the engine does not: who is sitting
where, whether the race has started, and playing AI seats when their turn comes
round. It is transport-free — it takes intents and returns events, and knows
nothing about sockets.

That transport-freedom is the point. **The entire multiplayer brain is testable
under plain vitest**, exactly as `bidding.test.ts` and `ai.test.ts` already
are. No Workers test runner, no new test infrastructure, no mocking a socket to
find out whether an eviction fired.

### State and events

```ts
type GameState = {
  players: Player[]        // seat, position, kind, away
  board: Board
  turn: number
  pending: Pending | null
  winner: number | null
  log: string[]
}

type Event =
  | { kind: 'threw'; seat: number; seed: number; faceIds: number[] }
  | { kind: 'moved'; seat: number; to: number; reason: 'double' | 'slot' }
  | { kind: 'bid'; seat: number; slot: number; value: number }
  | { kind: 'evicted'; seat: number; slot: number; value: number }
  | { kind: 'busted'; seat: number }
  | { kind: 'won'; seat: number }
  | { kind: 'seated'; seat: number; name: string }
  | { kind: 'away'; seat: number }
  | { kind: 'started' }
```

`threw` is the only event a client must *wait* on: it carries the seed and
faces, and the client plays the recording before adopting the state that
follows.

### Intents

`join`, `rename`, `start`, `throw`, `reroll`, `place`. The last three are the
same vocabulary `useRaceGame` already exposes as `startTurn`, `reroll` and
`place`, so the mapping is direct.

`pass` does not become an intent. It exists today only so `useAiTurns` can
close out a turn that hit its reroll cap, and that cap now lives server-side
inside `room.ts`, where it resolves the turn directly.

Every intent is checked against the state *and* the sender's seat. A player
who sends `place` on someone else's turn, or on an illegal slot, gets an error
and no state change. The server assumes the client is hostile; the UI simply
never puts a player in a position to send one of these.

## Rooms

### Codes and links

Four characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` — `I`, `L`, `O`, `0`
and `1` are left out because they are the characters people mishear when a code
is read aloud, which is the whole use case. That is 31^4 ≈ 924,000
combinations, drawn from the CSPRNG.

A code is not registered anywhere. `idFromName(code)` maps it to a Durable
Object, so the room *is* its name: no registry, no cleanup of a list of rooms,
no way for the list and the rooms to disagree.

The link is `https://<host>/r/ABCD`. Joining by link and typing the code into a
box reach the same screen by the same path — the link only pre-fills the box.

A code collides only if two rooms are live at once and both drew the same four
characters. A host connecting with `create` to an object that already has
players is refused, and the client silently draws another code and tries
again — so a collision costs a round-trip, not an error message.

### Seats and identity

On joining you claim the lowest free seat and take that snail's palette entry.
You may rename yourself; the snail's own name is the default, so doing nothing
is fine.

The browser keeps a `playerToken` in `sessionStorage`, and presenting it on
connect reclaims the same seat. This is what makes a refresh survivable without
the room needing to be durable in any deeper sense.

The host is whoever created the room and holds the only **Start the dash**
button. Table size is 3–6, as today. Every seat unclaimed when the race starts
becomes AI — so two friends and one AI is a legal race, and the host is never
asked to think about `MIN_SEATS`.

Once started, the room is closed to new players. A race with a snail that
appears at turn nine is not a race anyone asked for, and the alternative —
seating a latecomer into an AI's seat mid-game — hands them a position they did
not earn.

### Going away

When a socket closes, the seat is marked `away`. It is **not** switched to AI
there and then. The AI plays it only when that seat's turn actually comes
round and the player is still gone.

A ten-second wifi blip between your turns therefore costs you nothing, and
reconnecting puts you straight back in your snail. The behaviour at the moment
it matters is the one we want — the race never stalls on a dead laptop — and
everywhere else it is simply kinder. It needs no timers to do this.

A reconnecting client is sent the current snapshot with no backlog, and jumps
to the present rather than replaying what it missed.

### AI turns

When an AI seat's turn comes up, the Durable Object resolves the **whole turn
immediately** — throw, rerolls, placement — and broadcasts the events as a
burst. It does not sleep between steps.

This is possible because clients already need an animation queue, and the queue
paces the burst on playback exactly as `AI_PAUSE_MS` paces it today. Resolving
server-side instead costs no alarms, no hibernation wakeups and no billed
timers. Several AI seats in a row arrive as one burst and play out in order.

`MAX_AI_REROLLS` moves into `room.ts` unchanged, and the cap resolves the turn
with no bid, which is what `pass` did.

## The client

### The animation queue

`src/net/useRoom.ts` owns the socket and a queue of `{ event, state }` pairs.
A drain loop takes them one at a time:

- a `threw` event calls `throwDice(RACE_DICE, seed, faceIds)` and awaits
  playback, then adopts the state;
- everything else adopts the state after a readable beat — 700ms, the current
  `AI_PAUSE_MS`, for events generated by an AI or a remote seat, and none at
  all for your own moves, which need no pacing because you made them.

Two rules fall out of this and both matter:

**Controls are gated on an empty queue, not just on whose turn it is.** The
server may be several events ahead of what you are watching. `myTurn && queue
is empty` is the condition for enabling a button; anything less lets you act on
a board you have not been shown yet.

**The queue is the only writer of view state.** Nothing else sets the board or
the positions, so what is on screen is always some snapshot the server actually
sent, never a local guess.

### Solo mode

Solo runs the **same `Room` object** through a local transport that calls it
directly instead of over a socket. One turn-driving path serves both modes, so
playing solo exercises the multiplayer engine.

`useAiTurns` is deleted. Its job — pacing an AI turn so a human can read it —
is what the animation queue does, and doing it in two places is how the two
paths would drift apart. `useRaceGame` becomes a thin wrapper over the local
transport.

Solo therefore stays fully offline and costs no network round-trip.

### Screens

`App.tsx` grows a small router over `location.pathname`:

- `/` — the existing lobby, plus **Play with friends**
- `/r/ABCD` — the room lobby, or a join prompt

The room lobby shows the code large, a **Copy link** button, the seats filling
up as people arrive, and the host's start button. It reuses `lobby.css`.

`RaceGame` gains one idea: `mySeat`. The existing `aiSeat` gate on the controls
becomes `turn !== mySeat || queue not empty`, and each lane shows whose snail is
whose.

## Hosting

One Worker serves everything.

```
worker/
  index.ts      static assets on /*, WebSocket upgrade on /api/room/:code
  RaceRoom.ts   Durable Object — a transport adapter over room.ts
wrangler.toml
```

`RaceRoom.ts` holds no rules. It accepts sockets, hands messages to `room.ts`,
broadcasts what comes back, and persists state to `ctx.storage` after each
mutation so hibernation is safe to use.

Static assets are configured with SPA fallback so `/r/ABCD` resolves to the
app.

### Cost

The target is zero, and the free plan reaches it comfortably:

| | Workers Free |
| --- | --- |
| Worker requests | 100,000 / day |
| Durable Object requests | 100,000 / day |
| Durable Object duration | 13,000 GB-s / day |
| Static asset requests | free, unlimited, not counted |

Three decisions keep it there:

- **WebSockets, not polling.** Messages on an open socket are not billed
  per-message, and outgoing messages and protocol pings are not billed at all.
  Polling at 1 Hz would burn ~86,000 requests a day for a *single* player.
- **Hibernation.** State persists to storage on each mutation, so the object
  may hibernate. An idle room bills no duration, even before the runtime has
  actually hibernated it.
- **No alarms for AI.** Resolving AI turns in a burst means no timer wakeups,
  each of which would be a billed request.

A full race is on the order of a few hundred requests. An alarm reaps a room
after two hours idle, which is the only timer in the system.

### Deploying

`wrangler.toml` declares the Durable Object binding, its migration, and the
static assets directory. `wrangler dev` runs real Durable Objects locally, so
the room is testable end to end without deploying. `wrangler deploy` ships it.
The README gains a section with both commands.

## Testing

The existing tests continue to pass unchanged — the pure modules move, they do
not change.

New tests, all plain vitest against pure functions:

- **`engine.test.ts`** — a turn's flow: collecting a standing bid, the double
  bonus banking before a later bust, busting on a reroll but not an opener,
  eviction, and reaching the track length.
- **`room.test.ts`** — joining, the seat cap, rejecting a join after start,
  unclaimed seats becoming AI, an away seat's turn being played by the AI and
  the seat being reclaimed on return, and intents from the wrong seat being
  rejected.
- **`codes.test.ts`** — the alphabet excludes the ambiguous characters.
- **`purity.test.ts`** — no file under `src/engine/` imports the `../dice`
  barrel, so the Worker bundle can never acquire three or cannon-es.
- **`physics.test.ts`** — extended: a given `faceIds` produces those faces, and
  the same `{ seed, faceIds }` produces an identical track.

The Durable Object itself is a thin adapter and is covered by running the game
under `wrangler dev`, not by unit tests.

## Not doing

- **Spectators.** No one has asked to watch.
- **Chat.** The log is the shared narration; a chat box is a different feature
  with its own moderation questions.
- **Persistent rooms or rejoining tomorrow.** Rooms are disposable by design;
  this is what keeps storage out of the cost model.
- **Reconnect backlog replay.** A returning player jumps to the present. The
  log tells them what they missed.
