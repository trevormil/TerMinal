// ---------------------------------------------------------------------------
// One poll cycle's worth of dispatch, extracted from telegram.ts so the failure
// semantics are testable without a bot token or a network.
//
// The bug this exists for (finding C1, High): the poll loop committed the new
// `getUpdates` offset BEFORE processing the batch, and had no per-message
// try/catch. So a single throwing command:
//
//   • aborted the rest of the batch — every later message and every queued
//     callback tap in that cycle was dropped,
//   • permanently, because the offset had already advanced past them,
//   • silently, because the bare network `catch {}` around the whole thing
//     swallowed the error with no reply and no log.
//
// The user saw a command simply do nothing, forever, with no way to tell it had
// even been received.
//
// Rules now: every item is attempted, each independently; a failure replies with
// the error instead of vanishing; and the offset is committed INCREMENTALLY,
// after each item settles, to `updateId + 1`.
//
// Incrementally, not once at the end, because the two obvious placements each
// lose something:
//   • commit-before-processing (the original) DROPS the rest of a batch when one
//     item throws — the bug above;
//   • commit-after-the-whole-batch REPLAYS the entire batch if the app crashes
//     or is quit mid-batch. Telegram commands launch agents, so a replay means
//     duplicate agent runs, and PR #210's SIGKILL-at-quit widens that window.
// Per-item commits give both properties for one small extra write per message.
// The offset advances past a FAILED item too, deliberately: a message that
// reliably throws would otherwise be redelivered forever.
// ---------------------------------------------------------------------------

export type UpdateBatch = {
  messages: { updateId: number; text: string }[]
  callbacks: { updateId: number; data: string; queryId: string }[]
}

export type BatchHandlers = {
  handleMessage: (text: string) => Promise<void> | void
  handleCallback: (data: string, queryId: string) => Promise<void> | void
  /** Tell the user their command failed. Never allowed to throw the batch out. */
  onError: (item: string, err: Error) => void
  /** Persist the ack cursor. Called after EACH item settles, with updateId + 1. */
  commitOffset: (offset: number) => void
}

export type BatchResult = { handled: number; failed: number }

export async function runUpdateBatch(batch: UpdateBatch, h: BatchHandlers): Promise<BatchResult> {
  const result: BatchResult = { handled: 0, failed: 0 }
  const attempt = async (label: string, updateId: number, run: () => Promise<void> | void) => {
    try {
      await run()
      result.handled++
    } catch (e) {
      result.failed++
      try {
        h.onError(label, e as Error)
      } catch {
        // A failing error-reporter must not abort the batch either — that would
        // reintroduce exactly the bug this function exists to fix.
      }
    } finally {
      // Settled either way, so this one must never be redelivered.
      try {
        if (updateId > 0) h.commitOffset(updateId + 1)
      } catch {
        /* best-effort: a lost cursor write costs a replay, never a drop */
      }
    }
  }
  for (const m of batch.messages) await attempt(m.text, m.updateId, () => h.handleMessage(m.text))
  for (const c of batch.callbacks)
    await attempt(c.data, c.updateId, () => h.handleCallback(c.data, c.queryId))
  return result
}
