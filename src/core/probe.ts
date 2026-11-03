import { connect as netConnect } from 'node:net'
import { connect as tlsConnect } from 'node:tls'
import { SECURITY_HEADERS } from '../lib/security-headers.ts'

// Passive checks only: one GET on the root, one TCP connect, one TLS
// handshake. No port scan, no load test, nothing a normal client would not do.

export interface HttpProbe {
  ok: boolean
  latencyMs: number | null
  status: number | null
  isPubky: boolean
  server: string | null
  poweredBy: string | null
  /** Which security-related headers the server sends (names only). */
  securityHeaders: Array<string> | null
  error: string | null
}

export async function probeHttp(
  domain: string,
  port: number | null,
  timeoutMs = 10_000,
): Promise<HttpProbe> {
  const url = `https://${domain}${port && port !== 443 ? `:${port}` : ''}/`
  const started = performance.now()
  try {
    const res = await fetch(url, {
      redirect: 'manual',
      headers: {
        'user-agent': 'netky/0.1 (+https://netky.pubky.pastalabs.dev/about)',
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
    const latencyMs = Math.round(performance.now() - started)
    const body = (await res.text()).slice(0, 2000)
    return {
      // Any answer below 500 means the server is up and serving.
      ok: res.status < 500,
      latencyMs,
      status: res.status,
      isPubky: /pubky homeserver/i.test(body),
      server: res.headers.get('server'),
      poweredBy: res.headers.get('x-powered-by'),
      securityHeaders: SECURITY_HEADERS.filter((h) => res.headers.has(h)),
      error: res.status >= 500 ? `HTTP ${res.status}` : null,
    }
  } catch (e) {
    return {
      ok: false,
      latencyMs: null,
      status: null,
      isPubky: false,
      server: null,
      poweredBy: null,
      securityHeaders: null,
      error: errorMessage(e),
    }
  }
}

export interface TcpProbe {
  ok: boolean
  latencyMs: number | null
  error: string | null
}

/** For homeservers that only publish a Pubky-TLS endpoint (no ICANN domain). */
export function probeTcp(
  host: string,
  port: number,
  timeoutMs = 8_000,
): Promise<TcpProbe> {
  return new Promise((resolve) => {
    const started = performance.now()
    const socket = netConnect({ host, port })
    const done = (r: TcpProbe) => {
      socket.destroy()
      resolve(r)
    }
    socket.setTimeout(timeoutMs, () =>
      done({ ok: false, latencyMs: null, error: 'timeout' }),
    )
    socket.once('connect', () =>
      done({
        ok: true,
        latencyMs: Math.round(performance.now() - started),
        error: null,
      }),
    )
    socket.once('error', (e) =>
      done({ ok: false, latencyMs: null, error: errorMessage(e) }),
    )
  })
}

export interface TlsInfo {
  ok: boolean
  issuer: string | null
  expiresAt: number | null
  error: string | null
}

export function checkTls(
  domain: string,
  port: number | null,
  timeoutMs = 10_000,
): Promise<TlsInfo> {
  return new Promise((resolve) => {
    const socket = tlsConnect({
      host: domain,
      port: port ?? 443,
      servername: domain,
      rejectUnauthorized: false,
    })
    const done = (r: TlsInfo) => {
      socket.destroy()
      resolve(r)
    }
    socket.setTimeout(timeoutMs, () =>
      done({ ok: false, issuer: null, expiresAt: null, error: 'timeout' }),
    )
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate()
      const issuer = cert.issuer
        ? (cert.issuer.O ?? cert.issuer.CN ?? null)
        : null
      const expiresAt = cert.valid_to ? Date.parse(cert.valid_to) : null
      done({
        ok: socket.authorized,
        issuer: Array.isArray(issuer) ? issuer.join(', ') : issuer,
        expiresAt: Number.isFinite(expiresAt) ? expiresAt : null,
        error: socket.authorized
          ? null
          : String(socket.authorizationError ?? 'certificate not trusted'),
      })
    })
    socket.once('error', (e) =>
      done({
        ok: false,
        issuer: null,
        expiresAt: null,
        error: errorMessage(e),
      }),
    )
  })
}

/** Features the homeserver announces on GET /info. */
export async function fetchFeatures(
  domain: string,
  port: number | null,
): Promise<Array<string> | null> {
  const url = `https://${domain}${port && port !== 443 ? `:${port}` : ''}/info`
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent': 'netky/0.1 (+https://netky.pubky.pastalabs.dev/about)',
      },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { features?: unknown }
    return Array.isArray(body.features)
      ? body.features
          .filter((f): f is string => typeof f === 'string')
          .slice(0, 30)
      : null
  } catch {
    return null
  }
}

/** Downloads one public file (at most `maxBytes`) and returns the read speed. */
export async function readTest(
  domain: string,
  port: number | null,
  user: string,
  path: string,
  maxBytes = 8 * 1024 * 1024,
): Promise<{ kbps: number; bytes: number } | null> {
  const url = `https://${domain}${port && port !== 443 ? `:${port}` : ''}/pub/${path}`
  const started = performance.now()
  try {
    const res = await fetch(url, {
      headers: {
        'pubky-host': user,
        'user-agent': 'netky/0.1 (+https://netky.pubky.pastalabs.dev/about)',
      },
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok || !res.body) return null
    let bytes = 0
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes >= maxBytes) {
        await reader.cancel()
        break
      }
    }
    const seconds = (performance.now() - started) / 1000
    // Too small a file says more about latency than about throughput.
    if (bytes < 32 * 1024 || seconds <= 0) return null
    return { kbps: Math.round(bytes / 1024 / seconds), bytes }
  } catch {
    return null
  }
}

export type SignupMode = 'open' | 'token'

/**
 * Reads the signup mode without signing up: GET /signup_tokens/<token> answers
 * "Signup tokens not required" on open homeservers, and checks the token
 * otherwise. Returns null when the server does not expose this route.
 */
export async function checkSignup(
  domain: string,
  port: number | null,
  timeoutMs = 10_000,
): Promise<SignupMode | null> {
  const url = `https://${domain}${port && port !== 443 ? `:${port}` : ''}/signup_tokens/netky-probe`
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent': 'netky/0.1 (+https://netky.pubky.pastalabs.dev/about)',
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
    const body = (await res.text()).slice(0, 500).toLowerCase()
    if (body.includes('signup tokens not required')) return 'open'
    if (body.includes('signup token') || body.includes('token not found'))
      return 'token'
    return null
  } catch {
    return null
  }
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) {
    const cause = (e as { cause?: { code?: string; message?: string } }).cause
    if (e.name === 'TimeoutError') return 'timeout'
    return cause?.code ?? cause?.message ?? e.message
  }
  return String(e)
}
