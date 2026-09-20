import { describe, expect, test } from 'vitest'
import { routeOf } from './route'

describe('routeOf', () => {
  test('sends the root at the home screen', () => {
    expect(routeOf('/')).toEqual({ screen: 'home' })
  })

  test('reads the code out of a shared link', () => {
    expect(routeOf('/r/AB2C')).toEqual({ screen: 'room', code: 'AB2C' })
  })

  test('tidies a code someone typed in the address bar', () => {
    expect(routeOf('/r/ab2c')).toEqual({ screen: 'room', code: 'AB2C' })
  })

  test('forgives a trailing slash', () => {
    expect(routeOf('/r/AB2C/')).toEqual({ screen: 'room', code: 'AB2C' })
  })

  /* A mistyped link should offer the join box, not a dead end. */
  test('falls back to home when the code is not one', () => {
    expect(routeOf('/r/NOPE-NOT-A-CODE')).toEqual({ screen: 'home' })
    expect(routeOf('/r/AB2I')).toEqual({ screen: 'home' })
    expect(routeOf('/r/')).toEqual({ screen: 'home' })
    expect(routeOf('/elsewhere')).toEqual({ screen: 'home' })
  })
})
