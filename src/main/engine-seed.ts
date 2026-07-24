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
// Verified from each CLI's --help:
//   claude "<prompt>"        positional; "-p/--print for non-interactive"
//   codex "<prompt>"         positional [PROMPT]; forwarded to the interactive CLI
//   cursor-agent "<prompt>"  positional; "Initial prompt for the agent"
//   hermes --tui -z "<p>"    -z PROMPT flag
//   openrouter/openai-compat inherit their harness (codex → positional, hermes → -z)

/** Which engines can be seeded at launch. `local` is a bare shell — no agent, no
 *  prompt semantics — so it can't. */
export function engineSupportsLaunchSeed(engine: string): boolean {
  switch (engine) {
    case 'claude':
    case 'codex':
    case 'cursor':
    case 'hermes':
    case 'openrouter':
    case 'openai-compat':
      return true
    default:
      return false
  }
}

/** The args that make `engine` start an interactive session already seeded with
 *  `prompt` as the first turn. Appended AFTER the engine's own flags. */
export function engineInitialPromptArgs(
  engine: string,
  prompt: string,
  harness: 'codex' | 'hermes' = 'codex',
): string[] {
  if (!prompt) return []
  switch (engine) {
    case 'claude':
    case 'codex':
    case 'cursor':
    case 'openai-compat':
      return [prompt]
    case 'hermes':
      return ['-z', prompt]
    case 'openrouter':
      return harness === 'hermes' ? ['-z', prompt] : [prompt]
    default:
      return []
  }
}
