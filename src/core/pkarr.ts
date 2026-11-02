import { createPublicKey, verify } from 'node:crypto'
import dns from 'dns-packet'
import { decodeZ32 } from './z32.ts'

// Public PKARR relays. The relay only forwards the signed packet: the
// signature is checked here, so a relay cannot forge a record.
export const RELAYS = (
  process.env.NETKY_RELAYS ?? 'https://pkarr.pubky.app,https://pkarr.pubky.org'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')
const USER_AGENT = 'netky/0.1 (+https://netky.pubky.pastalabs.dev/about)'

export interface SignedPacket {
  /** Record timestamp (seq), in microseconds since the epoch. */
  timestampUs: bigint
  answers: Array<dns.Answer>
}

export interface SvcbRecord {
  name: string
  priority: number
  /** '.' means "this same name". */
  target: string
  port?: number
  ipv4hint: Array<string>
  ipv6hint: Array<string>
}

export class PkarrNotFound extends Error {}

/** Fetches a key's packet from the relays and checks its signature. */
export async function resolvePacket(
  pubkey: string,
  timeoutMs = 10_000,
): Promise<SignedPacket> {
  let lastError: unknown = null
  for (const relay of RELAYS) {
    try {
      const res = await fetch(`${relay}/${pubkey}`, {
        headers: { 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (res.status === 404) throw new PkarrNotFound(`no record for ${pubkey}`)
      if (!res.ok) throw new Error(`${relay} answered HTTP ${res.status}`)
      return parseRelayPayload(pubkey, Buffer.from(await res.arrayBuffer()))
    } catch (e) {
      lastError = e
      if (e instanceof PkarrNotFound) throw e
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

/** Relay payload = signature (64) + seq (u64 BE) + DNS packet. */
export function parseRelayPayload(
  pubkey: string,
  payload: Buffer,
): SignedPacket {
  if (payload.length < 72) throw new Error('payload too short')
  const signature = payload.subarray(0, 64)
  const timestampUs = payload.readBigUInt64BE(64)
  const packet = payload.subarray(72)

  const signable = Buffer.concat([
    Buffer.from(`3:seqi${timestampUs}e1:v${packet.length}:`),
    packet,
  ])
  const key = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, decodeZ32(pubkey)]),
    format: 'der',
    type: 'spki',
  })
  if (!verify(null, signable, key, signature))
    throw new Error('invalid PKARR signature')

  return { timestampUs, answers: dns.decode(packet).answers ?? [] }
}

/** Reads an SVCB/HTTPS rdata (RFC 9460). dns-packet leaves these as raw bytes. */
export function parseSvcb(name: string, data: Buffer): SvcbRecord {
  let o = 0
  const priority = data.readUInt16BE(o)
  o += 2
  const labels: Array<string> = []
  for (;;) {
    const len = data[o++]
    if (len === undefined) throw new Error('truncated SVCB target')
    if (len === 0) break
    if (len >= 0xc0) throw new Error('compressed SVCB target is not supported')
    labels.push(data.subarray(o, o + len).toString('ascii'))
    o += len
  }
  const rec: SvcbRecord = {
    name,
    priority,
    target: labels.length ? labels.join('.') : '.',
    ipv4hint: [],
    ipv6hint: [],
  }
  while (o + 4 <= data.length) {
    const key = data.readUInt16BE(o)
    const len = data.readUInt16BE(o + 2)
    const value = data.subarray(o + 4, o + 4 + len)
    o += 4 + len
    if (key === 3 && len === 2) rec.port = value.readUInt16BE(0)
    if (key === 4)
      for (let i = 0; i + 4 <= len; i += 4)
        rec.ipv4hint.push([...value.subarray(i, i + 4)].join('.'))
    if (key === 6)
      for (let i = 0; i + 16 <= len; i += 16) {
        const parts: Array<string> = []
        for (let j = 0; j < 16; j += 2)
          parts.push(value.readUInt16BE(i + j).toString(16))
        rec.ipv6hint.push(parts.join(':'))
      }
  }
  return rec
}

function stripDot(name: string): string {
  return name.replace(/\.$/, '')
}

function svcbRecords(packet: SignedPacket, name: string): Array<SvcbRecord> {
  const out: Array<SvcbRecord> = []
  for (const a of packet.answers) {
    if (stripDot(a.name) !== name) continue
    // dns-packet has no SVCB (64) / HTTPS (65) codec: they come back as UNKNOWN_<n>.
    const type = String(a.type)
    if (
      type !== 'UNKNOWN_64' &&
      type !== 'UNKNOWN_65' &&
      type !== 'HTTPS' &&
      type !== 'SVCB'
    )
      continue
    const data = (a as { data?: unknown }).data
    if (!Buffer.isBuffer(data)) continue
    try {
      out.push(parseSvcb(name, data))
    } catch {
      // A malformed record is skipped, the others still count.
    }
  }
  return out.sort((x, y) => x.priority - y.priority)
}

/** The homeserver key a user's `_pubky` record points to, or null. */
export function homeserverOfUser(
  pubkey: string,
  packet: SignedPacket,
): string | null {
  for (const rec of svcbRecords(packet, `_pubky.${pubkey}`)) {
    const target = stripDot(rec.target).toLowerCase()
    const bare =
      target.startsWith('pubky') && target.length === 57
        ? target.slice(5)
        : target
    if (/^[ybndrfg8ejkmcpqxot1uwisza345h769]{52}$/.test(bare)) return bare
  }
  return null
}

export interface HomeserverEndpoints {
  /** ICANN domain the homeserver is reachable at over regular HTTPS, if any. */
  domain: string | null
  domainPort: number | null
  /** Port of the Pubky-TLS endpoint (raw public key TLS). */
  pubkyPort: number | null
  ipv4: Array<string>
  ipv6: Array<string>
}

export function homeserverEndpoints(
  pubkey: string,
  packet: SignedPacket,
): HomeserverEndpoints {
  const ep: HomeserverEndpoints = {
    domain: null,
    domainPort: null,
    pubkyPort: null,
    ipv4: [],
    ipv6: [],
  }
  const v4 = new Set<string>()
  const v6 = new Set<string>()
  for (const rec of svcbRecords(packet, pubkey)) {
    rec.ipv4hint.forEach((ip) => v4.add(ip))
    rec.ipv6hint.forEach((ip) => v6.add(ip))
    if (rec.target === '.' || stripDot(rec.target) === pubkey) {
      ep.pubkyPort ??= rec.port ?? 443
    } else if (!ep.domain) {
      ep.domain = stripDot(rec.target).toLowerCase()
      ep.domainPort = rec.port ?? null
    }
  }
  for (const a of packet.answers) {
    if (stripDot(a.name) !== pubkey) continue
    if (a.type === 'A' && typeof a.data === 'string') v4.add(a.data)
    if (a.type === 'AAAA' && typeof a.data === 'string') v6.add(a.data)
  }
  ep.ipv4 = [...v4]
  ep.ipv6 = [...v6]
  return ep
}

/** TXT strings published under `name` (or under `_netky.name`). */
export function txtValues(packet: SignedPacket, name: string): Array<string> {
  const out: Array<string> = []
  for (const a of packet.answers) {
    const n = stripDot(a.name)
    if (a.type !== 'TXT' || (n !== name && n !== `_netky.${name}`)) continue
    const data = (a as { data?: unknown }).data
    const parts = Array.isArray(data) ? data : [data]
    for (const p of parts)
      if (p != null)
        out.push(Buffer.isBuffer(p) ? p.toString('utf8') : String(p))
  }
  return out
}

const KEY = /^[ybndrfg8ejkmcpqxot1uwisza345h769]{52}$/

/** Value of the first `field=<pubky key>` TXT, accepting a `pubky` prefix. */
export function keyField(
  packet: SignedPacket,
  name: string,
  field: string,
): Array<string> {
  const out: Array<string> = []
  for (const v of txtValues(packet, name)) {
    const m = v
      .trim()
      .match(new RegExp(`^${field}=(?:pubky)?([a-z0-9]{52})$`, 'i'))
    if (m && KEY.test(m[1].toLowerCase())) out.push(m[1].toLowerCase())
  }
  return out
}
