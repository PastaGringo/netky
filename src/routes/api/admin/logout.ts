import { createFileRoute } from '@tanstack/react-router'
import { assertSameOrigin, guarded, reply, signOut } from '#/server/admin'

export const Route = createFileRoute('/api/admin/logout')({
  server: {
    handlers: {
      POST: ({ request }) =>
        guarded(() => {
          assertSameOrigin(request)
          return reply({ ok: true }, 200, [signOut(request)])
        }),
    },
  },
})
