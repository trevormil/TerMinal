import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

// Known external apps for the "Open in editor/browser" handoffs, in preference
// order. Detected by .app bundle name so `open -a <name>` works without a CLI.
// Lives in its own module (no deps on settings) so both env.ts and settings.ts
// can use it without a circular import.
export const EDITOR_APPS = [
  'Cursor',
  'Visual Studio Code',
  'VSCodium',
  'Zed',
  'Windsurf',
  'Sublime Text',
]
export const BROWSER_APPS = [
  'Brave Browser',
  'Arc',
  'Google Chrome',
  'Firefox',
  'Microsoft Edge',
  'Safari',
]

export function appInstalled(name: string): boolean {
  return (
    existsSync(join('/Applications', `${name}.app`)) ||
    existsSync(join(homedir(), 'Applications', `${name}.app`))
  )
}

/** Installed editor/browser .app bundles (for the Settings/onboarding pickers). */
export function detectApps(): { editors: string[]; browsers: string[] } {
  return { editors: EDITOR_APPS.filter(appInstalled), browsers: BROWSER_APPS.filter(appInstalled) }
}

/** First installed editor/browser in preference order, or '' if none found.
 *  Used as the default handoff target before falling back to a hardcoded app. */
export const firstInstalledEditor = (): string => EDITOR_APPS.find(appInstalled) || ''
export const firstInstalledBrowser = (): string => BROWSER_APPS.find(appInstalled) || ''
