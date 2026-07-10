import { join } from 'node:path'

// Pure vault-resolution for the new-project scaffold flow — no electron, so it's
// unit-testable. `scaffold.ts` imports this; the electron-bound scaffoldProject
// stays there.

// Optional ticket-provider choice made at bootstrap. Only 'local' (default) and
// 'obsidian' are offered in the new-project flow; github/linear are configured
// later in Settings. For obsidian, `vaultLocation` picks where the vault lives:
//   - 'in-repo'  → a gitignored folder inside the repo (co-located, private)
//   - 'sibling'  → a new <parent>/<name>-vault next to the repo (default)
//   - 'existing' → an already-existing vault at `vaultPath`
export type ScaffoldTicketProvider = {
  kind: 'local' | 'obsidian'
  vaultLocation?: 'in-repo' | 'sibling' | 'existing'
  vaultPath?: string
  vaultName?: string
}

export const IN_REPO_VAULT_DIR = 'tickets-vault'

// Resolve an obsidian scaffold to the vault path + the .gitignore rules to add.
// tickets.json (the per-machine vault pointer) is always ignored; an in-repo
// vault also ignores its own folder.
export function resolveObsidianScaffold(
  dest: string,
  parent: string,
  safe: string,
  tp: ScaffoldTicketProvider,
): { vaultPath: string; ignore: string[] } {
  const ignore = ['.TerMinal/tickets.json']
  const loc = tp.vaultLocation || 'sibling'
  if (loc === 'existing' && tp.vaultPath?.trim()) return { vaultPath: tp.vaultPath.trim(), ignore }
  if (loc === 'in-repo') {
    ignore.push(`/${IN_REPO_VAULT_DIR}/`)
    return { vaultPath: join(dest, IN_REPO_VAULT_DIR), ignore }
  }
  return { vaultPath: join(parent, `${safe}-vault`), ignore } // sibling default
}
