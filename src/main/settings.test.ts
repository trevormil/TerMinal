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
  countGitReposOneLevel,
  pickDensestRoot,
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

  test('repo extensions are OFF by default and survive migration when opted in', () => {
    // Fail-closed default: a settings file that predates the flag (or garbage)
    // must NOT grant repo widgets/tabs code execution.
    expect(defaultSettings().allowRepoExtensions).toBe(false)
    expect(migrate({}).allowRepoExtensions).toBe(false)
    expect(migrate({ allowRepoExtensions: 'yes' }).allowRepoExtensions).toBe(false)
    expect(migrate({ allowRepoExtensions: true }).allowRepoExtensions).toBe(true)
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

  test('inbox notifyThreshold defaults to urgent and survives migration', () => {
    expect(migrate({}).inbox.notifyThreshold).toBe('urgent')
    expect(migrate({ inbox: { notifyThreshold: 'normal' } }).inbox.notifyThreshold).toBe('normal')
    expect(migrate({ inbox: { notifyThreshold: 'low' } }).inbox.notifyThreshold).toBe('low')
    // garbage falls back to the default rather than persisting
    expect(migrate({ inbox: { notifyThreshold: 'bogus' } }).inbox.notifyThreshold).toBe('urgent')
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
            claude: {
              path: '~/.local/bin/claude',
              defaultModel: 'sonnet',
              defaultEffort: '',
              baseUrl: '',
            },
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

  test('openai-compat api key is sealed on disk (never cleartext) and opens back', () => {
    const settings = migrate({ openaiCompatApiKey: 'sk-local-supersecret', projectsDir: '/p' })
    const sealed = sealSettingsForDisk(settings, adapter)
    expect(JSON.stringify(sealed)).not.toContain('sk-local-supersecret')
    const opened = migrate(openSettingsFromDisk(sealed, adapter))
    expect(opened.openaiCompatApiKey).toBe('sk-local-supersecret')
    // No encryption available → dropped from disk, not written plaintext.
    const dropped = sealSettingsForDisk(settings, { ...adapter, canEncrypt: () => false }) as {
      openaiCompatApiKey?: string
    }
    expect(dropped.openaiCompatApiKey).toBeUndefined()
  })

  test('openai-compat base url round-trips through engines settings', () => {
    const s = migrate({
      engines: { 'openai-compat': { baseUrl: 'http://10.0.0.5:8000/v1 ', defaultModel: 'qwen3' } },
    })
    expect(s.engines['openai-compat'].baseUrl).toBe('http://10.0.0.5:8000/v1')
    expect(s.engines['openai-compat'].defaultModel).toBe('qwen3')
    // Absent on old settings files → defaults, no crash.
    const legacy = migrate({ engines: { codex: { path: '/bin/codex' } } })
    expect(legacy.engines['openai-compat']).toEqual({
      path: '',
      defaultModel: '',
      defaultEffort: '',
      baseUrl: '',
    })
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

  test('an invalid bridge port in a patch keeps the current value', () => {
    const cur = migrate({ bridge: { enabled: true, port: 9123 } })
    for (const bad of [80, 0, -1, 65536, 1.5, NaN, 'nope']) {
      const next = mergeSettingsPatch(cur, { bridge: { port: bad } } as any)
      expect(next.bridge).toEqual({ enabled: true, port: 9123 })
    }
    // A valid port still applies, and preserves siblings.
    expect(mergeSettingsPatch(cur, { bridge: { port: 9200 } }).bridge).toEqual({
      enabled: true,
      port: 9200,
    })
  })

  test('legacy third-party model settings are ignored on migrate and patch', () => {
    const removedKey = 'open' + 'router'
    const cur = migrate({ [removedKey]: { apiKey: 'or-secret', defaultModel: 'model-a' } })
    expect((cur as any)[removedKey]).toBeUndefined()
    const next = mergeSettingsPatch(cur, { [removedKey]: { apiKey: 'still-nope' } } as any)
    expect((next as any)[removedKey]).toBeUndefined()
  })
})

describe('alert channels (alerts)', () => {
  const adapter = {
    seal: (value: string) => Buffer.from(`sealed:${value}`).toString('base64'),
    open: (payload: string) =>
      Buffer.from(payload, 'base64')
        .toString('utf8')
        .replace(/^sealed:/, ''),
  }

  test('defaults: desktop on (matches historical behavior), no webhooks', () => {
    expect(defaultSettings().alerts).toEqual({ desktop: { enabled: true }, webhooks: [] })
    expect(migrate({}).alerts).toEqual(defaultSettings().alerts)
  })

  test('migrate round-trips a configured alerts block', () => {
    const s = migrate({
      alerts: {
        desktop: { enabled: false },
        webhooks: [{ id: 'a', name: 'Slack', url: 'https://x/h', enabled: true }],
      },
    })
    expect(s.alerts).toEqual({
      desktop: { enabled: false },
      webhooks: [{ id: 'a', name: 'Slack', url: 'https://x/h', enabled: true }],
    })
  })

  test('wrong-typed alerts fields are ignored, not coerced', () => {
    const s = migrate({ alerts: { desktop: { enabled: 'yes' }, webhooks: 'nope' } })
    expect(s.alerts).toEqual(defaultSettings().alerts)
  })

  test('a url-less entry survives — it is a row the user just added', () => {
    // Dropping it would delete the row the moment the name field blurs, before
    // the URL is pasted in.
    const s = migrate({ alerts: { webhooks: [{ id: 'a', name: 'New', url: '' }] } })
    expect(s.alerts.webhooks).toEqual([{ id: 'a', name: 'New', url: '', enabled: false }])
  })

  test('clearing a url is an explicit empty string, not a restore', () => {
    // The Clear button saves ''. If that were treated like "absent", clearing a
    // webhook URL would silently put the old credential back.
    const cur = migrate({
      alerts: { webhooks: [{ id: 'a', name: 'Slack', url: 'https://x/h', enabled: true }] },
    })
    const next = mergeSettingsPatch(cur, {
      alerts: { webhooks: [{ id: 'a', name: 'Slack', url: '', enabled: true }] },
    })
    expect(next.alerts.webhooks[0].url).toBe('')
  })

  test('a junk entry is dropped, the good ones around it survive', () => {
    const s = migrate({
      alerts: {
        webhooks: [
          null,
          { id: 'a', name: 'Slack', url: 'https://x/h', enabled: true },
          { url: 42 },
          'nope',
        ],
      },
    })
    expect(s.alerts.webhooks.map((w) => w.id)).toEqual(['a'])
  })

  test('an entry with no id gets a stable one, so migrate is idempotent', () => {
    // Ids key the secret paths and the patch merge; a fresh id on every read
    // would orphan the sealed URL.
    const once = migrate({ alerts: { webhooks: [{ name: 'X', url: 'https://x/h' }] } })
    const twice = migrate(once)
    expect(once.alerts.webhooks[0].id).toBe(twice.alerts.webhooks[0].id)
    expect(once.alerts.webhooks[0].id).toBeTruthy()
  })

  test('unknown categories and non-boolean values are dropped from routing', () => {
    const s = migrate({
      alerts: {
        webhooks: [
          {
            id: 'a',
            name: 'X',
            url: 'https://x/h',
            enabled: true,
            categories: { tickets: true, 'not-a-category': true, errors: 'yes' },
          },
        ],
      },
    })
    expect(s.alerts.webhooks[0].categories).toEqual({ tickets: true })
  })

  // The pre-multi-webhook shape, still on every existing install's disk.
  describe('legacy single webhook', () => {
    test('a configured one becomes the first entry in the list', () => {
      const s = migrate({ alerts: { webhook: { enabled: true, url: 'https://x/h' } } })
      expect(s.alerts.webhooks).toEqual([
        { id: 'default', name: 'Webhook', url: 'https://x/h', enabled: true },
      ])
    })

    test('a disabled-but-configured one is carried over, still disabled', () => {
      // Otherwise turning it back on means re-pasting a URL the user already saved.
      const s = migrate({ alerts: { webhook: { enabled: false, url: 'https://x/h' } } })
      expect(s.alerts.webhooks).toEqual([
        { id: 'default', name: 'Webhook', url: 'https://x/h', enabled: false },
      ])
    })

    test('an empty one migrates to no webhooks at all', () => {
      expect(migrate({ alerts: { webhook: { enabled: false, url: '' } } }).alerts.webhooks).toEqual(
        [],
      )
    })

    test('the new key wins when both are present', () => {
      const s = migrate({
        alerts: {
          webhook: { enabled: true, url: 'https://legacy/h' },
          webhooks: [{ id: 'a', name: 'New', url: 'https://new/h', enabled: true }],
        },
      })
      expect(s.alerts.webhooks.map((w) => w.url)).toEqual(['https://new/h'])
    })
  })

  test('every webhook url is sealed on disk and opens back', () => {
    const settings = migrate({
      alerts: {
        webhooks: [
          { id: 'a', name: 'Slack', url: 'https://hooks.slack.com/services/SECRET', enabled: true },
          {
            id: 'b',
            name: 'Discord',
            url: 'https://discord.com/api/webhooks/OTHER',
            enabled: true,
          },
        ],
      },
    })
    const sealed = sealSettingsForDisk(settings, adapter)
    expect(JSON.stringify(sealed)).not.toContain('hooks.slack.com')
    expect(JSON.stringify(sealed)).not.toContain('discord.com')
    const opened = migrate(openSettingsFromDisk(sealed, adapter))
    expect(opened.alerts.webhooks.map((w) => w.url)).toEqual([
      'https://hooks.slack.com/services/SECRET',
      'https://discord.com/api/webhooks/OTHER',
    ])
  })

  test('partial alerts patches preserve sibling channels', () => {
    const cur = migrate({
      alerts: {
        desktop: { enabled: false },
        webhooks: [{ id: 'a', name: 'Slack', url: 'https://x/h', enabled: true }],
      },
    })
    const next = mergeSettingsPatch(cur, { alerts: { desktop: { enabled: true } } })
    expect(next.alerts.desktop.enabled).toBe(true)
    expect(next.alerts.webhooks).toEqual(cur.alerts.webhooks)
  })

  test('a patched entry that omits its url keeps the saved one', () => {
    // The Settings UI is handed masked secrets, and stripMaskedSecrets removes
    // the mask before saving — so an untouched entry arrives with NO url. A
    // wholesale array replace would wipe a working webhook on every unrelated
    // edit (renaming another one, toggling a category).
    const cur = migrate({
      alerts: { webhooks: [{ id: 'a', name: 'Slack', url: 'https://x/h', enabled: true }] },
    })
    const next = mergeSettingsPatch(cur, {
      alerts: { webhooks: [{ id: 'a', name: 'Renamed', enabled: false }] },
    })
    expect(next.alerts.webhooks).toEqual([
      { id: 'a', name: 'Renamed', url: 'https://x/h', enabled: false },
    ])
  })

  test('the webhook list is replaced wholesale, so deletes stick', () => {
    const cur = migrate({
      alerts: {
        webhooks: [
          { id: 'a', name: 'Slack', url: 'https://a/h', enabled: true },
          { id: 'b', name: 'Discord', url: 'https://b/h', enabled: true },
        ],
      },
    })
    const next = mergeSettingsPatch(cur, {
      alerts: { webhooks: [{ id: 'b', name: 'Discord', enabled: true }] },
    })
    expect(next.alerts.webhooks.map((w) => w.id)).toEqual(['b'])
    expect(next.alerts.webhooks[0].url).toBe('https://b/h')
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

// A pure in-memory filesystem: map of dir → child names, and a set of dirs that
// are git repos (contain `.git`). Lets us exercise the discovery rule without fs.
function fakeFs(tree: Record<string, string[]>, repos: string[] = []) {
  const repoSet = new Set(repos)
  return {
    hasGitDir: (d: string) => repoSet.has(d),
    listChildren: (d: string) => {
      const kids = tree[d]
      if (!kids) throw new Error(`ENOENT ${d}`)
      return kids
    },
    resolveHome: () => '/home/me',
    candidateRoots: () => ['/home/me', '/home/me/workspace', '/home/me/code'],
  }
}

describe('countGitReposOneLevel', () => {
  test('counts one-level git children, skips dotfiles', () => {
    const fs = fakeFs({ '/p': ['a', 'b', '.hidden', 'notrepo'] }, ['/p/a', '/p/b', '/p/.hidden'])
    expect(countGitReposOneLevel('/p', fs)).toBe(2)
  })

  test('unreadable dir counts as zero', () => {
    expect(countGitReposOneLevel('/missing', fakeFs({}))).toBe(0)
  })
})

describe('pickDensestRoot', () => {
  test('picks the densest, home wins ties (earliest in list)', () => {
    const counts: Record<string, number> = {
      '/home/me': 3,
      '/home/me/workspace': 3,
      '/home/me/code': 5,
    }
    expect(
      pickDensestRoot(['/home/me', '/home/me/workspace', '/home/me/code'], (d) => counts[d] ?? 0),
    ).toEqual({ root: '/home/me/code', count: 5 })
    expect(pickDensestRoot(['/home/me', '/home/me/workspace'], (d) => counts[d] ?? 0)).toEqual({
      root: '/home/me',
      count: 3,
    })
  })

  test('null when no candidate holds repos', () => {
    expect(pickDensestRoot(['/a', '/b'], () => 0)).toBeNull()
  })
})

describe('classifyProjectsDir', () => {
  test('blank path scans home and reports repo count', () => {
    const fs = fakeFs({ '/home/me': ['x', 'y'] }, ['/home/me/x', '/home/me/y'])
    expect(classifyProjectsDir('   ', fs)).toEqual({ ok: true, dir: '', repoCount: 2 })
  })

  test('valid parent trims whitespace and counts repos', () => {
    const fs = fakeFs({ '/projects': ['repo1'] }, ['/projects/repo1'])
    expect(classifyProjectsDir(' /projects ', fs)).toEqual({
      ok: true,
      dir: '/projects',
      repoCount: 1,
    })
  })

  test('repo path suggests parent (unchanged precedence)', () => {
    const fs = fakeFs({}, ['/projects/repo'])
    const result = classifyProjectsDir('/projects/repo', fs)
    expect(result).toMatchObject({ ok: false, reason: 'is-repo', suggestedParent: '/projects' })
  })

  test('zero repos here but denser sibling → no-repos-found with suggestion', () => {
    const fs = fakeFs(
      {
        '/home/me': ['workspace', 'Downloads'],
        '/home/me/workspace': ['r1', 'r2'],
        '/home/me/code': [],
      },
      ['/home/me/workspace/r1', '/home/me/workspace/r2'],
    )
    const result = classifyProjectsDir('', fs)
    expect(result).toMatchObject({
      ok: false,
      reason: 'no-repos-found',
      suggestedChild: '/home/me/workspace',
      suggestedCount: 2,
    })
  })

  test('zero repos anywhere → no-repos-found without suggestion', () => {
    const fs = fakeFs({ '/home/me': ['Downloads'], '/home/me/workspace': [], '/home/me/code': [] })
    const result = classifyProjectsDir('', fs)
    expect(result).toMatchObject({ ok: false, reason: 'no-repos-found' })
    expect((result as { suggestedChild?: string }).suggestedChild).toBeUndefined()
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
