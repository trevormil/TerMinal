# TerMinal Marketplace

The marketplace is intentionally file-backed. Everything in this directory is
served from the repository's `main` branch and can be installed by copying plain
files into a TerMinal repo or user config directory.

- `manifest.json` is the catalog TerMinal and the landing page can read.
- `schema.json` describes the manifest contract.
- `plugins/` contains React cockpit widgets.
- `widgets/` contains declarative command widgets.
- `skills/` contains Claude/Codex skill folders.
- `agents/` contains agent definitions.
- `snippets/` contains quick-prompt snippet packs.

Entries should be additive and versioned by id. If a preset changes, update the
same id and increment the item `version`; if it becomes a different workflow,
publish a new id. User-installed copies are owned by the user, so app updates
must never overwrite local edits without an explicit reinstall/reset action.

Every manifest item includes `addedBy`, which is displayed in the in-app
Marketplace so users can distinguish TerMinal Core presets from future
community, repo, or personal entries.
