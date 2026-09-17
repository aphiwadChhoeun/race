import { useCallback, useMemo, useState } from 'react'
import { DiceTable, useDiceRoll } from '../dice'
import { SLOTS, bidValue, collectBid, emptyBoard, legalSlots, placeBid, type Board } from './bidding'
import './race.css'

const TRACK_LENGTH = 30

type Player = {
  name: string
  position: number
  color: string
}

const INITIAL_PLAYERS: Player[] = [
  { name: 'Red', position: 0, color: '#e2574c' },
  { name: 'Blue', position: 0, color: '#4c7fe2' },
]

/** The dice have landed and the thrower owes the board a placement. */
type Pending = {
  value: number
  faces: number[]
  legal: number[]
}

export function RaceGame() {
  const [players, setPlayers] = useState<Player[]>(INITIAL_PLAYERS)
  const [board, setBoard] = useState<Board>(emptyBoard)
  const [turn, setTurn] = useState(0)
  const [pending, setPending] = useState<Pending | null>(null)
  const [winner, setWinner] = useState<number | null>(null)
  const [log, setLog] = useState<string[]>(['Red to throw.'])
  const [muted, setMuted] = useState(false)

  const { recording, playId, rolling, roll, settle } = useDiceRoll(2)

  const say = useCallback((...lines: string[]) => {
    setLog((previous) => [...lines, ...previous].slice(0, 6))
  }, [])

  const takeTurn = useCallback(async () => {
    if (winner !== null || pending !== null) return

    const current = turn
    const mover = players[current].name

    // A bid that survived until its owner's turn pays out: the slot it sits on
    // is how far they move, and it leaves the track either way.
    const collected = collectBid(board, current)
    setBoard(collected.board)

    if (collected.slot !== null) {
      const position = Math.min(TRACK_LENGTH, players[current].position + collected.slot)
      setPlayers((previous) =>
        previous.map((player, index) => (index === current ? { ...player, position } : player)),
      )

      if (position >= TRACK_LENGTH) {
        setWinner(current)
        say(`${mover} won slot ${collected.slot} and reaches ${TRACK_LENGTH} — ${mover} wins!`)
        return
      }

      say(`${mover} won slot ${collected.slot} and moves to ${position}.`)
    } else {
      say(`${mover} had no bid standing.`)
    }

    const faces = await roll()
    const value = bidValue(faces)
    const legal = legalSlots(collected.board, value)

    if (legal.length === 0) {
      say(`${mover} threw ${value} with nowhere legal to put it — bid lost.`)
      setTurn((current + 1) % players.length)
      return
    }

    setPending({ value, faces, legal })
  }, [board, pending, players, roll, say, turn, winner])

  const choose = useCallback(
    (slot: number) => {
      if (!pending || !pending.legal.includes(slot)) return

      const current = turn
      const mover = players[current].name
      const { board: next, evicted } = placeBid(board, slot, pending.value, current)

      setBoard(next)
      setPending(null)
      setTurn((current + 1) % players.length)
      say(
        ...evicted.map(
          (bid) => `${players[bid.player].name}'s ${bid.value} on ${bid.slot} is knocked off.`,
        ),
        `${mover} bids ${pending.value} on slot ${slot}.`,
      )
    },
    [board, pending, players, say, turn],
  )

  const reset = () => {
    setPlayers(INITIAL_PLAYERS)
    setBoard(emptyBoard())
    setTurn(0)
    setPending(null)
    setWinner(null)
    setLog(['Red to throw.'])
  }

  const active = players[turn]
  const slots = useMemo(() => Array.from({ length: SLOTS }, (_, slot) => slot), [])

  return (
    <div className="race">
      <header className="race__header">
        <h1>Race</h1>
        <label className="race__toggle">
          <input type="checkbox" checked={!muted} onChange={(e) => setMuted(!e.target.checked)} />
          Sound
        </label>
      </header>

      <div className="race__track" role="list" aria-label="Race track">
        {players.map((player, index) => (
          <div className="race__lane" key={player.name} role="listitem">
            <span className="race__lane-name" style={{ color: player.color }}>
              {player.name}
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
            ? `${active.name} threw ${pending.faces.join(' and ')} — place ${pending.value}`
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
                onClick={() => choose(slot)}
                disabled={!selectable}
                aria-label={
                  bid
                    ? `Slot ${slot}, ${players[bid.player].name} bidding ${bid.value}`
                    : `Slot ${slot}, empty`
                }
                style={{
                  borderColor: owner ? owner.color : undefined,
                  background: owner ? `${owner.color}22` : undefined,
                }}
              >
                <span className="race__slot-steps">{slot}</span>
                <span className="race__slot-bid" style={{ color: owner?.color }}>
                  {bid ? bid.value : selectable ? '+' : '—'}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="race__table">
        <DiceTable
          recording={recording}
          playId={playId}
          volume={muted ? 0 : 0.45}
          onSettle={settle}
        />
      </div>

      <div className="race__controls">
        {winner !== null ? (
          <button className="race__roll" onClick={reset}>
            {players[winner].name} wins — play again
          </button>
        ) : (
          <button className="race__roll" onClick={takeTurn} disabled={rolling || pending !== null}>
            {rolling ? 'Rolling…' : pending ? `${active.name}: pick a slot` : `Throw for ${active.name}`}
          </button>
        )}
      </div>

      {/* Screen readers get the result announced once the dice have settled. */}
      <p className="race__status" role="status">
        {rolling ? 'Rolling the dice.' : log[0]}
      </p>

      <ul className="race__log">
        {log.slice(1).map((entry, index) => (
          <li key={index}>{entry}</li>
        ))}
      </ul>
    </div>
  )
}
