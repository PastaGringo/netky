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
