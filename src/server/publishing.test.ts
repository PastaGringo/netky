import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

process.env.NETKY_DB = join(mkdtempSync(join(tmpdir(), 'netky-')), 't.sqlite')
process.env.NETKY_SECRET_KEY = Buffer.alloc(32, 7).toString('base64')

const { getDb, getMeta } = await import('#/core/db.ts')
const { buildPost } = await import('#/core/publisher.ts')
const { decrypt, encrypt } = await import('#/core/vault.ts')
const p = await import('./publishing.ts')
const { getHomeserver } = await import('./queries.ts')

const DAY = 86_400_000
const now = Date.UTC(2026, 10, 4, 9, 37)
const key = (c: string) => c.repeat(52)

function server(pubkey: string, domain: string, firstSeen = now - 3 * DAY) {
  getDb()
    .prepare(
      `INSERT INTO homeservers (pubkey, source, first_seen, resolved_at, domain, last_ok, is_pubky,
       last_probe_at, last_alive_at, user_count) VALUES (?, 'users', ?, ?, ?, 1, 1, ?, ?, 1)`,
    )
    .run(pubkey, firstSeen, now, domain, Date.now(), Date.now())
  // The uptime queries look at the real clock.
  getDb()
    .prepare('INSERT INTO probes (homeserver, at, ok) VALUES (?, ?, 1)')
    .run(pubkey, Date.now() - 60_000)
}

const posts: Array<string> = []
const post = async (content: string) => {
  posts.push(content)
  return `pubky://x/${posts.length}`
}

test('a post is built as pubky.app writes it, with a valid path', () => {
  const { path, url, body } = buildPost(
    'w3ase343kdnbtp4y3x69qd1qyt8peyrdtkhf671ujucc9i8fge6y',
    'hello',
  )
  assert.deepEqual(body, { content: 'hello', kind: 'short' })
  assert.match(path, /^\/pub\/pubky\.app\/posts\/[0-9A-Z]{13}$/)
  assert.ok(url.startsWith('pubky://w3ase343'))
})

test('the session encryption round-trips and detects tampering', () => {
  const enc = encrypt('secret')
  assert.equal(decrypt(enc), 'secret')
  const raw = Buffer.from(enc, 'base64')
  raw[raw.length - 1] ^= 1
  assert.throws(() => decrypt(raw.toString('base64')))
})

test('only stable, plain, public homeservers can be announced', () => {
  server(key('a'), 'hs.example.com')
  const ok = getHomeserver(key('a'))!
  assert.equal(p.isAnnounceable(ok, now), true)
  for (const domain of [
    'x.trycloudflare.com',
    'abc.oast.fun',
    'a.ngrok-free.app',
    'xn--pple-43d.com',
    'evil domain.com',
    'localhost',
  ])
    assert.equal(p.isAnnounceable({ ...ok, domain }, now), false, domain)
  assert.equal(
    p.isAnnounceable({ ...ok, firstSeen: now - 3_600_000 }, now),
    false,
    'too new',
  )
  assert.equal(
    p.isAnnounceable({ ...ok, uptime24h: 50 }, now),
    false,
    'unstable',
  )
  assert.equal(p.isAnnounceable({ ...ok, status: 'down' }, now), false, 'down')
})

test('an announcement names an operator only once confirmed', () => {
  const h = getHomeserver(key('a'))!
  assert.ok(
    !p
      .composeAnnouncement({
        ...h,
        operatorName: 'Alice',
        operatorConfirmed: false,
      })
      .includes('Alice'),
  )
  const text = p.composeAnnouncement({
    ...h,
    operatorName: 'Alice',
    operatorConfirmed: true,
  })
  assert.ok(text.includes('Run by Alice') && text.includes(`/hs/${h.pubkey}`))
})

test('nothing is due or published while off, and without a backlog once on', async () => {
  assert.equal(p.publishingDue(now), false, 'no account')
  getDb()
    .prepare(
      "INSERT INTO app_account (id, pubkey, secret_enc, linked_at, linked_by) VALUES (1, 'k', 'e', 0, 'a')",
    )
    .run()
  assert.equal(p.publishingDue(now), false, 'account, both off')
  assert.deepEqual(await p.runPublishing(now, post), [])

  p.setAnnouncementsEnabled(true, now)
  assert.equal(
    await p.publishNextAnnouncement(now, post),
    null,
    'known server is not announced',
  )
  assert.equal(posts.length, 0)
})

test('new servers are announced once, at most 3 a day, retried after a failure', async () => {
  server(key('b'), 'b.example.com')
  await assert.rejects(
    p.publishNextAnnouncement(now, async () => {
      throw new Error('relay down')
    }),
  )
  assert.equal(getMeta('publish_new_error'), 'relay down')
  assert.ok(await p.publishNextAnnouncement(now, post), 'retried')
  assert.ok(posts[0].includes('b.example.com'))
  assert.equal(await p.publishNextAnnouncement(now, post), null, 'only once')

  for (const c of ['c', 'd', 'e']) server(key(c), `${c}.example.com`)
  assert.ok(await p.publishNextAnnouncement(now, post))
  assert.ok(await p.publishNextAnnouncement(now, post))
  assert.equal(await p.publishNextAnnouncement(now, post), null, 'daily cap')
  assert.equal(posts.length, 3)
})

test('the daily report goes out once a day, after its hour, and retries on failure', async () => {
  posts.length = 0
  const fresh = Date.now()
  p.setDailyEnabled(true)
  await assert.rejects(
    p.publishDaily(fresh, async () => {
      throw new Error('relay down')
    }),
  )
  assert.ok(await p.publishDaily(fresh, post), 'retried')
  assert.equal(await p.publishDaily(fresh, post), null, 'once a day')
  assert.equal(posts.length, 1)
  assert.match(posts[0], /homeservers listed/)
  assert.ok(posts[0].length < 2000)
  p.setAnnouncementsEnabled(false)
  assert.equal(
    p.publishingDue(Date.UTC(2030, 0, 1, 7)),
    false,
    'before its hour',
  )
  assert.equal(
    p.publishingDue(Date.UTC(2030, 0, 1, 8)),
    true,
    'after its hour, new day',
  )
})

test('no report when the checks have stopped', async () => {
  getDb().prepare("DELETE FROM meta WHERE key = 'publish_daily_day'").run()
  posts.length = 0
  getDb()
    .prepare('UPDATE homeservers SET last_probe_at = ?')
    .run(Date.now() - 3_600_000)
  await assert.rejects(p.publishDaily(Date.now(), post), /not fresh/)
  assert.equal(posts.length, 0)
})
