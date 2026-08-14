#!/usr/bin/env bun
// Bundles src/runner/ into the single self-contained bin/terminal-cron that
// launchd, systemd, host-provision and the agent image all execute.
//
// The artifact stays COMMITTED because those flows run it straight out of a
// checkout (host-provision scp's the file; docker/build-agent-image.sh bakes
// it in; the app copies it to ~/.config/TerMinal/bin). src/runner-build.test.ts
// regenerates and diffs it, so a source edit without a rebuild fails the suite.
//
//   bun scripts/build-runner.ts          # write bin/terminal-cron
//   bun scripts/build-runner.ts --check  # exit 1 if the committed copy is stale
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const ENTRY = join(ROOT, 'src', 'runner', 'index.ts')
export const OUT = join(ROOT, 'bin', 'terminal-cron')

const BANNER = `#!/usr/bin/env bun
// GENERATED — do not edit. Built from src/runner/ by scripts/build-runner.ts.
// Edit the TypeScript modules there, then run \`bun run build:runner\`.
`

/** The bundle text, banner included. Throws with the build logs on failure. */
export async function buildRunner(): Promise<string> {
  const res = await Bun.build({
    entrypoints: [ENTRY],
    target: 'bun',
    format: 'esm',
    banner: BANNER,
  })
  if (!res.success) throw new Error(res.logs.map((l) => String(l)).join('\n'))
  return await res.outputs[0].text()
}

if (import.meta.main) {
  const text = await buildRunner()
  const check = process.argv.includes('--check')
  let current: string | null = null
  try {
    current = readFileSync(OUT, 'utf8')
  } catch {}
  if (current === text) {
    console.log('bin/terminal-cron already current')
  } else if (check) {
    console.error('bin/terminal-cron is stale — run: bun run build:runner')
    process.exit(1)
  } else {
    writeFileSync(OUT, text)
    chmodSync(OUT, 0o755)
    console.log('bin/terminal-cron: rebuilt')
  }
}
