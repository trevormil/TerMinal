// Inbox snooze + alert delivery-log IPC (ticket #0080).
//
// Also the wiring point for the two hooks notify-channels.ts exposes: the
// snooze gate (so a snoozed item is silent on every channel) and the delivery
// recorder (so a channel that keeps failing stops failing silently).

import { ipcMain } from 'electron'
import { emitActivity } from '../events'
import { clearSnooze, isSnoozedAt, readSnoozes, setSnooze, snoozePresets } from '../hitl-snooze'
import {
  appendDeliveryRecord,
  readDeliveryLog,
  recentDeliveries,
  shouldEscalate,
  writeDeliveryLog,
  type DeliveryRecord,
} from '../notify-log'
import { setDeliveryRecorder, setSnoozeGate } from '../notify-channels'
import { configPath } from '.././config-dir'

const SNOOZE_FILE = (): string => configPath('hitl-snooze.json')
const DELIVERY_FILE = (): string => configPath('notify-log.json')

// The gate runs on every alert dispatch, so re-reading the file each time would
// be a syscall per alert per channel. Cached, invalidated on every write.
let snoozeCache: Record<string, number> | null = null
const snoozes = (): Record<string, number> => (snoozeCache ??= readSnoozes(SNOOZE_FILE()))

let deliveryLog: DeliveryRecord[] | null = null

export function registerInboxIpc(): void {
  setSnoozeGate((hitlId) => isSnoozedAt(snoozes(), hitlId))

  setDeliveryRecorder(({ channel, ok, title, error }) => {
    deliveryLog ??= readDeliveryLog(DELIVERY_FILE())
    deliveryLog = appendDeliveryRecord(deliveryLog, { ts: Date.now(), channel, ok, title, error })
    writeDeliveryLog(DELIVERY_FILE(), deliveryLog)
    // Exactly once per failure streak — see shouldEscalate.
    if (!ok && shouldEscalate(deliveryLog, channel))
      emitActivity({
        kind: 'error',
        title: `Alert channel failing · ${channel}`,
        detail: `${channel} has failed 3 deliveries in a row. Last error: ${error || 'unknown'}`,
      })
  })

  ipcMain.handle('inbox:snoozes', () => snoozes())
  ipcMain.handle('inbox:snooze-presets', () => snoozePresets())
  ipcMain.handle('inbox:snooze', (_e, id: string, until: number) => {
    snoozeCache = setSnooze(SNOOZE_FILE(), id, until)
    return snoozeCache
  })
  ipcMain.handle('inbox:unsnooze', (_e, id: string) => {
    snoozeCache = clearSnooze(SNOOZE_FILE(), id)
    return snoozeCache
  })

  ipcMain.handle('inbox:delivery-log', (_e, channel?: string, limit?: number) =>
    recentDeliveries(deliveryLog ?? (deliveryLog = readDeliveryLog(DELIVERY_FILE())), {
      channel,
      limit,
    }),
  )
}
