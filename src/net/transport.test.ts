import { describe, expect, test, vi } from 'vitest'
import type { ServerMessage } from '../engine/protocol'
import { localTransport } from './transport'

/** Collects everything a transport sends us. */
function watch(transport: ReturnType<typeof localTransport>) {
  const seen: ServerMessage[] = []
  transport.listen((message) => seen.push(message))
  const of = <T extends ServerMessage['type']>(type: T) =>
    seen.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type)
  return { seen, of }
}

describe('localTransport', () => {
  test('seats the local player in every human seat', async () => {
    const transport = localTransport(4, [0, 1])
    const { of } = watch(transport)
    await vi.waitFor(() => expect(of('welcome')).toHaveLength(1))
    expect(of('welcome')[0].seats).toEqual([0, 1])
    expect(of('welcome')[0].room.seats.map((s) => s.kind)).toEqual([
      'human',
      'human',
      'ai',
      'ai',
    ])
  })

  /* The lobby screen already happened, so a local room has no waiting phase
     to sit in — it is racing by the time the welcome lands. */
  test('starts the race without being asked', async () => {
    const transport = localTransport(3, [0, 1])
    const { of } = watch(transport)
    await vi.waitFor(() => expect(of('snapshot')).toHaveLength(1))
    expect(of('snapshot')[0].game.players).toHaveLength(3)
    expect(of('room').at(-1)?.room.phase).toBe('racing')
  })

  /* Hotseat and online go through the same authorisation rule. Owning both
     human seats is the whole of what makes local play work. */
  test('lets the local player act for the seats it owns', async () => {
    const transport = localTransport(3, [0, 1])
    const { of } = watch(transport)
    await vi.waitFor(() => expect(of('welcome')).toHaveLength(1))

    transport.send({ type: 'throw' })
    await vi.waitFor(() => expect(of('steps').length).toBeGreaterThan(0))
    expect(of('error')).toHaveLength(0)
  })

  /* Seat 0 may be an AI: the lobby lets you sit anywhere. */
  test('claims exactly the seats it was told to, not the first few', async () => {
    const transport = localTransport(3, [1])
    const { of } = watch(transport)
    await vi.waitFor(() => expect(of('welcome')).toHaveLength(1))
    expect(of('welcome')[0].seats).toEqual([1])
    expect(of('welcome')[0].room.seats.map((s) => s.kind)).toEqual(['ai', 'human', 'ai'])
  })

  /* A transport that replied synchronously would deliver a message during the
     render that sent it, which React will not forgive. */
  test('never answers in the same tick it was asked', () => {
    const transport = localTransport(3, [0])
    const { seen } = watch(transport)
    expect(seen).toHaveLength(0)
  })

  test('goes quiet once closed', async () => {
    const transport = localTransport(3, [0])
    const { of } = watch(transport)
    transport.close()
    await Promise.resolve()
    expect(of('welcome')).toHaveLength(0)
  })
})
