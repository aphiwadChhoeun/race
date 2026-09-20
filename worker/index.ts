import { CODE_ALPHABET, CODE_LENGTH } from '../src/engine/codes'
import { RaceRoom } from './RaceRoom'

export { RaceRoom }

type Env = {
  ROOMS: DurableObjectNamespace<RaceRoom>
  ASSETS: Fetcher
}

const ROOM_PATH = new RegExp(`^/api/room/([${CODE_ALPHABET}]{${CODE_LENGTH}})$`)

/**
 * One Worker for the whole game.
 *
 * Static assets are served straight through — they are free and unlimited, and
 * never count against the request quota — and the only thing this handles
 * itself is the socket upgrade for a room.
 *
 * A room needs no registry: the code *is* the Durable Object's name, so there
 * is no list of live rooms to keep in step with the rooms themselves, and
 * nothing to clean up when one goes quiet.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const match = ROOM_PATH.exec(new URL(request.url).pathname)
    if (!match) return env.ASSETS.fetch(request)

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('This endpoint speaks WebSocket.', { status: 426 })
    }

    const id = env.ROOMS.idFromName(match[1])
    return env.ROOMS.get(id).fetch(request)
  },
}
