import { DurableObject } from 'cloudflare:workers'
import type { ClientMessage, Outbox } from '../src/engine/protocol'
import { Room, type RoomSnapshot } from '../src/engine/room'

/** Rooms are disposable. This is the only timer in the system. */
const REAP_AFTER_MS = 2 * 60 * 60 * 1000

const SAVED = 'room'

/** What a socket carries across a hibernation. */
type Attachment = { token: string }

/**
 * The room's transport.
 *
 * Deliberately rule-free: it accepts sockets, hands bytes to `Room` and posts
 * back whatever comes out. Every decision about the game happens in
 * `src/engine/`, which is plain TypeScript with tests — so the part of this
 * feature that can be wrong is the part that is covered.
 *
 * Sockets are accepted through the **hibernation** API rather than
 * `addEventListener`, which is what lets an idle room stop billing duration.
 * That is also why the room is rebuilt from storage on demand and saved after
 * every change: hibernation throws away everything in memory, including which
 * sockets were open, and the room is written to cope with exactly that.
 */
export class RaceRoom extends DurableObject {
  private room: Room | null = null

  private async load(code: string): Promise<Room> {
    if (this.room) return this.room

    const saved = await this.ctx.storage.get<RoomSnapshot>(SAVED)
    this.room = saved ? Room.restore(saved) : new Room(code)
    return this.room
  }

  private async save(): Promise<void> {
    if (!this.room) return
    await this.ctx.storage.put(SAVED, this.room.snapshot())
    // Pushed out on every change, so a room is reaped two hours after it goes
    // quiet rather than two hours after it was made.
    await this.ctx.storage.setAlarm(Date.now() + REAP_AFTER_MS)
  }

  override async fetch(request: Request): Promise<Response> {
    const code = new URL(request.url).pathname.split('/').pop() ?? ''
    await this.load(code)

    const { 0: client, 1: server } = new WebSocketPair()
    this.ctx.acceptWebSocket(server)

    return new Response(null, { status: 101, webSocket: client })
  }

  /** Posts an outbox, skipping sockets it is not addressed to. */
  private post(out: Outbox[]): void {
    if (out.length === 0) return

    const sockets = this.ctx.getWebSockets()
    for (const { to, message } of out) {
      const body = JSON.stringify(message)
      for (const socket of sockets) {
        if (to !== 'all' && this.tokenOf(socket) !== to) continue
        try {
          socket.send(body)
        } catch {
          // Closing underneath us is normal; `webSocketClose` will tidy up.
        }
      }
    }
  }

  private tokenOf(socket: WebSocket): string | null {
    const attachment = socket.deserializeAttachment() as Attachment | null
    return attachment?.token ?? null
  }

  override async webSocketMessage(socket: WebSocket, data: string | ArrayBuffer): Promise<void> {
    if (typeof data !== 'string') return

    let message: ClientMessage
    try {
      message = JSON.parse(data) as ClientMessage
    } catch {
      return
    }

    const room = await this.load('')

    // The token comes from the socket once it is known, never from the message
    // body after that — otherwise anyone could act as anyone by typing their
    // token into a hello.
    let token = this.tokenOf(socket)

    if (message.type === 'hello') {
      if (typeof message.token !== 'string' || message.token.length === 0) return
      token = message.token
      socket.serializeAttachment({ token } satisfies Attachment)
      // One browser, one snail. `claim` is how local play seats a hotseat
      // table, and it has no business arriving over a network.
      message = { ...message, claim: 1 }
    }

    if (!token) return

    this.post(room.handle(token, message))
    await this.save()
  }

  override async webSocketClose(socket: WebSocket): Promise<void> {
    const token = this.tokenOf(socket)
    if (!token) return

    const room = await this.load('')
    this.post(room.disconnect(token))
    await this.save()
  }

  override async webSocketError(socket: WebSocket): Promise<void> {
    await this.webSocketClose(socket)
  }

  override async alarm(): Promise<void> {
    // Nobody has touched this room in two hours. Rooms are disposable by
    // design — that is what keeps storage out of the cost of running this.
    await this.ctx.storage.deleteAll()
    this.room = null
  }
}
