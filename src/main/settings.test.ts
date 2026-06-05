import { test, expect, describe } from 'bun:test'
import { migrate, defaultSettings, defaultDaemonSettings, worktreesFrom } from './settings'

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
      engines: { codex: { path: '/bin/codex' }, claude: { path: '' }, cursor: { path: '/bin/cursor-agent' } },
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
    expect(s.defaultEngine).toBe('claude') // claude is the required engine; codex is optional
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
