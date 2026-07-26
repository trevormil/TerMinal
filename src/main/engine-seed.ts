// Seeding a new session's FIRST prompt as a launch argument, instead of pasting
// it into the booted TUI after a readiness heuristic.
//
// The old path (Terminal.tsx) waited for the engine to "settle", sent a leading
// Enter to clear Claude's trust dialog, bracketed-pasted, then double-Entered to
// submit — a stack of timing guesses tuned to Claude's TUI, which is why it was
// flaky and effectively Claude-only. Every agent CLI instead accepts an initial
// prompt that starts an INTERACTIVE (conversational) session — NOT the -p/print
// one-shot — so we pass the prompt at launch and the engine ingests it as its
// first turn, deterministically and provider-agnostically.
//
// The per-engine shapes now live in the shared registry (src/shared/engines.ts)
// alongside every other engine fact; these wrappers keep the call sites stable.
import { engineSupportsSeed, seedArgs } from '../shared/engines'

/** Which engines can be seeded at launch. `local` is a bare shell — no agent, no
 *  prompt semantics — so it can't. */
export function engineSupportsLaunchSeed(engine: string): boolean {
  return engineSupportsSeed(engine)
}

/**
 * The args that make `engine` start an interactive session already seeded with
 * `prompt` as the first turn. Appended AFTER the engine's own flags.
 *
 * Verified from each CLI's --help:
 *   claude "<prompt>"        positional; "-p/--print for non-interactive"
 *   codex "<prompt>"         positional [PROMPT]; forwarded to the interactive CLI
 *   cursor-agent "<prompt>"  positional; "Initial prompt for the agent"
 *   opencode --prompt "<p>"  "--prompt   prompt to use" (the TUI is the default cmd)
 *   hermes --tui -z "<p>"    -z PROMPT flag
 *   openrouter/openai-compat inherit their harness (codex → positional, hermes → -z)
 */
export function engineInitialPromptArgs(
  engine: string,
  prompt: string,
  harness: 'codex' | 'hermes' = 'codex',
): string[] {
  if (!prompt) return []
  // OpenRouter's interactive shape follows whichever harness actually runs it,
  // so it can't be a static registry fact.
  if (engine === 'openrouter') return harness === 'hermes' ? ['-z', prompt] : [prompt]
  return seedArgs(engine, prompt)
}
