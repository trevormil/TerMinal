// Pure builders for the Telegram Bot HTTP API (no I/O — unit-testable). The
// actual fetch lives in telegram.ts (poll/control) and events.ts (notify).

const API = 'https://api.telegram.org'

export function sendUrl(token: string): string {
  return `${API}/bot${token}/sendMessage`
}

/**
 * Catch the most common Telegram setup mistake before hitting the API: pasting
 * the bot's OWN id (the digits before ':' in the token) into the chat-id field.
 * The API rejects that with a cryptic 403 "the bot can't send messages to the
 * bot". Returns a human-friendly error string, or null if the pair looks sane.
 */
export function telegramChatIdError(botToken: string, chatId: string): string | null {
  const botId = botToken.split(':')[0]?.trim()
  const chat = chatId.trim()
  if (botId && chat && chat === botId) {
    return "That Chat id is the bot's own id (the number before ':' in the token). Use YOUR chat id instead — message @userinfobot to get it."
  }
  return null
}

/** Acknowledge a tapped inline-button so Telegram dismisses the loading
 *  spinner on the user's keyboard. Required by the Bot API. */
export function answerCallbackUrl(token: string): string {
  return `${API}/bot${token}/answerCallbackQuery`
}

/** Long-poll-free getUpdates; `offset` acks everything below it. */
export function getUpdatesUrl(token: string, offset: number): string {
  // allowed_updates lets us opt-in to callback_query so inline-button taps
  // surface alongside plain messages.
  const a = `&allowed_updates=${encodeURIComponent('["message","edited_message","callback_query"]')}`
  const q = offset > 0 ? `?offset=${offset}&timeout=0${a}` : `?timeout=0${a}`
  return `${API}/bot${token}/getUpdates${q}`
}

export type TgInlineButton = { text: string; callback_data: string }
export type TgInlineKeyboard = TgInlineButton[][]

export type TgMessage = { updateId: number; text: string }
// Callback from an inline-button tap. We surface the button's data + the
// chat id (so the dispatcher can confirm it matches the authorized chat)
// + the query id (needed for answerCallbackQuery).
export type TgCallback = {
  updateId: number
  queryId: string
  data: string
  fromChatId: string
}
export type ParsedUpdates = {
  messages: TgMessage[]
  callbacks: TgCallback[]
  nextOffset: number
}

/** Extract text messages + callback-query taps from the *authorized* chat,
 *  plus the ack offset. `nextOffset` advances past EVERY update (incl. other
 *  chats) so we never re-fetch them; only items from `chatId` are returned to
 *  act on — that fixed chat is the auth boundary, so an empty chatId yields
 *  nothing. */
export function parseUpdates(json: unknown, chatId: string): ParsedUpdates {
  const result = (json as { result?: unknown })?.result
  const messages: TgMessage[] = []
  const callbacks: TgCallback[] = []
  let maxId = 0
  if (Array.isArray(result)) {
    for (const u of result) {
      const id = Number(u?.update_id) || 0
      if (id > maxId) maxId = id
      // text message
      const msg = u?.message ?? u?.edited_message
      const text = msg?.text
      const mid = String(msg?.chat?.id ?? '')
      if (typeof text === 'string' && chatId && mid === chatId)
        messages.push({ updateId: id, text })
      // callback query (inline-button tap)
      const cq = u?.callback_query
      if (cq && typeof cq.data === 'string') {
        const fromChatId = String(cq?.message?.chat?.id ?? '')
        if (chatId && fromChatId === chatId) {
          callbacks.push({
            updateId: id,
            queryId: String(cq.id || ''),
            data: cq.data,
            fromChatId,
          })
        }
      }
    }
  }
  return { messages, callbacks, nextOffset: maxId ? maxId + 1 : 0 }
}
