export const RETIRED_AFTER_DAYS = 7

const RETIRED_AFTER_MS = RETIRED_AFTER_DAYS * 24 * 3_600_000

/**
 * No answer as a homeserver for a week (or ever, counted from when the server
 * was first seen). A deleted one behind a wildcard domain keeps answering 404,
 * so "not-pubky" counts as gone as much as "down".
 */
export function isRetired(
  status: string,
  lastAliveAt: number | null,
  firstSeen: number,
  now = Date.now(),
): boolean {
  if (status !== 'down' && status !== 'not-pubky') return false
  return now - (lastAliveAt ?? firstSeen) > RETIRED_AFTER_MS
}
