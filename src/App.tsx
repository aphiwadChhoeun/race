import { useState } from 'react'
import { Lobby } from './game/Lobby'
import { SoloRace } from './game/SoloRace'
import type { Seat } from './engine/seats'

export default function App() {
  const [roster, setRoster] = useState<Seat[] | null>(null)

  // Returning to the lobby sets this back to null, which unmounts the race —
  // so the next one always starts from fresh state with no key needed.
  if (!roster) return <Lobby onStart={setRoster} />

  return <SoloRace roster={roster} onExit={() => setRoster(null)} />
}
