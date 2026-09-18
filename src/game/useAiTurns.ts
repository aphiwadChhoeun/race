import { useEffect, useRef, useState } from 'react'
import { decideAi } from './ai'
import type { Player, TurnOutcome } from './useRaceGame'

/** Long enough to read the log line, short enough that six seats don't drag. */
const AI_PAUSE_MS = 700

/**
 * Defensive only. The AI rerolls until it can outbid, and every reroll busts
 * on 11/36, so a turn terminates with probability 1 — this just stops a
 * pathological board from spinning forever.
 */
const MAX_AI_REROLLS = 30

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type Driveable = {
  players: Player[]
  turn: number
  winner: number | null
  startTurn: () => Promise<TurnOutcome>
  reroll: () => Promise<TurnOutcome>
  place: (slot: number) => void
}

/**
 * Plays a turn for an AI seat when one comes round.
 *
 * A turn is a single async script rather than an effect reacting to each state
 * change: it is a sequence, and driving a sequence from re-entrant effects is
 * how races get in. The effect only *starts* the script, guarded by a ref so a
 * re-render cannot start a second one.
 *
 * What the effect watches matters. It deliberately does NOT watch `pending`:
 * that turns non-null the moment the AI throws, so an effect keyed on it would
 * tear down its own turn mid-script. And it watches `turn` itself rather than
 * a derived "is it an AI's turn" boolean, because that boolean stays `true`
 * across a handover between two AI seats — the deps would never change and the
 * second AI would never play.
 */
export function useAiTurns(game: Driveable): boolean {
  const [thinking, setThinking] = useState(false)
  const running = useRef(false)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const { players, turn, winner, startTurn, reroll, place } = game
  const seatKind = players[turn]?.kind
  const over = winner !== null

  useEffect(() => {
    if (over || seatKind !== 'ai' || running.current) return
    running.current = true

    const run = async () => {
      setThinking(true)
      await sleep(AI_PAUSE_MS)

      let outcome = await startTurn()

      for (let rerolls = 0; rerolls < MAX_AI_REROLLS; rerolls++) {
        if (!alive.current || outcome.kind !== 'decide') break

        await sleep(AI_PAUSE_MS)
        const action = decideAi(outcome.board, outcome.value)

        if (action.kind === 'place') {
          place(action.slot)
          break
        }
        outcome = await reroll()
      }

      setThinking(false)
      running.current = false
    }

    void run()
  }, [turn, seatKind, over, place, reroll, startTurn])

  return thinking
}
