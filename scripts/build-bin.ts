#!/usr/bin/env bun
// Bundles the typed sources under src/ into the single self-contained scripts in
// bin/ that launchd, systemd, host-provision, the agent image and the app itself
// execute.
//
// The artifacts stay COMMITTED because those flows run them straight out of a
// checkout (host-provision scp's the file; docker/build-agent-image.sh bakes it
// in; the app copies them to ~/.config/TerMinal/bin). src/bin-build-sync.test.ts
// regenerates and diffs every one of them, so a source edit without a rebuild
// fails the suite.
//
//   bun scripts/build-bin.ts                    # write every artifact
//   bun scripts/build-bin.ts --check            # exit 1 if any committed copy is stale
//   bun scripts/build-bin.ts terminal-monitor   # just one
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** artifact name in bin/ → the source directory it is bundled from. */
export const TARGETS: Record<string, string> = {
  'terminal-cron': 'runner',
  'terminal-monitor': 'monitor',
  'terminal-cli': 'cli',
}

export const entryFor = (name: string): string => join(ROOT, 'src', TARGETS[name], 'index.ts')
export const outFor = (name: string): string => join(ROOT, 'bin', name)

const banner = (name: string): string => `#!/usr/bin/env bun
// GENERATED — do not edit. Built from src/${TARGETS[name]}/ by scripts/build-bin.ts.
// Edit the TypeScript modules there, then run \`bun run build:bin\`.
`

/** The bundle text, banner included. Throws with the build logs on failure. */
export async function buildBin(name: string): Promise<string> {
  const res = await Bun.build({
    entrypoints: [entryFor(name)],
    target: 'bun',
    format: 'esm',
    banner: banner(name),
  })
  if (!res.success) throw new Error(res.logs.map((l) => String(l)).join('\n'))
  return await res.outputs[0].text()
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const check = args.includes('--check')
  const named = args.filter((a) => !a.startsWith('--'))
  const names = named.length ? named : Object.keys(TARGETS)

  let stale = 0
  for (const name of names) {
    if (!TARGETS[name]) {
      console.error(`unknown artifact ${name} — known: ${Object.keys(TARGETS).join(', ')}`)
      process.exit(2)
    }
    const text = await buildBin(name)
    const out = outFor(name)
    let current: string | null = null
    try {
      current = readFileSync(out, 'utf8')
    } catch {
      /* never built */
    }
    if (current === text) {
      console.log(`bin/${name} already current`)
    } else if (check) {
      console.error(`bin/${name} is stale`)
      stale++
    } else {
      writeFileSync(out, text)
      chmodSync(out, 0o755)
      console.log(`bin/${name}: rebuilt`)
    }
  }
  if (stale) {
    console.error('Run: bun run build:bin')
    process.exit(1)
  }
}
