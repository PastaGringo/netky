import { createFileRoute } from '@tanstack/react-router'
import { currentAdmin, getAppAccount, guarded, reply } from '#/server/admin'

export const Route = createFileRoute('/api/admin/me')({
  server: {
    handlers: {
      GET: ({ request }) =>
        guarded(() => {
          const admin = currentAdmin(request)
          return reply(
            admin ? { admin, account: getAppAccount() } : { admin: null },
          )
        }),
    },
  },
})
