import { readFile } from 'node:fs/promises'
import { createFileRoute } from '@tanstack/react-router'
import { DATA_DIR } from '#/core/db'
import { PUBKEY_RE } from '#/core/z32'

// Operator avatars, cached by the worker from Nexus: visitors never hit Nexus.
export const Route = createFileRoute('/avatars/$pubkey')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (!PUBKEY_RE.test(params.pubkey))
          return new Response('bad key', { status: 400 })
        try {
          const bytes = await readFile(`${DATA_DIR}/avatars/${params.pubkey}`)
          return new Response(bytes, {
            headers: {
              'content-type': sniff(bytes),
              'cache-control': 'public, max-age=3600',
              'x-content-type-options': 'nosniff',
            },
          })
        } catch {
          return new Response('not found', { status: 404 })
        }
      },
    },
  },
})

function sniff(b: Buffer): string {
  if (
    b.subarray(0, 4).toString('ascii') === 'RIFF' &&
    b.subarray(8, 12).toString('ascii') === 'WEBP'
  )
    return 'image/webp'
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png'
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg'
  if (b.subarray(0, 3).toString('ascii') === 'GIF') return 'image/gif'
  return 'application/octet-stream'
}
