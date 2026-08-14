// The advertised MCP tool schemas.
//
// Pure data: every entry is the JSON Schema an MCP client sees in tools/list.
// Kept in its own module because it is the single largest thing in the server
// and has no logic in it at all — the handler table lives in index.ts.

export type ToolSchema = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export const TOOLS: ToolSchema[] = [
  {
    name: 'list_tickets',
    description:
      'List backlog tickets across managed repos (index view: frontmatter only, no body — use get_ticket for the full body). Defaults to ACTIVE tickets (excludes closed); pass status:"all" for everything including closed, or a specific status (open|in-progress|closed|stuck|icebox). Also filter by repo (basename) or type. include_body adds a 600-char preview; limit caps the count.',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string' },
        status: { type: 'string' },
        type: { type: 'string' },
        include_body: { type: 'boolean' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'get_ticket',
    description:
      'Fetch the full body + frontmatter of one ticket by its slug (e.g. "0042-fix-foo").',
    inputSchema: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'] },
  },
  {
    name: 'list_prs',
    description: 'List PRs / MRs the harness is tracking (newest first, capped at 50).',
    inputSchema: {
      type: 'object',
      properties: { repo: { type: 'string' }, status: { type: 'string' } },
    },
  },
  {
    name: 'get_pr_artifact',
    description:
      'Fetch the latest review+test artifact for one PR. SHA optional (defaults to newest commit).',
    inputSchema: {
      type: 'object',
      properties: {
        host: { type: 'string' },
        repo: { type: 'string' },
        number: { type: 'number' },
        sha: { type: 'string' },
      },
      required: ['host', 'repo', 'number'],
    },
  },
  {
    name: 'list_scheduled_agents',
    description: 'List scheduled cron agents (filterable by repo basename).',
    inputSchema: { type: 'object', properties: { repo: { type: 'string' } } },
  },
  {
    name: 'recent_agent_runs',
    description: 'Recent scheduled-agent runs (cron-runs/ ledger). Filter by repo, status, limit.',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string' },
        status: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'ai_spend_today',
    description:
      'Cost summary for today (USD spent across the AI fleet). Filterable by repo or agent.',
    inputSchema: {
      type: 'object',
      properties: { repo: { type: 'string' }, agent: { type: 'string' } },
    },
  },
  // ---- WRITE TOOLS (deterministic — agents skip reading skill files) -----
  {
    name: 'file_ticket',
    description:
      'Create a new backlog ticket. Atomically allocates the next NNNN id, writes the frontmatter, returns the slug + path. Use after deciding what to file — schema decisions stay with the model, formatting is done here.',
    inputSchema: {
      type: 'object',
      required: ['repo', 'title'],
      properties: {
        repo: { type: 'string', description: 'Repo basename (e.g. "vellum-project")' },
        title: { type: 'string' },
        body: { type: 'string' },
        type: {
          type: 'string',
          enum: ['bug', 'feature', 'security', 'docs', 'dx', 'testing', 'ux', 'performance'],
        },
        priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
        status: {
          type: 'string',
          enum: ['open', 'in-progress', 'closed', 'stuck', 'icebox'],
        },
        source: { type: 'string' },
        agentId: {
          type: 'string',
          description: 'Assigned agent id. Defaults by ticket type when omitted.',
        },
        agentScope: { type: 'string', enum: ['repo', 'global'] },
        agentKind: { type: 'string', enum: ['classic', 'persistent'] },
        related: {
          type: 'array',
          items: { type: 'number' },
          description: 'Ticket ids this one is related to. Replaces the list wholesale.',
        },
        duplicateOf: {
          type: 'number',
          description: 'Canonical ticket id this one duplicates. 0 clears the link.',
        },
        modelTier: {
          type: 'string',
          enum: ['auto', 'top', 'cheap-agentic', 'cheap-raw'],
          description:
            'Routing tier resolved against the owner agent modelPolicy at spawn: top→deep, cheap-agentic/cheap-raw→cheap, auto→default. Defaults to auto.',
        },
      },
    },
  },
  {
    name: 'comment_ticket',
    description:
      "Append a timestamped entry to a ticket's `## Log` - the durable per-ticket context later runs read. Use it for findings, dead ends, and decisions that the next agent working this ticket needs; do NOT use it to edit the ticket's prose body. Auto-bumps `updated:`. Repo is auto-resolved from the slug.",
    inputSchema: {
      type: 'object',
      required: ['slug', 'body'],
      properties: {
        slug: { type: 'string' },
        body: { type: 'string', description: 'Markdown. What a later run needs to know.' },
        author: {
          type: 'string',
          description: 'Agent id to attribute the entry to. Defaults to "agent".',
        },
        via: { type: 'string', description: 'engine/model that wrote it, e.g. "codex/gpt-5".' },
      },
    },
  },
  {
    name: 'update_ticket',
    description:
      "Mutate a ticket's frontmatter (status, priority, assigned agent, run link) and optionally add/remove a PR URL. Auto-bumps `updated:`. Body is never modified. Repo is auto-resolved from the slug.",
    inputSchema: {
      type: 'object',
      required: ['slug'],
      properties: {
        slug: { type: 'string' },
        status: {
          type: 'string',
          enum: ['open', 'in-progress', 'closed', 'stuck', 'icebox'],
        },
        priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
        appendPrUrl: { type: 'string' },
        removePrUrl: { type: 'string' },
        agentId: { type: 'string' },
        agentScope: { type: 'string', enum: ['repo', 'global'] },
        agentKind: { type: 'string', enum: ['classic', 'persistent'] },
        runId: { type: 'string' },
        runSource: { type: 'string', enum: ['agent', 'cron', 'bg', 'session'] },
        sessionId: { type: 'string' },
        runStartedAt: { type: 'string' },
        runStatus: { type: 'string' },
        modelTier: {
          type: 'string',
          enum: ['auto', 'top', 'cheap-agentic', 'cheap-raw'],
          description:
            'Routing tier resolved against the owner agent modelPolicy at spawn. Only written when passed.',
        },
      },
    },
  },
  {
    name: 'update_ticket_agent',
    description:
      'Assign one ticket to exactly one agent. Auto-bumps `updated:`. Use list_agents first when you need valid ids. agentScope distinguishes repo-local from global agents; persistent agents are global.',
    inputSchema: {
      type: 'object',
      required: ['slug', 'agentId'],
      properties: {
        slug: { type: 'string' },
        agentId: { type: 'string' },
        agentScope: { type: 'string', enum: ['repo', 'global'] },
        agentKind: { type: 'string', enum: ['classic', 'persistent'] },
      },
    },
  },
  {
    name: 'update_ticket_run',
    description:
      'Link a ticket to the agent run that picked it up. Writes agent_run_* frontmatter fields and auto-bumps `updated:`. Use this at ticket implementation start when TERMINAL_RUN_ID or another run/session id is available.',
    inputSchema: {
      type: 'object',
      required: ['slug', 'runId'],
      properties: {
        slug: { type: 'string' },
        runId: { type: 'string' },
        runSource: { type: 'string', enum: ['agent', 'cron', 'bg', 'session'] },
        sessionId: { type: 'string' },
        runStartedAt: { type: 'string' },
        runStatus: { type: 'string' },
      },
    },
  },
  {
    name: 'file_inbox_item',
    description:
      'Append an item to the TerMinal Inbox — the one cross-repo queue of things a human should see. `category` files it under a folder in the Inbox sidebar and is free-form ("Monitoring", "Monitoring/Certs", "Code review"); human-in-the-loop blockers are simply the default, uncategorised kind. Append-only from the agent side: agents file and may later query list_inbox, but only the human should resolve. Emits a blocked activity event and pings Telegram with [Resolve] / [Tail run] buttons.',
    inputSchema: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string' },
        action: { type: 'string', description: 'What the human needs to do' },
        detail: { type: 'string' },
        repo: { type: 'string' },
        category: {
          type: 'string',
          description:
            'Free-form Inbox folder, nested with "/". Any name works — nothing needs registering.',
        },
        source: {
          type: 'string',
          enum: ['manual', 'agent', 'skill', 'factory', 'cron-fail'],
        },
        severity: {
          type: 'string',
          enum: ['urgent', 'normal', 'low'],
          description:
            'urgent = push/ping now; normal = inbox-worthy, notifies only if the user lowered their threshold; low = FYI. Omit for the source default.',
        },
        runId: { type: 'string' },
        ticketPath: { type: 'string' },
      },
    },
  },
  {
    name: 'file_hitl',
    description:
      'Alias of file_inbox_item, kept for existing agent scripts. Prefer file_inbox_item — a human-in-the-loop request is one category of Inbox item, not a separate queue. Same arguments, same behaviour.',
    inputSchema: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string' },
        action: { type: 'string', description: 'What the human needs to do' },
        detail: { type: 'string' },
        repo: { type: 'string' },
        category: { type: 'string' },
        source: {
          type: 'string',
          enum: ['manual', 'agent', 'skill', 'factory', 'cron-fail'],
        },
        severity: { type: 'string', enum: ['urgent', 'normal', 'low'] },
        runId: { type: 'string' },
        ticketPath: { type: 'string' },
      },
    },
  },
  {
    name: 'resolve_inbox_item',
    description:
      'Mark an Inbox item resolved (or re-open it). Human/operator tool only; agents should generally not call this for their own blockers. Agents should query list_inbox status or periodically re-check the original blocker.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string' }, resolved: { type: 'boolean' } },
    },
  },
  {
    name: 'resolve_hitl',
    description: 'Alias of resolve_inbox_item, kept for existing agent scripts.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string' }, resolved: { type: 'boolean' } },
    },
  },
  {
    name: 'emit_activity',
    description:
      'Append one event to the TerMinal activity log. Consumed by the Activity tab + Telegram feed. Use to surface progress without spamming Telegram.',
    inputSchema: {
      type: 'object',
      required: ['kind', 'title'],
      properties: {
        kind: {
          type: 'string',
          description:
            'session-start | session-end | ticket-filed | ticket-closed | pr-opened | pr-verdict | pr-merged | tests-pass | tests-fail | check | doc | agent-run | task-complete | blocked | error | info',
        },
        title: { type: 'string' },
        detail: { type: 'string' },
        repo: { type: 'string' },
      },
    },
  },
  {
    name: 'set_agent_state',
    description:
      'Persist per-(repo, agent) sidecar state at ~/.config/TerMinal/agent-state/<repo>/<agent>.json. Use for lastScannedSha or any arbitrary key so re-runs no-op early.',
    inputSchema: {
      type: 'object',
      required: ['repo', 'agent', 'key'],
      properties: {
        repo: { type: 'string' },
        agent: { type: 'string' },
        key: { type: 'string' },
        value: {},
      },
    },
  },
  {
    name: 'get_agent_state',
    description:
      'Read per-(repo, agent) sidecar state. Omit `key` for the whole object. Use at the top of /check-style flows to early-exit on unchanged SHA.',
    inputSchema: {
      type: 'object',
      required: ['repo', 'agent'],
      properties: {
        repo: { type: 'string' },
        agent: { type: 'string' },
        key: { type: 'string' },
      },
    },
  },
  {
    name: 'list_activity',
    description:
      'Query the TerMinal activity feed. Returns recent events filtered by kind/repo/sinceMs. Use to check "what happened recently" before deciding what to do next.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: 'Filter by activity kind' },
        repo: { type: 'string' },
        sinceMs: { type: 'number', description: 'ms epoch — only events newer than this' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'list_inbox',
    description:
      'List TerMinal Inbox items (any category, including human-in-the-loop blockers). Default = open only. Use at the start of an agent run to check "is anything blocking me right now?" and self-route around blockers.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'resolved', 'all'] },
        repo: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'list_hitl',
    description: 'Alias of list_inbox, kept for existing agent scripts.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'resolved', 'all'] },
        repo: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'list_bg_tasks',
    description:
      'List background /bg tasks. Filter by status (running|done|failed|canceled) and repo. Use to see what async work is already in flight before spawning more.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        repo: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'harness_status',
    description:
      'Snapshot of the whole harness right now: HITL open count, cron running, cron failures in last 24h, bg tasks running, today\'s spend by model. The single-call answer to "how is the fleet doing".',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'set_run_outcome',
    description:
      'Tag a run with its outcome (pr-opened | ticket-filed | merged | none). Call at the end of an agent run so the per-agent ROI column on the Spend tab populates. The runId is the harness run id (TERMINAL_RUN_ID env var).',
    inputSchema: {
      type: 'object',
      required: ['runId', 'outcome'],
      properties: {
        runId: { type: 'string' },
        outcome: { type: 'string', enum: ['pr-opened', 'ticket-filed', 'merged', 'none'] },
      },
    },
  },
  // --- introspection / cross-repo tools (2026-05-30) ---------------------
  {
    name: 'list_agents',
    description:
      'List assignable agents for a repo, including TerMinal defaults, repo-local agents/scripts, global agents/scripts, and persistent agents. Returns compact id/title/scope/kind records for use with file_ticket or update_ticket_agent. Defaults to TERMINAL_REPO.',
    inputSchema: { type: 'object', properties: { repo: { type: 'string' } } },
  },
  {
    name: 'request_agent_artifact',
    description:
      'Delegate a focused knowledge/artifact request to a short-lived Claude subprocess, write the result under .TerMinal/agent-requests/, and return a compact summary plus artifact paths. Use during ticket implementation when you need another agent/domain view without bloating the parent context.',
    inputSchema: {
      type: 'object',
      required: ['prompt'],
      properties: {
        repo: { type: 'string' },
        title: { type: 'string' },
        prompt: { type: 'string' },
        agentId: {
          type: 'string',
          description: 'Assignable agent id from list_agents. Defaults to knowledge-base.',
        },
        agentScope: { type: 'string', enum: ['repo', 'global'] },
        agentKind: { type: 'string', enum: ['classic', 'persistent'] },
        model: { type: 'string' },
        timeoutMs: { type: 'number' },
      },
    },
  },
  {
    name: 'list_review_patterns',
    description:
      'Top clusters from the nightly review-findings miner (<harnessDir>/reports/review-patterns.md). Use to see what recurring issues code reviews are flagging across the fleet before opening a fresh review.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
  },
  {
    name: 'factory_health',
    description:
      'Cross-repo rollup: per-repo ticket counts (by status) + open PR counts. The single-call "how is every project doing" snapshot the /factory orchestrator uses to pick targets.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'search_decisions',
    description:
      'Grep docs/decisions (ADRs), docs/learnings, docs/runbooks across managed repos for a query string. Returns hits with snippets so an agent can find prior decisions/gotchas before re-deciding.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        repo: { type: 'string', description: 'Scope to one repo (basename); omit to search all' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'recent_changes',
    description:
      'Git log digest for a repo over the last N days (default 7). Defaults to TERMINAL_REPO. Returns sha, author, relative time, subject — the cheapest "what changed recently" call.',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string' },
        days: { type: 'number' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'nearest_session',
    description:
      'List recent Claude session transcripts for a repo (newest first). Use to find a previous session that worked on the same code so a fresh agent can pull in context without you wiring it explicitly. Returns transcript file paths the agent can read.',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
]
