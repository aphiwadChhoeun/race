import { useState } from 'react'
import { Lobby } from './game/Lobby'
import { RaceGame } from './game/RaceGame'
import type { Seat } from './game/seats'

export default function App() {
  const [roster, setRoster] = useState<Seat[] | null>(null)

  // Returning to the lobby sets this back to null, which unmounts RaceGame —
  // so the next race always starts from fresh state with no key needed.
  if (!roster) return <Lobby onStart={setRoster} />

  return <RaceGame roster={roster} onExit={() => setRoster(null)} />
}
