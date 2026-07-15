// Host self-update (#19). Keeps a host's runner + cli current with latest `main`
// on its own — a systemd --user timer runs nightly (headless via linger), pulls
// the TerMinal repo, and reinstalls bin/terminal-cron + bin/terminal-cli. So a
// host stays fresh without the Mac app pushing to it.
//
// Pure builders (script + install command) are unit-tested; installed by
// provisioning over SSH.

const CFG = '$HOME/.config/TerMinal'
const BIN = `${CFG}/bin`
const REPO = '$HOME/repos/TerMinal'
const XDG = 'export XDG_RUNTIME_DIR="/run/user/$(id -u)";'

// The nightly update script (written to the host's bin dir). Idempotent: pulls if
// the clone exists, shallow-clones otherwise, reinstalls both binaries, and — when
// the runner changed — rebuilds the agent image (container/k8s runtimes bundle it)
// and re-imports it into k3s if present (#21).
export function buildSelfUpdateScript(repoSlug: string, branch: string): string {
  const IMPORT = 'docker save terminal-agent:latest | sudo -n k3s ctr images import -'
  const IMPORT_MANUAL = IMPORT.replace(' -n', '')
  return [
    '#!/usr/bin/env bash',
    'set -e',
    `mkdir -p "$HOME/repos" "${BIN}"`,
    `OLD_HEAD=$(git -C "${REPO}" rev-parse HEAD 2>/dev/null || echo none)`,
    `if [ -d "${REPO}/.git" ]; then`,
    // Reset to FETCH_HEAD (not origin/<branch>): a shallow single-branch clone has
    // no remote-tracking ref for other branches, so origin/<branch> can be missing.
    `  git -C "${REPO}" fetch --quiet origin ${branch}`,
    `  git -C "${REPO}" reset --hard --quiet FETCH_HEAD`,
    'else',
    // gh clone (uses the host's gh auth for the private repo); fall back to https.
    `  gh repo clone ${repoSlug} "${REPO}" -- --depth 1 --branch ${branch} \\`,
    `    || git clone --depth 1 --branch ${branch} "https://github.com/${repoSlug}" "${REPO}"`,
    'fi',
    'for f in terminal-cron terminal-cli; do',
    `  [ -f "${REPO}/bin/$f" ] && install -m 755 "${REPO}/bin/$f" "${BIN}/$f"`,
    'done',
    `NEW_HEAD=$(git -C "${REPO}" rev-parse --short HEAD 2>/dev/null || echo none)`,
    `echo "terminal selfupdate: $NEW_HEAD"`,
    // Rebuild the agent image only when the runner actually changed (avoid nightly
    // churn). docker build needs no sudo; the k3s re-import does, so it runs only
    // with passwordless sudo, else it prints the one-line manual command.
    `if command -v docker >/dev/null 2>&1 && [ -f "${REPO}/docker/terminal-agent.Dockerfile" ]; then`,
    `  if [ "$OLD_HEAD" = none ] || ! git -C "${REPO}" diff --quiet "$OLD_HEAD" HEAD -- bin/terminal-cron 2>/dev/null; then`,
    '    echo "runner changed → rebuilding agent image"',
    `    bash "${REPO}/docker/build-agent-image.sh" terminal-agent:latest "${REPO}/bin/terminal-cron" || echo "image build failed"`,
    '    if command -v k3s >/dev/null 2>&1; then',
    `      if sudo -n true 2>/dev/null; then ${IMPORT} && echo "image re-imported into k3s"; \\`,
    `      else echo "k3s present but no passwordless sudo — re-import manually: ${IMPORT_MANUAL}"; fi`,
    '    fi',
    '  else echo "runner unchanged → image rebuild skipped"; fi',
    'fi',
  ].join('\n')
}

// One remote shell command that writes the update script + a systemd --user
// service/timer and enables it. base64 ships the script + units so nothing is
// interpolated raw into the command line.
export function installSelfUpdateCmd(repoSlug: string, branch: string, onCalendar: string): string {
  // Command-line paths: double-quote the $HOME part so the shell expands it;
  // single-quote only the filename. Systemd ExecStart uses %h (systemd expands it;
  // it does NOT expand $HOME) to reach the same script.
  const BIN_Q = '"$HOME/.config/TerMinal/bin"'
  const USER_DIR = '"$HOME/.config/systemd/user"'
  const scriptFile = `${BIN_Q}/'terminal-selfupdate.sh'`
  const script64 = Buffer.from(buildSelfUpdateScript(repoSlug, branch)).toString('base64')
  const service = `[Unit]\nDescription=TerMinal host self-update\n\n[Service]\nType=oneshot\nExecStart=/bin/bash %h/.config/TerMinal/bin/terminal-selfupdate.sh\n`
  const timer = `[Unit]\nDescription=TerMinal host self-update (nightly)\n\n[Timer]\nOnCalendar=${onCalendar}\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n`
  const svc64 = Buffer.from(service).toString('base64')
  const tim64 = Buffer.from(timer).toString('base64')
  return (
    `${XDG} ` +
    `mkdir -p ${BIN_Q} ${USER_DIR} && ` +
    `printf %s '${script64}' | base64 -d > ${scriptFile} && chmod +x ${scriptFile} && ` +
    `printf %s '${svc64}' | base64 -d > ${USER_DIR}/'terminal-selfupdate.service' && ` +
    `printf %s '${tim64}' | base64 -d > ${USER_DIR}/'terminal-selfupdate.timer' && ` +
    `systemctl --user daemon-reload && ` +
    `systemctl --user enable --now 'terminal-selfupdate.timer'`
  )
}
