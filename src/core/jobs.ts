import { DATA_DIR, getDb, setMeta, transaction } from './db.ts'
import { lookupIp } from './geo.ts'
import {
  FEED_PAGE,
  type FeedEvent,
  classify,
  fetchFeed,
  findFeedHead,
  RateLimited,
  sleep,
  postTime,
} from './feed.ts'
import { fetchProfile, listNexusUsers } from './nexus.ts'
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
  fetchFeatures,
  readTest,
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
      geo_ip = ?, operator = ?, claim_verified = ?, claim_method = ?, operator_confirmed = ?,
      operator_name = ?, operator_avatar = ?
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
      const previous = db
        .prepare(
          'SELECT operator, claim_verified, claim_method, operator_confirmed, operator_name, operator_avatar FROM homeservers WHERE pubkey = ?',
        )
        .get(pubkey) as PreviousClaim | undefined
      const claim = await checkClaim(pubkey, packet, ep.domain, previous)
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
        claim.profile?.name ?? null,
        claim.profile?.avatar ? 1 : 0,
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
export const avatarPath = (pubkey: string) => `${DATA_DIR}/avatars/${pubkey}`

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
interface PreviousClaim {
  operator: string | null
  claim_verified: number
  claim_method: string | null
  operator_confirmed: number
  operator_name: string | null
  operator_avatar: number
}

/**
 * A lookup that fails for a reason other than "no such record" keeps what we
 * knew: a DNS or network hiccup must not erase a claim or a confirmation.
 */
async function checkClaim(
  homeserver: string,
  packet: SignedPacket,
  domain: string | null,
  previous: PreviousClaim | undefined,
) {
  const kept = {
    operator: previous?.operator ?? null,
    verified: previous?.claim_verified === 1,
    method: (previous?.claim_method ?? null) as 'pkarr' | 'dns' | null,
    confirmed: previous?.operator_confirmed === 1,
    profile: {
      name: previous?.operator_name ?? null,
      avatar: previous?.operator_avatar === 1,
    },
  }
  let operator: string | null =
    keyField(packet, homeserver, 'operator')[0] ?? null
  let method: 'pkarr' | 'dns' | null = operator ? 'pkarr' : null
  if (!operator && domain) {
    const dns = await dnsOperator(domain)
    if (dns === undefined) return kept
    operator = dns
    if (operator) method = 'dns'
  }
  if (!operator)
    return {
      operator: null,
      verified: false,
      method: null,
      confirmed: false,
      profile: null,
    }
  const [confirmed, profile] = await Promise.all([
    operatorConfirms(operator, homeserver),
    fetchProfile(operator, avatarPath(operator)),
  ])
  const same = operator === previous?.operator
  return {
    operator,
    verified: true,
    method,
    confirmed: confirmed ?? (same && kept.confirmed),
    profile: {
      name: profile.name ?? (same ? kept.profile.name : null),
      avatar: profile.avatar || (same && kept.profile.avatar),
    },
  }
}

/** The operator key from _netky.<domain>, null if none, undefined if DNS failed. */
async function dnsOperator(domain: string): Promise<string | null | undefined> {
  const { resolveTxt } = await import('node:dns/promises')
  try {
    for (const record of await resolveTxt(`_netky.${domain}`)) {
      const m = record.join('').trim().match(KEY_IN_TXT)
      if (m) return m[1].toLowerCase()
    }
    return null
  } catch (e) {
    const code = (e as { code?: string }).code
    if (code === 'ENODATA' || code === 'ENOTFOUND') return null
    log(
      `dns: _netky.${domain} lookup failed (${code ?? errorMessage(e)}), keeping the last claim`,
    )
    return undefined
  }
}

async function operatorConfirms(
  operator: string,
  homeserver: string,
): Promise<boolean | null> {
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
    if (res.status === 404) return false
    if (!res.ok) return null
    const words = (await res.text())
      .slice(0, 20_000)
      .toLowerCase()
      .split(/[\s,;]+/)
    return words.some((w) => w.replace(/^pubky/, '') === homeserver)
  } catch {
    // Unreachable right now: unknown, not a refusal.
    return null
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
      is_pubky = COALESCE(?, is_pubky), server_header = COALESCE(?, server_header), powered_by = COALESCE(?, powered_by),
      security_headers = COALESCE(?, security_headers)
    WHERE pubkey = ?`)
  const alive = db.prepare(
    'UPDATE homeservers SET last_alive_at = ? WHERE pubkey = ?',
  )
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
        r.securityHeaders ? JSON.stringify(r.securityHeaders) : null,
        hs.pubkey,
      )
      if (r.ok && r.isPubky) alive.run(at, hs.pubkey)
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
        null,
        hs.pubkey,
      )
      return
    }
    const r = await probeTcp(ip, hs.pubky_port)
    insert.run(hs.pubkey, at, r.ok ? 1 : 0, r.latencyMs, null, r.error)
    if (r.ok) alive.run(at, hs.pubkey)
    update.run(
      at,
      r.ok ? 1 : 0,
      r.latencyMs,
      r.error,
      null,
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
  db.prepare('DELETE FROM feed_hourly WHERE hour < ?').run(
    Date.now() - 31 * DAY,
  )
  db.prepare('DELETE FROM feed_users WHERE last_seen_at < ?').run(
    Date.now() - 31 * DAY,
  )
}

const FEED_MAX_PAGES = 10 // per server and pass: 10 000 events at most

/**
 * Reads every live homeserver's /events/ feed from where it stopped. The
 * history (backfill) feeds totals, apps and post dates; once the history is
 * read, new events are also dated (hourly activity, active users).
 */
export async function syncFeeds(onlyPubkey?: string) {
  const db = getDb()
  const sql = `SELECT pubkey, domain, domain_port FROM homeservers
    WHERE domain IS NOT NULL AND last_ok = 1 AND (is_pubky IS NULL OR is_pubky = 1)`
  const servers = (
    onlyPubkey
      ? db.prepare(`${sql} AND pubkey = ?`).all(onlyPubkey)
      : db.prepare(sql).all()
  ) as Array<{ pubkey: string; domain: string; domain_port: number | null }>
  let total = 0
  await mapLimit(servers, 2, async (hs) => {
    total += await syncFeed(hs.pubkey, hs.domain, hs.domain_port)
  })
  if (!onlyPubkey) log(`feeds: ${servers.length} servers, ${total} new events`)
}

interface FeedStateRow {
  cursor: string
  backfilled: number
  live_cursor: string | null
  backfill_end: string | null
}

/**
 * Two readers per server. The live one follows the end of the feed and dates
 * what it reads, from the first pass on. While the history is not fully read,
 * a second one reads it from the start up to where live reading began, so no
 * event is counted twice. Cursors are event numbers.
 */
async function syncFeed(
  pubkey: string,
  domain: string,
  port: number | null,
): Promise<number> {
  const db = getDb()
  db.prepare('INSERT OR IGNORE INTO feed_state (homeserver) VALUES (?)').run(
    pubkey,
  )
  const state = db
    .prepare(
      'SELECT cursor, backfilled, live_cursor, backfill_end FROM feed_state WHERE homeserver = ?',
    )
    .get(pubkey) as unknown as FeedStateRow
  const now = Date.now()
  const paused = db
    .prepare('SELECT pause_until FROM feed_state WHERE homeserver = ?')
    .get(pubkey) as {
    pause_until: number | null
  }
  if (paused.pause_until && paused.pause_until > now) return 0
  const hour = Math.floor(now / HOUR) * HOUR
  const save = db.prepare(
    'UPDATE feed_state SET events_total = events_total + ?, checked_at = ?, error = NULL WHERE homeserver = ?',
  )
  let seen = 0
  try {
    if (state.backfilled) {
      // History done: `cursor` is the live reader.
      seen += await readFeed(
        domain,
        port,
        state.cursor,
        null,
        (events, next) => {
          transaction(() => recordEvents(pubkey, events, now, hour))
          db.prepare(
            'UPDATE feed_state SET cursor = ? WHERE homeserver = ?',
          ).run(next, pubkey)
          save.run(events.length, now, pubkey)
        },
      )
      db.prepare(
        'UPDATE feed_state SET checked_at = ?, error = NULL WHERE homeserver = ?',
      ).run(now, pubkey)
      return seen
    }

    let live = state.live_cursor
    let end = state.backfill_end
    if (live == null || end == null) {
      const head = await findFeedHead(domain, port)
      live = end = String(head)
      db.prepare(
        'UPDATE feed_state SET live_cursor = ?, backfill_end = ?, live_since = COALESCE(live_since, ?) WHERE homeserver = ?',
      ).run(live, end, now, pubkey)
    }
    // Live first, so recent activity shows up even mid-history.
    seen += await readFeed(domain, port, live, null, (events, next) => {
      transaction(() => recordEvents(pubkey, events, now, hour))
      db.prepare(
        'UPDATE feed_state SET live_cursor = ? WHERE homeserver = ?',
      ).run(next, pubkey)
      save.run(events.length, now, pubkey)
    })
    // Then a slice of history, never past where live reading began.
    let done = false
    seen += await readFeed(
      domain,
      port,
      state.cursor,
      Number(end),
      (events, next, reachedEnd) => {
        transaction(() => recordEvents(pubkey, events, null, hour))
        db.prepare('UPDATE feed_state SET cursor = ? WHERE homeserver = ?').run(
          next,
          pubkey,
        )
        save.run(events.length, now, pubkey)
        done = reachedEnd
      },
    )
    if (done || Number(state.cursor) >= Number(end)) {
      // History read: the live cursor becomes the only one.
      db.prepare(
        'UPDATE feed_state SET backfilled = 1, cursor = live_cursor, live_cursor = NULL WHERE homeserver = ?',
      ).run(pubkey)
    }
    db.prepare(
      'UPDATE feed_state SET checked_at = ?, error = NULL WHERE homeserver = ?',
    ).run(now, pubkey)
  } catch (e) {
    if (e instanceof RateLimited)
      db.prepare(
        'UPDATE feed_state SET pause_until = ? WHERE homeserver = ?',
      ).run(now + e.retryAfterSeconds * 1000, pubkey)
    db.prepare(
      'UPDATE feed_state SET checked_at = ?, error = ? WHERE homeserver = ?',
    ).run(now, errorMessage(e), pubkey)
  }
  return seen
}

/**
 * Reads up to FEED_MAX_PAGES pages from `cursor`. With `until`, stops at that
 * event number (limits the last page so as not to read past it).
 */
async function readFeed(
  domain: string,
  port: number | null,
  cursor: string,
  until: number | null,
  onPage: (events: Array<FeedEvent>, next: string, reachedEnd: boolean) => void,
): Promise<number> {
  let seen = 0
  for (let page = 0; page < FEED_MAX_PAGES; page++) {
    if (page) await sleep(500) // one page every half second at most
    let limit = FEED_PAGE
    if (until != null) {
      const left = until - Number(cursor)
      if (!(left > 0)) {
        onPage([], cursor, true)
        break
      }
      limit = Math.min(FEED_PAGE, left)
    }
    const { events, cursor: next } = await fetchFeed(
      domain,
      port,
      cursor,
      limit,
    )
    const reachedEnd =
      events.length < limit || (until != null && Number(next) >= until)
    onPage(events, next, reachedEnd)
    seen += events.length
    cursor = next
    if (reachedEnd) break
  }
  return seen
}

function recordEvents(
  pubkey: string,
  events: Array<FeedEvent>,
  at: number | null,
  hour: number,
) {
  const db = getDb()
  const counts = new Map<string, number>()
  const hourly = new Map<string, number>()
  const apps = new Map<string, number>()
  const days = new Map<string, number>()
  const users = new Set<string>()
  let lastPost: number | null = null
  let blob: string | null = null
  for (const ev of events) {
    const { app, kind } = classify(ev.path)
    counts.set(`${kind}|${ev.op}`, (counts.get(`${kind}|${ev.op}`) ?? 0) + 1)
    apps.set(app, (apps.get(app) ?? 0) + 1)
    if (at != null) {
      hourly.set(kind, (hourly.get(kind) ?? 0) + 1)
      users.add(ev.user)
    }
    if (ev.op === 'PUT') {
      const t = postTime(ev.path)
      if (t != null) {
        lastPost = Math.max(lastPost ?? 0, t)
        const day = new Date(t).toISOString().slice(0, 10)
        days.set(day, (days.get(day) ?? 0) + 1)
      }
      if (kind === 'file' && ev.path.includes('/blobs/'))
        blob = `${ev.user}/pub/${ev.path}`
    }
  }
  const upCount = db.prepare(
    'INSERT INTO feed_counts (homeserver, kind, op, count) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET count = count + excluded.count',
  )
  for (const [key, n] of counts) {
    const [kind, op] = key.split('|')
    upCount.run(pubkey, kind, op, n)
  }
  const upApp = db.prepare(
    'INSERT INTO feed_apps (homeserver, app, events, last_seen_at) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET events = events + excluded.events, last_seen_at = COALESCE(excluded.last_seen_at, last_seen_at)',
  )
  for (const [app, n] of apps) upApp.run(pubkey, app, n, at)
  const upDay = db.prepare(
    'INSERT INTO feed_posts_daily (homeserver, day, count) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET count = count + excluded.count',
  )
  for (const [day, n] of days) upDay.run(pubkey, day, n)
  if (at != null) {
    const upHour = db.prepare(
      'INSERT INTO feed_hourly (homeserver, hour, kind, count) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET count = count + excluded.count',
    )
    for (const [kind, n] of hourly) upHour.run(pubkey, hour, kind, n)
    const upUser = db.prepare(
      'INSERT INTO feed_users (homeserver, user, last_seen_at) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET last_seen_at = excluded.last_seen_at',
    )
    for (const u of users) upUser.run(pubkey, u, at)
    db.prepare(
      'UPDATE feed_state SET last_event_at = ? WHERE homeserver = ?',
    ).run(at, pubkey)
  }
  if (lastPost != null)
    db.prepare(
      'UPDATE feed_state SET last_post_at = MAX(COALESCE(last_post_at, 0), ?) WHERE homeserver = ?',
    ).run(lastPost, pubkey)
  if (blob)
    db.prepare(
      'UPDATE feed_state SET sample_blob = ? WHERE homeserver = ?',
    ).run(blob, pubkey)
}

/** Every 6 h: features from /info, and whether the native PubkyTLS port answers. */
export async function checkCapabilities() {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT pubkey, domain, domain_port, pubky_port, ipv4, ipv6, geo_ip FROM homeservers
       WHERE resolved_at IS NOT NULL AND (is_pubky IS NULL OR is_pubky = 1)`,
    )
    .all() as Array<{
    pubkey: string
    domain: string | null
    domain_port: number | null
    pubky_port: number | null
    ipv4: string | null
    ipv6: string | null
  }>
  const update = db.prepare(
    'UPDATE homeservers SET features = COALESCE(?, features), pubky_tls_ok = ? WHERE pubkey = ?',
  )
  await mapLimit(rows, 4, async (hs) => {
    const features = hs.domain
      ? await fetchFeatures(hs.domain, hs.domain_port)
      : null
    let tls: number | null = null
    const ips = [
      ...(JSON.parse(hs.ipv4 ?? '[]') as Array<string>),
      ...(JSON.parse(hs.ipv6 ?? '[]') as Array<string>),
    ].filter(isPublicIp)
    if (hs.pubky_port && ips.length)
      tls = (await probeTcp(ips[0], hs.pubky_port)).ok ? 1 : 0
    update.run(features ? JSON.stringify(features) : null, tls, hs.pubkey)
  })
  log(`capabilities: ${rows.length} checked`)
}

/** Once a day: download one public file per server to measure read speed. */
export async function readTests() {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT h.pubkey, h.domain, h.domain_port, f.sample_blob FROM homeservers h
       JOIN feed_state f ON f.homeserver = h.pubkey
       WHERE h.domain IS NOT NULL AND h.last_ok = 1 AND f.sample_blob IS NOT NULL`,
    )
    .all() as Array<{
    pubkey: string
    domain: string
    domain_port: number | null
    sample_blob: string
  }>
  const update = db.prepare(
    'UPDATE homeservers SET read_kbps = ?, read_bytes = ?, read_at = ? WHERE pubkey = ?',
  )
  for (const hs of rows) {
    const slash = hs.sample_blob.indexOf('/pub/')
    const user = hs.sample_blob.slice(0, slash)
    const path = hs.sample_blob.slice(slash + 5)
    const r = await readTest(hs.domain, hs.domain_port, user, path)
    if (r) update.run(r.kbps, r.bytes, Date.now(), hs.pubkey)
  }
  log(`read tests: ${rows.length} servers`)
}
