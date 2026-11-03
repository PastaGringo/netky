// The homeserver's public event feed, GET /events/: one line per write or
// delete ("PUT pubky://<user>/pub/<app>/<path>"), then "cursor: <n>". It is
// the feed Nexus indexes; it carries no dates, so Netky dates new events at
// the time it reads them, and dates posts from their IDs.

const USER_AGENT = 'netky/0.1 (+https://netky.pubky.pastalabs.dev/about)'
export const FEED_PAGE = 1000 // the homeserver's maximum

export interface FeedEvent {
  op: 'PUT' | 'DEL'
  user: string
  /** Path below /pub/, e.g. "pubky.app/posts/0035YME6DECN0". */
  path: string
}

const LINE = /^(PUT|DEL) pubky:\/\/([a-z0-9]{52})\/pub\/(.+)$/

export async function fetchFeed(
  domain: string,
  port: number | null,
  cursor: string,
  limit = FEED_PAGE,
): Promise<{ events: Array<FeedEvent>; cursor: string; bytes: number }> {
  const base = `https://${domain}${port && port !== 443 ? `:${port}` : ''}`
  const res = await fetch(
    `${base}/events/?cursor=${encodeURIComponent(cursor)}&limit=${limit}`,
    {
      headers: { 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(30_000),
    },
  )
  if (!res.ok) throw new Error(`events feed answered HTTP ${res.status}`)
  const text = await res.text()
  const events: Array<FeedEvent> = []
  let next = cursor
  for (const line of text.split('\n')) {
    if (line.startsWith('cursor: ')) {
      next = line.slice(8).trim()
      continue
    }
    const m = LINE.exec(line.trim())
    if (m) events.push({ op: m[1] as 'PUT' | 'DEL', user: m[2], path: m[3] })
  }
  return { events, cursor: next, bytes: text.length }
}

export type Kind =
  | 'post'
  | 'follow'
  | 'tag'
  | 'bookmark'
  | 'mute'
  | 'profile'
  | 'file'
  | 'settings'
  | 'other'

export const KINDS: Array<Kind> = [
  'post',
  'follow',
  'tag',
  'bookmark',
  'mute',
  'profile',
  'file',
  'settings',
  'other',
]

/** The app (first folder under /pub/) and what kind of write it is. */
export function classify(path: string): { app: string; kind: Kind } {
  const slash = path.indexOf('/')
  // Files written straight into /pub/: not an app folder.
  if (slash === -1) return { app: '(files in /pub/)', kind: 'other' }
  const app = (slash === -1 ? path : path.slice(0, slash)).slice(0, 64)
  const rest = slash === -1 ? '' : path.slice(slash + 1)
  if (app !== 'pubky.app') {
    if (/(^|\/)(files|blobs)\//.test(rest)) return { app, kind: 'file' }
    return { app, kind: 'other' }
  }
  if (rest.startsWith('posts/')) return { app, kind: 'post' }
  if (rest.startsWith('follows/')) return { app, kind: 'follow' }
  if (rest.startsWith('tags/')) return { app, kind: 'tag' }
  if (rest.startsWith('bookmarks/')) return { app, kind: 'bookmark' }
  if (rest.startsWith('mutes/')) return { app, kind: 'mute' }
  if (rest === 'profile.json') return { app, kind: 'profile' }
  if (rest.startsWith('files/') || rest.startsWith('blobs/'))
    return { app, kind: 'file' }
  if (
    rest.startsWith('settings') ||
    rest === 'last_read' ||
    rest.startsWith('feeds/')
  )
    return { app, kind: 'settings' }
  return { app, kind: 'other' }
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/**
 * Creation time (ms) of a pubky.app post from its ID: 13 Crockford base32
 * characters holding the microseconds since the epoch (64 bits, one padding
 * bit). Null for anything that does not decode to a plausible date.
 */
export function postTime(path: string): number | null {
  const m = /^pubky\.app\/posts\/([0-9A-Z]{13})$/.exec(path)
  if (!m) return null
  let n = 0n
  for (const c of m[1]) {
    const v = CROCKFORD.indexOf(c)
    if (v < 0) return null
    n = n * 32n + BigInt(v)
  }
  const ms = Number((n >> 1n) / 1000n)
  // Before Pubky existed, or in the future: not a real timestamp ID.
  return ms > Date.UTC(2023, 0, 1) && ms < Date.now() + 86_400_000 ? ms : null
}
