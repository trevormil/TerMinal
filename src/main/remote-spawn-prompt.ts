// The first thing a phone-started session is told.
//
// Extracted from bridge-deps so BOTH spawn paths use the same words: the app
// (which opens a desktop tab and seeds this as the tab's first input) and the
// e2e bridge harness (which launches the agent itself, with no app running). A
// second copy would drift, and this prompt is the whole contract the agent has.
//
// It has to do three jobs: adopt the thread that is already waiting for it,
// learn the reporting contract, and get on with the work — with no human at the
// keyboard to correct it.

export function remoteSpawnPrompt(input: {
  /** Absolute path to THIS app's terminal-cli, which always has the `remote`
   *  subcommand. Bare `terminal-cli` isn't on an interactive session's PATH, and
   *  the repo's own bin/ may be on a branch that predates `remote` — the agent
   *  otherwise burns several turns guessing. */
  cliPath: string
  remoteId: string
  task?: string
}): string {
  // Quoted in case the path has spaces.
  const cli = `"${input.cliPath}"`
  const lines = [
    `You were started from TerMinal Remote on a phone. There is no one at this Mac —`,
    `report through the phone, not the terminal.`,
    ``,
    `A remote thread is already registered for you. Adopt it, then use it`,
    `(use this exact path — bare terminal-cli is not on PATH):`,
    ``,
    `    ${cli} remote register --id ${input.remoteId} "<short title>"`,
    `    ${cli} remote post --id ${input.remoteId} "<update>"`,
    `    ${cli} remote ask  --id ${input.remoteId} "<question>"   # blocks for a reply`,
    ``,
    `Follow the remote-terminal skill for when to post vs ask. Post at real`,
    `checkpoints, not every command. Ask only at a genuine fork; otherwise pick`,
    `the safe default and say so in a post.`,
    ``,
    `This session stays live between turns. When you finish a task, post the result`,
    `and just stop — the human's next phone message is handed to you automatically`,
    `as your next instruction, so you do NOT need to keep an ask open to stay`,
    `reachable.`,
  ]
  if (input.task) lines.push(``, `Your task:`, ``, input.task)
  else
    lines.push(
      ``,
      `No task was given — post that you are ready and stop; wait for the first message.`,
    )
  return lines.join('\n')
}
