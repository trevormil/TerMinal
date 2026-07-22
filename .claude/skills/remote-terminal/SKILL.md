---
name: remote-terminal
description: "Register this session with TerMinal Remote so it can be followed and steered from the phone. Use on /remote-terminal, 'sync this to my phone', 'I'm heading out — keep me posted', or before starting long work you want to supervise while away."
---

# /remote-terminal — put this session on the phone

Registers **this** session with the TerMinal Remote app, then keeps a running
conversation with the human while they are away from the Mac.

Several sessions can be registered at once; each becomes its own thread on the
phone. Nothing is scraped from the terminal — you decide what is worth sending.

## 1. Register (once, at the start)

```sh
terminal-cli remote register "<short title for the phone>"
```

It prints a session id. **Remember it** and pass `--id <id>` on every later
call. With exactly one session registered you may omit `--id`, but pass it
whenever more than one might be running.

Tell the human the session is now on their phone.

## 2. Post updates at real checkpoints

```sh
terminal-cli remote post --id <id> "tests green — opening the PR"
```

Write these like a text message to a colleague, not like a log line:

- **Do** post when something meaningful lands: a milestone, a decision you took,
  a failure you're about to work around, a PR opened.
- **Don't** post every command, file read, or intermediate thought. The phone is
  a digest, not a transcript.
- Aim for a handful of posts across a long task, not dozens.
- Include the outcome, not just the activity: "8 tests failing, all in the auth
  suite" beats "ran the tests".

## 3. Ask when you genuinely need them

```sh
terminal-cli remote ask --id <id> "PR is green. Merge it, or hold for review?"
```

`ask` **blocks** until the human replies and prints their answer on stdout —
treat that output as their instruction and continue. It defaults to a 15 minute
wait; pass `--timeout <seconds>` for longer.

Use it for a real fork in the road: an irreversible action, a design choice, a
missing credential. If you can pick a sensible default and note it in a `post`,
do that instead of blocking.

If it times out it exits non-zero and prints nothing. Choose the safe path,
`post` what you did and why, and carry on — never sit idle waiting again.

## 4. Collect replies while you work

```sh
terminal-cli remote check --id <id>
```

Non-blocking. Prints anything the human sent while you were busy, one message
per line, and empty when there is nothing. Run it at natural checkpoints — after
a build, between phases — so a note they left mid-task gets picked up promptly.

Treat whatever it prints as new instructions from the human.

## 5. Finish

```sh
terminal-cli remote end --id <id>
```

Post a closing summary first, so the last thing on their phone says where you
left things.

## Rules

- **Never** put secrets, tokens, or credentials in a `post` or `ask` — they land
  on a phone and in a notification.
- Registering does not change how you work; it adds a reporting channel.
- The human still has the Mac. This is for when they don't.
- Keep the human's own words: when `ask`/`check` returns an instruction, follow
  it rather than reinterpreting it.
