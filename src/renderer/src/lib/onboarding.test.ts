import { describe, expect, test } from 'bun:test'
import { buildOnboardingPatch, type OnboardingChoices } from './onboarding'

const none: OnboardingChoices = {
  applySetup: false,
  projectsDir: '',
  defaultEngine: '',
  applyConnections: false,
  telegramBotToken: '',
  telegramChatId: '',
  telegramNotify: true,
  openrouterApiKey: '',
}

describe('buildOnboardingPatch', () => {
  test('skip-all marks onboarded and touches nothing else', () => {
    expect(buildOnboardingPatch(none)).toEqual({ onboarded: true })
  })

  test('setup applies trimmed projectsDir and the chosen engine', () => {
    expect(
      buildOnboardingPatch({
        ...none,
        applySetup: true,
        projectsDir: '  ~/code ',
        defaultEngine: 'claude',
      }),
    ).toEqual({ onboarded: true, projectsDir: '~/code', defaultEngine: 'claude' })
  })

  test('setup without an engine choice leaves defaultEngine untouched', () => {
    const p = buildOnboardingPatch({ ...none, applySetup: true, projectsDir: '~/code' })
    expect(p).toEqual({ onboarded: true, projectsDir: '~/code' })
    expect('defaultEngine' in p).toBe(false)
  })

  test('skipping connections drops filled connection fields', () => {
    const p = buildOnboardingPatch({
      ...none,
      applySetup: true,
      telegramBotToken: '123:abc',
      telegramChatId: '42',
      openrouterApiKey: 'sk-or-v1-x',
    })
    expect('telegram' in p).toBe(false)
    expect('openrouterApiKey' in p).toBe(false)
  })

  test('telegram needs BOTH token and chat id', () => {
    const half = { ...none, applyConnections: true, telegramBotToken: '123:abc' }
    expect('telegram' in buildOnboardingPatch(half)).toBe(false)
    const both = { ...half, telegramChatId: ' 42 ' }
    expect(buildOnboardingPatch(both).telegram).toEqual({
      botToken: '123:abc',
      chatId: '42',
      notify: true,
    })
  })

  test('telegram notify preference is carried through', () => {
    const p = buildOnboardingPatch({
      ...none,
      applyConnections: true,
      telegramBotToken: '123:abc',
      telegramChatId: '42',
      telegramNotify: false,
    })
    expect(p.telegram?.notify).toBe(false)
  })

  test('openrouter key only lands when non-empty', () => {
    expect(
      buildOnboardingPatch({ ...none, applyConnections: true, openrouterApiKey: ' sk-or-v1-x ' })
        .openrouterApiKey,
    ).toBe('sk-or-v1-x')
    expect('openrouterApiKey' in buildOnboardingPatch({ ...none, applyConnections: true })).toBe(
      false,
    )
  })
})
