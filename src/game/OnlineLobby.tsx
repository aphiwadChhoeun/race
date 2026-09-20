import { useEffect, useState } from 'react'
import { MAX_SEATS, MIN_SEATS } from '../engine/seats'
import { linkTo } from '../net/route'
import { socketTransport, type Transport } from '../net/transport'
import { useRoom } from '../net/useRoom'
import { RaceGame } from './RaceGame'
import { Snail } from './Snail'
import './lobby.css'

export type OnlineLobbyProps = {
  code: string
  /** True when this browser made the room, rather than following a link. */
  host: boolean
  /** Seats the host asked for. Ignored when joining. */
  size: number
  onLeave: () => void
}

const COUNTS = Array.from({ length: MAX_SEATS - MIN_SEATS + 1 }, (_, i) => MIN_SEATS + i)

export function OnlineLobby({ code, host, size, onLeave }: OnlineLobbyProps) {
  // The socket is built inside the effect rather than in a memo so that
  // teardown and setup stay symmetric. A memo would hand the same object back
  // after StrictMode's extra unmount had already closed it, and the room would
  // open on a socket that was never coming back.
  const [transport, setTransport] = useState<Transport | null>(null)

  useEffect(() => {
    const socket = socketTransport(code, host, size)
    setTransport(socket)
    return () => socket.close()
  }, [code, host, size])

  const client = useRoom(transport)
  const { room, game, mySeats, error } = client
  const [copied, setCopied] = useState(false)

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(linkTo(code))
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard refused (insecure origin, or the user said no). The code is
      // on screen in big letters, which is the fallback.
    }
  }

  if (error && !room) {
    return (
      <div className="lobby">
        <h1 className="lobby__title">
          <Snail color="#ff5a4e" size={44} />
          Snail Dash
        </h1>
        <p className="lobby__blurb">{error}</p>
        <button className="lobby__start" onClick={onLeave}>
          Back to the lawn
        </button>
      </div>
    )
  }

  if (!room) {
    return (
      <div className="lobby">
        <p className="lobby__blurb">Finding the lawn…</p>
      </div>
    )
  }

  if (room.phase === 'racing' && game) {
    return (
      <RaceGame
        client={client}
        // Only the host could start this one, and a rematch is a new room.
        onAgain={null}
        onExit={onLeave}
        exitLabel="Leave the race"
      />
    )
  }

  const iAmHost = mySeats.includes(room.host)
  const waiting = room.seats.filter((seat) => seat.kind === 'ai').length

  return (
    <div className="lobby">
      <h1 className="lobby__title">
        <Snail color="#ff5a4e" size={44} racing />
        Snail Dash
      </h1>

      <div className="lobby__section">
        <h2 className="lobby__label">Share this code</h2>
        <p className="lobby__code">{code}</p>
        <button className="lobby__copy" onClick={copyLink}>
          {copied ? 'Link copied' : 'Copy the link'}
        </button>
      </div>

      {iAmHost && (
        <div className="lobby__section">
          <h2 className="lobby__label" id="lobby-count">
            How many snails?
          </h2>
          <div className="lobby__counts" role="group" aria-labelledby="lobby-count">
            {COUNTS.map((count) => (
              <button
                key={count}
                className="lobby__count"
                aria-pressed={room.seats.length === count}
                onClick={() => client.send({ type: 'resize', size: count })}
              >
                {count}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="lobby__section">
        <h2 className="lobby__label">The starting line</h2>
        <ul className="lobby__seats">
          {room.seats.map((seat, index) => (
            <li className="lobby__seat" key={index}>
              <Snail color={seat.color} size={30} />
              <span className="lobby__name" style={{ color: seat.ink }}>
                {seat.name}
              </span>
              <span className="lobby__who">
                {mySeats.includes(index)
                  ? 'you'
                  : seat.kind === 'human'
                    ? seat.away
                      ? 'away'
                      : 'ready'
                    : 'waiting — AI at the off'}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {error && <p className="lobby__blurb">{error}</p>}

      {iAmHost ? (
        <button className="lobby__start" onClick={() => client.send({ type: 'start' })}>
          {waiting > 0
            ? `Start the dash — ${waiting} ${waiting === 1 ? 'snail' : 'snails'} played by AI`
            : 'Start the dash'}
        </button>
      ) : (
        <p className="lobby__blurb">Waiting for the host to start the dash…</p>
      )}

      <button className="lobby__leave" onClick={onLeave}>
        Back to the lawn
      </button>
    </div>
  )
}
