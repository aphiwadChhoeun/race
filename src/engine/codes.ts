/**
 * Room codes.
 *
 * Four characters, drawn from an alphabet with `I`, `L`, `O`, `0` and `1`
 * removed — the characters people mishear when a code is read aloud, which is
 * exactly how these travel. That leaves 31^4, about 924,000 codes, and only
 * rooms alive at the same moment can collide.
 */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const CODE_LENGTH = 4

/**
 * A fresh code.
 *
 * Rejection sampling, for the same reason `rollFace` uses it: 256 is not a
 * multiple of 31, so taking the modulo of every byte would quietly favour the
 * front of the alphabet. It costs a discarded byte now and then.
 */
export function newCode(): string {
  const limit = Math.floor(256 / CODE_ALPHABET.length) * CODE_ALPHABET.length
  let code = ''

  while (code.length < CODE_LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH + 4))
    for (const byte of bytes) {
      if (byte >= limit) continue
      code += CODE_ALPHABET[byte % CODE_ALPHABET.length]
      if (code.length === CODE_LENGTH) break
    }
  }

  return code
}

/** A typed or pasted code, tidied — or null if it is not one. */
export function normaliseCode(raw: string): string | null {
  const code = raw.trim().toUpperCase()
  if (code.length !== CODE_LENGTH) return null
  for (const char of code) if (!CODE_ALPHABET.includes(char)) return null
  return code
}
