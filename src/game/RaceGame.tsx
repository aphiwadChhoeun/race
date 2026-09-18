import { useMemo, useState } from 'react'
import { DiceTable } from '../dice'
import { SLOTS, bidLabel, faceLabel } from './bidding'
import { DIE_COLORS } from './dice'
import type { Seat } from './seats'
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
                disabled={!selectable || aiSeat}
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
            <button
              className="race__roll"
              onClick={game.reroll}
              disabled={game.rolling || aiSeat}
            >
              {game.rolling ? 'Rolling…' : 'Reroll (a cross busts)'}
            </button>
            {pending.legal.length === 0 && (
              <button
                className="race__roll race__roll--quiet"
                onClick={game.pass}
                disabled={game.rolling || aiSeat}
              >
                Give up the throw
              </button>
            )}
          </>
        ) : (
          <button
            className="race__roll"
            onClick={game.startTurn}
            disabled={game.rolling || aiSeat}
          >
            {game.rolling ? 'Rolling…' : aiThinking ? `${active.name} is thinking…` : `Throw for ${active.name}`}
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
