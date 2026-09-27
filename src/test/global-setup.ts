// Pushes the drizzle schema into TEST_DATABASE_URL (a scratch database) once
// per test run. No-op when TEST_DATABASE_URL is unset (DB suites skip).
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export default function setup() {
  const url = process.env.TEST_DATABASE_URL
  if (!url) return
  const root = fileURLToPath(new URL('../..', import.meta.url))
  execFileSync(process.execPath, ['node_modules/drizzle-kit/bin.cjs', 'push', '--force', '--config=drizzle.config.ts'], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })
}
