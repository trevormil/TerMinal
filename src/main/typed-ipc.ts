import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { ChannelMap } from './ipc-channels'

/**
 * `ipcMain.handle`, bound to the channel map.
 *
 * `ipcMain.handle` types its callback as `(event, ...args: any[]) => any`, so a
 * handler is free to declare arguments the caller never sends and return a shape
 * the caller cannot use. Both sides then typecheck and the mismatch surfaces as
 * an undefined field in the UI. This overload reads the channel's declared
 * arguments and result off `ChannelMap` — generated from the preload key that
 * invokes the channel — so the handler is checked against its real caller.
 *
 * Migration is incremental: `ipcMain.handle` still works, and a channel with no
 * preload caller (nothing in the map) stays on it.
 */
export function handle<C extends keyof ChannelMap>(
  channel: C,
  listener: (
    event: IpcMainInvokeEvent,
    ...args: ChannelMap[C]['args']
  ) => ChannelMap[C]['result'] | Promise<ChannelMap[C]['result']>,
): void {
  // The cast is the one place the erasure happens, and it is contained: every
  // call site above it is checked, and electron's own signature is `any[]`.
  ipcMain.handle(channel, listener as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown)
}
