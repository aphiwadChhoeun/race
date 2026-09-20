import { useCallback, useEffect, useRef, useState } from 'react'
import { useDiceRoll, type DiceTray } from '../dice'
import { RACE_DICE } from '../engine/dice'
import type { ClientMessage, RoomView, ServerMessage } from '../engine/protocol'
import type { GameState, Step } from '../engine/state'
import { playBeats } from './queue'
import type { Transport } from './transport'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export type RoomClient = {
  room: RoomView | null
  game: GameState | null
  /** Seats this browser owns. Several of them, in local play. */
  mySeats: number[]
  error: string | null
  /** True while there are still beats to show. Controls must gate on this. */
  busy: boolean
  tray: DiceTray
  send: (message: ClientMessage) => void
}

/**
 * The client half of a room: a socket, and a queue of beats to watch.
 *
 * The room resolves a turn the instant it is asked — an AI's whole turn
 * arrives as one burst — while the player watches it at reading speed. So the
 * two are deliberately kept apart:
 *
 * **The queue is the only writer of `game`.** Nothing else sets the board or
 * the positions, which means what is on screen is always a state the room
 * actually sent, never a local guess, and never a board the player has not
 * watched happen.
 *
 * **Controls gate on `busy`, not on whose turn it is.** The room runs ahead of
 * the animation, so a gate on the turn alone would leave buttons live for a
 * position the player has not been shown yet.
 */
export function useRoom(transport: Transport | null): RoomClient {
  const [room, setRoom] = useState<RoomView | null>(null)
  const [game, setGame] = useState<GameState | null>(null)
  const [mySeats, setMySeats] = useState<number[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const tray = useDiceRoll(RACE_DICE)

  const queue = useRef<Step[]>([])
  const draining = useRef(false)
  const alive = useRef(true)
  // Read inside the drain loop, which outlives the render that started it.
  const mine = useRef<number[]>([])

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const drain = useCallback(async () => {
    if (draining.current) return
    draining.current = true
    setBusy(true)

    try {
      await playBeats(queue.current, {
        play: tray.play,
        pause: sleep,
        adopt: setGame,
        isMine: (seat) => mine.current.includes(seat),
        alive: () => alive.current,
      })
    } finally {
      draining.current = false
      if (alive.current) setBusy(false)
    }
  }, [tray])

  // Held in a ref so the subscription below can depend on `transport` alone.
  // A `drain` in those dependencies would resubscribe on every render, and the
  // cleanup that empties the queue would then throw away the rest of a turn
  // mid-animation — the race would stop dead with no error to show for it.
  const drainRef = useRef(drain)
  useEffect(() => {
    drainRef.current = drain
  })

  useEffect(() => {
    if (!transport) return

    const stop = transport.listen((message: ServerMessage) => {
      switch (message.type) {
        case 'welcome':
          mine.current = message.seats
          setMySeats(message.seats)
          setRoom(message.room)
          setError(null)
          // Arriving mid-race: jump to the present rather than replaying what
          // was missed. The log says what happened while we were gone.
          if (message.game) {
            queue.current = []
            setGame(message.game)
          }
          break

        case 'room':
          // Roster and phase are not animated — they are who is in the room,
          // not something happening in the race — so they land immediately.
          setRoom(message.room)
          break

        case 'snapshot':
          // Nothing to watch on the way here, so anything still queued is from
          // a race that no longer exists.
          queue.current = []
          setGame(message.game)
          break

        case 'steps':
          queue.current.push(...message.steps)
          void drainRef.current()
          break

        case 'error':
          setError(message.reason)
          break
      }
    })

    // Only ever torn down when the room itself changes, so emptying the queue
    // here discards a race that is genuinely over rather than one in progress.
    return () => {
      stop()
      queue.current = []
    }
  }, [transport])

  const send = useCallback(
    (message: ClientMessage) => {
      transport?.send(message)
    },
    [transport],
  )

  return { room, game, mySeats, error, busy, tray, send }
}
