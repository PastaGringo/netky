import { createFileRoute } from '@tanstack/react-router'
import {
  assertSameOrigin,
  disconnectAppAccount,
  guarded,
  reply,
  requireAdmin,
  startLink,
  verifyAppAccount,
} from '#/server/admin'

export const Route = createFileRoute('/api/admin/account')({
  server: {
    handlers: {
      // Checks the stored session.
      GET: ({ request }) =>
        guarded(async () => {
          requireAdmin(request)
          return reply(await verifyAppAccount())
        }),
      // Starts the Pubky Ring approval that connects an account.
      POST: ({ request }) =>
        guarded(() => {
          assertSameOrigin(request)
          return startLink(request)
        }),
      DELETE: ({ request }) =>
        guarded(async () => {
          assertSameOrigin(request)
          requireAdmin(request)
          await disconnectAppAccount()
          return reply({ ok: true })
        }),
    },
  },
})
