import { RaceGame } from './game/RaceGame'
import { defaultRoster } from './game/seats'

const ROSTER = defaultRoster(3).map((seat) => ({ ...seat, kind: 'human' as const }))

export default function App() {
  return <RaceGame roster={ROSTER} onExit={() => {}} />
}
