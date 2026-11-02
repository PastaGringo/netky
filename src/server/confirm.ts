// "I run this server": the operator named by a claim confirms with Pubky
// Ring. The flow asks for one capability, /pub/netky/:rw, then Netky adds
// the homeserver to /pub/netky/operates.txt on the operator's own
// homeserver and signs the session out. Nothing else is written or kept.
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import QRCode from 'qrcode'
import { resolveHomeservers } from '#/core/jobs.ts'
import { getHomeserver } from './queries.ts'

// Loaded at run time from node_modules: the SDK ships a WebAssembly file the
// server bundle cannot carry. It also swaps globalThis.fetch for a cookie-aware
// one, which is harmless here.
type Sdk = typeof import('@synonymdev/pubky')
let sdk: Sdk | null = null
let client: InstanceType<Sdk['Pubky']> | null = null
function pubky() {
  sdk ??= createRequire(import.meta.url)('@synonymdev/pubky') as Sdk
  client ??= new sdk.Pubky()
  return { sdk, client }
}

const CAPABILITIES = '/pub/netky/:rw'
const FILE = '/pub/netky/operates.txt'
const TTL_MS = 10 * 60_000
const MAX_FLOWS = 50

export type ConfirmStatus = 'pending' | 'done' | 'error'

interface Flow {
  homeserver: string
  status: ConfirmStatus
  message: string | null
  expires: number
}

const flows = new Map<string, Flow>()

function purge() {
  const now = Date.now()
  for (const [id, f] of flows) if (f.expires < now) flows.delete(id)
}

export class ConfirmError extends Error {}

export async function startConfirm(homeserver: string) {
  purge()
  const hs = getHomeserver(homeserver)
  if (!hs?.claimVerified || !hs.operator)
    throw new ConfirmError('This homeserver has no claim to confirm yet.')
  if (flows.size >= MAX_FLOWS)
    throw new ConfirmError(
      'Too many confirmations in progress, try again in a few minutes.',
    )

  const operator = hs.operator
  const { sdk, client } = pubky()
  const flow = client.startCookieAuthFlow(
    CAPABILITIES,
    sdk.AuthFlowKind.signin(),
  )
  const url = flow.authorizationUrl
  const id = randomBytes(16).toString('hex')
  const state: Flow = {
    homeserver,
    status: 'pending',
    message: null,
    expires: Date.now() + TTL_MS,
  }
  flows.set(id, state)

  flow
    .awaitApproval()
    .then(async (session) => {
      try {
        const key = session.info.publicKey.z32()
        if (key !== operator) {
          state.status = 'error'
          state.message =
            'This Pubky key is not the operator named in the DNS of this server.'
          return
        }
        let current = ''
        try {
          current = await session.storage.getText(FILE)
        } catch {
          // No file yet.
        }
        const keys = new Set(
          current
            .split(/[\s,;]+/)
            .map((w) =>
              w
                .trim()
                .toLowerCase()
                .replace(/^pubky/, ''),
            )
            .filter(Boolean),
        )
        keys.add(homeserver)
        await session.storage.putText(FILE, `${[...keys].join('\n')}\n`)
        state.status = 'done'
      } finally {
        await session.signout().catch(() => undefined)
        session.free()
      }
      // Refresh this server now instead of waiting for the next pass.
      await resolveHomeservers(homeserver).catch(() => undefined)
    })
    .catch((e: unknown) => {
      state.status = 'error'
      state.message = e instanceof Error ? e.message : String(e)
    })
    .finally(() => flow.free())

  const qr = await QRCode.toString(url, {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#070707', light: '#ffffff' },
  })
  return { id, url, qr, operator }
}

export function confirmStatus(
  id: string,
): { status: ConfirmStatus; message: string | null } | null {
  purge()
  const f = flows.get(id)
  return f ? { status: f.status, message: f.message } : null
}
