// Security score, from what Netky observes passively: no test is run for it.
// Each check scores only where it applies; the score is the share of the
// applicable points. Shared by the server (API) and the pages (no server deps).

export interface SecurityInput {
  domain: string | null
  pubkyPort: number | null
  tls: { ok: boolean; expiresAt: number | null } | null
  securityHeaders: Array<string> | null
  server: string | null
  poweredBy: string | null
  pubkyTls: boolean | null
  features: Array<string> | null
}

export interface SecurityCheck {
  id: string
  label: string
  ok: boolean
  points: number
  max: number
  why: string
}

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F'

export interface Security {
  score: number
  grade: Grade
  checks: Array<SecurityCheck>
}

const DAY = 86_400_000

export function gradeOf(score: number): Grade {
  if (score >= 90) return 'A'
  if (score >= 75) return 'B'
  if (score >= 60) return 'C'
  if (score >= 40) return 'D'
  return 'F'
}

/** Null when Netky has not seen the server answer over HTTPS yet. */
export function securityScore(
  h: SecurityInput,
  now = Date.now(),
): Security | null {
  if (!h.domain || !h.tls || h.securityHeaders == null) return null
  const headers = new Set(h.securityHeaders)
  const sitesHosted = h.features?.includes('websites') ?? false
  const checks: Array<SecurityCheck> = []
  const add = (
    id: string,
    label: string,
    ok: boolean,
    max: number,
    why: string,
  ) => checks.push({ id, label, ok, points: ok ? max : 0, max, why })

  add(
    'tls',
    'Valid TLS certificate',
    h.tls.ok,
    30,
    'Clients can trust they talk to this domain and nobody reads the traffic.',
  )
  add(
    'tls-expiry',
    'Certificate valid for 14+ more days',
    h.tls.ok && h.tls.expiresAt != null && h.tls.expiresAt - now > 14 * DAY,
    5,
    'A certificate about to expire usually means renewal is broken.',
  )
  add(
    'hsts',
    'HSTS (strict-transport-security)',
    headers.has('strict-transport-security'),
    15,
    'Browsers always use HTTPS on this domain, so a first visit over plain HTTP cannot be intercepted.',
  )
  add(
    'nosniff',
    'No MIME sniffing (x-content-type-options)',
    headers.has('x-content-type-options'),
    15,
    'The server hosts files uploaded by its users; without it a browser may run a file as HTML or script.',
  )
  add(
    'pubky-tls',
    'Native PubkyTLS port answers',
    h.pubkyTls === true,
    10,
    'Pubky clients can connect with TLS authenticated by the server’s own key, without relying on DNS or certificate authorities.',
  )
  add(
    'no-version',
    'Server header without a version',
    !h.server || !/\d/.test(h.server),
    5,
    'A software version in the Server header tells attackers which known flaws to try.',
  )
  add(
    'no-powered-by',
    'No X-Powered-By header',
    !h.poweredBy,
    5,
    'It reveals the stack for no benefit to users.',
  )
  if (sitesHosted) {
    add(
      'csp',
      'Content-Security-Policy',
      headers.has('content-security-policy'),
      10,
      'This server publishes websites: a CSP limits what a hosted page can load and run.',
    )
    add(
      'frames',
      'Framing protection (x-frame-options or CSP)',
      headers.has('x-frame-options') || headers.has('content-security-policy'),
      5,
      'Stops hosted pages from being embedded by other sites to trick users into clicking.',
    )
  }
  const max = checks.reduce((s, c) => s + c.max, 0)
  const got = checks.reduce((s, c) => s + c.points, 0)
  const score = Math.round((got / max) * 100)
  return { score, grade: gradeOf(score), checks }
}
