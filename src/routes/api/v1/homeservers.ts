import { createFileRoute } from '@tanstack/react-router'
import { json } from '#/server/api'
import { listHomeservers } from '#/server/queries'

export const Route = createFileRoute('/api/v1/homeservers')({
  server: {
    handlers: {
      GET: ({ request }) => {
        const url = new URL(request.url)
        const status = url.searchParams.get('status')
        const country = url.searchParams.get('country')?.toUpperCase()
        const minUptime = Number(url.searchParams.get('minUptime') ?? NaN)
        const list = listHomeservers().filter(
          (h) =>
            (!status || h.status === status) &&
            (!country || h.country === country) &&
            (Number.isNaN(minUptime) || (h.uptime7d ?? 0) >= minUptime),
        )
        return json({ count: list.length, homeservers: list })
      },
    },
  },
})
