// terminal-cli — self-contained TerMinal helpers exposed inside scheduled-agent
// scripts (.agents/<id>.sh) so the script body can file tickets, raise HITL,
// emit activity events, send Telegram pings, and persist run-to-run state
// (last-scanned SHA, arbitrary key/value) without hand-coding the JSON.
//
// The runner injects ~/.config/TerMinal/bin into PATH and sets TERMINAL_REPO /
// TERMINAL_AGENT_ID / TERMINAL_RUN_ID before exec-ing scripts.
//
// Subcommands:
//   terminal-cli ticket "<title>" "<body>"              file a ticket on TERMINAL_REPO's configured provider
//   terminal-cli inbox-item "<title>" "<action>"        file a global Inbox item + Telegram ping
//                    [--severity=urgent|normal|low] [--category=<Name>]
//                    --category is free-form: any name groups the Inbox sidebar.
//                    `terminal-cli hitl …` is a permanent alias of this verb —
//                    a human-in-the-loop request is one category of Inbox item.
//   terminal-cli activity <kind> "<title>" "<detail>"   emit one activity-feed event
//   terminal-cli deploy "<env>" "[sha]" "[detail]"      emit a deploy activity event
//   terminal-cli notify "<message>"                     send a Telegram message (raw)
//   terminal-cli inbox enqueue '<json>'                 queue local automation inbox request
//   terminal-cli inbox enqueue --source x --type y      queue via flags (less shell quoting)
//   terminal-cli inbox status|dir|example               inspect automation inbox helpers
//
//   terminal-cli state                                  print this agent's full state JSON
//   terminal-cli state get-sha                          print lastScannedSha (empty if first run)
//   terminal-cli state set-sha <sha>                    set lastScannedSha + bump lastRunAt
//   terminal-cli state get <key>                        print a single state field
//   terminal-cli state set <key> <value>                set a single state field (JSON-decoded if possible)
//
// State file path is ~/.config/TerMinal/agent-state/<repo-basename>/<agent-id>.json
// (state lives outside the repo so cron runs don't dirty the working tree).
//
// SELF-CONTAINED: bin/terminal-cli is a single bundled file with no runtime
// imports from the TerMinal app bundle, so host-provision can scp it to a
// remote host and the agent image can bake it in. That is what lets the typed
// sources here IMPORT the shared lock and sidecar-resolution modules instead of
// carrying hand-copies of them (the bundler inlines both at build time).
import { stateCommand } from './agent-state'
import { emitActivity, emitDeploy } from './activity'
import { classifyCommand } from './classify'
import { completionHitl, fileHitl } from './hitl'
import { listenerCommand } from './listener'
import { loopCommand } from './loop'
import { mcpCommand } from './mcp'
import { monitorCli } from './monitor'
import { pingTelegram } from './notify'
import { remoteCommand } from './remote'
import { commentOnTicket, fileTicket } from './tickets'

export function main(argv: string[]): void {
  const [, , cmd, ...args] = argv
  switch (cmd) {
    case 'loop':
      loopCommand(args[0], args.slice(1))
      break
    case 'ticket':
      if (args[0] === 'comment') commentOnTicket(args[1], args[2])
      else fileTicket(args[0], args[1], args[2])
      break
    // `inbox-item` is the documented verb; `hitl` falls through to the same arm
    // and stays supported forever (ticket 0123). It is `inbox-item` rather than
    // `inbox` because that verb already means the automation listener queue.
    case 'inbox-item':
    case 'hitl': {
      // Both flags are parsed here and stripped before the positionals are read,
      // so `inbox-item "title" "action" --category=X` works in any order.
      const flag = (name: string): string | undefined => {
        const hit = args.find((a) => a.startsWith(`--${name}=`))
        return hit ? hit.slice(name.length + 3) : undefined
      }
      const rest = args.filter((a) => !a.startsWith('--severity=') && !a.startsWith('--category='))
      fileHitl(rest[0], rest[1], { severity: flag('severity'), category: flag('category') })
      break
    }
    case 'monitor':
      monitorCli(args)
      break
    case 'completion-hitl':
      completionHitl(args[0] || 'Agent')
      break
    case 'activity':
      emitActivity(args[0], args[1], args[2])
      break
    case 'deploy':
    case 'ship':
      emitDeploy(args[0], args[1], args[2])
      break
    case 'notify':
      pingTelegram(args[0] || '')
      break
    case 'listener':
    case 'inbox':
      listenerCommand(args[0], args.slice(1))
      break
    case 'state':
      stateCommand(args[0], args.slice(1))
      break
    case 'mcp':
      mcpCommand(args[0], args.slice(1))
      break
    case 'classify':
      classifyCommand(args[0], args.slice(1))
      break
    case 'remote':
      remoteCommand(args[0], args.slice(1))
      break
    default:
      console.error(
        'usage: terminal-cli <ticket|inbox-item|activity|deploy|notify|inbox|state|mcp|classify|remote> [args...]\n' +
          '  ticket "<title>" "<body>" [tier]         file a backlog ticket on TERMINAL_REPO\n' +
          '                                           tier: auto|top|cheap-agentic|cheap-raw (default auto)\n' +
          '  ticket comment <slug> "<body>"           append to a ticket\'s log (read by later runs)\n' +
          '  inbox-item "<title>" "<action>"          file a global Inbox item + Telegram ping\n' +
          '                                           [--severity=urgent|normal|low] [--category=<Name>]\n' +
          '  hitl "<title>" "<action>"                alias of inbox-item (human-in-the-loop category)\n' +
          '  completion-hitl <engine>                 read hook JSON on stdin and file default-on Inbox item\n' +
          '  activity <kind> "<title>" "<detail>"     emit one activity-feed event\n' +
          '  deploy "<env>" "[sha]" "[detail]"        emit one deploy activity event\n' +
          '  notify "<message>"                       send a Telegram message (raw)\n' +
          '  inbox enqueue <json|--flags>              queue a local automation inbox request\n' +
          '  inbox status|dir|example                  inspect automation inbox helpers\n' +
          '  remote register "<title>"                register this session for the phone\n' +
          '  remote post "<message>" [--image <path>]  send an update (+ optional image)\n' +
          '  remote ask "<question>" [--timeout N]     ask and BLOCK until the phone replies\n' +
          '  remote check                             collect replies queued while working\n' +
          '  remote end                               mark the session finished\n' +
          '  state [get [key] | get-sha | set <k> <v> | set-sha <sha> | mark-main]\n' +
          '                                           persist per-(repo, agent) JSON sidecar\n',
      )
      process.exit(2)
  }
}

main(process.argv)
