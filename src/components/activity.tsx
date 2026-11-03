import type { Activity } from '#/server/queries'
import { Stat, ago, fmtDate } from './ui'

const KIND_LABEL: Record<string, string> = {
  post: 'posts',
  follow: 'follows',
  tag: 'tags',
  bookmark: 'bookmarks',
  mute: 'mutes',
  profile: 'profile updates',
  file: 'files',
  settings: 'settings & read marks',
  other: 'other app data',
}

/** Simple bar chart: one bar per value, oldest first. */
function Bars({
  values,
  labels,
  color = 'var(--green)',
  height = 56,
  caption,
}: {
  values: Array<number>
  labels: Array<string>
  color?: string
  height?: number
  caption: string
}) {
  const max = Math.max(1, ...values)
  const n = values.length
  return (
    <figure className="m-0 mt-3">
      <div className="border bg-panel/90 p-3">
        <svg
          viewBox={`0 0 ${n * 10} ${height}`}
          preserveAspectRatio="none"
          className="block h-16 w-full"
          role="img"
          aria-label={caption}
        >
          <line
            x1={0}
            x2={n * 10}
            y1={height - 0.5}
            y2={height - 0.5}
            stroke="var(--line)"
            strokeWidth={1}
          />
          {values.map((v, i) => {
            const h = v ? Math.max(2, (v / max) * height) : 0
            return (
              <rect
                key={labels[i]}
                x={i * 10 + 1}
                y={height - h}
                width={8}
                height={h}
                fill={color}
                opacity={0.8}
              >
                <title>{`${labels[i]} · ${v}`}</title>
              </rect>
            )
          })}
        </svg>
        <div className="mt-1 flex justify-between text-xs text-dim">
          <span>{labels[0]}</span>
          <span>{labels[n - 1]}</span>
        </div>
      </div>
      <figcaption className="mt-1 text-xs text-dim">{caption}</figcaption>
    </figure>
  )
}

export function ActivitySection({
  activity: a,
  now,
}: {
  activity: Activity | null
  now: number
}) {
  return (
    <section aria-labelledby="activity" className="mt-10">
      <h2 id="activity" className="m-0 font-display text-2xl">
        <span className="text-dim">$</span> activity
      </h2>
      {!a ? (
        <p className="mt-3 text-dim">
          Netky has not read this server&apos;s public event feed yet. It does
          every five minutes, for servers that are up.
        </p>
      ) : (
        <ActivityBody a={a} now={now} />
      )}
    </section>
  )
}

function ActivityBody({ a, now }: { a: Activity; now: number }) {
  const posts30 = a.postsDaily.reduce((s, d) => s + d.count, 0)
  const hourLabels = a.hourly.map((_, i) => (i === 23 ? 'now' : `-${23 - i} h`))
  const maxKind = Math.max(1, ...a.byKind.map((k) => k.put + k.del))
  return (
    <>
      {a.liveness === 'ghost' ? (
        <p className="mt-3 mb-0 border border-line bg-panel/90 px-4 py-2 text-sm text-pretty">
          <span className="text-dim">[GHOST]</span> This server answers, but its
          last dated activity is over 30 days old and Netky saw no write in a
          week of watching it.
        </p>
      ) : null}
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="last activity"
          value={a.lastActivityAt ? ago(a.lastActivityAt, now) : '—'}
          sub={
            a.lastActivityAt ? fmtDate(a.lastActivityAt) : 'nothing dated yet'
          }
        />
        <Stat
          label="writes 24h"
          value={a.events24h}
          sub={`${(a.events24h / 24).toFixed(1)} per hour · ${a.events7d} in 7 days`}
        />
        <Stat
          label="active users"
          value={a.activeUsers24h}
          sub={`in 24 h · ${a.activeUsers7d} in 7 days`}
        />
        <Stat label="posts 30 days" value={posts30} sub="dated from post IDs" />
      </div>
      <p className="mt-2 mb-0 text-xs text-dim">
        {a.backfilled
          ? `${a.eventsTotal} public writes read from its feed · live tracking since ${fmtDate(a.liveSince)}`
          : `Live since ${fmtDate(a.liveSince)}; still reading its history (${a.eventsTotal} writes so far), so totals and the posts chart are partial.`}
      </p>

      <div className="grid gap-x-6 md:grid-cols-2">
        <Bars
          values={a.hourly}
          labels={hourLabels}
          caption="writes per hour, the last 24 hours (live tracking only)"
        />
        <Bars
          values={a.postsDaily.map((d) => d.count)}
          labels={a.postsDaily.map((d) => d.day.slice(5))}
          color="var(--cyan)"
          caption="posts per day, the last 30 days"
        />
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div className="min-w-0">
          <h3 className="m-0 text-sm text-dim uppercase">what is written</h3>
          {a.byKind.length ? (
            <table className="mt-2 w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs text-dim">
                  <th className="py-1 font-normal">kind</th>
                  <th className="py-1 text-right font-normal">writes</th>
                  <th className="py-1 text-right font-normal">deletes</th>
                </tr>
              </thead>
              <tbody>
                {a.byKind.map((k) => (
                  <tr key={k.kind} className="border-t">
                    <td className="py-1.5">
                      {KIND_LABEL[k.kind] ?? k.kind}
                      <span
                        className="mt-1 block h-1 bg-green/60"
                        style={{
                          width: `${((k.put + k.del) / maxKind) * 100}%`,
                        }}
                        aria-hidden="true"
                      />
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{k.put}</td>
                    <td className="py-1.5 text-right text-dim tabular-nums">
                      {k.del || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mt-2 text-dim">No public writes yet.</p>
          )}
        </div>
        <div className="min-w-0">
          <h3 className="m-0 text-sm text-dim uppercase">apps writing here</h3>
          <p className="m-0 mt-1 text-xs text-dim">
            folders under /pub/, by number of writes
          </p>
          <ul className="m-0 mt-2 flex list-none flex-wrap gap-1.5 p-0">
            {a.apps.map((app) => (
              <li
                key={app.app}
                className="border px-2 py-0.5 text-xs"
                title={
                  app.lastSeenAt
                    ? `last write ${ago(app.lastSeenAt, now)}`
                    : 'seen in its history'
                }
              >
                <span className="text-text">{app.app}</span>{' '}
                <span className="text-dim">{app.events}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  )
}

export function UptimeDays({
  days,
}: {
  days: Array<{ day: string; uptime: number | null; checks: number }>
}) {
  return (
    <figure className="m-0 mt-3">
      <div className="flex gap-[2px] border bg-panel/90 p-3">
        {days.map((d) => {
          const color =
            d.uptime == null
              ? 'bg-line'
              : d.uptime >= 99
                ? 'bg-green'
                : d.uptime >= 90
                  ? 'bg-amber'
                  : 'bg-red'
          return (
            <span
              key={d.day}
              className={`block h-8 min-w-0 flex-1 ${color}`}
              style={{ opacity: d.uptime == null ? 0.5 : 0.85 }}
              title={`${d.day}: ${d.uptime == null ? 'no data' : `${d.uptime}% of ${d.checks} checks`}`}
            />
          )
        })}
      </div>
      <figcaption className="mt-1 flex justify-between text-xs text-dim">
        <span>{days[0]?.day}</span>
        <span>green ≥ 99 % · amber ≥ 90 % · red below · grey no data</span>
        <span>today</span>
      </figcaption>
    </figure>
  )
}
