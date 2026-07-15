import { test, expect, describe } from 'bun:test'
import { sendUrl, getUpdatesUrl, parseUpdates, telegramChatIdError } from './telegram-api'

describe('telegramChatIdError', () => {
  const token = '8357874929:AAGUQrMzOTFV6HVNJJSx71G'

  test('flags the bot id pasted as chat id (the 403 footgun)', () => {
    expect(telegramChatIdError(token, '8357874929')).toMatch(/bot's own id/)
    expect(telegramChatIdError(token, '  8357874929  ')).toMatch(/bot's own id/) // trims
  })

  test('passes a real chat id', () => {
    expect(telegramChatIdError(token, '6371624447')).toBeNull()
    expect(telegramChatIdError(token, '-1001234567890')).toBeNull() // group chat
  })

  test('empty inputs are not flagged', () => {
    expect(telegramChatIdError(token, '')).toBeNull()
    expect(telegramChatIdError('', '')).toBeNull()
    expect(telegramChatIdError('', '123')).toBeNull()
  })
})

describe('url builders', () => {
  test('sendUrl', () => {
    expect(sendUrl('123:ABC')).toBe('https://api.telegram.org/bot123:ABC/sendMessage')
  })
  test('getUpdatesUrl with/without offset', () => {
    // allowed_updates is appended to opt into callback_query taps; offset is
    // present only when ack-ing past prior updates.
    expect(getUpdatesUrl('T', 0)).toMatch(
      /^https:\/\/api\.telegram\.org\/botT\/getUpdates\?timeout=0&allowed_updates=/,
    )
    expect(getUpdatesUrl('T', 42)).toMatch(
      /^https:\/\/api\.telegram\.org\/botT\/getUpdates\?offset=42&timeout=0&allowed_updates=/,
    )
  })
})

describe('parseUpdates', () => {
  const upd = (id: number, chat: string, text: string) => ({
    update_id: id,
    message: { chat: { id: chat }, text },
  })

  test('returns only the authorized chat, advances offset past all', () => {
    const json = {
      result: [upd(10, '999', '/runs'), upd(11, '555', '/run docs'), upd(12, '999', '/status')],
    }
    const { messages, nextOffset } = parseUpdates(json, '999')
    expect(messages).toEqual([
      { updateId: 10, text: '/runs' },
      { updateId: 12, text: '/status' },
    ])
    expect(nextOffset).toBe(13) // 12 (max over ALL updates) + 1
  })

  test('numeric chat id matches string chatId', () => {
    const json = { result: [{ update_id: 1, message: { chat: { id: 999 }, text: '/help' } }] }
    expect(parseUpdates(json, '999').messages).toHaveLength(1)
  })

  test('empty chatId → no commands (auth boundary), but offset still advances', () => {
    const json = { result: [upd(5, '999', '/run dangerous')] }
    const { messages, nextOffset } = parseUpdates(json, '')
    expect(messages).toEqual([])
    expect(nextOffset).toBe(6)
  })

  test('edited_message is honored', () => {
    const json = {
      result: [{ update_id: 7, edited_message: { chat: { id: '999' }, text: '/runs' } }],
    }
    expect(parseUpdates(json, '999').messages).toEqual([{ updateId: 7, text: '/runs' }])
  })

  test('non-text updates ignored; empty result → offset 0', () => {
    expect(
      parseUpdates({ result: [{ update_id: 3, message: { chat: { id: '999' } } }] }, '999'),
    ).toEqual({
      messages: [],
      callbacks: [],
      nextOffset: 4,
    })
    expect(parseUpdates({ result: [] }, '999')).toEqual({
      messages: [],
      callbacks: [],
      nextOffset: 0,
    })
    expect(parseUpdates({}, '999')).toEqual({ messages: [], callbacks: [], nextOffset: 0 })
  })

  test('callback_query taps surface as callbacks (authorized chat only)', () => {
    const json = {
      result: [
        {
          update_id: 11,
          callback_query: {
            id: 'cq1',
            data: 'hitl:resolve:abc',
            message: { chat: { id: '999' } },
          },
        },
        {
          update_id: 12,
          callback_query: {
            id: 'cq2',
            data: 'hitl:resolve:other',
            message: { chat: { id: '777' } }, // unauthorized — ignored
          },
        },
      ],
    }
    const r = parseUpdates(json, '999')
    expect(r.callbacks).toEqual([
      { updateId: 11, queryId: 'cq1', data: 'hitl:resolve:abc', fromChatId: '999' },
    ])
    expect(r.nextOffset).toBe(13)
  })

  test('allowed_updates query string includes callback_query', () => {
    expect(getUpdatesUrl('t', 0)).toContain('callback_query')
    expect(getUpdatesUrl('t', 5)).toContain('callback_query')
  })
})
