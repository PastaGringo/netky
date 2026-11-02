import { createFileRoute } from '@tanstack/react-router'
import { confirmStatus } from '#/server/confirm'

export const Route = createFileRoute('/api/confirm/$id')({
  server: {
    handlers: {
      GET: ({ params }) => {
        const s = /^[0-9a-f]{32}$/.test(params.id)
          ? confirmStatus(params.id)
          : null
        return new Response(
          JSON.stringify(
            s ?? {
              status: 'error',
              message: 'This confirmation expired. Start again.',
            },
          ),
          {
            status: s ? 200 : 404,
            headers: {
              'content-type': 'application/json',
              'cache-control': 'no-store',
            },
          },
        )
      },
    },
  },
})
