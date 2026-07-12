# TerMinal agent image — runs the bundled headless runner (bin/terminal-cron)
# inside a container. This is the SHARED artifact for two runtimes (ADR-0002):
#   - systemd container runtime (#13): a --user service runs `docker run … run <id>`
#   - k3s CronJob on the host (#16): the same image, same entrypoint
#
# The build context only needs `terminal-cron` (see build-agent-image.sh). Engine
# CLIs (codex/claude/…) are NOT baked in — for LLM runs they're either added in a
# derived image or provided via mounted host PATH + credential dirs; the
# script-first path (.agents/<id>.sh) needs no engine at all.
FROM oven/bun:1-debian

# git for worktrees, util-linux for the runner's `script -q -e -c` TTY wrapper,
# openssh-client + ca-certs for git/gh over SSH/HTTPS.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates openssh-client util-linux \
    && rm -rf /var/lib/apt/lists/*

COPY terminal-cron /usr/local/bin/terminal-cron
RUN chmod +x /usr/local/bin/terminal-cron

# `docker run <image> run <id>` → `bun /usr/local/bin/terminal-cron run <id>`.
# The runner reads schedules.json + writes cron-runs under $HOME/.config/TerMinal,
# which the caller bind-mounts from the host so records surface in the Runs tab.
ENTRYPOINT ["bun", "/usr/local/bin/terminal-cron"]
