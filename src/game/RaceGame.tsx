import { useCallback, useState } from 'react'
import { DiceTable, useDiceRoll } from '../dice'
import './race.css'

const TRACK_LENGTH = 40

type Player = {
  name: string
  position: number
  color: string
}

const INITIAL_PLAYERS: Player[] = [
  { name: 'Red', position: 0, color: '#e2574c' },
  { name: 'Blue', position: 0, color: '#4c7fe2' },
]

export function RaceGame() {
  const [players, setPlayers] = useState<Player[]>(INITIAL_PLAYERS)
  const [turn, setTurn] = useState(0)
  const [winner, setWinner] = useState<number | null>(null)
  const [log, setLog] = useState<string[]>(['Red to throw.'])
  const [muted, setMuted] = useState(false)

  const { recording, playId, rolling, roll, settle } = useDiceRoll(2)

  const takeTurn = useCallback(async () => {
    if (winner !== null) return

    // `roll()` decides the outcome now and resolves when the dice stop moving,
    // so the turn reads top-to-bottom even though it waits on an animation.
    const faces = await roll()
    const steps = faces.reduce((sum, face) => sum + face, 0)
    const doubles = faces.length === 2 && faces[0] === faces[1]
    const current = turn
    const mover = players[current].name
    const position = Math.min(TRACK_LENGTH, players[current].position + steps)

    setPlayers((previous) =>
      previous.map((player, index) => (index === current ? { ...player, position } : player)),
    )

    if (position >= TRACK_LENGTH) {
      setWinner(current)
      setLog((previous) => [`${mover} threw ${steps} and wins!`, ...previous].slice(0, 6))
      return
    }

    setLog((previous) =>
      [
        doubles
          ? `${mover} threw double ${faces[0]} — ${steps} steps and another throw.`
          : `${mover} threw ${faces.join(' + ')} = ${steps}.`,
        ...previous,
      ].slice(0, 6),
    )

    if (!doubles) setTurn((current + 1) % players.length)
  }, [players, roll, turn, winner])

  const reset = () => {
    setPlayers(INITIAL_PLAYERS)
    setTurn(0)
    setWinner(null)
    setLog(['Red to throw.'])
  }

  const active = players[turn]

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

      <div className="race__table">
        <DiceTable
          recording={recording}
          playId={playId}
          volume={muted ? 0 : 0.45}
          onSettle={settle}
        />
      </div>

      <div className="race__controls">
        {winner === null ? (
          <button className="race__roll" onClick={takeTurn} disabled={rolling}>
            {rolling ? 'Rolling…' : `Throw for ${active.name}`}
          </button>
        ) : (
          <button className="race__roll" onClick={reset}>
            {players[winner].name} wins — play again
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
