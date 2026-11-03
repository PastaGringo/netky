// Admin area. Sign-in is a Pubky Ring approval that grants nothing: it only
// proves a key, which must be NETKY_ADMIN_KEY. The admin then links the account
// the application posts with, through a second approval limited to its posts
// folder. That session is stored encrypted with NETKY_SECRET_KEY.
import { createHash, randomBytes } from 'node:crypto'
import QRCode from 'qrcode'
import type { Capabilities } from '@synonymdev/pubky'
import { getDb } from '#/core/db.ts'
import { avatarPath } from '#/core/jobs.ts'
import { fetchProfile } from '#/core/nexus.ts'
import { decrypt, encrypt, hasSecretKey } from '#/core/vault.ts'
import { PUBKEY_RE } from '#/core/z32.ts'
import { pubky } from './pubky-sdk.ts'

const SESSION_COOKIE = '__Host-netky_admin'
const FLOW_COOKIE = '__Host-netky_flow'
const SESSION_TTL_MS = 7 * 24 * 3_600_000
const FLOW_TTL_MS = 10 * 60_000
const MAX_FLOWS = 20
export const APP_CAPABILITIES = '/pub/pubky.app/posts/:rw'

export class AdminError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

function adminKey(): string | null {
  const key = process.env.NETKY_ADMIN_KEY?.trim()
    .toLowerCase()
    .replace(/^pubky/, '')
  return key && PUBKEY_RE.test(key) ? key : null
}

function cookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq).trim() === name)
      return part.slice(eq + 1).trim()
  }
  return null
}

const setCookie = (name: string, value: string, maxAgeMs: number) =>
  `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(maxAgeMs / 1000)}`

export function reply(
  body: unknown,
  status = 200,
  cookies: Array<string> = [],
) {
  const headers = new Headers({
    'content-type': 'application/json',
    'cache-control': 'no-store',
  })
  for (const c of cookies) headers.append('set-cookie', c)
  return new Response(JSON.stringify(body), { status, headers })
}

/** Runs a handler and turns AdminError into a clean JSON answer. */
export async function guarded(fn: () => Promise<Response> | Response) {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof AdminError) return reply({ error: e.message }, e.status)
    console.error('admin error:', e instanceof Error ? e.message : String(e))
    return reply({ error: 'Something went wrong.' }, 500)
  }
}

/** Requests that change something must come from this site's own pages. */
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get('origin')
  const host = request.headers.get('host')
  let originHost: string | null = null
  try {
    originHost = origin ? new URL(origin).host : null
  } catch {
    originHost = null
  }
  if (!originHost || originHost !== host)
    throw new AdminError(403, 'Bad origin.')
}

export function currentAdmin(request: Request): string | null {
  const admin = adminKey()
  const token = cookie(request, SESSION_COOKIE)
  if (!admin || !token) return null
  const row = getDb()
    .prepare(
      'SELECT pubkey FROM admin_sessions WHERE token_hash = ? AND expires_at > ?',
    )
    .get(sha256(token), Date.now()) as { pubkey: string } | undefined
  // A session stops counting as soon as the admin key changes.
  return row?.pubkey === admin ? admin : null
}

export function requireAdmin(request: Request): string {
  const admin = currentAdmin(request)
  if (!admin) throw new AdminError(401, 'Sign in first.')
  return admin
}

function createSession(pubkey: string) {
  const db = getDb()
  db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').run(Date.now())
  const token = randomBytes(32).toString('base64url')
  db.prepare(
    'INSERT INTO admin_sessions (token_hash, pubkey, expires_at) VALUES (?, ?, ?)',
  ).run(sha256(token), pubkey, Date.now() + SESSION_TTL_MS)
  return setCookie(SESSION_COOKIE, token, SESSION_TTL_MS)
}

export function signOut(request: Request) {
  const token = cookie(request, SESSION_COOKIE)
  if (token)
    getDb()
      .prepare('DELETE FROM admin_sessions WHERE token_hash = ?')
      .run(sha256(token))
  return setCookie(SESSION_COOKIE, '', 0)
}

// --- Pubky Ring flows, each bound to the browser that started it ---

interface Flow {
  status: 'pending' | 'approved' | 'done' | 'error'
  message: string | null
  expires: number
  /** Login only: the proven key, until the browser collects its session. */
  key: string | null
}

const flows = new Map<string, Flow>()

function newFlow() {
  const now = Date.now()
  for (const [id, f] of flows) if (f.expires < now) flows.delete(id)
  if (flows.size >= MAX_FLOWS)
    throw new AdminError(
      429,
      'Too many sign-ins in progress, try again in a few minutes.',
    )
  const token = randomBytes(32).toString('base64url')
  const state: Flow = {
    status: 'pending',
    message: null,
    expires: now + FLOW_TTL_MS,
    key: null,
  }
  flows.set(sha256(token), state)
  return { state, flowCookie: setCookie(FLOW_COOKIE, token, FLOW_TTL_MS) }
}

const qrOf = (url: string) =>
  QRCode.toString(url, {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#070707', light: '#ffffff' },
  })

const fail = (state: Flow, e: unknown) => {
  state.status = 'error'
  state.message = e instanceof Error ? e.message : String(e)
}

export async function startLogin() {
  const admin = adminKey()
  if (!admin) throw new AdminError(503, 'NETKY_ADMIN_KEY is not configured.')
  const { sdk, client } = pubky()
  const { state, flowCookie } = newFlow()
  // No capability: this only proves which key approves.
  const flow = client.startCookieAuthFlow(
    '' as Capabilities,
    sdk.AuthFlowKind.signin(),
  )
  const url = flow.authorizationUrl
  flow
    .awaitToken()
    .then((token) => {
      const key = token.publicKey.z32()
      if (key !== admin) {
        state.status = 'error'
        state.message = 'This Pubky key is not allowed here.'
        return
      }
      state.key = key
      state.status = 'approved'
    })
    .catch((e: unknown) => fail(state, e))
  return reply({ url, qr: await qrOf(url) }, 200, [flowCookie])
}

export async function startLink(request: Request) {
  const admin = requireAdmin(request)
  // Refuse now rather than after the approval.
  if (!hasSecretKey())
    throw new AdminError(503, 'NETKY_SECRET_KEY is not configured.')
  if (getAppAccount())
    throw new AdminError(409, 'Disconnect the current account first.')
  const adminSession = cookie(request, SESSION_COOKIE) as string
  const { sdk, client } = pubky()
  const { state, flowCookie } = newFlow()
  const flow = client.startCookieAuthFlow(
    APP_CAPABILITIES as Capabilities,
    sdk.AuthFlowKind.signin(),
  )
  const url = flow.authorizationUrl
  flow
    .awaitApproval()
    .then(async (session) => {
      try {
        // The admin may have signed out while the QR code was on screen.
        const still = getDb()
          .prepare(
            'SELECT 1 FROM admin_sessions WHERE token_hash = ? AND expires_at > ?',
          )
          .get(sha256(adminSession), Date.now())
        if (!still) {
          await session.signout().catch(() => undefined)
          throw new Error('Your admin session ended. Sign in again.')
        }
        const pubkey = session.info.publicKey.z32()
        const profile = await fetchProfile(pubkey, avatarPath(pubkey))
        getDb()
          .prepare(
            `INSERT INTO app_account (id, pubkey, name, avatar, secret_enc, linked_at, linked_by)
             VALUES (1, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            pubkey,
            profile.name,
            profile.avatar ? 1 : 0,
            encrypt(await session.exportLocalSecret()),
            Date.now(),
            admin,
          )
        state.status = 'done'
      } finally {
        session.free()
      }
    })
    .catch((e: unknown) => fail(state, e))
  return reply({ url, qr: await qrOf(url) }, 200, [flowCookie])
}

/** Polled by the browser that started the flow, and only by it. */
export function flowStatus(request: Request) {
  const token = cookie(request, FLOW_COOKIE)
  const id = token ? sha256(token) : null
  const state = id ? flows.get(id) : undefined
  if (!id || !state || state.expires < Date.now())
    return reply(
      { status: 'error', message: 'This QR code expired. Start again.' },
      404,
    )
  if (state.status === 'approved' && state.key) {
    flows.delete(id) // one approval, one session
    return reply({ status: 'done', message: null }, 200, [
      createSession(state.key),
      setCookie(FLOW_COOKIE, '', 0),
    ])
  }
  if (state.status === 'pending')
    return reply({ status: 'pending', message: null })
  flows.delete(id)
  return reply({ status: state.status, message: state.message }, 200, [
    setCookie(FLOW_COOKIE, '', 0),
  ])
}

// --- The account the application posts with ---

interface AccountRow {
  pubkey: string
  name: string | null
  avatar: number
  secret_enc: string
  linked_at: number
  linked_by: string
}

export interface AppAccount {
  pubkey: string
  name: string | null
  avatar: string | null
  linkedAt: number
  linkedBy: string
}

function accountRow() {
  return getDb().prepare('SELECT * FROM app_account WHERE id = 1').get() as
    AccountRow | undefined
}

/** Never includes the session secret. */
export function getAppAccount(): AppAccount | null {
  const r = accountRow()
  return r
    ? {
        pubkey: r.pubkey,
        name: r.name,
        avatar: r.avatar ? `/avatars/${r.pubkey}` : null,
        linkedAt: r.linked_at,
        linkedBy: r.linked_by,
      }
    : null
}

/** Checks the stored session still works, without publishing anything. */
export async function verifyAppAccount() {
  const r = accountRow()
  if (!r) throw new AdminError(404, 'No account connected.')
  const profile = await fetchProfile(r.pubkey, avatarPath(r.pubkey))
  getDb()
    .prepare(
      'UPDATE app_account SET name = COALESCE(?, name), avatar = MAX(avatar, ?) WHERE id = 1',
    )
    .run(profile.name, profile.avatar ? 1 : 0)
  try {
    const session = await pubky().client.restoreSession(decrypt(r.secret_enc))
    try {
      if (session.info.publicKey.z32() !== r.pubkey)
        throw new Error('session of another key')
      return {
        ok: true,
        capabilities: session.info.capabilities,
        message: null,
      }
    } finally {
      session.free()
    }
  } catch (e) {
    return {
      ok: false,
      capabilities: [],
      message: `The session no longer works (${e instanceof Error ? e.message : String(e)}). Disconnect and connect it again.`,
    }
  }
}

/** Ends the homeserver session if possible, and forgets it in any case. */
export async function disconnectAppAccount() {
  const r = accountRow()
  if (!r) return
  try {
    const session = await pubky().client.restoreSession(decrypt(r.secret_enc))
    await session.signout().catch(() => undefined)
    session.free()
  } catch {
    // Already dead, or the key changed: deleting it below is what matters.
  }
  getDb().prepare('DELETE FROM app_account WHERE id = 1').run()
}
