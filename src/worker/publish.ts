// One publishing pass in its own short-lived process: the Pubky SDK replaces
// globalThis.fetch, which must not leak into the worker's checks.
import { runPublishing } from '../server/publishing.ts'

for (const line of await runPublishing())
  console.log(new Date().toISOString(), 'publish:', line)
process.exit(0)
