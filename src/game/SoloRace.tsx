import type { Seat } from '../engine/seats'
import { RaceGame } from './RaceGame'
import { useRaceGame } from './useRaceGame'

export type SoloRaceProps = {
  roster: Seat[]
  onExit: () => void
}

/**
 * A race in this tab, against the AI.
 *
 * Thin on purpose: the room behind `useRaceGame` is the same one the network
 * serves, so there is nothing here but the wiring and a way back to the lobby.
 */
export function SoloRace({ roster, onExit }: SoloRaceProps) {
  const game = useRaceGame(roster)
  return <RaceGame client={game} onAgain={game.reset} onExit={onExit} exitLabel="Lobby" />
}
