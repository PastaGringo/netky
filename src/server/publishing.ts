// What the application account publishes: a daily report on the network, and
// an announcement for each new homeserver. Both are off until the admin turns
// them on. Used by the admin pages and by the worker's publishing process.
import { getDb, getMeta, setMeta } from '#/core/db.ts'
import { hasAppAccount, publishPost } from '#/core/publisher.ts'
import { listHomeservers, networkStats } from './queries.ts'
import type { Homeserver } from './queries.ts'

const SITE = 'https://netky.pubky.pastalabs.dev'
const HOUR = 3_600_000
const DAY = 24 * HOUR
export const DAILY_HOUR_UTC = 8
export const MAX_ANNOUNCES_PER_DAY = 3
export const ANNOUNCE_AFTER_MS = DAY
export const ANNOUNCE_MIN_UPTIME = 90

type Post = (content: string) => Promise<string>

// A domain is chosen by whoever runs the server, and Netky would publish it.
// Plain ASCII names only (xn-- can imitate another domain), no throwaway ones.
const PLAIN_DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/
const THROWAWAY =
  /(^|\.)(trycloudflare\.com|ngrok\.io|ngrok\.app|ngrok\.dev|ngrok-free\.app|ngrok-free\.dev|loca\.lt|localhost\.run|serveo\.net|oast\.[a-z]+)$/

export function isAnnounceable(h: Homeserver, now = Date.now()): boolean {
  const d = h.domain
  return (
    h.status === 'up' &&
    !!d &&
    d.length <= 80 &&
    PLAIN_DOMAIN.test(d) &&
    !d.includes('xn--') &&
    !THROWAWAY.test(d) &&
    now - h.firstSeen >= ANNOUNCE_AFTER_MS &&
    (h.uptime24h ?? 0) >= ANNOUNCE_MIN_UPTIME
  )
}

function flagEmoji(country: string) {
  return String.fromCodePoint(
    ...[...country.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)),
  )
}

export function composeAnnouncement(h: Homeserver): string {
  const facts: Array<string> = []
  if (h.cdn) facts.push(`behind ${h.cdn}`)
  else if (h.country && h.countryName)
    facts.push(`${flagEmoji(h.country)} ${h.countryName}`)
  if (h.signup === 'open') facts.push('open signups')
  if (h.signup === 'token') facts.push('invite only')
  return [
    `🛰️ New homeserver on the Pubky network: ${h.domain}`,
    ...(facts.length ? ['', facts.join(' · ')] : []),
    // A name only once the operator confirmed it: anyone can name a key.
    ...(h.operatorConfirmed && h.operatorName
      ? ['', `Run by ${h.operatorName}`]
      : []),
    '',
    `${SITE}/hs/${h.pubkey}`,
  ].join('\n')
}

export function composeDailyReport(
  now = Date.now(),
  list = listHomeservers(),
): string {
  const s = networkStats(list)
  const today = new Date(now).toISOString().slice(0, 10)
  const yesterday = new Date(now - DAY).toISOString().slice(0, 10)
  const before = s.history.find((h) => h.day === yesterday)
  const delta = before ? s.usersResolved - before.users : 0
  const change = delta
    ? ` (${delta > 0 ? '+' : ''}${delta.toLocaleString('en-US')} since yesterday)`
    : ''
  const lines = [
    `📡 Pubky network, ${today}`,
    '',
    `${s.homeservers} homeservers listed, ${s.up} up`,
    `${s.usersResolved.toLocaleString('en-US')} users located${change}`,
  ]
  if (s.topShare != null)
    lines.push(`${s.topShare}% of them on the largest homeserver`)
  lines.push(
    `${s.events24h.toLocaleString('en-US')} public writes seen in 24 h`,
  )
  lines.push(
    `${s.openSignups} with open signups · ${s.claimed} claimed by their operator`,
  )
  lines.push('', SITE)
  return lines.join('\n')
}

// --- Settings ---

const on = (key: string) => getMeta(key) === '1'

export function setDailyEnabled(enabled: boolean) {
  setMeta('publish_daily', enabled ? '1' : '0')
}

/**
 * Turning announcements on marks every server known so far as seen: only
 * servers that appear from now on are announced, never a backlog.
 */
export function setAnnouncementsEnabled(enabled: boolean, now = Date.now()) {
  if (enabled && !on('publish_new'))
    getDb()
      .prepare(
        'INSERT OR IGNORE INTO announced_homeservers (pubkey, at) SELECT pubkey, ? FROM homeservers',
      )
      .run(now)
  setMeta('publish_new', enabled ? '1' : '0')
}

function recordResult(
  kind: 'daily' | 'new',
  uri: string | null,
  error: unknown,
  now: number,
) {
  setMeta(`publish_${kind}_at`, String(now))
  setMeta(`publish_${kind}_uri`, uri ?? '')
  setMeta(
    `publish_${kind}_error`,
    error
      ? (error instanceof Error ? error.message : String(error)).slice(0, 300)
      : '',
  )
}

export function publishingStatus(now = Date.now()) {
  const list = listHomeservers()
  const last = (kind: string) => ({
    at: Number(getMeta(`publish_${kind}_at`)) || null,
    uri: getMeta(`publish_${kind}_uri`) || null,
    error: getMeta(`publish_${kind}_error`) || null,
  })
  return {
    hasAccount: hasAppAccount(),
    daily: {
      enabled: on('publish_daily'),
      hourUtc: DAILY_HOUR_UTC,
      publishedToday:
        getMeta('publish_daily_day') ===
        new Date(now).toISOString().slice(0, 10),
      preview: composeDailyReport(now, list),
      last: last('daily'),
    },
    announcements: {
      enabled: on('publish_new'),
      pending: on('publish_new')
        ? pendingAnnouncements(list, now).map((h) => h.domain as string)
        : [],
      last: last('new'),
    },
  }
}

// --- Publishing ---

function pendingAnnouncements(list: Array<Homeserver>, now: number) {
  const seen = new Set(
    (
      getDb()
        .prepare('SELECT pubkey FROM announced_homeservers')
        .all() as Array<{ pubkey: string }>
    ).map((r) => r.pubkey),
  )
  return list.filter((h) => !seen.has(h.pubkey) && isAnnounceable(h, now))
}

function announcedRecently(now: number) {
  return (
    getDb()
      .prepare(
        'SELECT COUNT(*) AS n FROM announced_homeservers WHERE post_uri IS NOT NULL AND at > ?',
      )
      .get(now - DAY) as { n: number }
  ).n
}

/**
 * The report of the day, once a day: the day is claimed in one atomic write, so
 * the worker and the admin's button cannot both publish it. Returns the URI, or
 * null when it was already published.
 */
export async function publishDaily(
  now = Date.now(),
  post: Post = publishPost,
): Promise<string | null> {
  const list = listHomeservers()
  const stats = networkStats(list)
  // Better no report than a wrong one if the checks have stopped.
  if (
    !stats.homeservers ||
    !stats.lastProbeAt ||
    now - stats.lastProbeAt > 30 * 60_000
  ) {
    const error = new Error('Skipped: the network data is not fresh.')
    recordResult('daily', null, error, now)
    throw error
  }
  const day = new Date(now).toISOString().slice(0, 10)
  const claimed = getDb()
    .prepare(
      `INSERT INTO meta (key, value) VALUES ('publish_daily_day', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE value <> excluded.value`,
    )
    .run(day).changes
  if (!claimed) return null
  try {
    const uri = await post(composeDailyReport(now, list))
    recordResult('daily', uri, null, now)
    return uri
  } catch (e) {
    // Free the day, so the next hourly pass tries again.
    getDb().prepare("DELETE FROM meta WHERE key = 'publish_daily_day'").run()
    recordResult('daily', null, e, now)
    throw e
  }
}

/** One new server per pass, at most MAX_ANNOUNCES_PER_DAY a day. */
export async function publishNextAnnouncement(
  now = Date.now(),
  post: Post = publishPost,
) {
  if (announcedRecently(now) >= MAX_ANNOUNCES_PER_DAY) return null
  const next = pendingAnnouncements(listHomeservers(), now)[0]
  if (!next) return null
  const db = getDb()
  const claimed = db
    .prepare(
      'INSERT OR IGNORE INTO announced_homeservers (pubkey, at) VALUES (?, ?)',
    )
    .run(next.pubkey, now).changes
  if (!claimed) return null
  try {
    const uri = await post(composeAnnouncement(next))
    db.prepare(
      'UPDATE announced_homeservers SET post_uri = ? WHERE pubkey = ?',
    ).run(uri, next.pubkey)
    recordResult('new', uri, null, now)
    return uri
  } catch (e) {
    db.prepare('DELETE FROM announced_homeservers WHERE pubkey = ?').run(
      next.pubkey,
    )
    recordResult('new', null, e, now)
    throw e
  }
}

/** Is there anything for the publishing process to do right now? */
export function publishingDue(now = Date.now()): boolean {
  if (!hasAppAccount()) return false
  const d = new Date(now)
  const daily =
    on('publish_daily') &&
    d.getUTCHours() >= DAILY_HOUR_UTC &&
    getMeta('publish_daily_day') !== d.toISOString().slice(0, 10)
  const announce =
    on('publish_new') &&
    announcedRecently(now) < MAX_ANNOUNCES_PER_DAY &&
    pendingAnnouncements(listHomeservers(), now).length > 0
  return daily || announce
}

/** The hourly pass. One failure does not stop the other kind. */
export async function runPublishing(
  now = Date.now(),
  post: Post = publishPost,
) {
  const d = new Date(now)
  const results: Array<string> = []
  if (on('publish_daily') && d.getUTCHours() >= DAILY_HOUR_UTC) {
    const uri = await publishDaily(now, post).catch(
      (e: unknown) => `daily failed: ${e instanceof Error ? e.message : e}`,
    )
    if (uri) results.push(uri)
  }
  if (on('publish_new')) {
    const uri = await publishNextAnnouncement(now, post).catch(
      (e: unknown) =>
        `announcement failed: ${e instanceof Error ? e.message : e}`,
    )
    if (uri) results.push(uri)
  }
  return results
}
