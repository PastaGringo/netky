import { Link, createFileRoute, notFound } from '@tanstack/react-router'

import {
  Latency,
  Stat,
  StatusBadge,
  Uptime,
  ago,
  Flag,
  SignupBadge,
  fmtDate,
  shortKey,
} from '#/components/ui'
import { getHomeserverDetail } from '#/server/fns'
import type { Probe } from '#/server/queries'
import { NotFound } from './__root'

export const Route = createFileRoute('/hs/$pubkey')({
  loader: async ({ params }) => {
    const detail = await getHomeserverDetail({ data: params.pubkey }).catch(
      () => null,
    )
    if (!detail) throw notFound()
    return detail
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          {
            title: `${loaderData.homeserver.domain ?? shortKey(loaderData.homeserver.pubkey)} · netky`,
          },
        ]
      : [],
  }),
  component: Detail,
  notFoundComponent: NotFound,
})

function Detail() {
  const { homeserver: h, probes, now } = Route.useLoaderData()
  const tlsDays = h.tls?.expiresAt
    ? Math.floor((h.tls.expiresAt - now) / 86_400_000)
    : null

  return (
    <article className="mx-auto w-full max-w-6xl px-4 pt-10 pb-16 sm:px-6">
      <Link
        to="/"
        className="inline-flex min-h-[44px] items-center text-sm text-dim hover:text-red"
      >
        ← ./homeservers
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <StatusBadge status={h.status} />
        <SignupBadge mode={h.signup} />
        {h.claimVerified ? (
          <span className="border border-cyan px-1.5 text-xs leading-5 text-cyan">
            CLAIMED
          </span>
        ) : null}
      </div>
      <h1 className="m-0 mt-3 font-display text-[clamp(2rem,7vw,4rem)] leading-none break-all">
        {h.domain ?? shortKey(h.pubkey)}
      </h1>
      <p className="mt-3 mb-0 font-mono text-sm break-all text-dim">
        <span className="text-green">pubky</span>
        {h.pubkey}
      </p>
      {h.status === 'not-pubky' ? (
        <p className="mt-4 mb-0 border border-amber/60 bg-panel/90 px-4 py-2 text-sm text-pretty">
          <span className="text-amber">[WARN]</span> This key is published as a
          homeserver, but the address answers with something else. It is
          probably a test or a misconfiguration.
        </p>
      ) : null}

      <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="users" value={h.users} sub="known users pointing here" />
        <Stat
          label="uptime 7d"
          value={<Uptime value={h.uptime7d} />}
          sub={
            <>
              24h <Uptime value={h.uptime24h} /> · 30d{' '}
              <Uptime value={h.uptime30d} />
            </>
          }
        />
        <Stat
          label="latency"
          value={<Latency ms={h.latencyMs} />}
          sub={`checked ${ago(h.lastProbeAt, now)}`}
        />
        <Stat
          label="certificate"
          value={
            !h.tls ? (
              <span className="text-dim">—</span>
            ) : h.tls.ok ? (
              <span
                className={
                  tlsDays != null && tlsDays < 14 ? 'text-amber' : 'text-green'
                }
              >
                valid
              </span>
            ) : (
              <span className="text-red">invalid</span>
            )
          }
          sub={
            h.tls?.ok
              ? `${h.tls.issuer ?? 'unknown issuer'} · ${tlsDays} days left`
              : (h.tls?.error ?? 'no ICANN domain')
          }
        />
      </div>

      <section aria-labelledby="history" className="mt-10">
        <h2 id="history" className="m-0 font-display text-2xl">
          <span className="text-dim">$</span> last 48 hours
        </h2>
        <ProbeStrip probes={probes} now={now} />
        {h.lastError ? (
          <p className="mt-2 mb-0 text-sm">
            <span className="text-red">last error:</span>{' '}
            <code>{h.lastError}</code>
          </p>
        ) : null}
      </section>

      <section aria-labelledby="details" className="mt-10">
        <h2 id="details" className="m-0 font-display text-2xl">
          <span className="text-dim">$</span> cat record
        </h2>
        <dl className="mt-3 grid grid-cols-1 border bg-panel/90 text-sm sm:grid-cols-[12rem_minmax(0,1fr)]">
          <Item label="HTTPS endpoint">
            {h.domain
              ? `https://${h.domain}${h.port && h.port !== 443 ? `:${h.port}` : ''}`
              : '—'}
          </Item>
          <Item label="Pubky TLS port">{h.pubkyPort ?? '—'}</Item>
          <Item label="location">
            {h.cdn ? (
              `hidden behind ${h.cdn}`
            ) : h.country ? (
              <span className="inline-flex items-center gap-2">
                <Flag country={h.country} /> {h.countryName}
              </span>
            ) : (
              '—'
            )}
          </Item>
          <Item label="network">
            {h.asn ? `AS${h.asn} · ${h.asOrg ?? 'unknown'}` : '—'}
          </Item>
          <Item label="signups">
            {h.signup === 'open'
              ? 'open: anyone can create an account'
              : h.signup === 'token'
                ? 'invite only: a signup token from the operator is needed'
                : 'unknown'}
          </Item>
          <Item label="server header">{h.server ?? '—'}</Item>
          <Item label="operator">
            {h.operator ? (
              <>
                <span className="break-all">pubky{h.operator}</span>
                <span className="block text-xs text-dim">
                  named{' '}
                  {h.claimMethod === 'dns'
                    ? 'in the DNS of the server’s domain'
                    : 'in the server’s own PKARR record'}
                  {' · '}
                  {h.operatorConfirmed ? (
                    <span className="text-cyan">confirmed by the operator</span>
                  ) : (
                    <span className="text-amber">
                      not confirmed by the operator yet
                    </span>
                  )}
                </span>
              </>
            ) : (
              <>
                not claimed ·{' '}
                <Link
                  to="/about"
                  hash="claim"
                  className="underline hover:text-red"
                >
                  how to claim
                </Link>
              </>
            )}
          </Item>
          <Item label="first seen">{fmtDate(h.firstSeen)}</Item>
          {h.resolveError ? (
            <Item label="record error">{h.resolveError}</Item>
          ) : null}
        </dl>
        <p className="mt-2 mb-0 text-xs text-dim">
          Raw data:{' '}
          <a
            href={`/api/v1/homeservers/${h.pubkey}`}
            className="underline hover:text-red"
          >
            /api/v1/homeservers/{shortKey(h.pubkey)}
          </a>
        </p>
      </section>
    </article>
  )
}

function Item({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <>
      <dt className="border-b px-4 pt-2 text-dim sm:py-2">{label}</dt>
      <dd className="m-0 min-w-0 border-b px-4 pb-2 break-words sm:py-2">
        {children}
      </dd>
    </>
  )
}

/** One slot per 5-minute check over 48 h: height = latency, red = failed. */
function ProbeStrip({ probes, now }: { probes: Array<Probe>; now: number }) {
  if (!probes.length) return <p className="mt-3 text-dim">No checks yet.</p>
  const SLOT = 5 * 60_000
  const slots = (48 * 3_600_000) / SLOT
  const start = now - slots * SLOT
  const max = Math.max(1000, ...probes.map((p) => p.latencyMs ?? 0))
  const height = 60
  const failed = probes.filter((p) => !p.ok).length
  return (
    <figure className="m-0 mt-3">
      <div className="border bg-panel/90 p-3">
        <svg
          viewBox={`0 0 ${slots} ${height}`}
          preserveAspectRatio="none"
          className="block h-16 w-full"
          role="img"
          aria-label={`${probes.length} checks, ${failed} failed`}
        >
          <line
            x1={0}
            x2={slots}
            y1={height - 0.5}
            y2={height - 0.5}
            stroke="var(--line)"
            strokeWidth={1}
          />
          {probes.map((p) => {
            const h = p.ok
              ? Math.max(3, ((p.latencyMs ?? 0) / max) * height)
              : height
            return (
              <rect
                key={p.at}
                x={Math.max(0, Math.floor((p.at - start) / SLOT))}
                y={height - h}
                width={0.8}
                height={h}
                fill={p.ok ? 'var(--green)' : 'var(--red)'}
                opacity={p.ok ? 0.75 : 0.9}
              >
                <title>{`${new Date(p.at).toISOString().slice(0, 16).replace('T', ' ')} UTC · ${
                  p.ok ? `${p.latencyMs} ms` : (p.error ?? 'failed')
                }`}</title>
              </rect>
            )
          })}
        </svg>
        <div className="mt-1 flex justify-between text-xs text-dim">
          <span>-48 h</span>
          <span>now</span>
        </div>
      </div>
      <figcaption className="mt-1 text-xs text-dim">
        {probes.length} checks · {failed} failed · bar height is latency, red is
        a failed check
      </figcaption>
    </figure>
  )
}
