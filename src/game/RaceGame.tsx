import { useMemo, useState } from 'react'
import { DiceTable } from '../dice'
import { SLOTS, bidLabel, faceLabel } from './bidding'
import { DIE_COLORS } from './dice'
import type { Seat } from './seats'
import { Snail } from './Snail'
import { TRACK_LENGTH, useRaceGame } from './useRaceGame'
import { useAiTurns } from './useAiTurns'
import './race.css'

export type RaceGameProps = {
  roster: Seat[]
  onExit: () => void
}

export function RaceGame({ roster, onExit }: RaceGameProps) {
  const game = useRaceGame(roster)
  const aiThinking = useAiTurns(game)
  const [muted, setMuted] = useState(false)

  const { players, board, turn, pending, winner, log } = game
  const active = players[turn]
  const slots = useMemo(() => Array.from({ length: SLOTS }, (_, slot) => slot), [])
  // Known at render time, unlike `aiThinking`, which is state set inside the
  // AI effect and so lags `turn` by a commit — a gate on that state alone
  // leaves controls live for one painted frame after the turn hands over.
  const aiSeat = winner === null && active?.kind === 'ai'

  return (
    <div className="race">
      <header className="race__header">
        <h1 className="race__title">
          <Snail color="#ff5a4e" size={34} />
          Snail Dash
        </h1>
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
        {players.map((player, index) => {
          const progress = (player.position / TRACK_LENGTH) * 100
          const isTurn = turn === index && winner === null

          return (
            <div className="race__lane" key={player.name} role="listitem">
              <span className="race__lane-name" style={{ color: player.ink }}>
                {player.name}
                {player.kind === 'ai' && <span className="race__lane-tag">AI</span>}
              </span>
              <div className="race__lane-tiles">
                <div
                  className="race__lane-fill"
                  style={{ width: `${progress}%`, background: player.color }}
                />
                <div
                  className={[
                    'race__racer',
                    isTurn && 'race__racer--active',
                    winner === index && 'race__racer--won',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  // `--p` drives the transform that keeps the snail inside the
                  // lane at both ends; see `.race__racer` in race.css.
                  style={{ left: `${progress}%`, ['--p' as string]: progress }}
                >
                  <Snail color={player.color} size={26} racing />
                </div>
              </div>
              <span className="race__lane-score">
                {player.position}/{TRACK_LENGTH}
              </span>
            </div>
          )
        })}
      </div>

      <div className="race__bids">
        <h2 className="race__bids-title">
          {pending
            ? `${active.name} threw ${pending.faces.map(faceLabel).join(' and ')} — park ${bidLabel(pending.value)} on a leaf`
            : 'Bidding leaves — a leaf pays its own number in steps'}
        </h2>
        <div className="race__bids-row">
          {slots.map((slot) => {
            const bid = board[slot]
            const selectable = pending?.legal.includes(slot) ?? false
            const owner = bid ? players[bid.player] : null

            return (
              <button
                key={slot}
                className={`race__slot${owner ? ' race__slot--taken' : ''}`}
                onClick={() => game.place(slot)}
                disabled={!selectable || aiSeat}
                aria-label={
                  bid
                    ? `Slot ${slot}, ${players[bid.player].name} bidding ${bidLabel(bid.value)}`
                    : `Slot ${slot}, empty`
                }
                style={{
                  borderColor: owner ? owner.ink : undefined,
                  background: owner ? `${owner.color}33` : undefined,
                  boxShadow: owner ? `0 3px 0 ${owner.ink}` : undefined,
                }}
              >
                <span className="race__slot-steps">{slot}</span>
                <span className="race__slot-bid" style={{ color: owner?.ink }}>
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
            <button className="race__roll race__roll--win" onClick={game.reset}>
              {players[winner].name} wins the dash — race again
            </button>
            <button className="race__roll race__roll--quiet" onClick={onExit}>
              Back to lobby
            </button>
          </>
        ) : pending ? (
          // No "give up the throw" control: every empty slot is legal and there
          // are more slots than seats, so a thrower always has a slot to take
          // and giving up is never the better move. `pass` survives in the hook
          // for the AI's reroll cap, which can still end a turn with nothing.
          <button className="race__roll" onClick={game.reroll} disabled={game.rolling || aiSeat}>
            {game.rolling ? 'Rolling…' : 'Reroll — a cross busts you'}
          </button>
        ) : (
          <button
            className="race__roll"
            onClick={game.startTurn}
            disabled={game.rolling || aiSeat}
          >
            {game.rolling
              ? 'Rolling…'
              : aiThinking
                ? `${active.name} is thinking…`
                : `Throw for ${active.name}`}
          </button>
        )}
      </div>

      {/* Screen readers get the result announced once the dice have settled — for
          an AI seat, the thinking state is prepended rather than replacing the
          log, so a bid, eviction, bust or double is still announced during its
          turn instead of only "thinking" for the whole thing. */}
      <p className="race__status" role="status">
        {game.rolling
          ? 'Rolling the dice.'
          : aiThinking
            ? `${active.name} is thinking… ${log[0]}`
            : log[0]}
      </p>

      <ul className="race__log">
        {log.slice(1).map((entry, index) => (
          <li key={index}>{entry}</li>
        ))}
      </ul>
    </div>
  )
}
