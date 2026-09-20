import { useCallback, useMemo, useState } from 'react'
import type { Seat } from '../engine/seats'
import { localTransport } from '../net/transport'
import { useRoom, type RoomClient } from '../net/useRoom'

export type SoloGame = RoomClient & {
  /** Starts a fresh race with the same roster. */
  reset: () => void
}

/**
 * A race against the AI, in this tab.
 *
 * There is no separate solo game any more: this builds the same `Room` the
 * network serves and reaches it without a socket. Every rule, every AI turn
 * and every authorisation check is the code that runs online, so playing solo
 * is a test of multiplayer — and a bug found in one is a bug found in both.
 *
 * Hotseat survives untouched, because the local player claims every human seat
 * with one token and the room's single authorisation rule already allows that.
 */
export function useRaceGame(roster: Seat[]): SoloGame {
  // Bumped to build a new room, which is how "race again" works. `roster` is
  // deliberately not a dependency: the lobby hands over a fresh array every
  // render, and rebuilding on a new array reference would restart the race.
  const [generation, setGeneration] = useState(0)

  const transport = useMemo(() => {
    // Every seat the lobby marked human, by index rather than by count — the
    // lobby lets you sit in seat 1 and leave seat 0 to an AI.
    const humans = roster.flatMap((seat, index) => (seat.kind === 'human' ? [index] : []))
    return localTransport(roster.length, humans)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation])

  const reset = useCallback(() => setGeneration((n) => n + 1), [])

  return { ...useRoom(transport), reset }
}
