// Slack delivery for inbox items (inbox.destination 'both' | 'slack').
//
// One-way in v1: filings post, dedup recurrences thread under the original
// message, resolves stamp a ✅ reaction. Interactivity (resolving FROM Slack)
// needs a Socket Mode app and is deliberately out of scope here.
//
// Delivery is best-effort and MUST never block or fail a filing — the durable
// record is hitl.json, Slack is a view of it. Everything here swallows errors.

import { blockEffect } from './effect-guard'
import {
  SLACK_RESOLVE_REACTION,
  mirrorsToSlack,
  slackChannelName,
  slackMessageFor,
  slackRecurrenceText,
} from '../shared/slack'
import { readSettings, type SlackCfg } from './settings'
import type { HitlItem } from './hitl'

export type SlackPostRef = { channelId: string; ts: string }

export type SlackApiCall = {
  token: string
  method: string
  body: Record<string, unknown>
}

/** Thin transport, injectable for tests. Slack errors arrive as {ok:false}. */
async function slackApi(call: SlackApiCall): Promise<unknown> {
  const res = await fetch(`https://slack.com/api/${call.method}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${call.token}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(call.body),
    signal: AbortSignal.timeout(8000),
  })
  return res.json()
}

type SlackApi = (call: SlackApiCall) => Promise<unknown>

type ApiResult = { ok?: boolean; error?: string; channel?: unknown; ts?: unknown }

function asResult(v: unknown): ApiResult {
  return v && typeof v === 'object' ? (v as ApiResult) : {}
}

type SlackableHitl = Pick<
  HitlItem,
  | 'title'
  | 'source'
  | 'category'
  | 'repo'
  | 'action'
  | 'detail'
  | 'occurrenceCount'
  | 'slackChannel'
  | 'slackTs'
> & { severity?: 'urgent' | 'normal' | 'low' }

/**
 * Post a fresh filing. Routing ladder, one rung at a time, never a loop:
 *   1. the category's derived channel (by name)
 *   2. channel_not_found + autoCreate → conversations.create, retry by id
 *   3. still failing → the default channel (unless that's where we started)
 * Returns the message ref for later threading/reactions, or null.
 */
export async function deliverSlackPost(
  cfg: SlackCfg,
  item: SlackableHitl,
  api: SlackApi = slackApi,
): Promise<SlackPostRef | null> {
  try {
    const channel = slackChannelName(item.category, cfg)
    const fallback = slackChannelName(undefined, cfg)
    const message = slackMessageFor(item)
    const post = async (to: string): Promise<ApiResult> =>
      asResult(
        await api({
          token: cfg.botToken,
          method: 'chat.postMessage',
          body: { channel: to, ...message },
        }),
      )

    let res = await post(`#${channel}`)
    if (!res.ok && res.error === 'channel_not_found' && cfg.autoCreateChannels) {
      const created = asResult(
        await api({
          token: cfg.botToken,
          method: 'conversations.create',
          body: { name: channel },
        }),
      )
      const id = (created.channel as { id?: string } | undefined)?.id
      if (created.ok && id) res = await post(id)
    }
    if (!res.ok && channel !== fallback) res = await post(`#${fallback}`)
    if (!res.ok || typeof res.channel !== 'string' || typeof res.ts !== 'string') return null
    return { channelId: res.channel, ts: res.ts }
  } catch {
    return null
  }
}

/** A dedup-window recurrence: thread under the original post, if we have one. */
export async function threadSlackRecurrence(
  cfg: SlackCfg,
  item: SlackableHitl,
  api: SlackApi = slackApi,
): Promise<void> {
  if (!item.slackChannel || !item.slackTs) return
  try {
    await api({
      token: cfg.botToken,
      method: 'chat.postMessage',
      body: {
        channel: item.slackChannel,
        thread_ts: item.slackTs,
        text: slackRecurrenceText({ title: item.title, occurrenceCount: item.occurrenceCount }),
      },
    })
  } catch {
    /* best effort */
  }
}

/** Resolve → ✅ on the original message. Slack rejects a duplicate reaction
 *  with already_reacted; that's success for our purposes. */
export async function reactSlackResolved(
  cfg: SlackCfg,
  item: SlackableHitl,
  api: SlackApi = slackApi,
): Promise<void> {
  if (!item.slackChannel || !item.slackTs) return
  try {
    await api({
      token: cfg.botToken,
      method: 'reactions.add',
      body: { channel: item.slackChannel, timestamp: item.slackTs, name: SLACK_RESOLVE_REACTION },
    })
  } catch {
    /* best effort */
  }
}

/** Live config when Slack delivery should run, else null. The effect guard
 *  makes this unreachable from tests, same as the Telegram path. */
export function slackDelivery(): SlackCfg | null {
  if (blockEffect('notify', 'hitl-slack')) return null
  const s = readSettings()
  if (!mirrorsToSlack(s.inbox.destination) || !s.slack.botToken) return null
  return s.slack
}
