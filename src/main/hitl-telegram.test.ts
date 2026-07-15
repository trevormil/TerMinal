import { describe, expect, test } from 'bun:test'
import {
  hitlActivityKind,
  hitlNotifyKind,
  hitlTelegramKeyboard,
  hitlTelegramText,
} from './hitl-telegram'

describe('HITL Telegram payloads', () => {
  test('completion hooks are done notifications, not blocked alerts', () => {
    expect(hitlActivityKind('completion-hook')).toBe('task-complete')
    expect(hitlNotifyKind('completion-hook')).toBe('done')
    expect(
      hitlTelegramText({
        source: 'completion-hook',
        title: 'Codex completion',
        action: 'Review it',
      }),
    ).toBe('✅ Done · Codex completion — Review it')
  })

  test('human blockers remain blocked notifications', () => {
    expect(hitlActivityKind('agent')).toBe('blocked')
    expect(hitlNotifyKind('agent')).toBe('blocked')
    expect(hitlTelegramText({ source: 'agent', title: 'Needs approval' })).toBe(
      '⛔ HITL · Needs approval',
    )
  })

  test('inline keyboard always resolves and tails when a run exists', () => {
    expect(hitlTelegramKeyboard({ id: 'h1' })).toEqual([
      [{ text: '✅ Resolve', callback_data: 'hitl:resolve:h1' }],
    ])
    expect(hitlTelegramKeyboard({ id: 'h1', runId: 'r1' })).toEqual([
      [
        { text: '✅ Resolve', callback_data: 'hitl:resolve:h1' },
        { text: '🪵 Tail run', callback_data: 'run:tail:r1' },
      ],
    ])
  })
})
