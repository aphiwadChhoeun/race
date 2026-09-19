import { useState } from 'react'
import { MAX_SEATS, MIN_SEATS, defaultRoster, type Seat, type SeatKind } from './seats'
import { Snail } from './Snail'
import './lobby.css'

export type LobbyProps = {
  onStart: (roster: Seat[]) => void
}

const COUNTS = Array.from({ length: MAX_SEATS - MIN_SEATS + 1 }, (_, i) => MIN_SEATS + i)

export function Lobby({ onStart }: LobbyProps) {
  const [roster, setRoster] = useState<Seat[]>(() => defaultRoster(MIN_SEATS))

  /** Resizing keeps the kinds already chosen for the seats that survive. */
  const resize = (count: number) => {
    setRoster((previous) =>
      defaultRoster(count).map((seat, index) => ({
        ...seat,
        kind: previous[index]?.kind ?? seat.kind,
      })),
    )
  }

  const setKind = (index: number, kind: SeatKind) => {
    setRoster((previous) =>
      previous.map((seat, i) => (i === index ? { ...seat, kind } : seat)),
    )
  }

  return (
    <div className="lobby">
      <h1 className="lobby__title">
        <Snail color="#ff5a4e" size={44} racing />
        Snail Dash
      </h1>
      <p className="lobby__blurb">
        Six snails, seven leaves, one lawn. Park your bid on a leaf and it pays that many steps —
        unless somebody undercuts you first and knocks you clean off it.
      </p>

      <div className="lobby__section">
        <h2 className="lobby__label" id="lobby-count">
          How many snails?
        </h2>
        <div className="lobby__counts" role="group" aria-labelledby="lobby-count">
          {COUNTS.map((count) => (
            <button
              key={count}
              className="lobby__count"
              aria-pressed={roster.length === count}
              onClick={() => resize(count)}
            >
              {count}
            </button>
          ))}
        </div>
      </div>

      <div className="lobby__section">
        <h2 className="lobby__label">The starting line</h2>
        <ul className="lobby__seats">
          {roster.map((seat, index) => (
            <li className="lobby__seat" key={seat.name}>
              <Snail color={seat.color} size={30} />
              <span className="lobby__name" style={{ color: seat.ink }}>
                {seat.name}
              </span>
              <div className="lobby__kinds" role="group" aria-label={`${seat.name} is played by`}>
                <button
                  className="lobby__kind"
                  aria-pressed={seat.kind === 'human'}
                  onClick={() => setKind(index, 'human')}
                >
                  You
                </button>
                <button
                  className="lobby__kind"
                  aria-pressed={seat.kind === 'ai'}
                  onClick={() => setKind(index, 'ai')}
                >
                  AI
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <button className="lobby__start" onClick={() => onStart(roster)}>
        Start the dash
      </button>
    </div>
  )
}
