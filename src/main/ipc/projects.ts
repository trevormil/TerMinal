// Project-scaffold IPC (ticket 0122 index.ts decomposition) — creating a new
// project locally or on a configured host, plus the remote directory browser
// the host-side picker uses.

import { basename } from 'node:path'
import { handle } from '../typed-ipc'
import { emitActivity } from '../events'
import { resolvedTemplateRepo } from '../settings'
import { scaffoldProject, type ScaffoldTicketProvider } from '../scaffold'
import { remoteDirs, remoteProject, type RemoteSessionRef } from '../remote'

export type ProjectsIpcDeps = {
  remoteFromHostId(hostId: string, cwd?: string): RemoteSessionRef | null
}

export function registerProjectsIpc(deps: ProjectsIpcDeps): void {
  handle(
    'project:scaffold',
    (_e, name: string, parentDir?: string, ticketProvider?: ScaffoldTicketProvider) => {
      const r = scaffoldProject(name, parentDir, ticketProvider)
      emitActivity(
        {
          kind: r.ok ? 'task-complete' : 'error',
          title: r.ok
            ? `Project scaffolded · ${basename(r.path || name)}`
            : `Project scaffold failed · ${name}`,
          detail: r.ok ? r.path : r.error,
          repo: r.ok && r.path ? basename(r.path) : undefined,
          repoRoot: r.ok ? r.path : undefined,
        },
        { notify: !r.ok },
      )
      return r
    },
  )
  handle('remote:dirs', (_e, hostId: string, path?: string) => {
    const remote = deps.remoteFromHostId(hostId, path)
    if (!remote) return { cwd: path || '', parent: '', entries: [], error: 'remote host not found' }
    return remoteDirs
      .list(remote, path)
      .catch((e) => ({ cwd: path || '', parent: '', entries: [], error: (e as Error).message }))
  })
  handle('remote:scaffold', async (_e, hostId: string, name: string, parentDir?: string) => {
    const remote = deps.remoteFromHostId(hostId, parentDir)
    if (!remote) return { ok: false, error: 'remote host not found' }
    const templateRepo = remote.daemon?.templateRepo || resolvedTemplateRepo()
    const r = await remoteProject
      .scaffold(remote, name, parentDir || remote.cwd || '~', templateRepo)
      .catch((e) => ({
        ok: false,
        path: undefined,
        error: (e as Error).message,
      }))
    emitActivity(
      {
        kind: r.ok ? 'task-complete' : 'error',
        title: r.ok
          ? `Remote project scaffolded · ${basename(r.path || name)}`
          : `Remote project scaffold failed · ${name}`,
        detail: r.ok ? `${remote.sshTarget}:${r.path}` : r.error,
        repo: r.ok && r.path ? basename(r.path) : undefined,
        repoRoot: '',
      },
      { notify: !r.ok },
    )
    return r
  })
}
