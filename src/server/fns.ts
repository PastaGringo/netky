import { createServerFn } from '@tanstack/react-start'
import { PUBKEY_RE } from '#/core/z32.ts'
import {
  getHomeserver,
  listHomeservers,
  networkStats,
  activity,
  recentProbes,
  uptimeDaily,
} from './queries.ts'

export const getOverview = createServerFn({ method: 'GET' }).handler(() => {
  const homeservers = listHomeservers()
  return { homeservers, stats: networkStats(homeservers), now: Date.now() }
})

export const getHomeserverDetail = createServerFn({ method: 'GET' })
  .validator((pubkey: unknown) => {
    const key = String(pubkey)
      .toLowerCase()
      .replace(/^pubky/, '')
    if (!PUBKEY_RE.test(key)) throw new Error('invalid key')
    return key
  })
  .handler(({ data: pubkey }) => {
    const homeserver = getHomeserver(pubkey)
    return homeserver
      ? {
          homeserver,
          probes: recentProbes(pubkey),
          activity: activity(pubkey),
          uptimeDaily: uptimeDaily(pubkey),
          now: Date.now(),
        }
      : null
  })
