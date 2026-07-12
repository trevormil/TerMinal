import { test, expect, describe, mock } from 'bun:test'
import { triggerLayerFor, routeSyncSchedule, routeRemoveSchedule, routeReconcile, type RouterDeps } from './schedule-router'
import type { Schedule } from './schedules'
import type { RemoteHost } from './settings'

const sched = (over: Partial<Schedule> = {}): Schedule => ({
  id: 's1',
  repoRoot: '/r',
  repoLabel: 'r',
  agentId: 'coverage',
  agentTitle: 'Coverage',
  engine: 'codex',
  prompt: 'do it',
  spec: { kind: 'calendar', minute: 0, hour: 9 },
  enabled: true,
  createdAt: 0,
  ...over,
})

const host = (id: string): RemoteHost => ({
  id,
  label: id.toUpperCase(),
  sshTarget: `user@${id}`,
  defaultCwd: '',
  platform: 'linux',
  daemon: {} as RemoteHost['daemon'],
})

function fakeDeps(over: Partial<RouterDeps> = {}): RouterDeps {
  return {
    launchdSync: mock(() => ({ ok: true })),
    launchdUnschedule: mock(() => {}),
    launchdReconcile: mock(() => ({ loaded: 1, removed: 0, failed: [] })),
    systemdSync: mock(async () => ({ ok: true })),
    systemdReconcile: mock(async () => ({ loaded: 0, removed: 0, failed: [] })),
    k8sApply: mock(async () => ({ ok: true })),
    k8sRemove: mock(async () => ({ ok: true })),
    k8sReconcile: mock(async () => ({ loaded: 0, removed: 0, failed: [] })),
    pushRecord: mock(async () => ({ ok: true, id: 's1' })),
    removeRecord: mock(async () => true),
    hosts: () => [host('tm'), host('box2')],
    ...over,
  }
}

describe('triggerLayerFor', () => {
  test('no host → launchd (local)', () => {
    expect(triggerLayerFor(sched())).toBe('launchd')
  })
  test('host set → systemd', () => {
    expect(triggerLayerFor(sched({ host: 'tm' }))).toBe('systemd')
  })
})

describe('routeSyncSchedule', () => {
  test('local schedule syncs via launchd only', async () => {
    const d = fakeDeps()
    const r = await routeSyncSchedule(sched(), d)
    expect(r.ok).toBe(true)
    expect(d.launchdSync).toHaveBeenCalledTimes(1)
    expect(d.systemdSync).not.toHaveBeenCalled()
    expect(d.pushRecord).not.toHaveBeenCalled()
  })
  test('host schedule pushes the record AND installs the systemd timer, never launchd', async () => {
    const d = fakeDeps()
    const r = await routeSyncSchedule(sched({ host: 'tm' }), d)
    expect(r.ok).toBe(true)
    expect(d.pushRecord).toHaveBeenCalledTimes(1)
    expect(d.systemdSync).toHaveBeenCalledTimes(1)
    expect(d.launchdSync).not.toHaveBeenCalled()
  })
  test('unknown host id → error, nothing installed', async () => {
    const d = fakeDeps()
    const r = await routeSyncSchedule(sched({ host: 'ghost' }), d)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('ghost')
    expect(d.pushRecord).not.toHaveBeenCalled()
    expect(d.systemdSync).not.toHaveBeenCalled()
    expect(d.launchdSync).not.toHaveBeenCalled()
  })
  test('propagates a systemd install failure', async () => {
    const d = fakeDeps({ systemdSync: mock(async () => ({ ok: false, error: 'bus not found' })) })
    const r = await routeSyncSchedule(sched({ host: 'tm' }), d)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('bus not found')
  })
  test('runtime:k8s host schedule pushes the record then applies a CronJob, not a systemd unit', async () => {
    const d = fakeDeps()
    const r = await routeSyncSchedule(sched({ host: 'tm', runtime: 'k8s' }), d)
    expect(r.ok).toBe(true)
    expect(d.pushRecord).toHaveBeenCalledTimes(1) // runner still reads schedules.json
    expect(d.k8sApply).toHaveBeenCalledTimes(1)
    expect(d.systemdSync).not.toHaveBeenCalled()
  })
  test('DISABLED k8s schedule deletes its CronJob instead of applying one (enabled→disabled)', async () => {
    const d = fakeDeps()
    await routeSyncSchedule(sched({ host: 'tm', runtime: 'k8s', enabled: false }), d)
    expect(d.k8sRemove).toHaveBeenCalledTimes(1)
    expect(d.k8sApply).not.toHaveBeenCalled()
  })
})

// The save IPC drives host/runtime transitions by tearing down the PREVIOUS
// schedule's trigger (routeRemoveSchedule on the old record) then syncing the new
// one — these cover that each layer's teardown routes correctly.
describe('transition teardown (routeRemoveSchedule by prior runtime/host)', () => {
  test('k8s → bare on the same host: removing the prior k8s record deletes the CronJob', async () => {
    const d = fakeDeps()
    await routeRemoveSchedule(sched({ host: 'tm', runtime: 'k8s' }), d)
    expect(d.k8sRemove).toHaveBeenCalledTimes(1)
    expect(d.systemdSync).not.toHaveBeenCalled()
  })
  test('bare → k8s on the same host: removing the prior systemd record disables the unit', async () => {
    const d = fakeDeps()
    await routeRemoveSchedule(sched({ host: 'tm', runtime: 'bare' }), d)
    const [, passed] = (d.systemdSync as ReturnType<typeof mock>).mock.calls[0]
    expect((passed as Schedule).enabled).toBe(false)
    expect(d.k8sRemove).not.toHaveBeenCalled()
  })
  test('host A → host B: removing the prior record targets host A', async () => {
    const d = fakeDeps()
    await routeRemoveSchedule(sched({ host: 'tm', runtime: 'bare' }), d)
    // removeRecord is called against the OLD host (tm), not the new one
    const [ref] = (d.removeRecord as ReturnType<typeof mock>).mock.calls[0]
    expect((ref as { hostId: string }).hostId).toBe('tm')
  })
})

describe('routeRemoveSchedule', () => {
  test('local removal unschedules the launchd job', async () => {
    const d = fakeDeps()
    await routeRemoveSchedule(sched(), d)
    expect(d.launchdUnschedule).toHaveBeenCalledTimes(1)
    expect(d.removeRecord).not.toHaveBeenCalled()
  })
  test('host removal drops the host record and the systemd unit', async () => {
    const d = fakeDeps()
    await routeRemoveSchedule(sched({ host: 'tm' }), d)
    expect(d.removeRecord).toHaveBeenCalledTimes(1)
    // unit removal is a disabled sync (systemdSync with enabled:false)
    expect(d.systemdSync).toHaveBeenCalledTimes(1)
    const [, passed] = (d.systemdSync as ReturnType<typeof mock>).mock.calls[0]
    expect((passed as Schedule).enabled).toBe(false)
    expect(d.launchdUnschedule).not.toHaveBeenCalled()
  })
})

describe('routeReconcile', () => {
  test('reconciles local via launchd and each host-group via systemd, aggregating', async () => {
    const d = fakeDeps({
      launchdReconcile: mock(() => ({ loaded: 2, removed: 1, failed: [] })),
      systemdReconcile: mock(async () => ({ loaded: 1, removed: 0, failed: [] })),
    })
    const all = [sched({ id: 'a' }), sched({ id: 'b', host: 'tm' }), sched({ id: 'c', host: 'tm' }), sched({ id: 'd', host: 'box2' })]
    const r = await routeReconcile(all, d)
    expect(d.launchdReconcile).toHaveBeenCalledTimes(1)
    // one systemd reconcile per distinct host (tm, box2)
    expect(d.systemdReconcile).toHaveBeenCalledTimes(2)
    expect(r.loaded).toBe(2 + 1 + 1) // launchd + tm + box2
    expect(r.removed).toBe(1)
  })
  test('reconcile skips hosts with no schedules', async () => {
    const d = fakeDeps()
    await routeReconcile([sched({ id: 'a' })], d) // local only
    expect(d.systemdReconcile).not.toHaveBeenCalled()
  })
})
