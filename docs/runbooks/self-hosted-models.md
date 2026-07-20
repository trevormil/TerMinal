# Self-hosted / network models (`openai-compat` engine)

Route TerMinal agent runs at a model you host yourself — a box on the LAN or
behind a tunnel running vLLM, Ollama, LM Studio, TGI, llama.cpp server, SGLang,
or anything else exposing an OpenAI-compatible `/v1/chat/completions`.

## Setup

1. **Codex must be installed** — `openai-compat` rides the same `or-agent`
   (Codex) harness as the OpenRouter engine; there is no separate binary.
2. **Settings → Engines → Self-hosted**:
   - **Base URL** — the endpoint's `/v1` base, e.g. `http://10.0.0.5:8000/v1`
     (vLLM) or `http://localhost:11434/v1` (Ollama). Required; runs fail fast
     without it.
   - **Default model** — the slug your server actually serves (e.g.
     `qwen3-coder-next`). The or-agent harness *requires* a model in this mode —
     there is no sensible registry fallback for a custom server.
   - **Self-hosted API key** — sealed in the OS keychain, injected as
     `OPENAI_API_KEY`. Leave empty for keyless local servers (a `none`
     placeholder is sent; such servers ignore the Authorization header).
3. Pick **Self-hosted** wherever an engine is chosen: agent runs, ticket runs,
   background tasks, schedules, and interactive sessions (Codex TUI pointed at
   the endpoint via an inline provider, `wire_api = chat`).

## Standalone scripts (no app needed)

`or-exec` / `or-agent` honor `OPENAI_BASE_URL` directly:

```bash
OPENAI_BASE_URL=http://10.0.0.5:8000/v1 OPENAI_API_KEY=none \
  or-exec --model qwen3-coder-next --prompt "…"
OPENAI_BASE_URL=http://10.0.0.5:8000/v1 OPENAI_API_KEY=none \
  or-agent --model qwen3-coder-next --dir . "…task…"
```

Unset `OPENAI_BASE_URL` → both scripts behave exactly as before (OpenRouter,
`OPENROUTER_API_KEY`).

## Route 1 — script-first agent (zero-change fallback)

A script-first agent (`.agents/<id>.sh`) already receives `TERMINAL_WORKTREE` /
`TERMINAL_MODEL` / `TERMINAL_ENGINE` and can `curl` any endpoint directly. That
works with no engine support at all, but re-implements the agentic loop by
hand — which is exactly what the `openai-compat` engine avoids. Prefer the
engine; keep Route 1 for bespoke protocols.

## Security — read before pointing at a network box

- **Model output drives real tool calls.** Agents run `codex exec -s
  danger-full-access` (and interactive sessions `--yolo`-equivalent). Whatever
  the self-hosted model returns can execute commands in the worktree. Only
  point TerMinal at endpoints you control.
- **Gate the endpoint.** Require an API key on the server and/or restrict it by
  network ACL/firewall to your machines. An open LAN inference server is an
  open code-execution proxy for anyone who can reach it.
- **Plaintext HTTP over the LAN** exposes prompts and repo content in transit.
  Fine for a trusted home network; use a TLS tunnel (tailscale/ssh -L) for
  anything else.

## Caveats

- **Scheduled (cron) runs** read the base URL from `settings.json`, but the
  sealed API key cannot be decrypted by the headless runner. Keyed servers need
  `OPENAI_API_KEY` exported in the login shell profile or set per-schedule via
  the schedule's `env` map; keyless servers just work.
- **Cost/usage** is logged as `0` — there is no billing endpoint to poll.
- **Model picker chips** are empty for this engine (the server decides what it
  serves): set the default model in Settings, or type a slug in the free-text
  model step of the run dialog.
- Anthropic-compatible (`ANTHROPIC_BASE_URL`) endpoints are not supported —
  OpenAI-compatible only (see ticket 0036 follow-ups).
