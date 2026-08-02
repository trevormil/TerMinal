// The ONE registry of Telegram slash commands (ticket 91). telegram.ts used to
// hand-maintain three parallel copies of "which commands exist" — the
// dispatcher switch, the /help text, and the natural-language translator's
// command list — which is exactly the shape that drifts. This module is pure
// data (no electron, no runtime imports) so telegram-commands.test.ts can hold
// all three surfaces to it.

export type TgCommandSpec = {
  /** Primary slash token first, aliases after — all dispatch to one handler. */
  cmds: string[]
  /** Usage lines offered to the NL translator. Omitted = slash-only command
   *  (kept out of the prompt to keep it tight and unambiguous). */
  nl?: string[]
}

export const COMMAND_SPECS: TgCommandSpec[] = [
  { cmds: ['/help', '/start'] },
  { cmds: ['/repos'], nl: ['/repos'] },
  { cmds: ['/cd'], nl: ['/cd <repo>'] },
  { cmds: ['/agents'] },
  { cmds: ['/runs'], nl: ['/runs'] },
  { cmds: ['/run'], nl: ['/run <agentId> [@repo] [engine] [persona] [pipeline]'] },
  { cmds: ['/cancel'], nl: ['/cancel <n>'] },
  { cmds: ['/status'], nl: ['/status'] },
  { cmds: ['/tickets'], nl: ['/tickets [@repo]'] },
  { cmds: ['/ticket'], nl: ['/ticket <slug|n>', '/ticket new <title>'] },
  { cmds: ['/feature'], nl: ['/feature [@repo] <description>'] },
  { cmds: ['/close'], nl: ['/close <slug|n>'] },
  { cmds: ['/schedules'], nl: ['/schedules'] },
  { cmds: ['/pause'], nl: ['/pause <id|all>'] },
  { cmds: ['/resume'], nl: ['/resume <id|all>'] },
  { cmds: ['/runnow'], nl: ['/runnow <id>'] },
  { cmds: ['/hitl'], nl: ['/hitl'] },
  { cmds: ['/resolve'], nl: ['/resolve <n|all>'] },
  { cmds: ['/reopen'] },
  { cmds: ['/mrs', '/prs'], nl: ['/mrs [@repo]'] },
  { cmds: ['/mr', '/pr'], nl: ['/mr <iid>'] },
  { cmds: ['/state'] },
  { cmds: ['/reset-state'] },
  { cmds: ['/harness'], nl: ['/harness'] },
  { cmds: ['/activity'], nl: ['/activity [N]'] },
  { cmds: ['/sessions'], nl: ['/sessions'] },
  { cmds: ['/tail'], nl: ['/tail <runId|n>'] },
  { cmds: ['/rebuild'] },
  { cmds: ['/about', '/whoami'] },
  { cmds: ['/install'] },
  { cmds: ['/bg'], nl: ['/bg [@repo] [claude|codex|cursor] [haiku|sonnet|opus] <prompt>'] },
  { cmds: ['/budget'], nl: ['/budget', '/budget set <usd>'] },
]

/** Every token (primary + alias) → its spec. */
export function commandIndex(): Map<string, TgCommandSpec> {
  const idx = new Map<string, TgCommandSpec>()
  for (const spec of COMMAND_SPECS) for (const c of spec.cmds) idx.set(c, spec)
  return idx
}

/** The command list injected into the NL translator's system prompt. */
export function nlCommandList(): string {
  return COMMAND_SPECS.flatMap((s) => s.nl ?? []).join('\n  ')
}

/** The /help reply. Curated copy (grouping and phrasing are UX, not data) —
 *  the sync test asserts it advertises exactly the commands that dispatch. */
export const HELP_TEXT = [
  '🤖 TerMinal — AFK control',
  '',
  'REPOS',
  '/repos · /cd <repo>',
  '',
  'RUNS · AGENTS',
  '/runs · /run <agent> [codex|claude|cursor|openrouter|hermes|openai-compat] [persona] [pipeline] [@repo] · /cancel <n>',
  '/agents [@repo] · /state <agent> [@repo] · /reset-state <agent> [@repo]',
  '',
  'TICKETS',
  '/feature <what you want built> [@repo]   draft a ticket, tap to build it',
  '/tickets [@repo] · /ticket <slug> · /ticket new <title>',
  '/close <slug>',
  '',
  'SCHEDULES',
  '/schedules · /pause <id|all> · /resume <id|all> · /runnow <id>',
  '',
  'HITL',
  '/hitl · /resolve <n|all> · /reopen <n>',
  '',
  'MRS · ACTIVITY · HARNESS',
  '/mrs [@repo] · /mr <iid> · /activity [N] · /harness · /status',
  '',
  'BACKGROUND',
  '/bg [@repo] [claude|codex|cursor] [model] <prompt>',
  '/bg list · /bg cancel <n|id>',
  '',
  'BUDGETS',
  '/budget · /budget set <usd> · /budget set <agent> <usd>',
  '/budget override <Nh|Nm|clear>',
  '',
  'INFRASTRUCTURE',
  '/sessions · /tail <id|n> · /rebuild · /about',
  '/install <agent> [@repo]   copy from project-template',
].join('\n')
