import { createRequire } from 'node:module'

// Loaded at run time from node_modules: the SDK ships a WebAssembly file the
// server bundle cannot carry. It also swaps globalThis.fetch for a cookie-aware
// one, which is harmless here.
type Sdk = typeof import('@synonymdev/pubky')
let sdk: Sdk | null = null
let client: InstanceType<Sdk['Pubky']> | null = null

export function pubky() {
  sdk ??= createRequire(import.meta.url)('@synonymdev/pubky') as Sdk
  client ??= new sdk.Pubky()
  return { sdk, client }
}
