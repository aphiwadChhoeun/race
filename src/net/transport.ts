import { Room } from '../engine/room'
import type { ClientMessage, Outbox, ServerMessage } from '../engine/protocol'

/**
 * How the client talks to a room.
 *
 * Two implementations, one interface. Solo play is not a different game with
 * its own rules — it is the same `Room`, reached without a network, which is
 * why there is only ever one turn-driving path to debug and why playing solo
 * exercises the code that runs online.
 */
export type Transport = {
  send: (message: ClientMessage) => void
  /** Subscribes to messages. Returns an unsubscribe. */
  listen: (onMessage: (message: ServerMessage) => void) => () => void
  close: () => void
}

/** A token good enough to tell players apart. */
function newToken(): string {
  return crypto.randomUUID()
}

/** Fans an outbox out to a listener, keeping only what is addressed to it. */
function deliver(
  out: Outbox[],
  token: string,
  listeners: Set<(message: ServerMessage) => void>,
) {
  for (const { to, message } of out) {
    if (to !== 'all' && to !== token) continue
    for (const listener of listeners) listener(message)
  }
}

/**
 * A room in this tab, with no network under it.
 *
 * The local player claims every human seat with a single token, so hotseat
 * falls straight out of the room's one authorisation rule — "you may act when
 * it is the turn of a seat you own" — with nothing added for it.
 *
 * Replies go out on a microtask. A transport that answered synchronously would
 * deliver a message during the render that sent it, which React will not
 * forgive.
 */
export function localTransport(size: number, humanSeats: number[]): Transport {
  const token = newToken()
  const room = new Room('LOCAL')
  const listeners = new Set<(message: ServerMessage) => void>()
  let open = true
  let joined = false

  const post = (out: Outbox[]) => {
    queueMicrotask(() => {
      if (open) deliver(out, token, listeners)
    })
  }

  return {
    send(message) {
      if (open) post(room.handle(token, message))
    },
    listen(onMessage) {
      listeners.add(onMessage)

      // Joining on the first listener, not at construction, so the welcome has
      // somewhere to arrive. One hello claims every human seat at once, and
      // the race starts straight away — the lobby screen already happened, so
      // a local room has no waiting phase to sit in.
      if (!joined) {
        joined = true
        const out = room.handle(token, {
          type: 'hello',
          token,
          create: true,
          size,
          claim: humanSeats,
        })
        post([...out, ...room.handle(token, { type: 'start' })])
      }

      return () => listeners.delete(onMessage)
    },
    close() {
      open = false
      listeners.clear()
    },
  }
}

const TOKEN_KEY = 'snail-dash-token'

/**
 * The token that identifies this browser to a room.
 *
 * Kept in `sessionStorage`, so a refresh reclaims your snail but a second tab
 * is a second player — which is what you want when you are testing, and what
 * a person would expect when they deliberately open a new tab.
 */
function sessionToken(): string {
  try {
    const saved = sessionStorage.getItem(TOKEN_KEY)
    if (saved) return saved
    const token = newToken()
    sessionStorage.setItem(TOKEN_KEY, token)
    return token
  } catch {
    // Private mode, or storage disabled. A fresh token each load just means
    // a refresh costs you your seat.
    return newToken()
  }
}

/** A room on the other end of a WebSocket. */
export function socketTransport(code: string, create: boolean, size?: number): Transport {
  const token = sessionToken()
  const listeners = new Set<(message: ServerMessage) => void>()
  const origin = location.origin.replace(/^http/, 'ws')
  const socket = new WebSocket(`${origin}/api/room/${code}`)

  // Anything sent before the socket opens waits here rather than throwing.
  let queue: ClientMessage[] = []

  const post = (message: ClientMessage) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
    else queue.push(message)
  }

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'hello', token, create, size }))
    const waiting = queue
    queue = []
    for (const message of waiting) socket.send(JSON.stringify(message))
  })

  socket.addEventListener('message', (event) => {
    let message: ServerMessage
    try {
      message = JSON.parse(String(event.data)) as ServerMessage
    } catch {
      return
    }
    for (const listener of listeners) listener(message)
  })

  socket.addEventListener('close', () => {
    for (const listener of listeners) {
      listener({ type: 'error', reason: 'Lost the connection.', fatal: true })
    }
  })

  return {
    send: post,
    listen(onMessage) {
      listeners.add(onMessage)
      return () => listeners.delete(onMessage)
    },
    close() {
      listeners.clear()
      socket.close()
    },
  }
}
