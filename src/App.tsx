import { useEffect, useState } from 'react'
import { newCode } from './engine/codes'
import type { Seat } from './engine/seats'
import { routeOf } from './net/route'
import { Lobby } from './game/Lobby'
import { OnlineLobby } from './game/OnlineLobby'
import { SoloRace } from './game/SoloRace'

/**
 * Two routes and a solo game.
 *
 * No router dependency: `/` and `/r/CODE` do not need one, and a link that
 * has to survive being read aloud is better served by a path this short.
 */
export default function App() {
  const [path, setPath] = useState(() => location.pathname)
  const [roster, setRoster] = useState<Seat[] | null>(null)
  // Only the browser that drew the code creates the room; following a link
  // joins one. The room refuses a second create, so this cannot be guessed at.
  const [hosting, setHosting] = useState<{ code: string; size: number } | null>(null)

  useEffect(() => {
    const onPop = () => setPath(location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const go = (to: string) => {
    history.pushState(null, '', to)
    setPath(to)
  }

  const leave = () => {
    setHosting(null)
    go('/')
  }

  const route = routeOf(path)

  if (route.screen === 'room') {
    return (
      <OnlineLobby
        code={route.code}
        host={hosting?.code === route.code}
        size={hosting?.size ?? 3}
        onLeave={leave}
      />
    )
  }

  // Returning to the lobby sets this back to null, which unmounts the race —
  // so the next one always starts from fresh state with no key needed.
  if (roster) return <SoloRace roster={roster} onExit={() => setRoster(null)} />

  return (
    <Lobby
      onStart={setRoster}
      onHost={(size) => {
        const code = newCode()
        setHosting({ code, size })
        go(`/r/${code}`)
      }}
      onJoin={(code) => go(`/r/${code}`)}
    />
  )
}
