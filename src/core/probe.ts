import { connect as netConnect } from 'node:net'
import { connect as tlsConnect } from 'node:tls'

// Passive checks only: one GET on the root, one TCP connect, one TLS
// handshake. No port scan, no load test, nothing a normal client would not do.

export interface HttpProbe {
  ok: boolean
  latencyMs: number | null
  status: number | null
  isPubky: boolean
  server: string | null
  poweredBy: string | null
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

export function errorMessage(e: unknown): string {
  if (e instanceof Error) {
    const cause = (e as { cause?: { code?: string; message?: string } }).cause
    if (e.name === 'TimeoutError') return 'timeout'
    return cause?.code ?? cause?.message ?? e.message
  }
  return String(e)
}
