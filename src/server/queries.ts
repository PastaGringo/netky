// Read side, shared by the pages (server functions) and the public API.
// Only ever imported from server code.
import { getDb } from '#/core/db.ts'

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
  pubkey: string
  status: Status
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
  if (r.last_ok === 1 && r.is_pubky === 0) return 'not-pubky'
  return r.last_ok === 1 ? 'up' : 'down'
}

const pct = (v: number | null | undefined) =>
  v == null ? null : Math.round(v * 1000) / 10

function toHomeserver(
  r: Row,
  up?: { d1: number | null; d7: number | null; d30: number | null },
): Homeserver {
  const cdn = r.asn != null ? (CDN_ASNS.get(r.asn) ?? null) : null
  return {
    pubkey: r.pubkey,
    status: statusOf(r),
    domain: r.domain,
    port: r.domain_port,
    pubkyPort: r.pubky_port,
    users: r.user_count,
    firstSeen: r.first_seen,
    lastProbeAt: r.last_probe_at,
    latencyMs: r.last_ok === 1 ? r.last_latency_ms : null,
    lastError: r.last_ok === 1 ? null : r.last_error,
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
    resolveError: r.resolve_error,
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
  return rows
    .map((r) => toHomeserver(r, up.get(r.pubkey)))
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
  return row ? toHomeserver(row, uptimes(pubkey).get(pubkey)) : null
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
