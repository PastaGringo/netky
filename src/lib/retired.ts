export const RETIRED_AFTER_DAYS = 7

const RETIRED_AFTER_MS = RETIRED_AFTER_DAYS * 24 * 3_600_000

/**
 * When a server leaves the list: a week after its last answer as a homeserver
 * (or after it was first seen, if it never gave one). A deleted one behind a
 * wildcard domain keeps answering 404, so "not-pubky" counts as gone as much
 * as "down". Null while it answers.
 */
export function retiresAt(
  status: string,
  lastAliveAt: number | null,
  firstSeen: number,
): number | null {
  if (status !== 'down' && status !== 'not-pubky') return null
  return (lastAliveAt ?? firstSeen) + RETIRED_AFTER_MS
}
