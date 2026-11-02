import { getDb, setMeta, transaction } from './db.ts'
import { lookupIp } from './geo.ts'
import { listNexusUsers } from './nexus.ts'
import {
  type SignedPacket,
  PkarrNotFound,
  homeserverEndpoints,
  homeserverOfUser,
  keyField,
  resolvePacket,
} from './pkarr.ts'
import {
  checkSignup,
  checkTls,
  errorMessage,
  probeHttp,
  probeTcp,
} from './probe.ts'

const HOUR = 3_600_000
const DAY = 24 * HOUR

export const log = (...args: Array<unknown>) =>
  console.log(new Date().toISOString(), ...args)

async function mapLimit<T>(
  items: Array<T>,
  limit: number,
  fn: (item: T) => Promise<void>,
) {
  let i = 0
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (i < items.length) await fn(items[i++])
    },
  )
  await Promise.all(workers)
}

/** Pulls user keys from Nexus. New keys are resolved by resolveUsers(). */
export async function discoverUsers() {
  const ids = await listNexusUsers()
  const now = Date.now()
  const insert = getDb().prepare(
    'INSERT OR IGNORE INTO users (pubkey, first_seen) VALUES (?, ?)',
  )
  let added = 0
  transaction(() => {
    for (const id of ids) added += Number(insert.run(id, now).changes)
  })
  setMeta('last_discovery', String(now))
  log(`discovery: ${ids.length} users listed by Nexus, ${added} new`)
}

/** Reads each user's PKARR record to learn their homeserver. */
export async function resolveUsers(batch = 400) {
  const db = getDb()
  const due = db
    .prepare(
      'SELECT pubkey FROM users WHERE resolved_at IS NULL OR resolved_at < ? ORDER BY resolved_at IS NOT NULL, resolved_at LIMIT ?',
    )
    .all(Date.now() - DAY, batch) as Array<{ pubkey: string }>
  if (!due.length) return
  const update = db.prepare(
    'UPDATE users SET homeserver = ?, resolved_at = ?, record_ts = ?, resolve_error = ? WHERE pubkey = ?',
  )
  let found = 0
  await mapLimit(due, 4, async ({ pubkey }) => {
    try {
      const packet = await resolvePacket(pubkey)
      const hs = homeserverOfUser(pubkey, packet)
      update.run(
        hs,
        Date.now(),
        Number(packet.timestampUs / 1000n),
        hs ? null : 'no _pubky record',
        pubkey,
      )
      if (hs) {
        found++
        registerHomeserver(hs, 'users')
      }
    } catch (e) {
      // Keep the last known homeserver if the relay is just unreachable.
      const error =
        e instanceof PkarrNotFound ? 'no PKARR record' : errorMessage(e)
      db.prepare(
        'UPDATE users SET resolved_at = ?, resolve_error = ? WHERE pubkey = ?',
      ).run(Date.now(), error, pubkey)
    }
  })
  refreshUserCounts()
  log(`resolve users: ${due.length} checked, ${found} with a homeserver`)
}

export function registerHomeserver(
  pubkey: string,
  source: 'users' | 'submitted',
): boolean {
  const res = getDb()
    .prepare(
      'INSERT OR IGNORE INTO homeservers (pubkey, source, first_seen) VALUES (?, ?, ?)',
    )
    .run(pubkey, source, Date.now())
  return res.changes > 0
}

function refreshUserCounts() {
  getDb().exec(`
    UPDATE homeservers SET user_count = (
      SELECT COUNT(*) FROM users WHERE users.homeserver = homeservers.pubkey
    )
  `)
}

/** Reads each homeserver's own PKARR record: domain, ports, IPs, then geo. */
export async function resolveHomeservers(onlyPubkey?: string) {
  const db = getDb()
  const rows = (
    onlyPubkey
      ? db
          .prepare('SELECT pubkey FROM homeservers WHERE pubkey = ?')
          .all(onlyPubkey)
      : db.prepare('SELECT pubkey FROM homeservers').all()
  ) as Array<{ pubkey: string }>
  const update = db.prepare(`
    UPDATE homeservers SET resolved_at = ?, record_ts = ?, resolve_error = NULL, domain = ?, domain_port = ?,
      pubky_port = ?, ipv4 = ?, ipv6 = ?, country = ?, country_name = ?, asn = ?, as_org = ?,
      geo_ip = ?, operator = ?, claim_verified = ?, claim_method = ?, operator_confirmed = ?
    WHERE pubkey = ?`)
  await mapLimit(rows, 4, async ({ pubkey }) => {
    try {
      const packet = await resolvePacket(pubkey)
      const ep = homeserverEndpoints(pubkey, packet)
      // The public domain is how clients reach the server: locate that.
      // Address hints can be private (homeservers behind NAT publish them).
      const hint = [...ep.ipv4, ...ep.ipv6].find(isPublicIp) ?? null
      const ip = (ep.domain ? await resolveDomainIp(ep.domain) : null) ?? hint
      const geo = ip ? await lookupIp(ip) : null
      const claim = await checkClaim(pubkey, packet, ep.domain)
      update.run(
        Date.now(),
        Number(packet.timestampUs / 1000n),
        ep.domain,
        ep.domainPort,
        ep.pubkyPort,
        JSON.stringify(ep.ipv4),
        JSON.stringify(ep.ipv6),
        geo?.country ?? null,
        geo?.countryName ?? null,
        geo?.asn ?? null,
        geo?.asOrg ?? null,
        ip,
        claim.operator,
        claim.verified ? 1 : 0,
        claim.method,
        claim.confirmed ? 1 : 0,
        pubkey,
      )
    } catch (e) {
      const error =
        e instanceof PkarrNotFound ? 'no PKARR record' : errorMessage(e)
      db.prepare(
        'UPDATE homeservers SET resolved_at = ?, resolve_error = ? WHERE pubkey = ?',
      ).run(Date.now(), error, pubkey)
    }
  })
  log(`resolve homeservers: ${rows.length} checked`)
}

/** The operator must confirm with an `operates=<homeserver>` TXT in their own record. */
const KEY_IN_TXT =
  /^operator=(?:pubky)?([ybndrfg8ejkmcpqxot1uwisza345h769]{52})$/i
const USER_AGENT = 'netky/0.1 (+https://netky.pubky.pastalabs.dev/about)'

/**
 * Claims. The server side must be proven by whoever controls the server:
 * a TXT "operator=<key>" at _netky.<domain> (the domain the homeserver's own
 * signed record announces), or a `_netky` TXT in that record for servers
 * that publish it themselves. A stock homeserver rewrites its record every
 * hour, hence DNS as the usual way.
 * The operator then confirms from their own space: a TXT "operates=<server>"
 * in their record, or /pub/netky/operates.txt on their homeserver.
 */
async function checkClaim(
  homeserver: string,
  packet: SignedPacket,
  domain: string | null,
) {
  let operator: string | null =
    keyField(packet, homeserver, 'operator')[0] ?? null
  let method: 'pkarr' | 'dns' | null = operator ? 'pkarr' : null
  if (!operator && domain) {
    operator = await dnsOperator(domain)
    if (operator) method = 'dns'
  }
  if (!operator)
    return { operator: null, verified: false, method: null, confirmed: false }
  return {
    operator,
    verified: true,
    method,
    confirmed: await operatorConfirms(operator, homeserver),
  }
}

async function dnsOperator(domain: string): Promise<string | null> {
  const { resolveTxt } = await import('node:dns/promises')
  try {
    for (const record of await resolveTxt(`_netky.${domain}`)) {
      const m = record.join('').trim().match(KEY_IN_TXT)
      if (m) return m[1].toLowerCase()
    }
  } catch {
    // No record (ENODATA / ENOTFOUND): not claimed.
  }
  return null
}

async function operatorConfirms(
  operator: string,
  homeserver: string,
): Promise<boolean> {
  try {
    const packet = await resolvePacket(operator)
    if (keyField(packet, operator, 'operates').includes(homeserver)) return true
    // Otherwise a public file on the operator's own homeserver.
    const home = homeserverOfUser(operator, packet)
    if (!home) return false
    const ep = homeserverEndpoints(home, await resolvePacket(home))
    if (!ep.domain) return false
    const port =
      ep.domainPort && ep.domainPort !== 443 ? `:${ep.domainPort}` : ''
    const res = await fetch(
      `https://${ep.domain}${port}/pub/netky/operates.txt`,
      {
        headers: { 'pubky-host': operator, 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(10_000),
      },
    )
    if (!res.ok) return false
    const words = (await res.text())
      .slice(0, 20_000)
      .toLowerCase()
      .split(/[\s,;]+/)
    return words.some((w) => w.replace(/^pubky/, '') === homeserver)
  } catch {
    return false
  }
}

export function isPublicIp(ip: string): boolean {
  if (ip.includes(':')) return !/^(::1?$|f[cd]|fe[89ab])/i.test(ip)
  const [a, b] = ip.split('.').map(Number)
  return !(
    a === 10 ||
    a === 127 ||
    a === 0 ||
    a >= 224 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  )
}

async function resolveDomainIp(domain: string): Promise<string | null> {
  const { lookup } = await import('node:dns/promises')
  try {
    return (await lookup(domain, { family: 4 })).address
  } catch {
    try {
      return (await lookup(domain)).address
    } catch {
      return null
    }
  }
}

interface ProbeTarget {
  pubkey: string
  domain: string | null
  domain_port: number | null
  pubky_port: number | null
  ipv4: string | null
  ipv6: string | null
}

/** One passive health check per homeserver. */
export async function probeAll(onlyPubkey?: string) {
  const db = getDb()
  const sql =
    'SELECT pubkey, domain, domain_port, pubky_port, ipv4, ipv6 FROM homeservers WHERE resolved_at IS NOT NULL'
  const rows = (onlyPubkey
    ? db.prepare(`${sql} AND pubkey = ?`).all(onlyPubkey)
    : db.prepare(sql).all()) as unknown as Array<ProbeTarget>
  const insert = db.prepare(
    'INSERT INTO probes (homeserver, at, ok, latency_ms, status, error) VALUES (?, ?, ?, ?, ?, ?)',
  )
  const update = db.prepare(`
    UPDATE homeservers SET last_probe_at = ?, last_ok = ?, last_latency_ms = ?, last_error = ?,
      is_pubky = COALESCE(?, is_pubky), server_header = COALESCE(?, server_header), powered_by = COALESCE(?, powered_by)
    WHERE pubkey = ?`)
  let up = 0
  await mapLimit(rows, 8, async (hs) => {
    const at = Date.now()
    if (hs.domain) {
      const r = await probeHttp(hs.domain, hs.domain_port)
      insert.run(hs.pubkey, at, r.ok ? 1 : 0, r.latencyMs, r.status, r.error)
      update.run(
        at,
        r.ok ? 1 : 0,
        r.latencyMs,
        r.error,
        r.ok ? (r.isPubky ? 1 : 0) : null,
        r.server,
        r.poweredBy,
        hs.pubkey,
      )
      if (r.ok) up++
      return
    }
    const ips = [
      ...(JSON.parse(hs.ipv4 ?? '[]') as Array<string>),
      ...(JSON.parse(hs.ipv6 ?? '[]') as Array<string>),
    ]
    const ip = ips.find(isPublicIp)
    if (!ip || !hs.pubky_port) {
      insert.run(
        hs.pubkey,
        at,
        0,
        null,
        null,
        'no reachable endpoint published',
      )
      update.run(
        at,
        0,
        null,
        'no reachable endpoint published',
        null,
        null,
        null,
        hs.pubkey,
      )
      return
    }
    const r = await probeTcp(ip, hs.pubky_port)
    insert.run(hs.pubkey, at, r.ok ? 1 : 0, r.latencyMs, null, r.error)
    update.run(
      at,
      r.ok ? 1 : 0,
      r.latencyMs,
      r.error,
      null,
      null,
      null,
      hs.pubkey,
    )
    if (r.ok) up++
  })
  if (!onlyPubkey) log(`probe: ${up}/${rows.length} up`)
}

/** Signup mode of every homeserver with a domain. Unknown answers keep the last value. */
export async function checkAllSignups() {
  const db = getDb()
  const rows = db
    .prepare(
      'SELECT pubkey, domain, domain_port FROM homeservers WHERE domain IS NOT NULL AND (is_pubky IS NULL OR is_pubky = 1)',
    )
    .all() as Array<{
    pubkey: string
    domain: string
    domain_port: number | null
  }>
  const update = db.prepare(
    'UPDATE homeservers SET signup_mode = COALESCE(?, signup_mode), signup_checked_at = ? WHERE pubkey = ?',
  )
  let open = 0
  await mapLimit(rows, 4, async (hs) => {
    const mode = await checkSignup(hs.domain, hs.domain_port)
    if (mode === 'open') open++
    update.run(mode, Date.now(), hs.pubkey)
  })
  log(`signups: ${rows.length} checked, ${open} open`)
}

export async function checkAllTls() {
  const db = getDb()
  const rows = db
    .prepare(
      'SELECT pubkey, domain, domain_port FROM homeservers WHERE domain IS NOT NULL',
    )
    .all() as Array<{
    pubkey: string
    domain: string
    domain_port: number | null
  }>
  const update = db.prepare(
    'UPDATE homeservers SET tls_checked_at = ?, tls_ok = ?, tls_issuer = ?, tls_expires_at = ?, tls_error = ? WHERE pubkey = ?',
  )
  await mapLimit(rows, 4, async (hs) => {
    const t = await checkTls(hs.domain, hs.domain_port)
    update.run(
      Date.now(),
      t.ok ? 1 : 0,
      t.issuer,
      t.expiresAt,
      t.error,
      hs.pubkey,
    )
  })
  log(`tls: ${rows.length} checked`)
}

/** Daily counters for the growth chart, and pruning of old probes. */
export function dailySnapshot() {
  const db = getDb()
  const day = new Date().toISOString().slice(0, 10)
  const c = db
    .prepare(
      `
      SELECT
        (SELECT COUNT(*) FROM users) AS users_known,
        (SELECT COUNT(*) FROM users WHERE homeserver IS NOT NULL) AS users_resolved,
        (SELECT COUNT(*) FROM homeservers WHERE resolved_at IS NOT NULL) AS homeservers,
        (SELECT COUNT(*) FROM homeservers WHERE last_ok = 1) AS homeservers_up`,
    )
    .get() as {
    users_known: number
    users_resolved: number
    homeservers: number
    homeservers_up: number
  }
  db.prepare(
    `
    INSERT INTO snapshots (day, users_known, users_resolved, homeservers, homeservers_up) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(day) DO UPDATE SET users_known = excluded.users_known, users_resolved = excluded.users_resolved,
      homeservers = excluded.homeservers, homeservers_up = excluded.homeservers_up`,
  ).run(day, c.users_known, c.users_resolved, c.homeservers, c.homeservers_up)
  db.prepare('DELETE FROM probes WHERE at < ?').run(Date.now() - 90 * DAY)
}
