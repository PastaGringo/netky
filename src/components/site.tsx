import { Link } from '@tanstack/react-router'

const HUB = 'https://pubky.pastalabs.dev'
export const REPO = 'https://github.com/PastaGringo/netky'

const navLink =
  'inline-flex min-h-[44px] items-center px-2 text-dim hover:text-red'

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-void/95">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-2 sm:px-6">
        <Link
          to="/"
          className="flex min-h-[44px] min-w-0 flex-wrap items-center text-sm"
          aria-label="netky, home"
        >
          <span className="text-green">
            <span className="hidden sm:inline">root@</span>netky
          </span>
          <span className="text-dim">:~#</span>
          <span className="cursor" aria-hidden="true" />
        </Link>
        <nav
          aria-label="Main"
          className="-mx-2 flex min-w-0 flex-wrap items-center text-sm"
        >
          <a href={HUB} className={navLink}>
            <span aria-hidden="true">←&nbsp;</span>pastalabs
          </a>
          <Link
            to="/"
            className={navLink}
            activeOptions={{ exact: true }}
            activeProps={{ className: 'text-text' }}
          >
            ./homeservers
          </Link>
          <Link
            to="/about"
            className={navLink}
            activeProps={{ className: 'text-text' }}
          >
            about
          </Link>
          <a
            href="/api/v1/homeservers"
            className={`${navLink} hidden sm:inline-flex`}
          >
            api
          </a>
          <a href={REPO} className={`${navLink} hidden sm:inline-flex`}>
            github
          </a>
        </nav>
      </div>
    </header>
  )
}

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-dim sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="m-0">
          <span className="text-red">[EOF]</span> netky · an independent
          observer of the Pubky network.
        </p>
        <p className="m-0">
          Geolocation by{' '}
          <a href="https://db-ip.com" className="underline hover:text-red">
            DB-IP
          </a>{' '}
          (CC BY 4.0)
        </p>
      </div>
    </footer>
  )
}
