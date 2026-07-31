# Persistent-agent templates

Persistent agents live outside any repo, at
`~/.config/TerMinal/persistent-agents/<id>/`. That directory is user state, so
it cannot be committed — but the *starting content* of an agent can be, and
should be, so that it is reviewable in a PR like anything else that ships.

Each folder here is a template for one persistent agent: the exact file set the
`/new-persistent-agent` skill produces (`agent.json`, `INSTRUCTIONS.md`,
`MEMORY.md`, `STATE.md`, `JOURNAL.md`, `artifacts/`), ready to be copied.

## Seeding one

```bash
id=research-teacher
cp -R "templates/persistent-agents/$id" "$HOME/.config/TerMinal/persistent-agents/$id"
```

Copy is non-destructive by policy: **never overwrite an existing directory.**
`MEMORY.md` and `JOURNAL.md` accumulate real history within days, and clobbering
them resets everything the agent has learned. Seeding is a create-if-absent
operation, exactly like `seedSchedule()` in `src/main/schedules.ts`.

The Daily packs panel (Schedules tab) automates this and honors the same rule.
