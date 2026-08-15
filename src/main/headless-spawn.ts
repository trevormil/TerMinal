// Starting a REAL phone-requested session on this Mac with no app window to put
// it in (ticket 128).
//
// The app's own spawn hands the launch to the renderer, which opens a terminal
// tab — that is the right thing when there IS a window, because a pty spawned
// from main would be an orphan with no tab. The e2e bridge harness has no
// renderer at all, so its `spawn` used to register a thread and stop there: the
// phone got a session id and a plausible-looking chat that no agent was ever
// attached to. A New Session button that only pretends is worse than no button.
//
// So the harness launches the agent itself, from the same registry facts the
// desktop uses: engine flags from buildEngineLaunch, the initial prompt from
// engine-seed (a launch ARGUMENT, not a paste into a booted TUI), and the same
// remote-thread contract from remote-spawn-prompt.
//
// Two deliberate choices:
//   - a real pty. Agent CLIs are TUIs and behave differently (or refuse) on a
//     plain pipe, so the command is wrapped in `script`, which allocates one.
//     No native module, so this runs in a bare `bun` script.
//   - injected deps. Nothing here reads settings, touches disk, or spawns on its
//     own — the caller supplies those, so the policy is unit-testable.

import { buildEngineLaunch, type SessionEngine } from './engine-launch'
import { engineInitialPromptArgs } from './engine-seed'

export type HeadlessLaunch = { file: string; args: string[] }

/** BSD `script` (macOS): `script -q /dev/null <cmd> [args…]` runs cmd under a
 *  fresh pty and discards the typescript file. */
export const PTY_WRAPPER = { file: '/usr/bin/script', args: ['-q', '/dev/null'] }

export function buildHeadlessLaunch(input: {
  engine: string
  /** Resolved binary for the engine (settings override → env → PATH name). */
  bin: string
  model?: string
  effort?: string
  /** The agent's first turn, passed as a launch argument. */
  prompt: string
  /** Override for tests / a platform without BSD `script`. */
  ptyWrapper?: HeadlessLaunch
}): HeadlessLaunch {
  const { args } = buildEngineLaunch({
    // The engine id arrives off the wire; buildEngineLaunch's fallback branch
    // handles an id it doesn't know, so a stale phone degrades instead of
    // throwing.
    engine: input.engine as SessionEngine,
    mode: 'new',
    model: input.model,
    effort: input.effort,
  })
  const seeded = [...args, ...engineInitialPromptArgs(input.engine, input.prompt)]
  const wrapper = input.ptyWrapper ?? PTY_WRAPPER
  return { file: wrapper.file, args: [...wrapper.args, input.bin, ...seeded] }
}

export type HeadlessSpawnInput = {
  cwd: string
  engine?: string
  effort?: string
  task?: string
}

export type HeadlessSpawnDeps = {
  /** Engine used when the phone did not pick one. */
  defaultEngine(): string
  /** Binary for an engine id. */
  binFor(engine: string): string
  /** Drop an effort level the engine would reject (mirrors the app). */
  coerceEffort(engine: string, effort?: string): string | undefined
  /** Register the thread FIRST, so the phone can open it while the agent boots. */
  register(input: { title: string; repo: string; cwd: string; engine: string }): { id: string }
  /** Undo the registration when the launch fails — the id only ever existed so
   *  the prompt could name it. */
  unregister(id: string): void
  post(id: string, text: string): void
  prompt(remoteId: string, task?: string): string
  /** Actually start the process. Returns false when it could not be started. */
  launch(launch: HeadlessLaunch & { cwd: string }): boolean
}

/**
 * Register the remote thread, then launch a real agent against it. The thread is
 * registered before the launch so the phone can open it immediately — but unlike
 * the old harness stub, a failed launch is reported as a failure instead of
 * leaving a thread nobody is behind.
 */
export function startHeadlessSession(
  input: HeadlessSpawnInput,
  deps: HeadlessSpawnDeps,
): { id: string } | { error: string } {
  const engine = input.engine || deps.defaultEngine()
  const bin = deps.binFor(engine)
  if (!bin) return { error: `no binary configured for ${engine}` }
  const repo = input.cwd.split('/').filter(Boolean).pop() || 'session'
  const session = deps.register({
    title: input.task ? input.task.slice(0, 60) : `${repo} · from phone`,
    repo,
    cwd: input.cwd,
    engine,
  })
  const launch = buildHeadlessLaunch({
    engine,
    bin,
    // Validated here (not just downstream) so a stale phone can never make the
    // launch builder see a level the engine would reject.
    effort: deps.coerceEffort(engine, input.effort),
    prompt: deps.prompt(session.id, input.task),
  })
  if (!deps.launch({ ...launch, cwd: input.cwd })) {
    deps.unregister(session.id)
    return { error: `could not start ${engine} in ${repo}` }
  }
  deps.post(session.id, `Starting a ${engine} session in ${repo}…`)
  return { id: session.id }
}
