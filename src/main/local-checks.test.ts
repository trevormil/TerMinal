import { expect, test } from 'bun:test'
import { selectChecks, checkResult, discoverChecks, runLocalCheck } from './local-checks'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('offers existing check scripts before installed binary fallbacks', () => {
  const checks = selectChecks(
    { scripts: { typecheck: 'tsc --noEmit', lint: 'eslint src', dev: 'vite' } },
    ['tsc', 'eslint'],
  )
  expect(checks.map((c) => c.id)).toEqual(['script:typecheck', 'script:lint'])
  expect(checks[0].args).toEqual(['run', 'typecheck'])
  expect(checks[0].detail).toBe('tsc --noEmit')
})
test('never downloads checkers and tolerates malformed manifests', () => {
  expect(selectChecks(null, [])).toEqual([])
  expect(selectChecks({ scripts: { check: 42 } }, ['tsc']).map((c) => c.args)).toEqual([
    ['--noEmit', '--pretty', 'false'],
  ])
  expect(selectChecks({}, ['eslint'])[0].args).toEqual(['.', '--format', 'stylish'])
})
test('result preserves failed exit status, strips colors and bounds display output', () => {
  expect(checkResult(1, '\u001b[31msrc/a.ts(2,1): error TS2322\u001b[0m', '').status).toBe('failed')
  expect(checkResult(0, '', '').summary).toBe('Check passed')
  expect(checkResult(null, '', 'timed out').status).toBe('error')
  expect(checkResult(1, 'x'.repeat(40000), '').output.length).toBeLessThan(33000)
  expect(checkResult(1, '\u001b[31merror\u001b[0m', '').output).toBe('error')
})

test('discovery handles missing repos and checkers, and run revalidates the reviewed plan', async () => {
  const root = mkdtempSync(join(tmpdir(), 'terminal-check-'))
  try {
    expect(discoverChecks('').error).toContain('local git repo')
    expect(discoverChecks(root).error).toContain('No checker')
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ scripts: { check: 'echo checked' } }),
    )
    const plan = discoverChecks(root)
    expect((await runLocalCheck(root, plan, 'script:check')).output).toContain('checked')
    expect((await runLocalCheck(root, plan, 'unknown')).status).toBe('error')
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ scripts: { check: 'echo changed' } }),
    )
    expect((await runLocalCheck(root, plan, 'script:check')).output).toContain('changed. Reopen')
    expect((await runLocalCheck('', plan, 'script:check')).status).toBe('error')
    writeFileSync(join(root, 'package.json'), '{')
    expect(discoverChecks(root).error).toContain('package.json')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('excessive checker output is terminated and reported as incomplete', async () => {
  const root = mkdtempSync(join(tmpdir(), 'terminal-check-limit-'))
  try {
    writeFileSync(join(root, 'large.js'), "process.stdout.write('x'.repeat(600000))")
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ scripts: { check: 'bun large.js' } }),
    )
    const result = await runLocalCheck(root, discoverChecks(root), 'script:check')
    expect(result.status).toBe('error')
    expect(result.output.length).toBeLessThan(33000)
    expect(result.summary).toContain('could not complete')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
