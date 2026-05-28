import { test, expect, describe } from 'bun:test'
import { parseRemote } from './repo'

describe('parseRemote', () => {
  test('https URL → host + path, strips .git', () => {
    expect(parseRemote('https://labs.gauntletai.com/trevormiller/agentforge.git')).toEqual({
      host: 'labs.gauntletai.com',
      path: 'trevormiller/agentforge',
    })
  })

  test('https without .git', () => {
    expect(parseRemote('https://github.com/trevormil/gauntlet-terminal')).toEqual({
      host: 'github.com',
      path: 'trevormil/gauntlet-terminal',
    })
  })

  test('scp-like ssh URL', () => {
    expect(parseRemote('git@github.com:owner/repo.git')).toEqual({
      host: 'github.com',
      path: 'owner/repo',
    })
  })

  test('ssh:// URL with nested group path', () => {
    expect(parseRemote('ssh://git@labs.gauntletai.com/group/sub/proj.git')).toEqual({
      host: 'labs.gauntletai.com',
      path: 'group/sub/proj',
    })
  })

  test('https with embedded credentials', () => {
    expect(parseRemote('https://user:token@labs.gauntletai.com/a/b.git')).toEqual({
      host: 'labs.gauntletai.com',
      path: 'a/b',
    })
  })

  test('garbage → null', () => {
    expect(parseRemote('not a url')).toBeNull()
    expect(parseRemote('')).toBeNull()
  })
})
