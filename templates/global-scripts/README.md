# Global agent-script templates

Global scripts live at `~/.config/TerMinal/scripts/<id>.sh` (+ `<id>.json`
sidecar) and are available to every repo, unlike the per-repo
`.agents/<id>.sh`. That directory is user state and can't be committed — so the
scripts themselves live here, committed and reviewable, and get copied over.

Use a global script when the agent's job is **inherently cross-repo**. The
`briefing` agent is the canonical case: it reports on what happened everywhere,
which is exactly why its review surface is the Inbox drawer rather than the
per-repo Reports tab.

## Seeding

```bash
mkdir -p ~/.config/TerMinal/scripts
cp templates/global-scripts/briefing.sh  ~/.config/TerMinal/scripts/
cp templates/global-scripts/briefing.json ~/.config/TerMinal/scripts/
cp templates/global-scripts/briefing.md   ~/.config/TerMinal/scripts/
chmod 755 ~/.config/TerMinal/scripts/briefing.sh
```

The Daily packs panel in the Schedules tab automates this. Copy is
create-if-absent: a local edit to a global script is a deliberate act and must
never be silently overwritten by a re-seed.
