import { test, expect, describe } from 'bun:test'
import {
  migrate,
  defaultSettings,
  defaultDaemonSettings,
  worktreesFrom,
  sealSettingsForDisk,
  openSettingsFromDisk,
  mergeSettingsPatch,
  classifyProjectsDir,
  resolveEngineModel,
  resolveTelegramCreds,
  telegramSidecarPayload,
} from './settings'

describe('migrate', () => {
  test('empty / garbage → defaults', () => {
    expect(migrate(undefined)).toEqual(defaultSettings())
    expect(migrate(null)).toEqual(defaultSettings())
    expect(migrate('nope')).toEqual(defaultSettings())
    expect(migrate(42)).toEqual(defaultSettings())
  })

  test('legacy flat booleans → nested telegram', () => {
    const s = migrate({ telegram: true, telegramControl: true })
    expect(s.telegram.notify).toBe(true)
    expect(s.telegram.control).toBe(true)
    expect(s.telegram.botToken).toBe('') // filled from defaults
    expect(s.onboarded).toBe(false)
  })

  test('legacy false booleans preserved', () => {
    const s = migrate({ telegram: false, telegramControl: false })
    expect(s.telegram.notify).toBe(false)
    expect(s.telegram.control).toBe(false)
  })

  test('new nested telegram round-trips', () => {
    const s = migrate({
      onboarded: true,
      telegram: { notify: true, control: false, botToken: 'abc:123', chatId: '999' },
    })
    expect(s.onboarded).toBe(true)
    expect(s.telegram).toEqual({ notify: true, control: false, botToken: 'abc:123', chatId: '999' })
  })

  test('inbox completion hook defaults on and can be disabled', () => {
    expect(migrate({}).inbox.completionHook).toBe(true)
    expect(migrate({ inbox: { completionHook: false } }).inbox.completionHook).toBe(false)
    expect(migrate({}).inbox.agentContextPreamble).toBe(true)
    expect(migrate({ inbox: { agentContextPreamble: false } }).inbox.agentContextPreamble).toBe(
      false,
    )
  })

  test('appearance defaults to dark and accepts light/system modes', () => {
    expect(migrate({}).appearance).toEqual({
      mode: 'dark',
      theme: 'terminal',
      accent: '',
      uiScale: 1,
      tabLayout: 'horizontal',
    })
    expect(
      migrate({
        appearance: {
          mode: 'light',
          theme: 'terminal',
          accent: '#0ea5e9',
          uiScale: 1.15,
          tabLayout: 'sidebar',
        },
      }).appearance,
    ).toEqual({
      mode: 'light',
      theme: 'terminal',
      accent: '#0ea5e9',
      uiScale: 1.15,
      tabLayout: 'sidebar',
    })
    expect(migrate({ appearance: { mode: 'system' } }).appearance.mode).toBe('system')
  })

  test('engines + scalars', () => {
    const s = migrate({
      projectsDir: '/p',
      worktreesDir: '/w',
      defaultEngine: 'claude',
      forge: 'github',
      harnessDir: '/h',
      templateRepo: 'https://x/y',
      engines: {
        codex: { path: '/bin/codex' },
        claude: { path: '' },
        cursor: { path: '/bin/cursor-agent' },
      },
      remoteHosts: [
        {
          id: 'tm',
          label: 'Remote Desktop',
          sshTarget: 'tm',
          defaultCwd: '~/work',
          platform: 'linux',
          daemon: {
            projectsDir: '~/src',
            engines: { claude: { path: '~/.local/bin/claude', defaultModel: 'sonnet' } },
            defaultEngine: 'cursor',
            forge: 'gitlab',
          },
        },
        { id: '../../bad', sshTarget: 'bad host' },
        { id: 'no-target' },
      ],
    })
    expect(s.projectsDir).toBe('/p')
    expect(s.worktreesDir).toBe('/w')
    expect(s.defaultEngine).toBe('claude')
    expect(s.forge).toBe('github')
    expect(s.harnessDir).toBe('/h')
    expect(s.templateRepo).toBe('https://x/y')
    expect(s.engines.codex.path).toBe('/bin/codex')
    expect(s.engines.cursor.path).toBe('/bin/cursor-agent')
    expect(s.remoteHosts).toEqual([
      {
        id: 'tm',
        label: 'Remote Desktop',
        sshTarget: 'tm',
        defaultCwd: '~/work',
        platform: 'linux',
        daemon: {
          ...defaultDaemonSettings(),
          projectsDir: '~/src',
          defaultEngine: 'cursor',
          forge: 'gitlab',
          engines: {
            ...defaultDaemonSettings().engines,
            claude: { path: '~/.local/bin/claude', defaultModel: 'sonnet' },
          },
        },
      },
      {
        id: '..-..-bad',
        label: '..-..-bad',
        sshTarget: 'bad host',
        defaultCwd: '',
        platform: 'auto',
        daemon: defaultDaemonSettings(),
      },
    ])
  })

  test('invalid enum values fall back to defaults', () => {
    const s = migrate({ defaultEngine: 'gpt', forge: 'bitbucket', appearance: { mode: 'sepia' } })
    expect(s.defaultEngine).toBe('codex') // codex is the default agent-run engine; claude stays selectable
    expect(s.forge).toBe('auto')
    expect(s.appearance.mode).toBe('dark')
  })

  test('wrong-typed fields are ignored, not coerced', () => {
    const s = migrate({ projectsDir: 123, onboarded: 'yes', engines: { codex: { path: 5 } } })
    expect(s.projectsDir).toBe('')
    expect(s.onboarded).toBe(false)
    expect(s.engines.codex.path).toBe('')
  })
})

describe('worktreesFrom', () => {
  test('explicit value wins', () => {
    expect(worktreesFrom('/custom/wt', '/projects')).toBe('/custom/wt')
  })
  test('falls back to <projects>/.worktrees', () => {
    expect(worktreesFrom('', '/projects')).toBe('/projects/.worktrees')
  })
})

describe('settings secrets', () => {
  const adapter = {
    seal: (value: string) => Buffer.from(`sealed:${value}`).toString('base64'),
    open: (payload: string) =>
      Buffer.from(payload, 'base64')
        .toString('utf8')
        .replace(/^sealed:/, ''),
  }

  test('seals and opens configured secret fields', () => {
    const settings = migrate({
      telegram: { notify: true, control: true, botToken: 'bot-secret', chatId: 'chat-secret' },
      projectsDir: '/projects',
    })
    const sealed = sealSettingsForDisk(settings, adapter)
    const json = JSON.stringify(sealed)
    expect(json).not.toContain('bot-secret')
    expect(json).not.toContain('chat-secret')

    const opened = migrate(openSettingsFromDisk(sealed, adapter))
    expect(opened.telegram.botToken).toBe('bot-secret')
    expect(opened.telegram.chatId).toBe('chat-secret')
    expect(opened.projectsDir).toBe('/projects')
  })

  test('omits secrets (no cleartext) when OS encryption is unavailable', () => {
    const noEncrypt = { ...adapter, canEncrypt: () => false }
    const settings = migrate({
      telegram: { notify: true, control: true, botToken: 'bot-secret', chatId: 'chat-secret' },
      openrouterApiKey: 'sk-or-v1-secret',
      projectsDir: '/projects',
    })
    const sealed = sealSettingsForDisk(settings, noEncrypt) as any
    const json = JSON.stringify(sealed)
    // The token must NOT be written in cleartext…
    expect(json).not.toContain('bot-secret')
    expect(json).not.toContain('chat-secret')
    expect(json).not.toContain('sk-or-v1-secret')
    // …and since we can't seal it, the keys are dropped, not left plaintext.
    expect(sealed.telegram.botToken).toBeUndefined()
    expect(sealed.openrouterApiKey).toBeUndefined()
    // Non-secret settings still persist.
    expect(sealed.projectsDir).toBe('/projects')
  })

  test('openrouter api key is sealed on disk and opens back', () => {
    const settings = migrate({ openrouterApiKey: 'sk-or-v1-supersecret', projectsDir: '/p' })
    const sealed = sealSettingsForDisk(settings, adapter)
    expect(JSON.stringify(sealed)).not.toContain('sk-or-v1-supersecret')
    const opened = migrate(openSettingsFromDisk(sealed, adapter))
    expect(opened.openrouterApiKey).toBe('sk-or-v1-supersecret')
  })

  test('legacy plaintext and empty secrets pass through', () => {
    const opened = migrate(
      openSettingsFromDisk(
        {
          telegram: { botToken: 'plain-token', chatId: '' },
        },
        adapter,
      ),
    )
    expect(opened.telegram.botToken).toBe('plain-token')
    expect(opened.telegram.chatId).toBe('')
    const sealed = sealSettingsForDisk(opened, adapter) as any
    expect(sealed.telegram.chatId).toBe('')
  })

  test('partial nested patches preserve sibling secret fields', () => {
    const cur = migrate({
      telegram: { notify: false, control: false, botToken: 'bot', chatId: 'chat' },
    })
    const next = mergeSettingsPatch(cur, { telegram: { notify: true } })
    expect(next.telegram).toEqual({ notify: true, control: false, botToken: 'bot', chatId: 'chat' })
  })

  test('legacy third-party model settings are ignored on migrate and patch', () => {
    const removedKey = 'open' + 'router'
    const cur = migrate({ [removedKey]: { apiKey: 'or-secret', defaultModel: 'model-a' } })
    expect((cur as any)[removedKey]).toBeUndefined()
    const next = mergeSettingsPatch(cur, { [removedKey]: { apiKey: 'still-nope' } } as any)
    expect((next as any)[removedKey]).toBeUndefined()
  })
})

describe('telegram creds sidecar (out-of-process delivery)', () => {
  const creds = { botToken: 'bot:123', chatId: '999' }

  test('sidecar wins over settings.json', () => {
    expect(resolveTelegramCreds(creds, { botToken: 'stale', chatId: 'stale' })).toEqual(creds)
  })

  test('falls back to a plaintext settings.json telegram block', () => {
    expect(resolveTelegramCreds(null, creds)).toEqual(creds)
  })

  test('a sealed {__terminalSecret} object is NOT a usable token', () => {
    // This is the core bug: out-of-process filers must skip the sealed object
    // rather than send it as a broken request. Both sources sealed → null.
    const sealed = { __terminalSecret: 'terminal-secret:v1', payload: 'abc' }
    expect(resolveTelegramCreds(null, { botToken: sealed, chatId: sealed })).toBeNull()
  })

  test('missing / partial creds resolve to null', () => {
    expect(resolveTelegramCreds(null, null)).toBeNull()
    expect(resolveTelegramCreds(undefined, undefined)).toBeNull()
    expect(resolveTelegramCreds({ botToken: 'x', chatId: '' }, null)).toBeNull()
    expect(resolveTelegramCreds({ botToken: '', chatId: 'y' }, null)).toBeNull()
    // a half-filled sidecar does NOT block the fully-configured settings source
    expect(resolveTelegramCreds({ botToken: 'x', chatId: '' }, creds)).toEqual(creds)
  })

  test('telegramSidecarPayload mirrors only when both fields are set', () => {
    const both = migrate({ telegram: { botToken: 'bot:1', chatId: '2' } })
    expect(telegramSidecarPayload(both)).toEqual({ botToken: 'bot:1', chatId: '2' })
    expect(telegramSidecarPayload(migrate({ telegram: { botToken: 'bot:1' } }))).toBeNull()
    expect(telegramSidecarPayload(defaultSettings())).toBeNull()
  })
})

describe('classifyProjectsDir', () => {
  test('blank path is valid', () => {
    expect(classifyProjectsDir('   ', () => true)).toEqual({ ok: true, dir: '' })
  })

  test('valid parent trims whitespace', () => {
    expect(classifyProjectsDir(' /projects ', () => false)).toEqual({ ok: true, dir: '/projects' })
  })

  test('repo path suggests parent', () => {
    const result = classifyProjectsDir('/projects/repo', (d) => d === '/projects/repo')
    expect(result).toMatchObject({ ok: false, reason: 'is-repo', suggestedParent: '/projects' })
  })
})

describe('resolveEngineModel', () => {
  test('explicit model wins over daemon default', () => {
    const daemon = defaultDaemonSettings()
    daemon.engines.codex.defaultModel = 'gpt-5'
    expect(resolveEngineModel('codex', 'gpt-5-codex', daemon)).toBe('gpt-5-codex')
  })

  test('falls back to daemon default or empty string', () => {
    const daemon = defaultDaemonSettings()
    daemon.engines.claude.defaultModel = 'sonnet'
    expect(resolveEngineModel('claude', undefined, daemon)).toBe('sonnet')
    expect(resolveEngineModel('cursor', undefined, daemon)).toBe('')
  })
})
