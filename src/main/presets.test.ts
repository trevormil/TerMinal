import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const run = (home: string, code: string) => {
  const result = spawnSync(process.execPath, ['--eval', code], {
    cwd: process.cwd(),
    env: { ...process.env, HOME: home },
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  return JSON.parse(result.stdout)
}

describe('preset prefs', () => {
  test('hides and restores app-owned preset ids without touching user content files', () => {
    const home = mkdtempSync(join(tmpdir(), 'terminal-presets-'))
    try {
      const hidden = run(
        home,
        "import { hidePreset, readPresetPrefs } from './src/main/presets.ts'; hidePreset('agents','factory'); hidePreset('snippets','continue'); console.log(JSON.stringify(readPresetPrefs()))",
      )
      expect(hidden.hidden.agents).toEqual(['factory'])
      expect(hidden.hidden.snippets).toEqual(['continue'])

      const restored = run(
        home,
        "import { restorePreset, readPresetPrefs } from './src/main/presets.ts'; restorePreset('agents','factory'); restorePreset('snippets'); console.log(JSON.stringify(readPresetPrefs()))",
      )
      expect(restored.hidden.agents).toEqual([])
      expect(restored.hidden.snippets).toEqual([])
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
