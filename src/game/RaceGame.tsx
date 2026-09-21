import { useMemo, useState } from 'react'
import { DiceTable } from '../dice'
import { SLOTS, bidLabel, faceLabel } from '../engine/bidding'
import { TRACK_LENGTH } from '../engine/state'
import type { RoomClient } from '../net/useRoom'
import { ConfirmDialog } from './ConfirmDialog'
import { DIE_COLORS } from './dice'
import { Snail } from './Snail'
import './race.css'

export type RaceGameProps = {
  client: RoomClient
  /** Starts another race with the same field, or null when that is not on offer. */
  onAgain: (() => void) | null
  onExit: () => void
  exitLabel: string
}

/** What the big button says while it is not yours to press. */
function buttonLabel(rolling: boolean, waiting: boolean, active: string, ready: string) {
  if (rolling) return 'Rolling…'
  if (waiting) return `${active} is racing…`
  return ready
}

export function RaceGame({ client, onAgain, onExit, exitLabel }: RaceGameProps) {
  const { game, mySeats, busy, tray } = client
  const [muted, setMuted] = useState(false)
  const [confirmingExit, setConfirmingExit] = useState(false)
  const slots = useMemo(() => Array.from({ length: SLOTS }, (_, slot) => slot), [])

  if (!game) {
    return (
      <div className="race">
        <p className="race__status" role="status">
          Lining the snails up…
        </p>
      </div>
    )
  }

  const { players, board, turn, pending, winner, log } = game
  const active = players[turn]
  const mine = mySeats.includes(turn)

  // Gated on `busy`, not merely on whose turn it is. The room resolves a turn
  // the moment it is asked — an AI's whole turn arrives as one burst — so it
  // runs ahead of the animation, and a gate on the turn alone would leave
  // these live for a board the player has not been shown happening yet.
  const canAct = winner === null && mine && !busy && !tray.rolling
  const waiting = busy || !mine

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
          <button
            className="race__exit"
            onClick={() => (winner === null ? setConfirmingExit(true) : onExit())}
          >
            {exitLabel}
          </button>
        </div>
      </header>

      {confirmingExit && (
        <ConfirmDialog
          message="Leave this race? Your progress won't be saved."
          confirmLabel="Leave"
          cancelLabel="Keep racing"
          onConfirm={onExit}
          onCancel={() => setConfirmingExit(false)}
        />
      )}

      <div className="race__track" role="list" aria-label="Race track">
        {players.map((player, index) => {
          const progress = (player.position / TRACK_LENGTH) * 100
          const isTurn = turn === index && winner === null

          return (
            <div className="race__lane" key={index} role="listitem">
              <span className="race__lane-name" style={{ color: player.ink }}>
                {player.name}
                {mySeats.includes(index) ? (
                  <span className="race__lane-tag">you</span>
                ) : player.away ? (
                  <span className="race__lane-tag">away</span>
                ) : player.kind === 'ai' ? (
                  <span className="race__lane-tag">AI</span>
                ) : null}
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
                onClick={() => client.send({ type: 'place', slot })}
                disabled={!selectable || !canAct}
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
          recording={tray.recording}
          playId={tray.playId}
          volume={muted ? 0 : 0.45}
          onSettle={tray.settle}
          dieColors={DIE_COLORS}
        />
      </div>

      <div className="race__controls">
        {winner !== null ? (
          <>
            {onAgain && (
              <button className="race__roll race__roll--win" onClick={onAgain}>
                {players[winner].name} wins the dash — race again
              </button>
            )}
            <button className="race__roll race__roll--quiet" onClick={onExit}>
              {onAgain ? exitLabel : `${players[winner].name} wins the dash — ${exitLabel}`}
            </button>
          </>
        ) : pending ? (
          // No "give up the throw" control: every empty slot is legal and there
          // are more slots than seats, so a thrower always has a slot to take
          // and giving up is never the better move. The engine keeps `pass` for
          // the AI's reroll cap, which can still end a turn with nothing.
          <button
            className="race__roll"
            onClick={() => client.send({ type: 'reroll' })}
            disabled={!canAct}
          >
            {buttonLabel(tray.rolling, waiting, active.name, 'Reroll — a cross busts you')}
          </button>
        ) : (
          <button
            className="race__roll"
            onClick={() => client.send({ type: 'throw' })}
            disabled={!canAct}
          >
            {buttonLabel(tray.rolling, waiting, active.name, `Throw for ${active.name}`)}
          </button>
        )}
      </div>

      {/* Screen readers get the result announced once the dice have settled.
          The log advances one beat at a time as the queue drains, so a bid,
          eviction, bust or double is announced as it is shown rather than a
          whole AI turn arriving at once. */}
      <p className="race__status" role="status">
        {tray.rolling ? 'Rolling the dice.' : log[0]}
      </p>

      <ul className="race__log">
        {log.slice(1).map((entry, index) => (
          <li key={index}>{entry}</li>
        ))}
      </ul>
    </div>
  )
}
