import { createFileRoute } from '@tanstack/react-router'
import { assertSameOrigin, guarded, startLogin } from '#/server/admin'

export const Route = createFileRoute('/api/admin/login')({
  server: {
    handlers: {
      POST: ({ request }) =>
        guarded(() => {
          assertSameOrigin(request)
          return startLogin()
        }),
    },
  },
})
