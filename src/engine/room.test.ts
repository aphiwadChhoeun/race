import { describe, expect, test } from 'vitest'
import type { Outbox, ServerMessage } from './protocol'
import { Room } from './room'
import type { GameState } from './state'

const hello = (room: Room, token: string, extra: object = {}) =>
  room.handle(token, { type: 'hello', token, ...extra })

/** A room of `size` seats: the host, plus one human per token in `others`. */
function seated(size: number, others: string[] = []): Room {
  const room = new Room('AB2C')
  hello(room, 'host', { create: true, size })
  for (const token of others) hello(room, token)
  return room
}

const find = (out: Outbox[], type: ServerMessage['type']) =>
  out.map((o) => o.message).find((m) => m.type === type)

/** The last state reached by whatever steps this call produced. */
function reached(out: Outbox[]): GameState | null {
  const steps = out.flatMap((o) => (o.message.type === 'steps' ? o.message.steps : []))
  return steps.length > 0 ? steps[steps.length - 1].state : null
}

/** Plays the host's turn through to a placement, however the dice fall. */
function hostTurn(room: Room): Outbox[] {
  const out = [...room.handle('host', { type: 'throw' })]
  for (let guard = 0; guard < 40; guard++) {
    const game = room.game()
    if (!game?.pending || game.winner !== null) break
    if (game.turn !== 0) break
    out.push(...room.handle('host', { type: 'place', slot: game.pending.legal[0] }))
  }
  return out
}

describe('joining', () => {
  test('creates a room and seats the host first', () => {
    const room = new Room('AB2C')
    expect(find(hello(room, 'host', { create: true, size: 3 }), 'welcome')).toMatchObject({
      seats: [0],
    })
  })

  test('refuses to join a room nobody has created', () => {
    expect(find(hello(new Room('AB2C'), 'guest'), 'error')).toMatchObject({ fatal: true })
  })

  /* A code clash has to be loud on the creating side, so the client can draw
     another one rather than two hosts sharing a room by accident. */
  test('refuses a second create on a live room', () => {
    expect(find(hello(seated(3), 'other', { create: true, size: 3 }), 'error')).toMatchObject({
      fatal: true,
    })
  })

  test('gives each arrival the next free seat', () => {
    expect(find(hello(seated(3, ['b']), 'c'), 'welcome')).toMatchObject({ seats: [2] })
  })

  test('turns a claimed seat human and leaves the rest AI', () => {
    expect(seated(3, ['b']).view().seats.map((s) => s.kind)).toEqual(['human', 'human', 'ai'])
  })

  test('turns away an arrival when every seat is claimed', () => {
    expect(find(hello(seated(3, ['b', 'c']), 'd'), 'error')).toMatchObject({ fatal: true })
  })

  test('refuses a newcomer once the race has started', () => {
    const room = seated(3, ['b'])
    room.handle('host', { type: 'start' })
    expect(find(hello(room, 'late'), 'error')).toMatchObject({ fatal: true })
  })

  test('lets a player rename their own snail', () => {
    const room = seated(3, ['b'])
    room.handle('b', { type: 'rename', name: 'Dave' })
    expect(room.view().seats[1].name).toBe('Dave')
  })

  test('refuses a rename from a token that owns no seat', () => {
    const room = seated(3, ['b'])
    expect(find(room.handle('nobody', { type: 'rename', name: 'Mallory' }), 'error')).toBeDefined()
    expect(room.view().seats.map((s) => s.name)).toEqual(['Turbo', 'Zippy', 'Pesto'])
  })

  test('tells everyone when the roster changes', () => {
    expect(find(hello(seated(3), 'b'), 'room')).toBeDefined()
  })

  /* Hotseat: one token owning several seats is the whole of what makes local
     play work through the same authorisation rule as the network. */
  test('lets one token claim several seats at once', () => {
    const room = new Room('AB2C')
    const out = hello(room, 'local', { create: true, size: 5, claim: 3 })
    expect(find(out, 'welcome')).toMatchObject({ seats: [0, 1, 2] })
    expect(room.view().seats.map((s) => s.kind)).toEqual([
      'human',
      'human',
      'human',
      'ai',
      'ai',
    ])
  })

  test('claims what it can when asked for more seats than are free', () => {
    const room = seated(4, ['b'])
    expect(find(hello(room, 'greedy', { claim: 9 }), 'welcome')).toMatchObject({ seats: [2, 3] })
  })
})

describe('starting', () => {
  test('only the host may start', () => {
    const room = seated(3, ['b'])
    expect(find(room.handle('b', { type: 'start' }), 'error')).toBeDefined()
    expect(room.view().phase).toBe('lobby')
  })

  test('starts with two humans and an AI, so a pair can race', () => {
    const room = seated(3, ['b'])
    room.handle('host', { type: 'start' })
    expect(room.view().phase).toBe('racing')
    expect(room.game()?.players.map((p) => p.kind)).toEqual(['human', 'human', 'ai'])
  })

  test('lets the host resize the table before the race', () => {
    const room = seated(3)
    room.handle('host', { type: 'resize', size: 5 })
    expect(room.view().seats).toHaveLength(5)
  })

  /* Resizing must not strand a player who has already taken a seat. */
  test('refuses a resize that would unseat someone', () => {
    const room = seated(5, ['b', 'c', 'd', 'e'])
    room.handle('host', { type: 'resize', size: 3 })
    expect(room.view().seats).toHaveLength(5)
  })

  test('refuses a table outside the sizes the game supports', () => {
    const room = seated(3)
    room.handle('host', { type: 'resize', size: 9 })
    room.handle('host', { type: 'resize', size: 2 })
    expect(room.view().seats).toHaveLength(3)
  })

  test('refuses to start twice', () => {
    const room = seated(3)
    room.handle('host', { type: 'start' })
    const before = room.game()
    room.handle('host', { type: 'start' })
    expect(room.game()).toBe(before)
  })
})

describe('playing', () => {
  test('lets the seat whose turn it is throw', () => {
    const room = seated(3, ['b'])
    room.handle('host', { type: 'start' })
    expect(reached(room.handle('host', { type: 'throw' }))?.pending).not.toBeNull()
  })

  test('ignores an intent from a seat it is not the turn of', () => {
    const room = seated(3, ['b'])
    room.handle('host', { type: 'start' })
    expect(find(room.handle('b', { type: 'throw' }), 'error')).toMatchObject({ fatal: false })
    expect(room.game()?.pending).toBeNull()
  })

  test('ignores an intent from a token that owns no seat at all', () => {
    const room = seated(3, ['b'])
    room.handle('host', { type: 'start' })
    expect(find(room.handle('nobody', { type: 'throw' }), 'error')).toBeDefined()
    expect(room.game()?.pending).toBeNull()
  })

  test('refuses a game intent before the race has started', () => {
    expect(find(seated(3).handle('host', { type: 'throw' }), 'error')).toBeDefined()
  })

  /* The burst stops at the first seat someone is watching from. That is what
     bounds it: with a connected human it runs at most the other seats, and
     with nobody connected it does not run at all. */
  test('plays every AI seat through to the next connected human', () => {
    const room = seated(3)
    room.handle('host', { type: 'start' })
    hostTurn(room)
    const game = room.game()!
    expect(game.winner === null ? game.turn : 0).toBe(0)
  })

  /* A departure must not advance the race. Otherwise the last person to close
     their tab would set the remaining AI seats running with nobody watching,
     and the room would play itself to a finish in an empty house. */
  test('never plays a turn because somebody left', () => {
    const room = seated(3, ['b'])
    room.handle('host', { type: 'start' })
    const before = room.game()
    expect(find(room.disconnect('b'), 'steps')).toBeUndefined()
    expect(room.game()).toBe(before)
  })

  /* Hibernation restores a room believing nobody is watching. The first
     message back has to bring the AI with it, or the race stops for good. */
  test('starts driving again when a restored room hears from someone', () => {
    const room = seated(3)
    room.handle('host', { type: 'start' })
    const restored = Room.restore(JSON.parse(JSON.stringify(room.snapshot())))
    expect(restored.idle).toBe(true)
    expect(reached(restored.handle('host', { type: 'throw' }))?.pending).not.toBeNull()
    expect(restored.idle).toBe(false)
  })

  test('plays an all-AI table to a winner once a watcher asks it to', () => {
    const room = seated(3)
    room.handle('host', { type: 'start' })
    for (let turns = 0; turns < 400 && room.game()?.winner === null; turns++) hostTurn(room)
    expect(room.game()?.winner).not.toBeNull()
  })
})

describe('going away', () => {
  test('marks a dropped seat away without handing it to the AI', () => {
    const room = seated(3, ['b'])
    room.handle('host', { type: 'start' })
    room.disconnect('b')
    expect(room.view().seats[1]).toMatchObject({ kind: 'human', away: true })
  })

  test('gives a returning player their own snail back', () => {
    const room = seated(3, ['b'])
    room.handle('host', { type: 'start' })
    room.disconnect('b')
    expect(find(hello(room, 'b'), 'welcome')).toMatchObject({ seats: [1] })
    expect(room.view().seats[1].away).toBe(false)
  })

  test('hands a returning player the race as it stands now', () => {
    const room = seated(3, ['b'])
    room.handle('host', { type: 'start' })
    room.handle('host', { type: 'throw' })
    room.disconnect('b')
    const welcome = find(hello(room, 'b'), 'welcome')
    expect(welcome && 'game' in welcome && welcome.game).not.toBeNull()
  })

  /* The whole point of deferring the handover: a blip between your turns
     costs you nothing, and the race never stalls on a dead laptop. */
  test('plays an away seat only when its turn comes round', () => {
    const room = seated(3, ['b'])
    room.handle('host', { type: 'start' })
    room.disconnect('b')
    hostTurn(room)
    const game = room.game()!
    expect(game.winner === null ? game.turn : 0).toBe(0)
    expect(room.view().seats[1].kind).toBe('human')
  })

  test('stops driving once the last watcher leaves mid-burst', () => {
    const room = seated(3, ['b'])
    room.handle('host', { type: 'start' })
    room.disconnect('host')
    room.disconnect('b')
    expect(room.idle).toBe(true)
  })
})

describe('saving', () => {
  const reload = (room: Room) => Room.restore(JSON.parse(JSON.stringify(room.snapshot())))

  test('restores a room mid-race', () => {
    const room = seated(3, ['b'])
    room.handle('host', { type: 'start' })
    room.handle('host', { type: 'throw' })
    const restored = reload(room)
    expect(restored.view().phase).toBe('racing')
    expect(restored.game()?.pending).not.toBeNull()
  })

  /* Hibernation drops every socket, so a restored room must believe nobody is
     connected until they say hello again — otherwise it would think a
     long-gone player was still watching and refuse to play their seat. */
  test('restores with nobody connected', () => {
    expect(reload(seated(3, ['b'])).idle).toBe(true)
  })

  test('still knows who owns which seat after a restore', () => {
    const room = seated(3, ['b'])
    room.handle('host', { type: 'start' })
    const restored = reload(room)
    expect(find(hello(restored, 'b'), 'welcome')).toMatchObject({ seats: [1] })
  })
})
