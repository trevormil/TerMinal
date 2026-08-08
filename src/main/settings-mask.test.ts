import { describe, expect, test } from 'bun:test'
import { SECRET_MASK, maskSettingsSecrets, stripMaskedSecrets } from './settings-mask'

const settings = () => ({
  projectsDir: '/Users/me/Projects',
  openrouterApiKey: 'sk-or-v1-REALKEY',
  openaiCompatApiKey: '',
  telegram: { botToken: '12345:REALTOKEN', chatId: '999', control: true },
  alerts: {
    webhooks: [
      { id: 'a', name: 'Slack', enabled: true, url: 'https://hooks.slack.com/services/REAL' },
      { id: 'b', name: 'Ops', enabled: true, url: 'https://ops.example.com/OTHER' },
    ],
  },
})

describe('maskSettingsSecrets', () => {
  test('no real secret value survives into the renderer payload', () => {
    const masked = maskSettingsSecrets(settings())
    const serialised = JSON.stringify(masked)
    for (const secret of ['sk-or-v1-REALKEY', '12345:REALTOKEN', 'REAL', '999', 'OTHER']) {
      expect(serialised).not.toContain(secret)
    }
  })

  test('masks every path settings.ts seals on disk', () => {
    const masked = maskSettingsSecrets(settings())
    expect(masked.openrouterApiKey).toBe(SECRET_MASK)
    expect(masked.telegram.botToken).toBe(SECRET_MASK)
    expect(masked.telegram.chatId).toBe(SECRET_MASK)
    // EVERY webhook in the list, not just the first — the wildcard path has to
    // expand against the real array.
    expect(masked.alerts.webhooks.map((w) => w.url)).toEqual([SECRET_MASK, SECRET_MASK])
  })

  test('an unset secret stays empty so "configured" is still distinguishable', () => {
    const masked = maskSettingsSecrets(settings())
    expect(masked.openaiCompatApiKey).toBe('')
    expect(masked.secretsSet).toMatchObject({
      openrouterApiKey: true,
      openaiCompatApiKey: false,
      'telegram.botToken': true,
      'alerts.webhooks.0.url': true,
      'alerts.webhooks.1.url': true,
    })
  })

  test('non-secret settings and sibling keys pass through untouched', () => {
    const masked = maskSettingsSecrets(settings())
    expect(masked.projectsDir).toBe('/Users/me/Projects')
    expect(masked.telegram.control).toBe(true)
    expect(masked.alerts.webhooks[0].name).toBe('Slack')
    expect(masked.alerts.webhooks[0].enabled).toBe(true)
  })

  test('does not mutate the settings object it was handed', () => {
    const original = settings()
    maskSettingsSecrets(original)
    expect(original.openrouterApiKey).toBe('sk-or-v1-REALKEY')
    expect(original.telegram.botToken).toBe('12345:REALTOKEN')
    // The list is the easy one to alias by reference and clobber in place.
    expect(original.alerts.webhooks[0].url).toBe('https://hooks.slack.com/services/REAL')
  })

  test('an empty webhook list masks nothing and reports nothing', () => {
    const masked = maskSettingsSecrets({ alerts: { webhooks: [] } })
    expect(masked.alerts.webhooks).toEqual([])
    expect(Object.keys(masked.secretsSet).some((k) => k.startsWith('alerts.'))).toBe(false)
  })

  test('tolerates a missing nested branch', () => {
    expect(() => maskSettingsSecrets({ projectsDir: '/x' })).not.toThrow()
    expect(maskSettingsSecrets({ projectsDir: '/x' }).secretsSet['telegram.botToken']).toBe(false)
  })
})

describe('stripMaskedSecrets', () => {
  // The regression this exists for: the renderer now holds masks, so a patch
  // that round-trips them would persist '••••••••' over a real credential.
  test('drops an echoed mask instead of persisting it', () => {
    const patch = stripMaskedSecrets({
      openrouterApiKey: SECRET_MASK,
      telegram: { botToken: SECRET_MASK, control: false },
    })
    expect('openrouterApiKey' in patch).toBe(false)
    expect('botToken' in patch.telegram).toBe(false)
    expect(patch.telegram.control).toBe(false)
  })

  test('a genuine new secret is passed straight through', () => {
    const patch = stripMaskedSecrets({ openrouterApiKey: 'sk-or-v1-NEW' })
    expect(patch.openrouterApiKey).toBe('sk-or-v1-NEW')
  })

  test('clearing a secret with an empty string still works', () => {
    expect(stripMaskedSecrets({ openrouterApiKey: '' }).openrouterApiKey).toBe('')
  })

  // The regression the review caught: the Settings inputs used to bind
  // `defaultValue` to the mask, so the mask was EDITABLE. Typing after it
  // produces '••••••••ghi', which is not SECRET_MASK, so nothing strips it and
  // the real credential is overwritten with garbage. The UI fix is to render an
  // always-empty write-only field (SettingsPanel's SecretInput); this pins the
  // fact that stripMaskedSecrets alone cannot save us from it.
  test('a mask with text appended is NOT stripped — the UI must never emit one', () => {
    const corrupted = `${SECRET_MASK}ghi`
    expect(stripMaskedSecrets({ openrouterApiKey: corrupted }).openrouterApiKey).toBe(corrupted)
  })

  test('an echoed webhook mask is dropped, so the saved url survives the patch', () => {
    // Without this, renaming ONE webhook would overwrite every other one's URL
    // with the mask — mergeWebhooks only restores a url that is ABSENT.
    const patch = stripMaskedSecrets({
      alerts: {
        webhooks: [
          { id: 'a', name: 'Renamed', url: SECRET_MASK },
          { id: 'b', name: 'Ops', url: 'https://ops.example.com/NEW' },
        ],
      },
    })
    expect('url' in patch.alerts.webhooks[0]).toBe(false)
    expect(patch.alerts.webhooks[0].name).toBe('Renamed')
    expect(patch.alerts.webhooks[1].url).toBe('https://ops.example.com/NEW')
  })

  test('a patch with no secrets is returned as-is', () => {
    const patch = { projectsDir: '/x' }
    expect(stripMaskedSecrets(patch)).toBe(patch)
  })
})
