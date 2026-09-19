/// <reference types="vite/client" />
import { describe, expect, test } from 'vitest'

/**
 * The engine is bundled into a Cloudflare Worker, which must not carry a
 * physics library or a renderer.
 *
 * `src/dice/index.ts` re-exports `DiceTable` (React, three) and `physics`
 * (cannon-es). Reaching the dice *types* through it is harmless today only
 * because those imports are type-only and erase at compile time. A single
 * `import { faceOf } from '../dice'` would quietly put three and cannon-es in
 * the Worker bundle, and the symptom would be a fat deploy rather than an
 * error — nothing would fail, so nobody would look. Hence this.
 *
 * Read through Vite's glob rather than `node:fs` so the guard costs no
 * dependency of its own.
 */
const sources: Record<string, string> = import.meta.glob('./*.ts', {
  query: '?raw',
  eager: true,
  import: 'default',
})

describe('the engine', () => {
  const rules: [string, RegExp][] = [
    ['the dice barrel', /from '\.\.\/dice'/],
    // React in the engine would mean a rule that only runs in a browser.
    ['React', /from 'react'/],
    ['the physics engine', /from '\.\.\/dice\/physics'|from 'cannon-es'/],
  ]

  test('has sources to check', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(4)
  })

  for (const [what, pattern] of rules) {
    test(`never imports ${what}`, () => {
      for (const [path, text] of Object.entries(sources)) {
        expect(text, `${path} imports ${what}`).not.toMatch(pattern)
      }
    })
  }
})
