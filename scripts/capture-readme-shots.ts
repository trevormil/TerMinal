// Regenerate the README screenshots from the UX sandbox (ticket 98).
//
//   bun run shots
//
// The old images were taken against the developer's real instance and leaked
// their home-directory and checkout paths (in the README hero, and in the
// Agents shot's STATE row) onto a public page. This captures from a throwaway
// HOME with a fixture repo instead, so
// there is no personal state in the process to leak — clean by construction,
// not by remembering to check.
//
// The visible paths are chosen here rather than left as mkdtemp noise, because
// they appear IN the images.

import { existsSync, mkdirSync, rmSync, copyFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = resolve(import.meta.dir, '..')
const STAGE = '/tmp/terminal-shots'
const SHOT_DIR = join(ROOT, 'test-results', 'readme-shots')
const DEST = join(ROOT, 'docs')

// A presentable home + repo name. `~/projects/acme-api` reads as a product;
// `/var/folders/.../terminal-ux-home-Xk2p9k/fixture-repo` reads as a bug.
const HOME = join(STAGE, 'home')
const REPO_NAME = 'acme-api'

rmSync(STAGE, { recursive: true, force: true })
mkdirSync(HOME, { recursive: true })

if (!existsSync(join(ROOT, 'out', 'main', 'index.js'))) {
  console.error('No build found — run `bun run build` first.')
  process.exit(1)
}

console.log('▸ capturing from a sandboxed instance…')
const r = spawnSync('bunx', ['playwright', 'test', '--config=playwright.shots.config.ts'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: {
    ...process.env,
    TERMINAL_UX_HOME: HOME,
    TERMINAL_UX_CONFIG_DIR: join(STAGE, 'config'),
    TERMINAL_UX_REPO_NAME: REPO_NAME,
    // Presentable stub output — the hero is a picture of the terminal.
    TERMINAL_UX_DEMO: '1',
    TERMINAL_UX_REMOTE_SLUG: `acme/${REPO_NAME}`,
    README_SHOT_DIR: SHOT_DIR,
  },
})
if (r.status !== 0) {
  console.error('capture failed')
  process.exit(r.status ?? 1)
}

const shots = readdirSync(SHOT_DIR).filter((f) => f.endsWith('.png'))
for (const f of shots) copyFileSync(join(SHOT_DIR, f), join(DEST, f))
console.log(`\n▸ copied ${shots.length} images → docs/`)
console.log('  Now LOOK at them before committing. The whole reason this ticket')
console.log('  exists is that nobody opened the last set.')
