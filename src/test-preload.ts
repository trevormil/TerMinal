import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Loaded before every `bun test` file (see bunfig.toml).
//
// A test in this repo once wrote fixture data straight into the developer's real
// ~/.config/TerMinal and destroyed their global agent registry. Nothing about
// the test looked dangerous — it imported a state module, and that module had
// the real path baked into a module-level const.
//
// So: the whole suite runs against a throwaway config dir by default. A test
// that wants its own can still override TERMINAL_CONFIG_DIR; what it cannot do
// is fall through to the real one by forgetting.
if (!process.env.TERMINAL_CONFIG_DIR) {
  process.env.TERMINAL_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'terminal-test-config-'))
}

// The same lesson one layer out: sandboxing STATE did not sandbox EFFECTS. A
// test that filed a HITL still appended to the real activity feed (which the
// running app tails and mirrors to the phone) and still POSTed the Telegram Bot
// API — the suite pinged the operator's phone twice per run. src/main/
// effect-guard.ts refuses both under test.
//
// `bun test` already sets NODE_ENV=test, which the guard keys off. This is the
// second, independent signal, so a test that clobbers NODE_ENV (or a helper
// spawned with a scrubbed env) still runs with effects blocked.
process.env.TERMINAL_BLOCK_EFFECTS = '1'
