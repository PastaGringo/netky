import { Link, createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import {
  Latency,
  Stat,
  StatusBadge,
  Uptime,
  ago,
  Avatar,
  Flag,
  shortKey,
} from '#/components/ui'
import { getOverview } from '#/server/fns'
import type { Homeserver, Status } from '#/server/queries'
import { NextCheck } from '#/components/next-check'
import { WorldMap } from '#/components/world-map'
import type { CountryPoint } from '#/components/world-map'

export const Route = createFileRoute('/')({
  loader: () => getOverview(),
  component: Home,
})

type Filter = 'all' | 'up' | 'down' | 'open' | 'other'
const FILTERS: Array<[Filter, string]> = [
  ['all', 'all'],
  ['up', 'up'],
  ['down', 'down'],
  ['open', 'open signups'],
  ['other', 'not a homeserver'],
]

function matches(h: Homeserver, f: Filter) {
  if (f === 'all') return true
  if (f === 'open') return h.status === 'up' && h.signup === 'open'
  if (f === 'other')
    return h.status === 'not-pubky' || h.status === 'unresolved'
  return h.status === (f as Status)
}

function Home() {
  const { homeservers, stats, now } = Route.useLoaderData()
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const countries = useMemo(() => groupByCountry(homeservers), [homeservers])
  const pickCountry = (name: string) => {
    setFilter('all')
    setQuery(name)
    document
      .getElementById('list-title')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return homeservers.filter(
      (h) =>
        matches(h, filter) &&
        (!q ||
          h.pubkey.includes(q) ||
          (h.domain ?? '').includes(q) ||
          (h.countryName ?? '').toLowerCase().includes(q) ||
          (h.asOrg ?? '').toLowerCase().includes(q)),
    )
  }, [homeservers, filter, query])

  return (
    <>
      <section className="mx-auto w-full max-w-6xl px-4 pt-12 pb-8 sm:px-6 lg:pt-16">
        <p className="m-0 text-green">
          <span className="text-dim">&gt; </span>scanning the pubky network
        </p>
        <h1
          className="glitch m-0 mt-2 font-display text-[clamp(3.6rem,15vw,8rem)] leading-[0.85] tracking-tight uppercase"
          data-text="netky"
        >
          netky
        </h1>
        <p className="mt-5 mb-0 max-w-2xl text-lg text-pretty">
          The directory of <span className="text-red">Pubky homeservers</span>:
          every server we can find, read from its own signed record, checked
          every five minutes.
        </p>
      </section>

      <section
        aria-label="Network stats"
        className="mx-auto w-full max-w-6xl px-4 sm:px-6"
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          <Stat
            label="homeservers"
            value={stats.homeservers}
            sub={`${stats.up} up right now`}
          />
          <Stat
            label="users located"
            value={stats.usersResolved}
            sub={`out of ${stats.usersKnown} keys known`}
          />
          <Stat
            label="countries"
            value={stats.countries}
            sub="excluding CDN-fronted servers"
          />
          <Stat
            label="open signups"
            value={stats.openSignups}
            sub={
              stats.openSignups
                ? 'anyone can join'
                : 'all invite only, ask an operator'
            }
          />
          <div className="col-span-2 grid md:col-span-1">
            <Stat
              label="claimed"
              value={`${stats.claimed}/${stats.homeservers}`}
              sub={
                <Link
                  to="/about"
                  hash="claim"
                  className="underline hover:text-red"
                >
                  claim yours
                </Link>
              }
            />
          </div>
        </div>
        {stats.topShare != null && stats.topShare >= 50 ? (
          <p className="mt-3 mb-0 border border-amber/60 bg-panel/90 px-4 py-2 text-sm text-pretty">
            <span className="text-amber">[WARN]</span> {stats.topShare}% of
            located users live on a single homeserver. The network is open, but
            most of it still runs in one place.
          </p>
        ) : null}
        <div className="mt-3 border bg-panel/90 p-3 sm:p-5">
          <WorldMap points={countries.points} onPick={pickCountry} />
        </div>
        <Countries
          points={countries.points}
          cdn={countries.cdn}
          onPick={pickCountry}
        />
        <p className="mt-2 mb-0 text-xs text-dim">
          last check {ago(stats.lastProbeAt, now)} ·{' '}
          <NextCheck serverNow={now} /> · users last listed{' '}
          {ago(stats.lastDiscoveryAt, now)}
        </p>
      </section>

      <section
        aria-labelledby="list-title"
        className="mx-auto w-full max-w-6xl px-4 pt-10 pb-16 sm:px-6"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="list-title" className="m-0 font-display text-3xl">
            <span className="text-dim">$</span> ls ./homeservers
          </h2>
          <div className="flex min-w-0 flex-wrap gap-2">
            <div
              role="group"
              aria-label="Filter by status"
              className="flex flex-wrap"
            >
              {FILTERS.map(([f, label]) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  aria-pressed={filter === f}
                  className={`min-h-[44px] border px-3 text-sm ${
                    filter === f
                      ? 'border-red bg-red text-void'
                      : 'text-dim hover:text-text'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="grep key, domain, country…"
              aria-label="Search homeservers"
              className="min-h-[44px] w-full min-w-0 border bg-panel px-3 text-sm placeholder:text-dim focus:border-red focus:outline-none sm:w-64"
            />
          </div>
        </div>

        <div className="mt-4 border bg-panel/90">
          <div className="hidden grid-cols-[6.5rem_minmax(0,1fr)_5rem_6rem_6rem_minmax(0,11rem)] gap-3 border-b px-4 py-2 text-xs text-dim uppercase md:grid">
            <span>status</span>
            <span>homeserver</span>
            <span className="text-right">users</span>
            <span className="text-right">uptime 7d</span>
            <span className="text-right">latency</span>
            <span>location</span>
          </div>
          <ul className="m-0 list-none p-0">
            {shown.map((h) => (
              <Row key={h.pubkey} h={h} />
            ))}
          </ul>
          {shown.length === 0 ? (
            <p className="m-0 px-4 py-6 text-dim">No homeserver matches.</p>
          ) : null}
        </div>
        <p className="mt-3 mb-0 text-xs text-dim">
          Only homeservers that at least one known user points to are listed.{' '}
          <Link to="/about" className="underline hover:text-red">
            How this works
          </Link>
        </p>
      </section>
    </>
  )
}

function Row({ h }: { h: Homeserver }) {
  return (
    <li className="border-b last:border-b-0">
      <Link
        to="/hs/$pubkey"
        params={{ pubkey: h.pubkey }}
        className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-panel-raised md:grid-cols-[6.5rem_minmax(0,1fr)_5rem_6rem_6rem_minmax(0,11rem)]"
      >
        <span>
          <StatusBadge status={h.status} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-text">
            {h.domain ?? shortKey(h.pubkey)}
          </span>
          <span className="block truncate text-xs text-dim">
            {h.domain ? shortKey(h.pubkey) : 'no ICANN domain'}
            {h.claimVerified && !h.operatorConfirmed ? (
              <span className="text-cyan"> · claimed</span>
            ) : null}
            {h.claimVerified && h.operatorConfirmed ? (
              <span className="text-cyan">
                {' · run by '}
                <Avatar
                  src={h.operatorAvatar}
                  name={h.operatorName}
                  size={16}
                />{' '}
                {h.operatorName ?? shortKey(h.operator ?? '')}
              </span>
            ) : null}
            {h.status === 'up' && h.signup === 'open' ? (
              <span className="text-green"> · open signups</span>
            ) : h.status === 'up' && h.signup === 'token' ? (
              <span> · invite only</span>
            ) : null}
          </span>
        </span>
        <span className="col-span-2 flex flex-wrap gap-x-4 text-sm md:contents">
          <span className="md:text-right">
            <span className="text-text">{h.users}</span>
            <span className="text-dim md:hidden">
              {' '}
              {h.users === 1 ? 'user' : 'users'}
            </span>
          </span>
          <span className="md:text-right">
            <Uptime value={h.uptime7d} />
            <span className="text-dim md:hidden"> 7d</span>
          </span>
          <span className="md:text-right">
            <Latency ms={h.latencyMs} />
          </span>
          <span className="min-w-0 truncate text-dim">
            {h.cdn ? (
              <>behind {h.cdn}</>
            ) : h.country ? (
              <span className="inline-flex items-center gap-2">
                <Flag country={h.country} />
                {h.countryName}
              </span>
            ) : (
              '—'
            )}
          </span>
        </span>
      </Link>
    </li>
  )
}

/** Live homeservers grouped by country; CDN-fronted ones are counted apart. */
function groupByCountry(homeservers: Array<Homeserver>) {
  const byCountry = new Map<string, CountryPoint>()
  let cdn = 0
  for (const h of homeservers) {
    if (h.status !== 'up' && h.status !== 'down') continue
    if (h.cdn) {
      cdn++
      continue
    }
    if (!h.country) continue
    const c = byCountry.get(h.country) ?? {
      code: h.country,
      name: h.countryName ?? h.country,
      servers: 0,
      users: 0,
    }
    c.servers++
    c.users += h.users
    byCountry.set(h.country, c)
  }
  const points = [...byCountry.values()].sort(
    (a, b) => b.servers - a.servers || b.users - a.users,
  )
  return { points, cdn }
}

function Countries({
  points,
  cdn,
  onPick,
}: {
  points: Array<CountryPoint>
  cdn: number
  onPick: (name: string) => void
}) {
  const list = points.map((c) => [c.code, c] as const)
  if (!list.length) return null
  return (
    <ul
      aria-label="Homeservers by country"
      className="m-0 mt-3 flex list-none flex-wrap gap-2 p-0"
    >
      {list.map(([code, c]) => (
        <li key={code}>
          <button
            type="button"
            onClick={() => onPick(c.name)}
            title={`${c.servers} homeserver${c.servers > 1 ? 's' : ''}, ${c.users} user${c.users > 1 ? 's' : ''}`}
            className="inline-flex min-h-[44px] items-center gap-2 border bg-panel/90 px-3 text-sm hover:border-red"
          >
            <Flag country={code} className="text-lg" />
            <span>{c.name}</span>
            <span className="text-dim">{c.servers}</span>
          </button>
        </li>
      ))}
      {cdn ? (
        <li>
          <button
            type="button"
            onClick={() => onPick('cloudflare')}
            title="Behind a CDN: the real location is hidden"
            className="inline-flex min-h-[44px] items-center gap-2 border bg-panel/90 px-3 text-sm text-dim hover:border-red"
          >
            <span aria-hidden="true">☁</span>
            <span>behind a CDN</span>
            <span>{cdn}</span>
          </button>
        </li>
      ) : null}
    </ul>
  )
}
