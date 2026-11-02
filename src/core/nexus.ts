// Nexus (the pubky.app indexer) is only used as a source of user keys.
// Which homeserver a user lives on is always read from the user's own
// signed PKARR record, never taken from Nexus.
export const NEXUS_URL =
  process.env.NETKY_NEXUS_URL ?? 'https://nexus.pubky.app'

const PAGE = 20 // Nexus rejects a larger limit on this endpoint.
const MAX_SKIP = 10_000 // and a larger skip.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Every user key Nexus lists in its "most followed" stream. */
export async function listNexusUsers(
  opts: { delayMs?: number } = {},
): Promise<Array<string>> {
  const out = new Set<string>()
  for (let skip = 0; skip <= MAX_SKIP; skip += PAGE) {
    const url = `${NEXUS_URL}/v0/stream/users/ids?source=most_followed&skip=${skip}&limit=${PAGE}`
    const res = await fetch(url, {
      headers: {
        'user-agent': 'netky/0.1 (+https://netky.pubky.pastalabs.dev/about)',
      },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok)
      throw new Error(`Nexus answered HTTP ${res.status} at skip=${skip}`)
    const ids = (await res.json()) as unknown
    if (!Array.isArray(ids) || ids.length === 0) break
    for (const id of ids) if (typeof id === 'string') out.add(id)
    if (ids.length < PAGE) break
    await sleep(opts.delayMs ?? 150)
  }
  return [...out]
}

export interface Profile {
  name: string | null
  /** The avatar was saved to `avatarPath`. */
  avatar: boolean
}

/** Name and avatar of a user from Nexus; the avatar is written to `avatarPath`. */
export async function fetchProfile(
  pubkey: string,
  avatarPath: string,
): Promise<Profile> {
  const headers = {
    'user-agent': 'netky/0.1 (+https://netky.pubky.pastalabs.dev/about)',
  }
  let name: string | null = null
  try {
    const res = await fetch(`${NEXUS_URL}/v0/user/${pubkey}`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    })
    if (res.ok) {
      const user = (await res.json()) as { details?: { name?: unknown } }
      if (typeof user.details?.name === 'string')
        name = user.details.name.slice(0, 80)
    }
  } catch {
    // Keep going: the avatar may still come.
  }
  let avatar = false
  try {
    const res = await fetch(`${NEXUS_URL}/static/avatar/${pubkey}`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    })
    const type = res.headers.get('content-type') ?? ''
    if (res.ok && type.startsWith('image/')) {
      const bytes = Buffer.from(await res.arrayBuffer())
      if (bytes.length > 0 && bytes.length < 2_000_000) {
        const { mkdir, writeFile, rename } = await import('node:fs/promises')
        const { dirname } = await import('node:path')
        await mkdir(dirname(avatarPath), { recursive: true })
        await writeFile(`${avatarPath}.tmp`, bytes)
        await rename(`${avatarPath}.tmp`, avatarPath)
        avatar = true
      }
    }
  } catch {
    // No avatar.
  }
  return { name, avatar }
}
