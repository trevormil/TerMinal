# 15. `webview` is a ticket provider kind, distinct from a ticket view

Date: 2026-07-31

Status: accepted

Records the decision shipped in
[#182](https://github.com/trevormil/TerMinal/pull/182).

## Context

Every ticket provider kind before this one (`local`, `github`, `linear`,
`obsidian`) assumed a **CRUD backend that speaks TerMinal's ticket schema** —
frontmatter with an owner agent, acceptance criteria, `refs`, `depends_on`. That
contract is what the factory depends on: it is how a run knows who owns a ticket
and what "done" means.

TerMinal already had a mechanism for boards that *don't* speak that schema:
`views[]` (`TicketView`) — a read-only embedded page shown as a Tickets sub-tab,
deliberately **not** a provider, so a team's non-conforming Linear/Jira board can
be visible without anything writing to it through the ticket API.

What `views[]` could not express is a repo whose tickets live *entirely*
elsewhere. Such a repo still had `provider: 'local'`, so the Tickets tab showed
an always-empty "Backlog" slot next to the real board — visible dead weight, and
an invitation to file a ticket into a backlog nobody reads.

## Decision

Add **`webview` as a fifth provider kind**, configured with a single
`{ url, label }`, and keep it categorically different from `TicketView`:

| | `provider: 'webview'` | `views[]` entry |
|---|---|---|
| What it means | tickets live *only* here | an extra read-only lens |
| Local backlog | none | still the provider |
| Tab layout | the page *is* the tab | a sub-tab next to Backlog |

- **All five CRUD dispatchers degrade explicitly** for this kind — `list` returns
  empty, `get` returns null, `create` throws, `update`/`comment` return false —
  rather than silently falling through to the local backlog. Misrouting a write
  is worse than refusing it.
- **`bin/terminal-cli` fails closed** the same way, so an agent that tries to
  file a ticket in such a repo gets an error instead of a ticket nobody will see.
- URLs go through the existing `views[]` sanitizer: http(s) only, validated at
  the config boundary.
- The provider Smoke test (which creates, updates and closes a real ticket) is
  hidden for this kind — there is nothing it could assert.
- If a repo configures both, the provider's page becomes the first slot in the
  existing view strip rather than a second, competing full-tab surface.

## Consequences

- A repo can adopt TerMinal for its terminal, agents and runs without pretending
  its ticket board matches our schema, and without an empty Backlog tab implying
  otherwise.
- The agent contract is unchanged and still binding: nothing writes ticket
  frontmatter to a platform that doesn't have it. Writes to those platforms go
  through their own MCP, driven deliberately in-session.
- The cost is a provider kind that implements none of the provider interface —
  a deliberate null object. Anything that adds a sixth CRUD operation must
  remember to give `webview` an explicit refusal, and the existing
  `ticket-provider.test.ts` cases for the five current operations are the guard.
- Unrecognized stored provider values still normalize to `local`, so a config
  written by a newer build never silently misroutes on an older one.
