import { describe, expect, it } from 'bun:test'
import { mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  askQuestion,
  deleteRemoteSession,
  imagePath,
  remoteSessionForAgent,
  saveImage,
  currentRemoteSession,
  endRemoteSession,
  isValidRemoteId,
  listRemoteSessions,
  postMessage,
  readMessages,
  readRemoteSession,
  registerRemoteSession,
  takeReplies,
} from './remote-sessions'

const tmp = () => mkdtempSync(join(tmpdir(), 'gt-remote-'))

describe('registration', () => {
  it('registers a session and lists it', () => {
    const dir = tmp()
    const s = registerRemoteSession({ title: 'ship the PR', repo: 'TerMinal' }, dir)
    expect(s.id).toBeTruthy()
    expect(s.status).toBe('working')
    expect(listRemoteSessions(dir).map((x) => x.id)).toEqual([s.id])
  })

  it('supports several sessions at once', () => {
    const dir = tmp()
    registerRemoteSession({ id: 'aaa', title: 'one' }, dir)
    registerRemoteSession({ id: 'bbb', title: 'two' }, dir)
    expect(listRemoteSessions(dir)).toHaveLength(2)
  })

  it('re-registering resumes rather than wiping the conversation', () => {
    const dir = tmp()
    registerRemoteSession({ id: 'aaa', title: 'one' }, dir)
    postMessage('aaa', 'agent', 'progress', [], dir)
    const again = registerRemoteSession({ id: 'aaa' }, dir)
    expect(again.title).toBe('one')
    expect(readMessages('aaa', {}, dir)).toHaveLength(1)
  })

  it('keeps session files owner-only — they carry work context', () => {
    const dir = tmp()
    const s = registerRemoteSession({ title: 'x' }, dir)
    postMessage(s.id, 'agent', 'hello', [], dir)
    expect(statSync(join(dir, `${s.id}.json`)).mode & 0o077).toBe(0)
    expect(statSync(join(dir, `${s.id}.jsonl`)).mode & 0o077).toBe(0)
  })

  it('refuses ids that could escape the directory', () => {
    expect(isValidRemoteId('../../etc/passwd')).toBe(false)
    expect(isValidRemoteId('a/b')).toBe(false)
    expect(isValidRemoteId('')).toBe(false)
    expect(isValidRemoteId('ok-123')).toBe(true)

    const dir = tmp()
    expect(readRemoteSession('../escape', dir)).toBeNull()
    expect(readMessages('../escape', {}, dir)).toEqual([])
  })

  it('deletes a session and its files for good', () => {
    const dir = tmp()
    const s = registerRemoteSession({ title: 'x' }, dir)
    postMessage(s.id, 'agent', 'hello', [], dir)
    saveImage(s.id, Buffer.from('img'), 'png', dir)
    expect(deleteRemoteSession(s.id, dir)).toBe(true)
    expect(readRemoteSession(s.id, dir)).toBeNull()
    expect(listRemoteSessions(dir)).toHaveLength(0)
    // Idempotent + refuses a traversal id.
    expect(deleteRemoteSession(s.id, dir)).toBe(false)
    expect(deleteRemoteSession('../escape', dir)).toBe(false)
  })
})

describe('messages', () => {
  it('records both sides in order', () => {
    const dir = tmp()
    const s = registerRemoteSession({ title: 'x' }, dir)
    postMessage(s.id, 'agent', 'tests green', [], dir)
    postMessage(s.id, 'user', 'merge it', [], dir)
    expect(readMessages(s.id, {}, dir).map((m) => [m.from, m.text])).toEqual([
      ['agent', 'tests green'],
      ['user', 'merge it'],
    ])
  })

  it('paginates with after, so the phone fetches only what is new', () => {
    const dir = tmp()
    const s = registerRemoteSession({ title: 'x' }, dir)
    postMessage(s.id, 'agent', 'one', [], dir)
    postMessage(s.id, 'agent', 'two', [], dir)
    expect(readMessages(s.id, { after: 1 }, dir).map((m) => m.text)).toEqual(['two'])
  })

  it('ignores empty text and unknown sessions', () => {
    const dir = tmp()
    const s = registerRemoteSession({ title: 'x' }, dir)
    expect(postMessage(s.id, 'agent', '   ', [], dir)).toBeNull()
    expect(postMessage('nope', 'agent', 'hi', [], dir)).toBeNull()
    expect(readMessages(s.id, {}, dir)).toHaveLength(0)
  })

  it('survives a torn final line, since the log is appended to live', () => {
    const dir = tmp()
    const s = registerRemoteSession({ title: 'x' }, dir)
    postMessage(s.id, 'agent', 'one', [], dir)
    writeFileSync(join(dir, `${s.id}.jsonl`), readMessagesRaw(dir, s.id) + '{"at":1,"fr')
    expect(readMessages(s.id, {}, dir).map((m) => m.text)).toEqual(['one'])
  })
})

function readMessagesRaw(dir: string, id: string): string {
  return require('node:fs').readFileSync(join(dir, `${id}.jsonl`), 'utf8')
}

describe('ask and reply delivery', () => {
  it('marks the session as awaiting and records the question', () => {
    const dir = tmp()
    const s = registerRemoteSession({ title: 'x' }, dir)
    askQuestion(s.id, 'merge it?', dir)
    const after = readRemoteSession(s.id, dir)!
    expect(after.status).toBe('awaiting')
    expect(after.question).toBe('merge it?')
    expect(readMessages(s.id, {}, dir).at(-1)?.text).toBe('merge it?')
  })

  it('hands over a reply once and only once', () => {
    const dir = tmp()
    const s = registerRemoteSession({ title: 'x' }, dir)
    askQuestion(s.id, 'merge it?', dir)
    postMessage(s.id, 'user', 'yes, squash', [], dir)

    expect(takeReplies(s.id, dir)).toEqual(['yes, squash'])
    // Consumed: a second check must not replay it as if it were new.
    expect(takeReplies(s.id, dir)).toEqual([])
  })

  it('queues a reply sent while the agent is busy', () => {
    const dir = tmp()
    const s = registerRemoteSession({ title: 'x' }, dir)
    // Never asked — you just left a note mid-work.
    postMessage(s.id, 'user', 'also bump the version', [], dir)
    expect(readRemoteSession(s.id, dir)!.status).toBe('working')
    expect(takeReplies(s.id, dir)).toEqual(['also bump the version'])
  })

  it('clears the awaiting state once the reply is collected', () => {
    const dir = tmp()
    const s = registerRemoteSession({ title: 'x' }, dir)
    askQuestion(s.id, 'merge it?', dir)
    postMessage(s.id, 'user', 'yes', [], dir)
    takeReplies(s.id, dir)
    const after = readRemoteSession(s.id, dir)!
    expect(after.status).toBe('working')
    expect(after.question).toBeUndefined()
  })

  it('never hands the agent its own messages back', () => {
    const dir = tmp()
    const s = registerRemoteSession({ title: 'x' }, dir)
    postMessage(s.id, 'agent', 'thinking out loud', [], dir)
    expect(takeReplies(s.id, dir)).toEqual([])
  })

  it('delivers several queued replies in order', () => {
    const dir = tmp()
    const s = registerRemoteSession({ title: 'x' }, dir)
    postMessage(s.id, 'user', 'first', [], dir)
    postMessage(s.id, 'user', 'second', [], dir)
    expect(takeReplies(s.id, dir)).toEqual(['first', 'second'])
  })
})

describe('images', () => {
  it('saves an image and attaches it to a message', () => {
    const dir = tmp()
    const s = registerRemoteSession({ title: 'x' }, dir)
    const name = saveImage(s.id, Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'png', dir)!
    expect(name).toMatch(/\.png$/)
    postMessage(s.id, 'user', 'look at this', [name], dir)
    const msg = readMessages(s.id, {}, dir).at(-1)!
    expect(msg.images).toEqual([name])
    expect(imagePath(s.id, name, dir)).toContain(`${s.id}.files`)
  })

  it('hands the agent an image as a readable path', () => {
    const dir = tmp()
    const s = registerRemoteSession({ title: 'x' }, dir)
    const name = saveImage(s.id, Buffer.from([1, 2, 3]), 'png', dir)!
    postMessage(s.id, 'user', 'this error', [name], dir)
    const delivered = takeReplies(s.id, dir)
    expect(delivered).toHaveLength(1)
    expect(delivered[0]).toContain('this error')
    // The agent gets an absolute path it can Read, not base64.
    expect(delivered[0]).toContain(`[image: `)
    expect(delivered[0]).toContain(`${s.id}.files`)
  })

  it('allows an image-only message', () => {
    const dir = tmp()
    const s = registerRemoteSession({ title: 'x' }, dir)
    const name = saveImage(s.id, Buffer.from([1]), 'jpg', dir)!
    expect(postMessage(s.id, 'user', '', [name], dir)).not.toBeNull()
    expect(readMessages(s.id, {}, dir).at(-1)?.images).toEqual([name])
  })

  it('refuses a traversing image name', () => {
    const dir = tmp()
    const s = registerRemoteSession({ title: 'x' }, dir)
    expect(imagePath(s.id, '../../etc/passwd', dir)).toBeNull()
    expect(imagePath(s.id, 'a/b.png', dir)).toBeNull()
  })

  it('coerces an unknown extension to png rather than trusting it', () => {
    const dir = tmp()
    const s = registerRemoteSession({ title: 'x' }, dir)
    expect(saveImage(s.id, Buffer.from([1]), 'exe', dir)).toMatch(/\.png$/)
  })
})

describe('routing by host agent session id', () => {
  it('finds the exact session an agent registered, even when repo is shared', () => {
    const dir = tmp()
    // Two sessions, same repo/cwd, different host-agent ids.
    registerRemoteSession({ id: 'ra', title: 'A', cwd: '/repo', agentSessionId: 'sess-A' }, dir)
    registerRemoteSession({ id: 'rb', title: 'B', cwd: '/repo', agentSessionId: 'sess-B' }, dir)

    expect(remoteSessionForAgent('sess-A', dir)?.id).toBe('ra')
    expect(remoteSessionForAgent('sess-B', dir)?.id).toBe('rb')
  })

  it('returns null for an unknown or empty agent id', () => {
    const dir = tmp()
    registerRemoteSession({ id: 'ra', agentSessionId: 'sess-A' }, dir)
    expect(remoteSessionForAgent('sess-Z', dir)).toBeNull()
    expect(remoteSessionForAgent('', dir)).toBeNull()
  })

  it('carries the agent session id through a re-register', () => {
    const dir = tmp()
    registerRemoteSession({ id: 'ra', agentSessionId: 'sess-A' }, dir)
    // A later register without the id (e.g. adopting via --id) keeps it.
    registerRemoteSession({ id: 'ra', title: 'renamed' }, dir)
    expect(remoteSessionForAgent('sess-A', dir)?.title).toBe('renamed')
  })
})

describe('listing', () => {
  it('puts sessions waiting on you first', () => {
    const dir = tmp()
    registerRemoteSession({ id: 'busy', title: 'busy' }, dir)
    registerRemoteSession({ id: 'blocked', title: 'blocked' }, dir)
    askQuestion('blocked', 'well?', dir)
    expect(listRemoteSessions(dir)[0].id).toBe('blocked')
  })

  it('current session ignores ended ones', () => {
    const dir = tmp()
    registerRemoteSession({ id: 'old', title: 'old' }, dir)
    endRemoteSession('old', dir)
    expect(currentRemoteSession(dir)).toBeNull()

    registerRemoteSession({ id: 'new', title: 'new' }, dir)
    expect(currentRemoteSession(dir)?.id).toBe('new')
  })

  it('is empty, not throwing, before anything registers', () => {
    expect(listRemoteSessions(join(tmp(), 'nothing-here'))).toEqual([])
  })
})
