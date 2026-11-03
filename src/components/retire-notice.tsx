import { useEffect, useState } from 'react'

import { RETIRED_AFTER_DAYS } from '#/lib/retired'

function format(ms: number) {
  const s = Math.floor(ms / 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${Math.floor(s / 86_400)}d ${pad(Math.floor(s / 3600) % 24)}h ${pad(Math.floor(s / 60) % 60)}m ${pad(s % 60)}s`
}

/**
 * Countdown to the moment a silent server leaves the directory. The first
 * render uses the server's clock (`serverNow`) so that hydration matches.
 */
export function RetireNotice({
  retiresAt,
  serverNow,
}: {
  retiresAt: number
  serverNow: number
}) {
  const [now, setNow] = useState(serverNow)

  useEffect(() => {
    setNow(Date.now())
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [])

  const left = retiresAt - now
  return (
    <p className="mt-4 mb-0 border border-amber/60 bg-panel/90 px-4 py-2 text-sm text-pretty">
      {left > 0 ? (
        <>
          <span className="text-amber">[WARN]</span> Not answering as a
          homeserver. Netky removes a server from its directory after{' '}
          {RETIRED_AFTER_DAYS} days of silence: this one leaves in{' '}
          <span className="whitespace-nowrap text-text tabular-nums">
            {format(left)}
          </span>
          , unless it answers again.
        </>
      ) : (
        <>
          <span className="text-amber">[INFO]</span> Removed from the directory
          after {RETIRED_AFTER_DAYS} days of silence. Netky keeps checking it,
          and it comes back at its first answer.
        </>
      )}
    </p>
  )
}
