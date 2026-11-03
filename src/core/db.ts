import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const DATA_DIR = process.env.NETKY_DATA_DIR ?? './data'
const DB_PATH = process.env.NETKY_DB ?? `${DATA_DIR}/netky.sqlite`

let db: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (db) return db
  mkdirSync(dirname(DB_PATH), { recursive: true })
  db = new DatabaseSync(DB_PATH)
  // The worker writes, the web server mostly reads: WAL lets both run at once.
  db.exec(
    'PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;',
  )
  migrate(db)
  return db
}

const MIGRATIONS: Array<string> = [
  `
  CREATE TABLE users (
    pubkey        TEXT PRIMARY KEY,
    homeserver    TEXT,
    first_seen    INTEGER NOT NULL,
    resolved_at   INTEGER,
    record_ts     INTEGER,
    resolve_error TEXT
  );
  CREATE INDEX users_homeserver ON users(homeserver);
  CREATE INDEX users_resolved_at ON users(resolved_at);

  CREATE TABLE homeservers (
    pubkey          TEXT PRIMARY KEY,
    source          TEXT NOT NULL,          -- 'users' | 'submitted'
    first_seen      INTEGER NOT NULL,
    resolved_at     INTEGER,
    record_ts       INTEGER,
    resolve_error   TEXT,
    domain          TEXT,
    domain_port     INTEGER,
    pubky_port      INTEGER,
    ipv4            TEXT,                   -- JSON array
    ipv6            TEXT,                   -- JSON array
    country         TEXT,
    country_name    TEXT,
    asn             INTEGER,
    as_org          TEXT,
    user_count      INTEGER NOT NULL DEFAULT 0,
    last_probe_at   INTEGER,
    last_ok         INTEGER,
    last_latency_ms INTEGER,
    last_error      TEXT,
    is_pubky        INTEGER,                -- root answered "Pubky Homeserver"
    server_header   TEXT,
    powered_by      TEXT,
    tls_checked_at  INTEGER,
    tls_ok          INTEGER,
    tls_issuer      TEXT,
    tls_expires_at  INTEGER,
    tls_error       TEXT
  );

  CREATE TABLE probes (
    homeserver TEXT NOT NULL,
    at         INTEGER NOT NULL,
    ok         INTEGER NOT NULL,
    latency_ms INTEGER,
    status     INTEGER,
    error      TEXT
  );
  CREATE INDEX probes_hs_at ON probes(homeserver, at);

  CREATE TABLE snapshots (
    day              TEXT PRIMARY KEY,      -- YYYY-MM-DD (UTC)
    users_known      INTEGER NOT NULL,
    users_resolved   INTEGER NOT NULL,
    homeservers      INTEGER NOT NULL,
    homeservers_up   INTEGER NOT NULL
  );

  CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // Operator claims: a TXT "operator=<key>" in the homeserver's own PKARR
  // record, confirmed by a TXT "operates=<homeserver key>" in the operator's.
  `
  ALTER TABLE homeservers ADD COLUMN operator TEXT;
  ALTER TABLE homeservers ADD COLUMN claim_verified INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE homeservers ADD COLUMN geo_ip TEXT;
  `,
  // Signup mode: 'open' | 'token' (invite only), read from a public endpoint.
  `
  ALTER TABLE homeservers ADD COLUMN signup_mode TEXT;
  ALTER TABLE homeservers ADD COLUMN signup_checked_at INTEGER;
  `,
  // Claims: the server side is proven by a DNS TXT on its domain (or a TXT in
  // its own PKARR record); the operator confirms from their own space.
  `
  ALTER TABLE homeservers ADD COLUMN claim_method TEXT;
  ALTER TABLE homeservers ADD COLUMN operator_confirmed INTEGER NOT NULL DEFAULT 0;
  `,
  // Operator display: name from Nexus, avatar cached under DATA_DIR/avatars.
  `
  ALTER TABLE homeservers ADD COLUMN operator_name TEXT;
  ALTER TABLE homeservers ADD COLUMN operator_avatar INTEGER NOT NULL DEFAULT 0;
  `,
  // Social activity from each homeserver's public /events/ feed, and a few
  // more passive technical facts.
  `
  CREATE TABLE feed_state (
    homeserver    TEXT PRIMARY KEY,
    cursor        TEXT NOT NULL DEFAULT '0',
    backfilled    INTEGER NOT NULL DEFAULT 0,   -- history read to the end
    live_since    INTEGER,                      -- events after this are dated
    events_total  INTEGER NOT NULL DEFAULT 0,
    last_event_at INTEGER,                      -- last new event seen live
    last_post_at  INTEGER,                      -- newest post ID seen
    sample_blob   TEXT,                         -- a public file, for the read test
    checked_at    INTEGER,
    error         TEXT
  );
  CREATE TABLE feed_counts (
    homeserver TEXT NOT NULL, kind TEXT NOT NULL, op TEXT NOT NULL, count INTEGER NOT NULL,
    PRIMARY KEY (homeserver, kind, op)
  );
  CREATE TABLE feed_hourly (
    homeserver TEXT NOT NULL, hour INTEGER NOT NULL, kind TEXT NOT NULL, count INTEGER NOT NULL,
    PRIMARY KEY (homeserver, hour, kind)
  );
  CREATE TABLE feed_posts_daily (
    homeserver TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL,
    PRIMARY KEY (homeserver, day)
  );
  CREATE TABLE feed_apps (
    homeserver TEXT NOT NULL, app TEXT NOT NULL, events INTEGER NOT NULL, last_seen_at INTEGER,
    PRIMARY KEY (homeserver, app)
  );
  CREATE TABLE feed_users (
    homeserver TEXT NOT NULL, user TEXT NOT NULL, last_seen_at INTEGER NOT NULL,
    PRIMARY KEY (homeserver, user)
  );
  ALTER TABLE homeservers ADD COLUMN features TEXT;            -- JSON, from /info
  ALTER TABLE homeservers ADD COLUMN pubky_tls_ok INTEGER;     -- native endpoint answers
  ALTER TABLE homeservers ADD COLUMN security_headers TEXT;    -- JSON array of names
  ALTER TABLE homeservers ADD COLUMN read_kbps INTEGER;
  ALTER TABLE homeservers ADD COLUMN read_bytes INTEGER;
  ALTER TABLE homeservers ADD COLUMN read_at INTEGER;
  `,
  // Live reading from the end of the feed while the history is still read.
  `
  ALTER TABLE feed_state ADD COLUMN live_cursor TEXT;
  ALTER TABLE feed_state ADD COLUMN backfill_end TEXT;
  ALTER TABLE feed_state ADD COLUMN pause_until INTEGER; -- after a 429
  `,
  // When a server last answered as a homeserver. A deleted one behind a
  // wildcard domain still answers HTTP, so last_ok alone cannot tell.
  `
  ALTER TABLE homeservers ADD COLUMN last_alive_at INTEGER;
  UPDATE homeservers SET last_alive_at = (
    SELECT MAX(at) FROM probes WHERE homeserver = pubkey AND ok = 1
  ) WHERE is_pubky IS NOT 0;
  `,
  // Admin sessions (only a hash of the cookie is kept) and the account the
  // application posts with (its Pubky session is encrypted, AES-256-GCM).
  `
  CREATE TABLE admin_sessions (
    token_hash TEXT PRIMARY KEY,
    pubkey     TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE app_account (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    pubkey     TEXT NOT NULL,
    name       TEXT,
    avatar     INTEGER NOT NULL DEFAULT 0,
    secret_enc TEXT NOT NULL,
    linked_at  INTEGER NOT NULL,
    linked_by  TEXT NOT NULL
  );
  `,
  // Homeservers already announced, or known when announcements were turned on.
  `
  CREATE TABLE announced_homeservers (
    pubkey   TEXT PRIMARY KEY,
    at       INTEGER NOT NULL,
    post_uri TEXT
  );
  `,
  // Servers deleted before last_alive_at existed. A feed with events proves
  // one was a homeserver, and its last 200 dates the end. For the others that
  // read as "not pubky", no past answer counted as uptime.
  `
  UPDATE homeservers SET last_alive_at = (
    SELECT MAX(at) FROM probes WHERE homeserver = pubkey AND ok = 1 AND status = 200
  ) WHERE is_pubky = 0 AND last_alive_at IS NULL AND EXISTS (
    SELECT 1 FROM feed_state WHERE homeserver = pubkey AND events_total > 0
  );
  UPDATE probes SET ok = 0 WHERE ok = 1 AND homeserver IN (
    SELECT pubkey FROM homeservers WHERE is_pubky = 0
  ) AND (status IS NOT 200 OR homeserver IN (
    SELECT pubkey FROM homeservers WHERE is_pubky = 0 AND last_alive_at IS NULL
  ));
  `,
]

function migrate(d: DatabaseSync) {
  d.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
  const row = d.prepare('SELECT version FROM schema_version').get() as
    { version: number } | undefined
  let version = row?.version ?? 0
  if (!row) d.prepare('INSERT INTO schema_version (version) VALUES (0)').run()
  while (version < MIGRATIONS.length) {
    d.exec('BEGIN')
    try {
      d.exec(MIGRATIONS[version])
      version++
      d.prepare('UPDATE schema_version SET version = ?').run(version)
      d.exec('COMMIT')
    } catch (e) {
      d.exec('ROLLBACK')
      throw e
    }
  }
}

export function getMeta(key: string): string | null {
  const row = getDb()
    .prepare('SELECT value FROM meta WHERE key = ?')
    .get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setMeta(key: string, value: string) {
  getDb()
    .prepare(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    )
    .run(key, value)
}

export function transaction<T>(fn: () => T): T {
  const d = getDb()
  d.exec('BEGIN')
  try {
    const out = fn()
    d.exec('COMMIT')
    return out
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  }
}
