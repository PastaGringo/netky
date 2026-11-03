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

export function SignupBadge({ mode }: { mode: 'open' | 'token' | null }) {
  if (!mode) return null
  return mode === 'open' ? (
    <span
      className="inline-block border border-green px-1.5 text-xs leading-5 font-semibold whitespace-nowrap text-green"
      title="Anyone can create an account here"
    >
      OPEN SIGNUPS
    </span>
  ) : (
    <span
      className="inline-block border border-line px-1.5 text-xs leading-5 font-semibold whitespace-nowrap text-dim"
      title="Accounts need a signup token from the operator"
    >
      INVITE ONLY
    </span>
  )
}

export function shortKey(key: string) {
  return `${key.slice(0, 6)}…${key.slice(-4)}`
}

/** SVG flag (flag-icons): emoji flags do not render on Windows. */
export function Flag({
  country,
  className = '',
}: {
  country: string | null
  className?: string
}) {
  if (!country || !/^[a-z]{2}$/i.test(country)) return null
  return (
    <span
      className={`fi fi-${country.toLowerCase()} shrink-0 rounded-[1px] ${className}`}
      role="img"
      aria-hidden="true"
    />
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

/** Avatar of a claimed homeserver's operator, with a fallback initial. */
export function Avatar({
  src,
  name,
  size = 18,
}: {
  src: string | null
  name: string | null
  size?: number
}) {
  const style = { width: size, height: size }
  if (src)
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        className="inline-block shrink-0 rounded-full border border-cyan/60 object-cover"
        style={style}
      />
    )
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-full border border-cyan/60 text-[0.6rem] text-cyan"
      style={style}
    >
      {(name ?? '?').trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}

export function OfficialBadge({
  official,
}: {
  official: 'production' | 'staging' | null
}) {
  if (!official) return null
  const label = `Official Pubky homeserver run by Synonym (${official})`
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 text-xs leading-5 font-semibold whitespace-nowrap text-dim"
      title={label}
    >
      <img src="/synonym.svg" alt={label} width={80} height={20} />
      {official === 'staging' ? 'STAGING' : null}
    </span>
  )
}

const GRADE_COLOR: Record<string, string> = {
  A: 'text-green border-green',
  B: 'text-green border-green/60',
  C: 'text-amber border-amber',
  D: 'text-red border-red/70',
  F: 'text-red border-red',
}

/** Security grade, e.g. "B 78". */
export function GradeBadge({
  security,
}: {
  security: { score: number; grade: string } | null
}) {
  if (!security) return <span className="text-dim">—</span>
  return (
    <span
      className={`inline-block border px-1.5 text-xs leading-5 font-semibold whitespace-nowrap tabular-nums ${GRADE_COLOR[security.grade]}`}
      title={`Security score ${security.score}/100 (passive checks)`}
    >
      {security.grade} {security.score}
    </span>
  )
}
