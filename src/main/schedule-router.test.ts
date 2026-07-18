import { test, expect, describe, mock } from 'bun:test'
import {
  triggerLayerFor,
  routeSyncSchedule,
  routeRemoveSchedule,
  routeReconcile,
  routeRunNow,
  type RouterDeps,
  type RunNowDeps,
} from './schedule-router'
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
    // Pin the platform so these tests behave identically on macOS dev machines
    // and Linux CI runners — the local-schedule branch is launchd (mac-only).
    platform: 'darwin',
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
  test('local schedule on a non-mac platform errors instead of touching launchd', async () => {
    const d = fakeDeps({ platform: 'linux' })
    const r = await routeSyncSchedule(sched(), d)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('macOS')
    expect(d.launchdSync).not.toHaveBeenCalled()
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

// "Run now" must obey the same host binding as the trigger install (#43): a
// host schedule fires on ITS host — never as a local terminal-cron run whose
// host-side repoRoot doesn't exist on this machine.
function runNowDeps(store: Schedule[], over: Partial<RunNowDeps> = {}): RunNowDeps {
  return {
    getSchedule: (id) => store.find((s) => s.id === id) ?? null,
    hosts: () => [host('tm'), host('box2')],
    hostRunNow: mock(async () => ({ ok: true }) as const),
    localRunNow: mock(() => {}),
    ...over,
  }
}

describe('routeRunNow', () => {
  test('host schedule with NO explicit hostId fires on its host, never locally (the #43 bug)', async () => {
    const d = runNowDeps([sched({ host: 'tm' })])
    const r = await routeRunNow('s1', undefined, d)
    expect(r).toEqual({ ok: true })
    expect(d.hostRunNow).toHaveBeenCalledTimes(1)
    const [target] = (d.hostRunNow as ReturnType<typeof mock>).mock.calls[0]
    expect((target as RemoteHost).id).toBe('tm')
    expect(d.localRunNow).not.toHaveBeenCalled()
  })
  test('explicit hostId (Runs-tab re-run) fires on that host even when the schedule is not in the local store', async () => {
    const d = runNowDeps([])
    const r = await routeRunNow('s1', 'box2', d)
    expect(r).toEqual({ ok: true })
    const [target] = (d.hostRunNow as ReturnType<typeof mock>).mock.calls[0]
    expect((target as RemoteHost).id).toBe('box2')
    expect(d.localRunNow).not.toHaveBeenCalled()
  })
  test('local schedule fires the local runner, not any host', async () => {
    const d = runNowDeps([sched()])
    const r = await routeRunNow('s1', undefined, d)
    expect(r).toEqual({ ok: true })
    expect(d.localRunNow).toHaveBeenCalledTimes(1)
    expect(d.hostRunNow).not.toHaveBeenCalled()
  })
  test('unknown host id → error, nothing fires anywhere', async () => {
    const d = runNowDeps([sched({ host: 'ghost' })])
    const r = await routeRunNow('s1', undefined, d)
    expect('error' in r && r.error).toContain('ghost')
    expect(d.hostRunNow).not.toHaveBeenCalled()
    expect(d.localRunNow).not.toHaveBeenCalled()
  })
  test('SSH trigger failure surfaces as { error } — no throw, no local fallthrough', async () => {
    const d = runNowDeps([sched({ host: 'tm' })], {
      hostRunNow: mock(async () => {
        throw new Error('ssh: connect to host tm port 22: No route to host')
      }),
    })
    const r = await routeRunNow('s1', undefined, d)
    expect('error' in r && r.error).toContain('No route to host')
    expect(d.localRunNow).not.toHaveBeenCalled()
  })
  test('no local schedule + attached remote session → fires on the attached remote', async () => {
    const attachedRunNow = mock(async () => ({ ok: true }) as const)
    const d = runNowDeps([], { attachedRunNow })
    const r = await routeRunNow('s1', undefined, d)
    expect(r).toEqual({ ok: true })
    expect(attachedRunNow).toHaveBeenCalledTimes(1)
    expect(d.localRunNow).not.toHaveBeenCalled()
  })
  test("the schedule's host binding wins over an attached remote session", async () => {
    const attachedRunNow = mock(async () => ({ ok: true }) as const)
    const d = runNowDeps([sched({ host: 'tm' })], { attachedRunNow })
    await routeRunNow('s1', undefined, d)
    expect(d.hostRunNow).toHaveBeenCalledTimes(1)
    expect(attachedRunNow).not.toHaveBeenCalled()
  })
})

describe('routeReconcile', () => {
  test('reconciles local via launchd and each host-group via systemd, aggregating', async () => {
    const d = fakeDeps({
      launchdReconcile: mock(() => ({ loaded: 2, removed: 1, failed: [] })),
      systemdReconcile: mock(async () => ({ loaded: 1, removed: 0, failed: [] })),
    })
    const all = [
      sched({ id: 'a' }),
      sched({ id: 'b', host: 'tm' }),
      sched({ id: 'c', host: 'tm' }),
      sched({ id: 'd', host: 'box2' }),
    ]
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
