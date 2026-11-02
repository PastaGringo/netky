import { useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

// The worker probes every homeserver on the "*/5 * * * *" cron: at :00, :05…
const EVERY_MS = 5 * 60_000
// A pass takes a few seconds; refresh the page data a bit after the mark.
const SETTLE_MS = 20_000

function format(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * "next check in m:ss", ticking every second. The first render uses the
 * server's clock (`serverNow`) so that hydration matches.
 */
export function NextCheck({ serverNow }: { serverNow: number }) {
  const router = useRouter()
  const [now, setNow] = useState(serverNow)

  useEffect(() => {
    setNow(Date.now())
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [])

  const next = Math.floor(now / EVERY_MS) * EVERY_MS + EVERY_MS
  const left = next - now

  // Reload the data once the pass that just started has had time to finish.
  useEffect(() => {
    const sinceMark = now % EVERY_MS
    if (sinceMark >= SETTLE_MS && sinceMark < SETTLE_MS + 1000)
      void router.invalidate()
  }, [now, router])

  const checking = now % EVERY_MS < SETTLE_MS
  return (
    <span aria-live="off">
      {checking ? (
        <span className="text-green">checking now…</span>
      ) : (
        <>
          next check in{' '}
          <span className="text-text tabular-nums">{format(left)}</span>
        </>
      )}
    </span>
  )
}
