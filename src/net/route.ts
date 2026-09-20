import { normaliseCode } from '../engine/codes'

export type Route = { screen: 'home' } | { screen: 'room'; code: string }

/**
 * Where a path points.
 *
 * Two routes do not need a router. `/r/AB2C` is the shape a link takes, and
 * anything that is not a valid code lands on the home screen rather than an
 * error — a mistyped link should offer you the join box, not a dead end.
 */
export function routeOf(pathname: string): Route {
  const match = /^\/r\/([^/]+)\/?$/.exec(pathname)
  if (!match) return { screen: 'home' }

  const code = normaliseCode(decodeURIComponent(match[1]))
  return code ? { screen: 'room', code } : { screen: 'home' }
}

/** The link you send a friend. */
export function linkTo(code: string): string {
  return `${location.origin}/r/${code}`
}
