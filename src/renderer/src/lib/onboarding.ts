import type { Engine, SettingsPatch } from './types'

// Assembles the single settings patch the two-step onboarding writes on
// finish. Pure so the skip/apply rules are testable: skipping a step means
// its fields never land, and half-filled connections (e.g. a Telegram token
// with no chat id) are dropped rather than saved broken.

export type OnboardingChoices = {
  /** step 1 (environment) confirmed — projects dir + default engine apply */
  applySetup: boolean
  projectsDir: string
  /** explicit engine pick; '' = user made no choice, leave settings alone */
  defaultEngine: Engine | ''
  /** step 2 (connections) confirmed — filled fields below apply */
  applyConnections: boolean
  telegramBotToken: string
  telegramChatId: string
  telegramNotify: boolean
  openrouterApiKey: string
}

export function buildOnboardingPatch(c: OnboardingChoices): SettingsPatch {
  const patch: SettingsPatch = { onboarded: true }
  if (c.applySetup) {
    patch.projectsDir = c.projectsDir.trim()
    if (c.defaultEngine) patch.defaultEngine = c.defaultEngine
  }
  if (c.applyConnections) {
    const botToken = c.telegramBotToken.trim()
    const chatId = c.telegramChatId.trim()
    if (botToken && chatId) patch.telegram = { botToken, chatId, notify: c.telegramNotify }
    const key = c.openrouterApiKey.trim()
    if (key) patch.openrouterApiKey = key
  }
  return patch
}
