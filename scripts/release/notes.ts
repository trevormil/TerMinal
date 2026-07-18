#!/usr/bin/env bun
// Print the release notes for a tag: the CHANGELOG section for that version,
// falling back to the commit subjects since the previous tag. Used by the
// release workflow (`bun scripts/release/notes.ts v0.2.0 > release-notes.md`).
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { extractNotes, commitListNotes } from '../../src/shared/release/versioning'

const tag = process.argv[2]
if (!tag) {
  console.error('usage: bun scripts/release/notes.ts <vX.Y.Z>')
  process.exit(2)
}
const version = tag.replace(/^v/, '')
const changelogPath = new URL('../../CHANGELOG.md', import.meta.url)
const notes = extractNotes(readFileSync(changelogPath, 'utf8'), version)
if (notes) {
  console.log(notes)
} else {
  const git = (cmd: string): string => {
    try {
      return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim()
    } catch {
      return ''
    }
  }
  const prev = git(`git describe --abbrev=0 --tags ${tag}^`)
  const range = prev ? `${prev}..${tag}` : tag
  const subjects = git(`git log --format=%s ${range}`).split('\n').filter(Boolean)
  console.log(commitListNotes(subjects))
}
