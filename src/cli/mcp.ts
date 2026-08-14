// terminal-cli mcp <tool> [k=v k=v ...] — shell-friendly invocation of the
// MCP server's tools so bash agent scripts can call them without a JSON-RPC
// client. Spawns the MCP server, sends initialize + tools/call, prints the
// result text, exits.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { TERMINAL_BIN } from './env'

export function mcpCommand(tool: string | undefined, kvArgs: string[]): void {
  if (!tool) {
    console.error(
      'usage: terminal-cli mcp <tool> [k=v k=v ...]\n' +
        'examples:\n' +
        '  terminal-cli mcp file_ticket repo=vellum-project title="fix flaky test" type=bug\n' +
        '  terminal-cli mcp list_hitl status=open\n' +
        '  terminal-cli mcp set_run_outcome runId=$TERMINAL_RUN_ID outcome=pr-opened\n',
    )
    process.exit(2)
  }
  // Parse k=v args. Values are JSON-parsed when possible so booleans/numbers
  // round-trip; otherwise treated as strings.
  const params: Record<string, unknown> = {}
  for (const a of kvArgs) {
    const eq = a.indexOf('=')
    if (eq < 0) continue
    const key = a.slice(0, eq)
    const raw = a.slice(eq + 1)
    let val: unknown = raw
    try {
      val = JSON.parse(raw)
    } catch {
      /* leave as string */
    }
    params[key] = val
  }
  // Spawn the MCP server as a subprocess
  const serverBin = TERMINAL_BIN('terminal-mcp-server')
  if (!existsSync(serverBin)) {
    console.error(`terminal-cli mcp: server not installed at ${serverBin}`)
    process.exit(2)
  }
  const mcpTimeout =
    tool === 'request_agent_artifact'
      ? Math.max(30_000, Math.min(Number(params.timeoutMs || 180_000) + 30_000, 630_000))
      : 30_000
  const child = execFile(serverBin, [], { timeout: mcpTimeout }, (err, stdout) => {
    if (err && (err as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
      console.error('terminal-cli mcp: server timeout')
      process.exit(1)
    }
    // Parse the responses — initialize + tools/call (we sent them as two
    // requests). The last one is the result we want.
    let result: any = null
    for (const line of (stdout || '').split('\n')) {
      if (!line.trim()) continue
      try {
        const r = JSON.parse(line)
        if (r.id === 2) result = r
      } catch {
        /* server chatter that is not a JSON-RPC frame */
      }
    }
    if (!result) {
      console.error('terminal-cli mcp: no response')
      process.exit(1)
    }
    if (result.error) {
      console.error(`terminal-cli mcp: ${result.error.message}`)
      process.exit(1)
    }
    // Tool results come as { content: [{ type:'text', text:'<json>' }] }
    const text = result.result?.content?.[0]?.text
    if (text) console.log(text)
    process.exit(0)
  })
  child.stdin!.write(
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }) +
      '\n' +
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: tool, arguments: params },
      }) +
      '\n',
  )
  child.stdin!.end()
}
