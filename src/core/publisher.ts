// Writes a post with the application account. The SDKs are loaded on first use
// and at run time: they carry WebAssembly the web bundle cannot hold, and the
// Pubky SDK replaces globalThis.fetch, so the worker only loads them in the
// short-lived process of src/worker/publish.ts.
import { createRequire } from 'node:module'
import { getDb } from './db.ts'
import { decrypt } from './vault.ts'

const load = (name: string) => createRequire(import.meta.url)(name)

/** The JSON and path of a short post, as pubky.app writes it (no null fields). */
export function buildPost(account: string, content: string) {
  const { PubkySpecsBuilder, PubkyAppPostKind } = load(
    'pubky-app-specs',
  ) as typeof import('pubky-app-specs')
  const { meta, post } = new PubkySpecsBuilder(account).createPost(
    content,
    PubkyAppPostKind.Short,
    null,
    null,
  )
  const body = Object.fromEntries(
    Object.entries(post.toJson() as Record<string, unknown>).filter(
      ([, v]) => v !== null && v !== undefined,
    ),
  )
  return { path: meta.path, url: meta.url, body }
}

export function hasAppAccount(): boolean {
  return !!getDb().prepare('SELECT 1 FROM app_account WHERE id = 1').get()
}

/** Publishes with the connected account and returns the post's URI. */
export async function publishPost(content: string): Promise<string> {
  const row = getDb()
    .prepare('SELECT pubkey, secret_enc FROM app_account WHERE id = 1')
    .get() as { pubkey: string; secret_enc: string } | undefined
  if (!row) throw new Error('No application account connected.')
  const { path, url, body } = buildPost(row.pubkey, content)
  const { Pubky } = load(
    '@synonymdev/pubky',
  ) as typeof import('@synonymdev/pubky')
  const session = await new Pubky().restoreSession(decrypt(row.secret_enc))
  try {
    await session.storage.putJson(path as `/pub/${string}`, body)
    return url
  } finally {
    session.free()
  }
}
