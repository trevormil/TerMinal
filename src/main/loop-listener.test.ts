import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

// loop-listener resolves the events.jsonl path via getLoop (reads
// ~/.config/TerMinal/loops.json) and loops.ts imports electron, so each case
// runs in a subprocess with a throwaway HOME + a mocked electron.
const run = (home: string, code: string): Record<string, unknown> => {
  const result = spawnSync(process.execPath, ['--eval', code], {
    cwd: process.cwd(),
    env: { ...process.env, HOME: home },
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  return JSON.parse(result.stdout)
}

describe('paired-loop listener routing', () => {
  test('routes each role event to the peer session PTY, once, from EOF', () => {
    const home = mkdtempSync(join(tmpdir(), 'terminal-loop-listener-'))
    try {
      const r = run(
        home,
        `import { mock } from 'bun:test';
mock.module('electron', () => ({ Notification: class { static isSupported() { return false } show() {} } }));
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
const repo = join('${home}', 'repo');
const loopId = 't-loop';
const evDir = join(repo, '.TerMinal', 'loops', loopId);
mkdirSync(evDir, { recursive: true });
writeFileSync(join(evDir, 'events.jsonl'), '{"role":"worker","summary":"seeded before start"}\\n');
mkdirSync(join('${home}', '.config', 'TerMinal'), { recursive: true });
writeFileSync(join('${home}', '.config', 'TerMinal', 'loops.json'), JSON.stringify([{ id: loopId, repo: 'repo', repoRoot: repo, goal: 'g', mode: 'paired', engine: 'claude', worktree: '/wt', branch: 'loop/t', status: 'idle', phase: 'negotiate', nextRole: 'planner', iteration: 0, maxIterations: 25, createdAt: 1, updatedAt: 1 }]));
const L = await import('./src/main/loop-listener.ts');
const writes = [];
const deps = { writeToSession: (k, d) => { writes.push({ k, d }); return true }, sessionIdOf: () => undefined, lastAssistantText: () => '' };
L.registerLoopSession('driverKey', loopId, 'driver');
L.registerLoopSession('workerKey', loopId, 'worker');
// First tick seeds the offset at EOF — the pre-existing line must NOT replay.
L.runLoopListenerTick(deps);
const afterSeed = writes.length;
// Worker hands off -> delivered to the driver session.
appendFileSync(join(evDir, 'events.jsonl'), '{"role":"worker","summary":"ready for review","detail":"A1-A3 done"}\\n');
L.runLoopListenerTick(deps);
// Driver replies -> delivered to the worker session.
appendFileSync(join(evDir, 'events.jsonl'), '{"role":"driver","summary":"A2 fails","detail":"modal 600ms"}\\n');
L.runLoopListenerTick(deps);
// A tick with no new bytes delivers nothing (no double-send).
L.runLoopListenerTick(deps);
console.log(JSON.stringify({ afterSeed, writes }));`,
      )
      // Seeding at EOF: the pre-existing worker line does not replay.
      expect(r.afterSeed).toBe(0)
      const writes = r.writes as { k: string; d: string }[]
      expect(writes.length).toBe(2)
      // worker event -> driver session, submitted (trailing \r), content carried
      expect(writes[0].k).toBe('driverKey')
      expect(writes[0].d).toContain('ready for review')
      expect(writes[0].d).toContain('A1-A3 done')
      expect(writes[0].d.endsWith('\r')).toBe(true)
      expect(writes[0].d).toContain('· worker')
      // driver event -> worker session
      expect(writes[1].k).toBe('workerKey')
      expect(writes[1].d).toContain('A2 fails')
      expect(writes[1].d).toContain('· driver')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
