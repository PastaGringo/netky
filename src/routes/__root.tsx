import {
  HeadContent,
  Link,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'

import { SiteFooter, SiteHeader } from '#/components/site'
import appCss from '../styles.css?url'

const TITLE = 'netky · Pubky homeserver directory'
const DESCRIPTION =
  'Every Pubky homeserver we can find, with uptime, latency, location and user counts. Read from signed PKARR records, checked every five minutes.'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1, viewport-fit=cover',
      },
      { title: TITLE },
      { name: 'description', content: DESCRIPTION },
      { name: 'theme-color', content: '#070707' },
      { property: 'og:type', content: 'website' },
      { property: 'og:title', content: TITLE },
      { property: 'og:description', content: DESCRIPTION },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
    ],
  }),
  shellComponent: RootDocument,
  notFoundComponent: NotFound,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="crt">
        <div className="flex min-h-dvh flex-col">
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </div>
        <Scripts />
      </body>
    </html>
  )
}

export function NotFound() {
  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-24 sm:px-6">
      <p className="text-sm text-dim">
        $ resolve {'<'}this page{'>'}
      </p>
      <h1
        className="glitch font-display text-7xl leading-none text-red sm:text-8xl"
        data-text="404"
      >
        404
      </h1>
      <p className="mt-4 text-pretty">
        No record found. Nothing on the network points here.
      </p>
      <Link
        to="/"
        className="mt-8 inline-flex min-h-[44px] max-w-full items-center border border-green px-4 text-green hover:bg-green hover:text-void"
      >
        cd ~
      </Link>
    </section>
  )
}
