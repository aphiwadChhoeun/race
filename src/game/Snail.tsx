/**
 * A racing snail, drawn inline.
 *
 * Inline rather than an asset because the shell has to take an arbitrary seat
 * colour at runtime, and because the eyestalks animate — both of which an
 * `<img>` would put out of CSS's reach.
 *
 * Purely decorative: every place a snail appears, the seat's name is already
 * rendered as text beside it, so the SVG is hidden from assistive tech rather
 * than duplicating that name.
 */

export type SnailProps = {
  /** The shell colour. The body is derived from it, so one colour is enough. */
  color: string
  /** Rendered size in px, square. */
  size?: number
  /** Adds the idle bob and the racing lean. Off for static roster rows. */
  racing?: boolean
  className?: string
}

export function Snail({ color, size = 34, racing = false, className }: SnailProps) {
  return (
    <svg
      className={['snail', racing && 'snail--racing', className].filter(Boolean).join(' ')}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {/* Painted back to front: foot, then head, then stalks, then the shell
          on top — so the shell overlaps the base of the neck the way a real
          one does, and the neck needs no join drawn where they meet. */}

      {/* Foot: the slab the whole snail rides on. */}
      <path
        className="snail__foot"
        d="M4 38c0-3 3-5 7-5h26c3 0 5 2 5 5 0 2-2 3-4 3H7c-2 0-3-1-3-3Z"
        fill="#fff3d4"
        stroke="#2f5d34"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />

      {/* Head and neck, leaning forward into the race. */}
      <path
        className="snail__head"
        d="M29 38C29 27 32 20.5 37 18.5c4-1.6 7.4 1 7 4.8-0.4 4.4-4 7.4-6.6 9.4-2 1.5-2.6 2.6-2.6 4.3Z"
        fill="#fff3d4"
        stroke="#2f5d34"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      {/* Mouth, so the head has a front. */}
      <path d="M40.5 27.5c1.6 0.3 2.6 1.2 3 2.4" stroke="#2f5d34" strokeWidth="1.8" strokeLinecap="round" fill="none" />

      {/* Eyestalks and their eyes move together — the group is what bobs. */}
      <g className="snail__stalks">
        <g stroke="#2f5d34" strokeWidth="2.2" strokeLinecap="round" fill="none">
          <path d="M40.4 20.5c1.4-3.2 2.6-5.4 3.2-8" />
          <path d="M34.6 21.4c-0.6-3.4-0.4-6.4 0.2-9.2" />
        </g>
        <circle cx="44" cy="10.2" r="2.9" fill="#fff" stroke="#2f5d34" strokeWidth="2" />
        <circle cx="34.6" cy="9.4" r="2.9" fill="#fff" stroke="#2f5d34" strokeWidth="2" />
        <circle cx="44.7" cy="9.8" r="1.1" fill="#2f5d34" />
        <circle cx="35.3" cy="9" r="1.1" fill="#2f5d34" />
      </g>

      {/* Shell: the seat colour, with a lighter spiral coiled on top of it.
          The spiral is three alternating semicircles of growing radius, which
          is the cheapest path that actually reads as a coil rather than a
          squiggle. */}
      <circle
        className="snail__shell"
        cx="19"
        cy="24"
        r="12.8"
        fill={color}
        stroke="#2f5d34"
        strokeWidth="2.6"
      />
      <path
        className="snail__spiral"
        d="M19 24a2 2 0 1 1 4 0 4.5 4.5 0 1 1-9 0 7 7 0 1 1 14 0"
        stroke="#fff"
        strokeOpacity="0.8"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
      {/* Gloss, so a flat fill still reads as a shell. */}
      <ellipse cx="13.5" cy="16.5" rx="3.6" ry="2.2" fill="#fff" opacity="0.5" transform="rotate(-35 13.5 16.5)" />
    </svg>
  )
}
