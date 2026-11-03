import { createFileRoute } from '@tanstack/react-router'
import { flowStatus, guarded } from '#/server/admin'

export const Route = createFileRoute('/api/admin/flow')({
  server: {
    handlers: {
      GET: ({ request }) => guarded(() => flowStatus(request)),
    },
  },
})
