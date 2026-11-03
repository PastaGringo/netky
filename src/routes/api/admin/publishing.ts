import { createFileRoute } from '@tanstack/react-router'
import {
  AdminError,
  assertSameOrigin,
  guarded,
  reply,
  requireAdmin,
} from '#/server/admin'
import {
  publishDaily,
  publishingStatus,
  setAnnouncementsEnabled,
  setDailyEnabled,
} from '#/server/publishing'

export const Route = createFileRoute('/api/admin/publishing')({
  server: {
    handlers: {
      GET: ({ request }) =>
        guarded(() => {
          requireAdmin(request)
          return reply(publishingStatus())
        }),
      // { daily?: boolean, announcements?: boolean } or { publishNow: true }
      POST: ({ request }) =>
        guarded(async () => {
          assertSameOrigin(request)
          requireAdmin(request)
          const body = (await request.json().catch(() => null)) as {
            daily?: unknown
            announcements?: unknown
            publishNow?: unknown
          } | null
          if (!publishingStatus().hasAccount)
            throw new AdminError(409, 'Connect an account first.')
          if (body?.publishNow === true) {
            const uri = await publishDaily().catch((e: unknown) => {
              throw new AdminError(
                502,
                e instanceof Error ? e.message : String(e),
              )
            })
            if (!uri)
              throw new AdminError(409, 'Today’s report is already published.')
          }
          if (typeof body?.daily === 'boolean') setDailyEnabled(body.daily)
          if (typeof body?.announcements === 'boolean')
            setAnnouncementsEnabled(body.announcements)
          return reply(publishingStatus())
        }),
    },
  },
})
