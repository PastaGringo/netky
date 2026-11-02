// z-base-32, the alphabet Pubky uses for public keys (52 characters = 32 bytes).
const ALPHABET = 'ybndrfg8ejkmcpqxot1uwisza345h769'
const LOOKUP = new Map([...ALPHABET].map((c, i) => [c, i]))

export const PUBKEY_RE = /^[ybndrfg8ejkmcpqxot1uwisza345h769]{52}$/

export function isPubkey(s: string): boolean {
  return PUBKEY_RE.test(s)
}

/** Accepts a bare key, `pk:<key>` or `pubky<key>` and returns the bare key, or null. */
export function normalizePubkey(input: string): string | null {
  const s = input
    .trim()
    .toLowerCase()
    .replace(/^pk:/, '')
    .replace(/^pubky:\/\//, '')
  const bare = s.length === 57 && s.startsWith('pubky') ? s.slice(5) : s
  return isPubkey(bare) ? bare : null
}

export function decodeZ32(s: string): Uint8Array {
  const out = new Uint8Array(Math.floor((s.length * 5) / 8))
  let buffer = 0
  let bits = 0
  let i = 0
  for (const c of s) {
    const v = LOOKUP.get(c)
    if (v === undefined) throw new Error(`invalid z-base-32 character: ${c}`)
    buffer = (buffer << 5) | v
    bits += 5
    if (bits >= 8) {
      bits -= 8
      out[i++] = (buffer >> bits) & 0xff
    }
  }
  return out
}
