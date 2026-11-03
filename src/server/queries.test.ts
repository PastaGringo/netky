import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

process.env.NETKY_DB = join(mkdtempSync(join(tmpdir(), 'netky-')), 't.sqlite')

const { getDb } = await import('#/core/db.ts')
const { probeAll } = await import('#/core/jobs.ts')
const { getHomeserver, listHomeservers, networkStats } =
  await import('./queries.ts')

const DAY = 86_400_000
const now = Date.now()

function server(pubkey: string, firstSeen: number) {
  getDb()
    .prepare(
      'INSERT INTO homeservers (pubkey, source, first_seen, resolved_at, domain) VALUES (?, ?, ?, ?, ?)',
    )
    .run(pubkey, 'test', firstSeen, now, `${pubkey}.test`)
}

function lastAlive(pubkey: string, at: number) {
  getDb()
    .prepare('UPDATE homeservers SET last_alive_at = ? WHERE pubkey = ?')
    .run(at, pubkey)
}

/** Answers each server's root page, as probeAll sees it. */
function answers(table: Record<string, Response | 'unreachable'>) {
  globalThis.fetch = (async (url: string) => {
    const key = new URL(url).hostname.replace('.test', '')
    const answer = table[key]
    if (answer === 'unreachable') throw new Error('ENOTFOUND')
    return answer.clone()
  }) as typeof fetch
}

const pubky = new Response('Pubky Homeserver', { status: 200 })
const wildcard = new Response('404 page not found', { status: 404 })

const listed = () =>
  listHomeservers()
    .map((h) => h.pubkey)
    .sort()

server('alive', now - 60 * DAY)
server('recent', now - 60 * DAY)
server('deleted', now - 60 * DAY)
server('gone', now - 60 * DAY)
server('never', now - 8 * DAY)
server('new', now - DAY)

const table: Parameters<typeof answers>[0] = {
  alive: pubky,
  recent: 'unreachable',
  deleted: wildcard,
  gone: 'unreachable',
  never: 'unreachable',
  new: wildcard,
}

test('a check that answers as a homeserver records it, others do not', async () => {
  answers(table)
  await probeAll()
  const at = (key: string) => getHomeserverRow(key).last_alive_at
  assert.ok(at('alive')! >= now)
  assert.equal(at('deleted'), null)
  assert.equal(at('gone'), null)
})

function getHomeserverRow(pubkey: string) {
  return getDb()
    .prepare('SELECT last_alive_at FROM homeservers WHERE pubkey = ?')
    .get(pubkey) as { last_alive_at: number | null }
}

test('the list leaves out servers gone for over 7 days', async () => {
  lastAlive('recent', now - DAY)
  lastAlive('deleted', now - 8 * DAY)
  lastAlive('gone', now - 8 * DAY)
  assert.equal(getHomeserver('deleted')?.status, 'not-pubky')
  assert.equal(getHomeserver('gone')?.status, 'down')
  assert.deepEqual(listed(), ['alive', 'new', 'recent'])
})

test('the totals leave them out too', () => {
  const stats = networkStats()
  assert.equal(stats.homeservers, 2)
  assert.equal(stats.up, 1)
})

test('a retired server keeps its own page', () => {
  assert.equal(getHomeserver('deleted')?.retired, true)
  assert.equal(getHomeserver('never')?.retired, true)
  assert.equal(getHomeserver('recent')?.retired, false)
})

test('a silent server says when it leaves, one that answers does not', () => {
  const sevenDays = 7 * DAY
  assert.equal(getHomeserver('recent')?.retiresAt, now - DAY + sevenDays)
  assert.equal(getHomeserver('new')?.retiresAt, now - DAY + sevenDays)
  assert.equal(getHomeserver('alive')?.retiresAt, null)
})

test('a server comes back at its first answer', async () => {
  answers({ ...table, deleted: pubky })
  await probeAll()
  assert.deepEqual(listed(), ['alive', 'deleted', 'new', 'recent'])
})
