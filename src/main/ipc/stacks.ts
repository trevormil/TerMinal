// Stacked-PR IPC (ticket #0095).
//
// Read-only apart from `stacks:merge`, which sits behind the same human merge
// gate as the single-PR button — agents never reach it.

import { handle } from '../typed-ipc'
import { fetchStacks, mergeStack, stackExtensionInstalled, type Stack } from '../stacks'

export function registerStacksIpc(): void {
  handle(
    'stacks:list',
    (_e, repoRoot: string, repoPath: string): Promise<{ stacks: Stack[]; error?: string }> =>
      fetchStacks(repoRoot, repoPath),
  )

  handle('stacks:extension', (_e, repoRoot: string) => stackExtensionInstalled(repoRoot))

  handle('stacks:merge', (_e, repoRoot: string, iid: number) => mergeStack(repoRoot, iid))
}
