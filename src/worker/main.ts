// Background worker: discovery, resolution and probes. Runs next to the web
// server (same image, same SQLite file) with `node src/worker/main.ts`.
import { spawn } from 'node:child_process'
import { Cron } from 'croner'
import { publishingDue } from '../server/publishing.ts'
import { getDb, getMeta } from '../core/db.ts'
import { geoDatabasesPresent, refreshGeoDatabases } from '../core/geo.ts'
import {
  checkAllSignups,
  checkCapabilities,
  readTests,
  syncFeeds,
  checkAllTls,
  dailySnapshot,
  discoverUsers,
  log,
  probeAll,
  resolveHomeservers,
  resolveUsers,
} from '../core/jobs.ts'

/** Publishing runs apart, and only when there is something to publish. */
async function runPublishingProcess() {
  if (!publishingDue()) return
  await new Promise<void>((resolve) => {
    const child = spawn(process.execPath, ['src/worker/publish.ts'], {
      stdio: 'inherit',
      timeout: 5 * 60_000,
    })
    child.on('close', () => resolve())
    child.on('error', (e) => {
      log('publish failed to start:', e)
      resolve()
    })
  })
}

function job(name: string, pattern: string, fn: () => Promise<void> | void) {
  return new Cron(
    pattern,
    { name, protect: true, catch: (e) => log(`${name} failed:`, e) },
    async () => {
      await fn()
    },
  )
}

getDb()
log('netky worker starting')

job('discover', '17 */6 * * *', discoverUsers)
job('resolve-users', '*/10 * * * *', () => resolveUsers())
job('resolve-homeservers', '25,55 * * * *', () => resolveHomeservers())
job('probe', '*/5 * * * *', () => probeAll())
job('tls', '41 */6 * * *', checkAllTls)
job('signups', '47 */6 * * *', checkAllSignups)
job('capabilities', '51 */6 * * *', checkCapabilities)
// Feeds a minute after the probes, so only servers just seen up are read.
job('feeds', '1-59/5 * * * *', () => syncFeeds())
job('read-tests', '33 4 * * *', readTests)
job('snapshot', '50 23 * * *', dailySnapshot)
job('geo', '0 5 3 * *', refreshGeoDatabases)
job('publish', '37 * * * *', runPublishingProcess)

// First boot: fill the database right away instead of waiting for the crons.
async function bootstrap() {
  try {
    if (!geoDatabasesPresent()) await refreshGeoDatabases()
  } catch (e) {
    log('geo download failed, continuing without geo:', e)
  }
  if (!getMeta('last_discovery')) await discoverUsers()
  // Drain the unresolved queue before the first probes.
  for (let i = 0; i < 20; i++) {
    const left = getDb()
      .prepare('SELECT COUNT(*) AS n FROM users WHERE resolved_at IS NULL')
      .get() as { n: number }
    if (!left.n) break
    await resolveUsers()
  }
  await resolveHomeservers()
  await probeAll()
  await checkAllTls()
  await checkAllSignups()
  await checkCapabilities()
  await syncFeeds()
  dailySnapshot()
  log('bootstrap done')
}

bootstrap().catch((e) => log('bootstrap failed:', e))

for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    log(`worker stopping (${signal})`)
    process.exit(0)
  })
