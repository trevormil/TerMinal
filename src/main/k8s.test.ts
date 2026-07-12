import { test, expect, describe } from 'bun:test'
import { specToCron, buildCronJobManifest, applyManifestCmd, deleteCronJobCmd, listCronJobsCmd, parseCronJobNames } from './k8s'

describe('specToCron', () => {
  test('passes a raw cron expr through', () => {
    expect(specToCron({ kind: 'cron', expr: '*/15 * * * *' })).toBe('*/15 * * * *')
  })
  test('daily calendar → M H * * *', () => {
    expect(specToCron({ kind: 'calendar', minute: 30, hour: 9 })).toBe('30 9 * * *')
  })
  test('weekday calendar → M H * * d,d', () => {
    expect(specToCron({ kind: 'calendar', minute: 0, hour: 8, weekdays: [1, 3, 5] })).toBe('0 8 * * 1,3,5')
  })
})

describe('buildCronJobManifest', () => {
  const m = buildCronJobManifest('coverage', { kind: 'calendar', minute: 0, hour: 9 }, {
    image: 'terminal-agent:latest',
    home: '/home/u',
    cfgDir: '/home/u/.config/TerMinal',
    repoRoot: '/home/u/repos/app',
    uid: 1000,
    gid: 1000,
    timeoutSec: 1800,
    backoffLimit: 2,
  })
  test('is a CronJob with the schedule + no-overlap policy', () => {
    expect(m).toContain('kind: CronJob')
    expect(m).toContain('name: terminal-cron-coverage')
    expect(m).toContain('schedule: "0 9 * * *"')
    expect(m).toContain('concurrencyPolicy: Forbid')
  })
  test('runs the image with `run <id>` args and non-root uid', () => {
    expect(m).toContain('image: terminal-agent:latest')
    expect(m).toContain('imagePullPolicy: IfNotPresent') // image imported into k3s, no registry
    expect(m).toContain('- run')
    expect(m).toContain('- coverage')
    expect(m).toContain('runAsUser: 1000')
  })
  test('carries the timeout + retry as k8s job controls', () => {
    expect(m).toContain('activeDeadlineSeconds: 1800')
    expect(m).toContain('backoffLimit: 2')
  })
  test('hostPath-mounts the cfg dir so records land on the host (Runs tab)', () => {
    expect(m).toContain('path: /home/u/.config/TerMinal')
    expect(m).toContain('path: /home/u/repos/app')
    expect(m).toContain('value: /home/u') // HOME env
  })
  test('rejects an unsafe schedule id', () => {
    expect(() => buildCronJobManifest('a b', { kind: 'cron', expr: '* * * * *' }, { image: 'i', home: '/h', cfgDir: '/c', repoRoot: '/r', uid: 1, gid: 1, timeoutSec: 1, backoffLimit: 0 })).toThrow()
  })
})

describe('kubectl command builders', () => {
  test('apply reads the manifest from stdin (no temp files)', () => {
    expect(applyManifestCmd()).toContain('kubectl apply -f -')
  })
  test('delete targets the schedule CronJob, ignoring absence', () => {
    const c = deleteCronJobCmd('coverage')
    expect(c).toContain('kubectl delete cronjob terminal-cron-coverage')
    expect(c).toContain('--ignore-not-found')
  })
  test('list selects only TerMinal CronJobs', () => {
    expect(listCronJobsCmd()).toContain('kubectl get cronjobs')
    expect(listCronJobsCmd()).toContain('app=terminal-cron')
  })
  test('parseCronJobNames extracts schedule ids from names', () => {
    expect(parseCronJobNames('terminal-cron-coverage\nterminal-cron-deps\n')).toEqual(['coverage', 'deps'])
  })
})
