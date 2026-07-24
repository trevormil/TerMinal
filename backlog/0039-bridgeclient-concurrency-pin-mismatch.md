---
id: 39
title: "Harden BridgeClient concurrency + surface pin-mismatch errors distinctly"
status: backlog
priority: low
horizon: later
hitl: false
type: refactor
source: manual
created: 2026-07-23
updated: 2026-07-23
prs: []
refs:
  - ios/TerMinalRemote/Networking/BridgeClient.swift
depends_on: [34]
agent_id: 1000x-ai-engineer
agent_scope: repo
agent_kind: classic
model_tier: auto
---

## Description

BridgeClient is a shared class whose cached `host` is read/written from many
concurrent tasks (tab polls, thread poll, image loads). Benign today, but it's
a data race under Swift 6 strict concurrency — convert BridgeClient to an
actor or `@MainActor`-isolate it.

Note: a first pass at distinct pin-mismatch error mapping is landing in
PR #123 — this ticket covers the actor conversion and any remaining
error-surfacing polish.

## Acceptance criteria

- BridgeClient compiles under strict concurrency with no unsynchronized
  shared mutable state.
- Existing tests green.

## Notes

Low urgency — no observed misbehavior yet; this is future-proofing for the
Swift 6 strict-concurrency migration.
