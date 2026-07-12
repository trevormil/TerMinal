# Runbook — k3s on an always-on host (runtime: k8s)

Sets up the `runtime: 'k8s'` trigger (ADR-0002 #16): scheduled agents run as
Kubernetes CronJobs on the host's **own single-node k3s cluster** — not a remote/cloud
cluster. Same hardware as the systemd path, with k8s orchestration.

## Prerequisites
- Host provisioned for scheduled agents (see build-and-release / #12): Bun, linger,
  runner installed, Docker.
- The agent image built on the host (`docker/build-agent-image.sh`).

## 1. Install k3s (requires root — run ON the host)
```bash
curl -sfL https://get.k3s.io | sh -
# make kubectl usable without sudo (k3s writes a root-owned kubeconfig):
sudo chmod 644 /etc/rancher/k3s/k3s.yaml    # or: mkdir -p ~/.kube && sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config && sudo chown $USER ~/.kube/config
kubectl get nodes    # should show the node Ready
```

## 2. Import the agent image into k3s (no registry needed)
k3s uses its own containerd, so a locally-built Docker image must be imported:
```bash
docker save terminal-agent:latest | sudo k3s ctr images import -
sudo k3s ctr images ls | grep terminal-agent
```
Re-run this whenever the image is rebuilt (e.g. after a runner update — see the nightly
self-update timer, #19).

## 3. How TerMinal drives it
For a schedule with `host` set and `runtime: 'k8s'`, TerMinal SSHes to the host and
`kubectl apply`s a `CronJob` (built by `src/main/k8s.ts` `buildCronJobManifest`):
- `concurrencyPolicy: Forbid` (no overlap)
- `activeDeadlineSeconds` = the schedule timeout, `backoffLimit` = retries
- the agent image with `args: [run, <id>]`
- **hostPath** mounts of `~/.config/TerMinal` and the repo, so pods write the same
  `cron-runs/<id>.json` the Runs tab reads — one `UnifiedRun` contract across all runtimes.

Reconcile mirrors launchd/systemd: CronJobs ↔ k8s-runtime schedules, orphans deleted.

## Inspect / debug
```bash
kubectl get cronjobs -l app=terminal-cron
kubectl get jobs -l app=terminal-cron
kubectl logs job/<job-name>
kubectl create job --from=cronjob/terminal-cron-<id> manual-test   # fire once now
```

## Notes
- Secrets (engine keys, gh/glab tokens) belong in a k8s `Secret` + `envFrom`, never baked
  into the image (follow-up as real engine runs are wired).
- This is opt-in and orthogonal to the systemd path — the systemd trigger already covers
  always-on scheduling; k8s is the orchestrated option on the same box.
