import { describe, expect, test } from 'bun:test'
import { expandSecretPaths, SECRET_PATTERNS } from './secret-paths'

// Sealing and masking BOTH walk these. A path the expander misses is a secret
// written to disk in cleartext, or shipped to the renderer unmasked — so the
// interesting cases are the ones where the pattern doesn't cleanly apply.
describe('expandSecretPaths', () => {
  test('a fixed path resolves when its parent exists', () => {
    expect(expandSecretPaths({ telegram: { botToken: 't' } }, [['telegram', 'botToken']])).toEqual([
      ['telegram', 'botToken'],
    ])
  })

  test('the leaf need not exist — an UNSET secret is still a valid path', () => {
    // Callers guard on `leaf in parent`; returning the path lets them decide.
    expect(expandSecretPaths({ telegram: {} }, [['telegram', 'botToken']])).toEqual([
      ['telegram', 'botToken'],
    ])
  })

  test('a fixed path survives a missing parent, so masking can report "not set"', () => {
    // Dropping it would leave a hole in secretsSet, and the Settings UI reads
    // that map to decide "configured" vs "not configured".
    expect(expandSecretPaths({}, [['telegram', 'botToken']])).toEqual([['telegram', 'botToken']])
    expect(expandSecretPaths({ telegram: 'oops' }, [['telegram', 'botToken']])).toEqual([
      ['telegram', 'botToken'],
    ])
  })

  test('a wildcard expands over every array index', () => {
    const root = { alerts: { webhooks: [{ url: 'a' }, { url: 'b' }, { url: 'c' }] } }
    expect(expandSecretPaths(root, [['alerts', 'webhooks', '*', 'url']])).toEqual([
      ['alerts', 'webhooks', '0', 'url'],
      ['alerts', 'webhooks', '1', 'url'],
      ['alerts', 'webhooks', '2', 'url'],
    ])
  })

  test('an empty list expands to nothing', () => {
    expect(
      expandSecretPaths({ alerts: { webhooks: [] } }, [['alerts', 'webhooks', '*', 'url']]),
    ).toEqual([])
  })

  test('a non-array where a wildcard expects one is skipped, not thrown on', () => {
    // A hand-edited settings.json is the normal source of this.
    for (const webhooks of [undefined, 'nope', 42, { url: 'x' }]) {
      expect(
        expandSecretPaths({ alerts: { webhooks } }, [['alerts', 'webhooks', '*', 'url']]),
      ).toEqual([])
    }
  })

  test('a junk entry still gets a slot — consumers guard on the parent', () => {
    // The index exists, so the path is real; both consumers check the parent is
    // an object before reading or writing, and report it as "not set".
    const root = { alerts: { webhooks: [null, { url: 'b' }] } }
    expect(expandSecretPaths(root, [['alerts', 'webhooks', '*', 'url']])).toEqual([
      ['alerts', 'webhooks', '0', 'url'],
      ['alerts', 'webhooks', '1', 'url'],
    ])
  })

  test('the shipped patterns cover the webhook list', () => {
    const paths = expandSecretPaths({
      telegram: { botToken: 't', chatId: 'c' },
      alerts: { webhooks: [{ url: 'a' }, { url: 'b' }] },
      openrouterApiKey: 'k',
    })
    expect(paths.map((p) => p.join('.'))).toEqual([
      'telegram.botToken',
      'telegram.chatId',
      'alerts.webhooks.0.url',
      'alerts.webhooks.1.url',
      'openrouterApiKey',
      'openaiCompatApiKey',
    ])
  })

  test('the pattern list still names every secret', () => {
    expect(SECRET_PATTERNS.length).toBe(5)
  })
})
