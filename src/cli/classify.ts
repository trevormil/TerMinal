// terminal-cli classify <ci|risk|kind> <input> — wraps the harness
// classifiers for shell scripts. ci reads a log file path; risk takes
// space-separated file paths + optional --diff-lines=N; kind just runs the
// deterministic title→kind regex catalog locally.
import { readFileSync } from 'node:fs'
import { inferKind } from './activity'

export function classifyCommand(kind: string | undefined, args: string[]): void {
  if (kind === 'kind') {
    const title = args.join(' ')
    console.log(inferKind(title))
    return
  }
  if (kind === 'ci') {
    const logPath = args[0]
    if (!logPath) {
      console.error('usage: terminal-cli classify ci <log-file>')
      process.exit(2)
    }
    let rawLog = ''
    try {
      rawLog = readFileSync(logPath, 'utf8')
    } catch (e) {
      console.error(`terminal-cli classify ci: ${(e as Error).message}`)
      process.exit(1)
    }
    // Heuristic catalog — this is now the only CI-failure classifier in the
    // tree. Skip the LLM fallback here: for shell scripts the deterministic answer is
    // what's useful; scripts can call `terminal-cli mcp classify_ci` for the
    // full version (TODO: wire that MCP tool later).
    const PATTERNS = [
      {
        class: 'prettier-formatting',
        re: /\[warn\]\s+Code style issues found|prettier --check.*failed|files would be reformatted/i,
      },
      { class: 'eslint-fixable', re: /\d+\s+(error|problem)s?.*eslint|eslint.*\d+\s+error/i },
      { class: 'typecheck-isolated', re: /error TS\d+:|TS\d+\s+:|TypeScript:.*error/ },
      {
        class: 'snapshot-mismatch',
        re: /snapshot file.*was not written|snapshot.*does not match|toMatchSnapshot.*fail|obsolete snapshot/i,
      },
      {
        class: 'test-real',
        re: /\d+\s+failing|\d+\s+failed|FAIL\s+|✗\s+|AssertionError|Expected.*Received/,
      },
      {
        class: 'build-config',
        re: /(rollup|vite|webpack|esbuild|tsup).*(error|failed)|Module not found|Cannot resolve|Cannot find module/i,
      },
      {
        class: 'lockfile-drift',
        re: /(lockfile|bun\.lock|package-lock).*out of (date|sync)|frozen-lockfile.*failed|lockfile mismatch/i,
      },
      {
        class: 'dependency',
        re: /npm ERR! code E\d+|EPEERINVALID|404 Not Found.*\.tgz|peer dep|ETIMEDOUT.*registry/i,
      },
      {
        class: 'flake-network',
        re: /ECONNRESET|ETIMEDOUT|503 Service Unavailable|429 Too Many Requests|connection refused/i,
      },
      {
        class: 'deploy-infra',
        re: /(ImagePullBackOff|CrashLoopBackOff|kubectl.*error|helm.*failed|docker push.*denied|terraform.*error)/i,
      },
    ]
    // eslint-disable-next-line no-control-regex
    const stripped = rawLog.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    for (const p of PATTERNS) {
      if (p.re.test(stripped)) {
        console.log(p.class)
        return
      }
    }
    console.log('ambiguous')
    return
  }
  if (kind === 'risk') {
    // terminal-cli classify risk file1 file2 ... --diff-lines=N
    const files: string[] = []
    let diffLines = 0
    for (const a of args) {
      if (a.startsWith('--diff-lines=')) diffLines = parseInt(a.slice(13), 10) || 0
      else files.push(a)
    }
    if (!files.length) {
      console.error('usage: terminal-cli classify risk <file> [<file> ...] [--diff-lines=N]')
      process.exit(2)
    }
    const HIGH = [
      /(^|\/)migrations?\//i,
      /(^|\/)db\//i,
      /\bschema\.prisma$|\bschema\.sql$|\.sql$/i,
      /\bauth\b|\bauthz?\b|\bsession\b|\boauth\b/i,
      /\bpayments?\b|\bbilling\b|\bstripe\b|\bcheckout\b/i,
      /(^|\/)k8s\/|(^|\/)kubernetes\/|(^|\/)helm\/|deployment\.ya?ml$/i,
      /(^|\/)terraform\/|\.tf$/i,
      /\bsecrets?\b|\.env(\.|$)|credentials/i,
      /(^|\/)\.github\/workflows\//i,
    ]
    const LOW = [
      /\.md$/i,
      /(^|\/)docs?\//i,
      /(^|\/)CHANGELOG\.md$/i,
      /(^|\/)README/i,
      /(^|\/)\.gitignore$/i,
      /(^|\/)\.editorconfig$/i,
      /(^|\/)LICENSE/i,
      /(^|\/)\.prettierrc/i,
      /(^|\/)snapshots?\//i,
    ]
    for (const f of files)
      for (const p of HIGH)
        if (p.test(f)) {
          console.log('high')
          return
        }
    if (diffLines > 500) {
      console.log('medium')
      return
    }
    if (files.every((f) => LOW.some((p) => p.test(f))) && diffLines <= 50) {
      console.log('low')
      return
    }
    if (files.every((f) => LOW.some((p) => p.test(f)))) {
      console.log('low')
      return
    }
    console.log('medium')
    return
  }
  console.error('usage: terminal-cli classify <ci|risk|kind> <args>')
  process.exit(2)
}
