import { createFileRoute } from '@tanstack/react-router'
import { json } from '#/server/api'
import { networkStats } from '#/server/queries'

export const Route = createFileRoute('/api/v1/stats')({
  server: { handlers: { GET: () => json(networkStats()) } },
})
