import { createFileRoute } from '@tanstack/react-router'
import { PUBKEY_RE } from '#/core/z32'
import { json } from '#/server/api'
import {
  activity,
  getHomeserver,
  recentProbes,
  uptimeDaily,
} from '#/server/queries'

export const Route = createFileRoute('/api/v1/homeservers/$pubkey')({
  server: {
    handlers: {
      GET: ({ params }) => {
        const key = params.pubkey.toLowerCase().replace(/^pubky/, '')
        if (!PUBKEY_RE.test(key)) return json({ error: 'invalid key' }, 400)
        const homeserver = getHomeserver(key)
        if (!homeserver) return json({ error: 'not found' }, 404)
        return json({
          homeserver,
          activity: activity(key),
          uptimeDaily: uptimeDaily(key),
          probes: recentProbes(key),
        })
      },
    },
  },
})
