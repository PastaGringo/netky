// Runs the web server and the worker side by side in one container.
// If either one exits, stop the other and exit, so the orchestrator restarts both.
import { spawn } from 'node:child_process'

const children = [
  spawn(process.execPath, ['.output/server/index.mjs'], { stdio: 'inherit' }),
  spawn(process.execPath, ['src/worker/main.ts'], { stdio: 'inherit' }),
]

let stopping = false
function stopAll(code) {
  if (stopping) return
  stopping = true
  for (const c of children) if (c.exitCode === null) c.kill('SIGTERM')
  setTimeout(() => process.exit(code), 3000).unref()
}

for (const c of children) c.on('exit', (code) => stopAll(code ?? 1))
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => stopAll(0))
