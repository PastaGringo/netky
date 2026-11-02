import { createFileRoute } from '@tanstack/react-router'
import { PUBKEY_RE } from '#/core/z32'
import { ConfirmError, startConfirm } from '#/server/confirm'

const noStore = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
}

export const Route = createFileRoute('/api/confirm')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => null)) as {
          homeserver?: unknown
        } | null
        const key = String(body?.homeserver ?? '').toLowerCase()
        if (!PUBKEY_RE.test(key))
          return new Response(JSON.stringify({ error: 'invalid key' }), {
            status: 400,
            headers: noStore,
          })
        try {
          return new Response(JSON.stringify(await startConfirm(key)), {
            headers: noStore,
          })
        } catch (e) {
          const status = e instanceof ConfirmError ? 409 : 500
          const error =
            e instanceof ConfirmError
              ? e.message
              : 'Could not start Pubky Ring sign-in.'
          return new Response(JSON.stringify({ error }), {
            status,
            headers: noStore,
          })
        }
      },
    },
  },
})
