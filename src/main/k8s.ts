// Kubernetes CronJob trigger (ADR-0002 #16) — runs scheduled agents as CronJobs
// on the HOST's own single-node cluster (k3s on the always-on box), NOT a remote
// cloud cluster. Reuses the #13 container image (imported into k3s's containerd,
// so no external registry). Records surface in the Runs tab via a hostPath mount
// of the host's cron-runs dir — same UnifiedRun contract as every other runtime.
//
// Pure builders (manifest + kubectl command strings) are unit-tested; the impure
// SSH/kubectl shell reconciles CronJobs ↔ schedules on the host.

import { execFile } from 'node:child_process'
import { isSafeSshTarget } from './remote'
import { isSafeUnitId } from './systemd'
import type { ScheduleSpec } from './cron'

const PREFIX = 'terminal-cron-'
const name = (id: string) => `${PREFIX}${id}`

// Schedule spec → a standard 5-field cron string for CronJob.spec.schedule.
export function specToCron(spec: ScheduleSpec): string {
  if (spec.kind === 'cron') return spec.expr.trim()
  const dow = spec.weekdays && spec.weekdays.length ? [...spec.weekdays].sort((a, b) => a - b).join(',') : '*'
  return `${spec.minute} ${spec.hour} * * ${dow}`
}

export type CronJobOpts = {
  image: string
  home: string
  cfgDir: string // host ~/.config/TerMinal — hostPath-mounted at the same path
  repoRoot: string // host repo — hostPath-mounted at the same path
  uid: number
  gid: number
  timeoutSec: number
  backoffLimit: number
  namespace?: string
}

// Render the CronJob manifest (YAML) for a schedule. imagePullPolicy: IfNotPresent
// because the image is imported straight into k3s containerd. hostPath mounts keep
// the runner's absolute paths valid and land records on the host.
export function buildCronJobManifest(id: string, spec: ScheduleSpec, o: CronJobOpts): string {
  if (!isSafeUnitId(id)) throw new Error(`unsafe schedule id: ${id}`)
  const ns = o.namespace || 'default'
  return `apiVersion: batch/v1
kind: CronJob
metadata:
  name: ${name(id)}
  namespace: ${ns}
  labels:
    app: terminal-cron
    terminal-cron/schedule-id: "${id}"
spec:
  schedule: "${specToCron(spec)}"
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
  jobTemplate:
    spec:
      activeDeadlineSeconds: ${o.timeoutSec}
      backoffLimit: ${o.backoffLimit}
      template:
        spec:
          restartPolicy: Never
          securityContext:
            runAsUser: ${o.uid}
            runAsGroup: ${o.gid}
          containers:
            - name: agent
              image: ${o.image}
              imagePullPolicy: IfNotPresent
              args:
                - run
                - ${id}
              env:
                - name: HOME
                  value: ${o.home}
              volumeMounts:
                - name: cfg
                  mountPath: ${o.cfgDir}
                - name: repo
                  mountPath: ${o.repoRoot}
          volumes:
            - name: cfg
              hostPath:
                path: ${o.cfgDir}
                type: Directory
            - name: repo
              hostPath:
                path: ${o.repoRoot}
                type: Directory
`
}

// kubectl command builders — run over SSH on the host (k3s ships kubectl).
export const applyManifestCmd = () => 'kubectl apply -f -'
export const deleteCronJobCmd = (id: string) => `kubectl delete cronjob ${name(id)} --ignore-not-found`
export const listCronJobsCmd = () => `kubectl get cronjobs -l app=terminal-cron -o name`

// `kubectl get -o name` prints `cronjob.batch/terminal-cron-<id>` per line.
export function parseCronJobNames(out: string): string[] {
  return out
    .split('\n')
    .map((l) => l.trim().replace(/^.*\//, '')) // strip `cronjob.batch/`
    .filter((l) => l.startsWith(PREFIX))
    .map((l) => l.slice(PREFIX.length))
    .filter(Boolean)
}

// ── Impure SSH/kubectl shell (host k3s; live-verify pending k3s install) ──────

export type K8sHost = { sshTarget: string }

function ssh(sshTarget: string, cmd: string, stdin?: string): Promise<{ ok: boolean; stdout: string; error?: string }> {
  return new Promise((resolve) => {
    if (!isSafeSshTarget(sshTarget)) return resolve({ ok: false, stdout: '', error: 'unsafe ssh target' })
    const child = execFile(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', sshTarget, `bash -lc ${shSingleQuote(cmd)}`],
      { encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) resolve({ ok: false, stdout: stdout || '', error: (stderr || err.message || 'ssh error').trim() })
        else resolve({ ok: true, stdout: stdout || '' })
      },
    )
    if (stdin && child.stdin) {
      child.stdin.write(stdin)
      child.stdin.end()
    }
  })
}

const shSingleQuote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`

export async function applyCronJobOnHost(
  host: K8sHost,
  id: string,
  spec: ScheduleSpec,
  o: CronJobOpts,
): Promise<{ ok: boolean; error?: string }> {
  const r = await ssh(host.sshTarget, applyManifestCmd(), buildCronJobManifest(id, spec, o))
  return r.ok ? { ok: true } : { ok: false, error: r.error }
}

export async function deleteCronJobOnHost(host: K8sHost, id: string): Promise<{ ok: boolean; error?: string }> {
  const r = await ssh(host.sshTarget, deleteCronJobCmd(id))
  return r.ok ? { ok: true } : { ok: false, error: r.error }
}

// Diff installed CronJobs ↔ the k8s-runtime schedules for this host: delete
// orphans, apply the rest. `render` maps a schedule id to its (spec, opts).
export async function reconcileCronJobsOnHost(
  host: K8sHost,
  schedules: { id: string; spec: ScheduleSpec; opts: CronJobOpts }[],
): Promise<{ applied: number; removed: number; failed: { id: string; error: string }[] }> {
  const failed: { id: string; error: string }[] = []
  let applied = 0
  let removed = 0
  const wanted = new Set(schedules.map((s) => s.id))
  const listed = await ssh(host.sshTarget, listCronJobsCmd())
  if (!listed.ok) return { applied, removed, failed: [{ id: '*', error: listed.error || 'kubectl list failed' }] }
  for (const id of parseCronJobNames(listed.stdout)) {
    if (!wanted.has(id)) {
      const r = await deleteCronJobOnHost(host, id)
      if (r.ok) removed++
      else failed.push({ id, error: r.error || 'delete failed' })
    }
  }
  for (const s of schedules) {
    const r = await applyCronJobOnHost(host, s.id, s.spec, s.opts)
    if (r.ok) applied++
    else failed.push({ id: s.id, error: r.error || 'apply failed' })
  }
  return { applied, removed, failed }
}
