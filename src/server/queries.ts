// Read side, shared by the pages (server functions) and the public API.
// Only ever imported from server code.
import { getDb } from '#/core/db.ts'
import { OFFICIAL } from '#/lib/official.ts'
import { retiresAt } from '#/lib/retired.ts'
import { type Security, securityScore } from '#/lib/security.ts'

const HOUR = 3_600_000
const DAY = 24 * HOUR

// Networks that front a server with their own edge: the IP says where the
// CDN answered from, not where the homeserver runs.
const CDN_ASNS = new Map([
  [13335, 'Cloudflare'],
  [209242, 'Cloudflare'],
  [54113, 'Fastly'],
  [20940, 'Akamai'],
  [16625, 'Akamai'],
])

export type Status = 'up' | 'down' | 'not-pubky' | 'unresolved'

export interface Homeserver {
  /** Run by Synonym: their production or staging homeserver. */
  official: 'production' | 'staging' | null
  pubkey: string
  status: Status
  /** Gone long enough to leave the list. Its own page and API URL remain. */
  retired: boolean
  /** When it leaves the list if it stays silent; null while it answers. */
  retiresAt: number | null
  domain: string | null
  port: number | null
  pubkyPort: number | null
  users: number
  firstSeen: number
  lastProbeAt: number | null
  latencyMs: number | null
  lastError: string | null
  country: string | null
  countryName: string | null
  asn: number | null
  asOrg: string | null
  cdn: string | null
  uptime24h: number | null
  uptime7d: number | null
  uptime30d: number | null
  tls: {
    ok: boolean
    issuer: string | null
    expiresAt: number | null
    error: string | null
  } | null
  operator: string | null
  /** Whoever controls the server named an operator (DNS or PKARR TXT). */
  claimVerified: boolean
  claimMethod: 'dns' | 'pkarr' | null
  /** The operator confirmed from their own record or homeserver. */
  operatorConfirmed: boolean
  operatorName: string | null
  /** Local URL of the operator's avatar, if one is cached. */
  operatorAvatar: string | null
  /** 'open': anyone can sign up; 'token': invite only; null: unknown. */
  signup: 'open' | 'token' | null
  server: string | null
  /** Last write seen (live) or newest post ID; null while unknown. */
  lastActivityAt: number | null
  events24h: number
  liveness: Liveness | null
  activityIndexing: boolean
  /** Features announced on /info (the closest thing to a version). */
  features: Array<string> | null
  /** The native PubkyTLS port answers (null: none published on a public IP). */
  pubkyTls: boolean | null
  securityHeaders: Array<string> | null
  poweredBy: string | null
  /** Passive security score; null until the server answered over HTTPS. */
  security: Security | null
  readKbps: number | null
  readAt: number | null
  resolveError: string | null
}

interface Row {
  pubkey: string
  domain: string | null
  domain_port: number | null
  pubky_port: number | null
  user_count: number
  first_seen: number
  resolved_at: number | null
  resolve_error: string | null
  last_probe_at: number | null
  last_ok: number | null
  last_alive_at: number | null
  last_latency_ms: number | null
  last_error: string | null
  is_pubky: number | null
  server_header: string | null
  country: string | null
  country_name: string | null
  asn: number | null
  as_org: string | null
  tls_checked_at: number | null
  tls_ok: number | null
  tls_issuer: string | null
  tls_expires_at: number | null
  tls_error: string | null
  operator: string | null
  claim_verified: number
  claim_method: string | null
  operator_confirmed: number
  operator_name: string | null
  operator_avatar: number
  features: string | null
  pubky_tls_ok: number | null
  security_headers: string | null
  powered_by: string | null
  read_kbps: number | null
  read_at: number | null
  signup_mode: string | null
}

function uptimes(pubkey?: string) {
  const now = Date.now()
  const rows = getDb()
    .prepare(
      `SELECT homeserver,
        AVG(CASE WHEN at > ? THEN ok END) AS d1,
        AVG(CASE WHEN at > ? THEN ok END) AS d7,
        AVG(ok) AS d30
      FROM probes WHERE at > ? ${pubkey ? 'AND homeserver = ?' : ''} GROUP BY homeserver`,
    )
    .all(
      ...[
        now - DAY,
        now - 7 * DAY,
        now - 30 * DAY,
        ...(pubkey ? [pubkey] : []),
      ],
    ) as Array<{
    homeserver: string
    d1: number | null
    d7: number | null
    d30: number | null
  }>
  return new Map(rows.map((r) => [r.homeserver, r]))
}

function statusOf(r: Row): Status {
  if (!r.domain && !r.pubky_port) return 'unresolved'
  // Something answers, but not a homeserver. If this key once did answer as
  // one, it is gone (a reverse proxy now answers for it), not something else.
  if (r.last_ok === 1 && r.is_pubky === 0)
    return r.last_alive_at == null ? 'not-pubky' : 'down'
  return r.last_ok === 1 ? 'up' : 'down'
}

const pct = (v: number | null | undefined) =>
  v == null ? null : Math.round(v * 1000) / 10

function toHomeserver(
  r: Row,
  up?: { d1: number | null; d7: number | null; d30: number | null },
  act?: ActivitySummary,
): Homeserver {
  const cdn = r.asn != null ? (CDN_ASNS.get(r.asn) ?? null) : null
  const status = statusOf(r)
  const answering = status === 'up' || status === 'not-pubky'
  const leaves = retiresAt(status, r.last_alive_at, r.first_seen)
  const base: Omit<Homeserver, 'security'> = {
    pubkey: r.pubkey,
    official: OFFICIAL[r.pubkey] ?? null,
    status,
    retired: leaves != null && leaves <= Date.now(),
    retiresAt: leaves,
    domain: r.domain,
    port: r.domain_port,
    pubkyPort: r.pubky_port,
    users: r.user_count,
    firstSeen: r.first_seen,
    lastProbeAt: r.last_probe_at,
    latencyMs: answering ? r.last_latency_ms : null,
    lastError: answering ? null : r.last_error,
    country: cdn ? null : r.country,
    countryName: cdn ? null : r.country_name,
    asn: r.asn,
    asOrg: r.as_org,
    cdn,
    uptime24h: pct(up?.d1),
    uptime7d: pct(up?.d7),
    uptime30d: pct(up?.d30),
    tls:
      r.tls_checked_at == null
        ? null
        : {
            ok: r.tls_ok === 1,
            issuer: r.tls_issuer,
            expiresAt: r.tls_expires_at,
            error: r.tls_error,
          },
    operator: r.operator,
    claimVerified: r.claim_verified === 1,
    claimMethod:
      r.claim_method === 'dns' || r.claim_method === 'pkarr'
        ? r.claim_method
        : null,
    operatorConfirmed: r.operator_confirmed === 1,
    // Name and avatar only once the operator confirmed: otherwise anyone could
    // name a well-known key in their own DNS and borrow its face.
    operatorName:
      r.operator && r.operator_confirmed === 1 ? r.operator_name : null,
    operatorAvatar:
      r.operator && r.operator_confirmed === 1 && r.operator_avatar === 1
        ? `/avatars/${r.operator}`
        : null,
    signup:
      r.signup_mode === 'open' || r.signup_mode === 'token'
        ? r.signup_mode
        : null,
    server: r.server_header,
    lastActivityAt: act?.lastActivityAt ?? null,
    events24h: act?.events24h ?? 0,
    liveness: act?.liveness ?? null,
    activityIndexing: act?.indexing ?? false,
    features: r.features ? (JSON.parse(r.features) as Array<string>) : null,
    pubkyTls: r.pubky_tls_ok == null ? null : r.pubky_tls_ok === 1,
    securityHeaders: r.security_headers
      ? (JSON.parse(r.security_headers) as Array<string>)
      : null,
    poweredBy: r.powered_by,
    readKbps: r.read_kbps,
    readAt: r.read_at,
    resolveError: r.resolve_error,
  }
  // No score for something that is not a Pubky homeserver.
  return {
    ...base,
    security: base.status === 'not-pubky' ? null : securityScore(base),
  }
}

const ORDER: Record<Status, number> = {
  up: 0,
  down: 1,
  'not-pubky': 2,
  unresolved: 3,
}

export function listHomeservers(): Array<Homeserver> {
  const rows = getDb()
    .prepare('SELECT * FROM homeservers')
    .all() as unknown as Array<Row>
  const up = uptimes()
  const acts = activitySummaries()
  return rows
    .map((r) => toHomeserver(r, up.get(r.pubkey), acts.get(r.pubkey)))
    .filter((h) => !h.retired)
    .sort(
      (a, b) =>
        ORDER[a.status] - ORDER[b.status] ||
        b.users - a.users ||
        a.pubkey.localeCompare(b.pubkey),
    )
}

export function getHomeserver(pubkey: string): Homeserver | null {
  const row = getDb()
    .prepare('SELECT * FROM homeservers WHERE pubkey = ?')
    .get(pubkey) as Row | undefined
  return row
    ? toHomeserver(
        row,
        uptimes(pubkey).get(pubkey),
        activitySummaries().get(pubkey),
      )
    : null
}

export interface Probe {
  at: number
  ok: boolean
  latencyMs: number | null
  error: string | null
}

/** Probes of the last `hours`, oldest first. */
export function recentProbes(pubkey: string, hours = 48): Array<Probe> {
  const rows = getDb()
    .prepare(
      'SELECT at, ok, latency_ms, error FROM probes WHERE homeserver = ? AND at > ? ORDER BY at',
    )
    .all(pubkey, Date.now() - hours * HOUR) as Array<{
    at: number
    ok: number
    latency_ms: number | null
    error: string | null
  }>
  return rows.map((r) => ({
    at: r.at,
    ok: r.ok === 1,
    latencyMs: r.latency_ms,
    error: r.error,
  }))
}

export interface NetworkStats {
  homeservers: number
  up: number
  claimed: number
  /** Events across all live homeservers, the last 24 hours. */
  events24h: number
  ghosts: number
  openSignups: number
  usersKnown: number
  usersResolved: number
  countries: number
  /** Share of resolved users on the busiest homeserver, 0-100. */
  topShare: number | null
  lastProbeAt: number | null
  lastDiscoveryAt: number | null
  history: Array<{
    day: string
    homeservers: number
    up: number
    users: number
  }>
}

export function networkStats(list = listHomeservers()): NetworkStats {
  const db = getDb()
  const u = db
    .prepare(
      'SELECT COUNT(*) AS known, SUM(homeserver IS NOT NULL) AS resolved FROM users',
    )
    .get() as { known: number; resolved: number | null }
  const meta = db
    .prepare("SELECT value FROM meta WHERE key = 'last_discovery'")
    .get() as { value: string } | undefined
  const history = db
    .prepare(
      'SELECT day, homeservers, homeservers_up, users_resolved FROM snapshots ORDER BY day DESC LIMIT 90',
    )
    .all() as Array<{
    day: string
    homeservers: number
    homeservers_up: number
    users_resolved: number
  }>
  const real = list.filter((h) => h.status === 'up' || h.status === 'down')
  const resolved = u.resolved ?? 0
  const top = Math.max(0, ...list.map((h) => h.users))
  return {
    homeservers: real.length,
    up: real.filter((h) => h.status === 'up').length,
    claimed: real.filter((h) => h.claimVerified).length,
    events24h: list.reduce((a, h) => a + h.events24h, 0),
    ghosts: real.filter((h) => h.liveness === 'ghost').length,
    openSignups: real.filter((h) => h.status === 'up' && h.signup === 'open')
      .length,
    usersKnown: u.known,
    usersResolved: resolved,
    countries: new Set(real.map((h) => h.country).filter(Boolean)).size,
    topShare: resolved ? Math.round((top / resolved) * 1000) / 10 : null,
    lastProbeAt: Math.max(0, ...list.map((h) => h.lastProbeAt ?? 0)) || null,
    lastDiscoveryAt: meta ? Number(meta.value) : null,
    history: history.reverse().map((h) => ({
      day: h.day,
      homeservers: h.homeservers,
      up: h.homeservers_up,
      users: h.users_resolved,
    })),
  }
}

// --- Social activity (from the /events/ feeds) and the 30-day uptime ---

export type Liveness = 'active' | 'quiet' | 'ghost'

interface FeedRow {
  homeserver: string
  backfilled: number
  live_since: number | null
  events_total: number
  last_event_at: number | null
  last_post_at: number | null
}

export interface ActivitySummary {
  lastActivityAt: number | null
  events24h: number
  /**
   * active: activity within 7 days; quiet: within 30; ghost: last dated
   * activity over 30 days ago and no write during 7+ days of live watching.
   * null while unknown.
   */
  liveness: Liveness | null
  /** Still reading the server's history: no verdict yet. */
  indexing: boolean
}

function liveness(f: FeedRow | undefined, now: number): ActivitySummary {
  if (!f)
    return {
      lastActivityAt: null,
      events24h: 0,
      liveness: null,
      indexing: false,
    }
  const last = Math.max(f.last_event_at ?? 0, f.last_post_at ?? 0) || null
  let l: Liveness | null = null
  if (last && now - last < 7 * DAY) l = 'active'
  else if (last && now - last < 30 * DAY) l = 'quiet'
  // Only posts are dated in the history; follows, tags… are not. So a ghost
  // also needs a week of live watching with no write at all.
  else if (
    f.live_since &&
    now - f.live_since > 7 * DAY &&
    (!f.last_event_at || now - f.last_event_at > 7 * DAY)
  )
    l = 'ghost'
  // The end of the feed is read live from the first pass, so the verdict holds
  // even while the history is still being read.
  return {
    lastActivityAt: last,
    events24h: 0,
    liveness: l,
    indexing: f.backfilled !== 1,
  }
}

/** Last activity, events of the last 24 h and liveness of every homeserver. */
export function activitySummaries(): Map<string, ActivitySummary> {
  const db = getDb()
  const now = Date.now()
  const feeds = db
    .prepare('SELECT * FROM feed_state')
    .all() as unknown as Array<FeedRow>
  const counts = new Map(
    (
      db
        .prepare(
          'SELECT homeserver, SUM(count) AS n FROM feed_hourly WHERE hour >= ? GROUP BY homeserver',
        )
        .all(now - DAY) as Array<{ homeserver: string; n: number }>
    ).map((r) => [r.homeserver, r.n]),
  )
  return new Map(
    feeds.map((f) => [
      f.homeserver,
      { ...liveness(f, now), events24h: counts.get(f.homeserver) ?? 0 },
    ]),
  )
}

export interface Activity extends ActivitySummary {
  backfilled: boolean
  liveSince: number | null
  eventsTotal: number
  /** Writes and deletes by kind, all time. */
  byKind: Array<{ kind: string; put: number; del: number }>
  /** Events per hour, the last 24 hours, oldest first (only since live tracking). */
  hourly: Array<number>
  events7d: number
  activeUsers24h: number
  activeUsers7d: number
  apps: Array<{ app: string; events: number; lastSeenAt: number | null }>
  /** Posts per day over the last 30 days, from post IDs. */
  postsDaily: Array<{ day: string; count: number }>
}

export function activity(pubkey: string): Activity | null {
  const db = getDb()
  const now = Date.now()
  const f = db
    .prepare('SELECT * FROM feed_state WHERE homeserver = ?')
    .get(pubkey) as FeedRow | undefined
  if (!f) return null
  const hourStart = Math.floor(now / HOUR) * HOUR
  const hourlyRows = db
    .prepare(
      'SELECT hour, SUM(count) AS n FROM feed_hourly WHERE homeserver = ? AND hour > ? GROUP BY hour',
    )
    .all(pubkey, hourStart - 24 * HOUR) as Array<{ hour: number; n: number }>
  const byHour = new Map(hourlyRows.map((r) => [r.hour, r.n]))
  const hourly = Array.from(
    { length: 24 },
    (_, i) => byHour.get(hourStart - (23 - i) * HOUR) ?? 0,
  )
  const kinds = db
    .prepare('SELECT kind, op, count FROM feed_counts WHERE homeserver = ?')
    .all(pubkey) as Array<{ kind: string; op: string; count: number }>
  const byKind = new Map<string, { kind: string; put: number; del: number }>()
  for (const k of kinds) {
    const e = byKind.get(k.kind) ?? { kind: k.kind, put: 0, del: 0 }
    if (k.op === 'DEL') e.del += k.count
    else e.put += k.count
    byKind.set(k.kind, e)
  }
  const users = db
    .prepare(
      'SELECT SUM(last_seen_at > ?) AS d1, SUM(last_seen_at > ?) AS d7 FROM feed_users WHERE homeserver = ?',
    )
    .get(now - DAY, now - 7 * DAY, pubkey) as {
    d1: number | null
    d7: number | null
  }
  const events7d =
    (
      db
        .prepare(
          'SELECT SUM(count) AS n FROM feed_hourly WHERE homeserver = ? AND hour >= ?',
        )
        .get(pubkey, now - 7 * DAY) as { n: number | null }
    ).n ?? 0
  const apps = (
    db
      .prepare(
        'SELECT app, events, last_seen_at FROM feed_apps WHERE homeserver = ? ORDER BY events DESC LIMIT 40',
      )
      .all(pubkey) as Array<{
      app: string
      events: number
      last_seen_at: number | null
    }>
  ).map((a) => ({ app: a.app, events: a.events, lastSeenAt: a.last_seen_at }))
  const firstDay = new Date(now - 29 * DAY).toISOString().slice(0, 10)
  const daily = new Map(
    (
      db
        .prepare(
          'SELECT day, count FROM feed_posts_daily WHERE homeserver = ? AND day >= ?',
        )
        .all(pubkey, firstDay) as Array<{ day: string; count: number }>
    ).map((d) => [d.day, d.count]),
  )
  const postsDaily = Array.from({ length: 30 }, (_, i) => {
    const day = new Date(now - (29 - i) * DAY).toISOString().slice(0, 10)
    return { day, count: daily.get(day) ?? 0 }
  })
  return {
    ...liveness(f, now),
    events24h: hourly.reduce((a, b) => a + b, 0),
    backfilled: f.backfilled === 1,
    liveSince: f.live_since,
    eventsTotal: f.events_total,
    byKind: [...byKind.values()].sort(
      (a, b) => b.put + b.del - (a.put + a.del),
    ),
    hourly,
    events7d,
    activeUsers24h: users.d1 ?? 0,
    activeUsers7d: users.d7 ?? 0,
    apps,
    postsDaily,
  }
}

/** Share of successful checks per day, the last 30 days, oldest first. */
export function uptimeDaily(
  pubkey: string,
): Array<{ day: string; uptime: number | null; checks: number }> {
  const now = Date.now()
  const rows = getDb()
    .prepare(
      `SELECT strftime('%Y-%m-%d', at / 1000, 'unixepoch') AS day, AVG(ok) AS up, COUNT(*) AS n
       FROM probes WHERE homeserver = ? AND at > ? GROUP BY day`,
    )
    .all(pubkey, now - 30 * DAY) as Array<{
    day: string
    up: number
    n: number
  }>
  const byDay = new Map(rows.map((r) => [r.day, r]))
  return Array.from({ length: 30 }, (_, i) => {
    const day = new Date(now - (29 - i) * DAY).toISOString().slice(0, 10)
    const r = byDay.get(day)
    return {
      day,
      uptime: r ? Math.round(r.up * 1000) / 10 : null,
      checks: r?.n ?? 0,
    }
  })
}
