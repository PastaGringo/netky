import { Link } from '@tanstack/react-router'
import type { Security } from '#/lib/security'
import { GradeBadge } from './ui'

export function SecuritySection({ security }: { security: Security | null }) {
  return (
    <section aria-labelledby="security" className="mt-10">
      <h2 id="security" className="m-0 font-display text-2xl">
        <span className="text-dim">$</span> security
      </h2>
      {!security ? (
        <p className="mt-3 text-dim">
          No score yet: Netky needs to see the server answer over HTTPS first.
        </p>
      ) : (
        <div className="mt-3 border bg-panel/90">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-3">
            <span className="font-display text-5xl leading-none">
              {security.grade}
            </span>
            <span className="text-sm">
              <span className="text-text">{security.score}/100</span>
              <span className="block text-xs text-dim">
                passive checks only ·{' '}
                <Link
                  to="/about"
                  hash="security"
                  className="underline hover:text-red"
                >
                  how it is scored
                </Link>
              </span>
            </span>
            <span className="ml-auto">
              <GradeBadge security={security} />
            </span>
          </div>
          <ul className="m-0 list-none p-0">
            {security.checks.map((c) => (
              <li
                key={c.id}
                className="flex gap-3 border-b px-4 py-2 text-sm last:border-b-0"
              >
                <span
                  className={`w-5 shrink-0 ${c.ok ? 'text-green' : 'text-red'}`}
                  aria-label={c.ok ? 'passed' : 'failed'}
                >
                  {c.ok ? '✓' : '✗'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={c.ok ? 'text-text' : 'text-text'}>
                    {c.label}
                  </span>
                  <span className="block text-xs text-dim">{c.why}</span>
                </span>
                <span className="shrink-0 text-xs text-dim tabular-nums">
                  {c.points}/{c.max}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
