import { describe, expect, it } from 'bun:test'
import {
  PTY_WRAPPER,
  buildHeadlessLaunch,
  startHeadlessSession,
  type HeadlessLaunch,
  type HeadlessSpawnDeps,
} from './headless-spawn'

// Ticket 128: the harness `spawn` registered a thread and pretended an agent was
// behind it. These pin the real launch — that a process is actually started, in
// the repo the phone picked, with the engine it picked, carrying the thread id.

describe('buildHeadlessLaunch', () => {
  it('runs the engine under a pty — agent TUIs are not pipe-safe', () => {
    const l = buildHeadlessLaunch({ engine: 'claude', bin: '/opt/bin/claude', prompt: 'go' })
    expect(l.file).toBe(PTY_WRAPPER.file)
    expect(l.args.slice(0, 2)).toEqual(['-q', '/dev/null'])
    expect(l.args[2]).toBe('/opt/bin/claude')
  })

  it('seeds the first turn as a launch argument, not a paste', () => {
    const l = buildHeadlessLaunch({ engine: 'claude', bin: 'claude', prompt: 'ship the PR' })
    expect(l.args[l.args.length - 1]).toBe('ship the PR')
    // …and never the -p one-shot, which would exit instead of staying live.
    expect(l.args).not.toContain('-p')
  })

  it('carries the engine flags the desktop uses', () => {
    const claude = buildHeadlessLaunch({ engine: 'claude', bin: 'claude', prompt: 'x' })
    expect(claude.args).toContain('--permission-mode')
    const codex = buildHeadlessLaunch({ engine: 'codex', bin: 'codex', prompt: 'x' })
    expect(codex.args).toContain('danger-full-access')
  })

  it('passes the model and effort through per engine', () => {
    const l = buildHeadlessLaunch({
      engine: 'claude',
      bin: 'claude',
      model: 'opus',
      effort: 'high',
      prompt: 'x',
    })
    expect(l.args).toContain('--model')
    expect(l.args).toContain('opus')
    expect(l.args).toContain('--effort')
    expect(l.args).toContain('high')
  })
})

function deps(over: Partial<HeadlessSpawnDeps> = {}): {
  d: HeadlessSpawnDeps
  launched: (HeadlessLaunch & { cwd: string })[]
  removed: string[]
  posts: string[]
} {
  const launched: (HeadlessLaunch & { cwd: string })[] = []
  const removed: string[] = []
  const posts: string[] = []
  const d: HeadlessSpawnDeps = {
    defaultEngine: () => 'codex',
    binFor: (e) => `/bin/${e}`,
    coerceEffort: (_e, v) => v,
    register: () => ({ id: 'thread-1' }),
    unregister: (id) => removed.push(id),
    post: (_id, text) => posts.push(text),
    prompt: (id, task) => `thread ${id}${task ? ` task ${task}` : ''}`,
    launch: (l) => {
      launched.push(l)
      return true
    },
    ...over,
  }
  return { d, launched, removed, posts }
}

describe('startHeadlessSession', () => {
  it('actually launches, in the repo the phone chose', () => {
    const { d, launched } = deps()
    const out = startHeadlessSession({ cwd: '/code/TerMinal', engine: 'claude' }, d)
    expect(out).toEqual({ id: 'thread-1' })
    expect(launched).toHaveLength(1)
    expect(launched[0].cwd).toBe('/code/TerMinal')
    expect(launched[0].args).toContain('/bin/claude')
  })

  it('honours the engine the phone sent, and the default when it sent none', () => {
    const a = deps()
    startHeadlessSession({ cwd: '/code/x', engine: 'cursor' }, a.d)
    expect(a.launched[0].args).toContain('/bin/cursor')
    const b = deps()
    startHeadlessSession({ cwd: '/code/x' }, b.d)
    expect(b.launched[0].args).toContain('/bin/codex')
  })

  it('hands the agent the thread id and the task', () => {
    const { d, launched } = deps()
    startHeadlessSession({ cwd: '/code/x', engine: 'claude', task: 'fix the flake' }, d)
    expect(launched[0].args.join(' ')).toContain('thread thread-1')
    expect(launched[0].args.join(' ')).toContain('task fix the flake')
  })

  it('drops an effort level the engine would reject', () => {
    const { d, launched } = deps({ coerceEffort: () => undefined })
    startHeadlessSession({ cwd: '/code/x', engine: 'claude', effort: 'nonsense' }, d)
    expect(launched[0].args).not.toContain('nonsense')
  })

  it('reports a failed launch instead of leaving a thread nobody is behind', () => {
    const { d, removed, posts } = deps({ launch: () => false })
    const out = startHeadlessSession({ cwd: '/code/x', engine: 'claude' }, d)
    expect(out).toEqual({ error: 'could not start claude in x' })
    expect(removed).toEqual(['thread-1'])
    expect(posts).toEqual([])
  })

  it('refuses when the engine has no binary', () => {
    const { d, launched } = deps({ binFor: () => '' })
    expect(startHeadlessSession({ cwd: '/code/x', engine: 'hermes' }, d)).toEqual({
      error: 'no binary configured for hermes',
    })
    expect(launched).toHaveLength(0)
  })
})
