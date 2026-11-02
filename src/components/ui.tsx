import type { Status } from '#/server/queries.ts'

export const STATUS: Record<
  Status,
  { label: string; className: string; help: string }
> = {
  up: {
    label: 'UP',
    className: 'text-green border-green',
    help: 'answered the last check',
  },
  down: {
    label: 'DOWN',
    className: 'text-red border-red',
    help: 'did not answer the last check',
  },
  'not-pubky': {
    label: 'NOT PUBKY',
    className: 'text-amber border-amber',
    help: 'answers, but not as a Pubky homeserver',
  },
  unresolved: {
    label: 'NO RECORD',
    className: 'text-dim border-line',
    help: 'users point to this key, but it publishes no reachable endpoint',
  },
}

export function StatusBadge({ status }: { status: Status }) {
  const s = STATUS[status]
  return (
    <span
      className={`inline-block border px-1.5 text-xs leading-5 font-semibold whitespace-nowrap ${s.className}`}
      title={s.help}
    >
      {s.label}
    </span>
  )
}

export function shortKey(key: string) {
  return `${key.slice(0, 6)}…${key.slice(-4)}`
}

export function flag(country: string | null) {
  if (!country || country.length !== 2) return ''
  return String.fromCodePoint(
    ...[...country.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)),
  )
}

export function ago(ts: number | null, now = Date.now()) {
  if (!ts) return 'never'
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 172_800) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86_400)} days ago`
}

export function fmtDate(ts: number | null) {
  return ts ? new Date(ts).toISOString().slice(0, 10) : '—'
}

export function Uptime({ value }: { value: number | null }) {
  if (value == null) return <span className="text-dim">—</span>
  const color =
    value >= 99 ? 'text-green' : value >= 90 ? 'text-amber' : 'text-red'
  return <span className={color}>{value.toFixed(value === 100 ? 0 : 1)}%</span>
}

export function Latency({ ms }: { ms: number | null }) {
  if (ms == null) return <span className="text-dim">—</span>
  const color = ms < 500 ? 'text-green' : ms < 1500 ? 'text-amber' : 'text-red'
  return <span className={color}>{ms} ms</span>
}

export function Stat({
  label,
  value,
  sub,
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
}) {
  return (
    <div className="min-w-0 border bg-panel/90 px-4 py-3">
      <div className="text-xs tracking-wide text-dim uppercase">{label}</div>
      <div className="font-display text-4xl leading-tight text-text">
        {value}
      </div>
      {sub ? <div className="text-xs text-dim">{sub}</div> : null}
    </div>
  )
}
