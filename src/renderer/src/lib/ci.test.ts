import { test, expect, describe } from 'bun:test'
import { groupJobsByStage } from './ci'
import type { CiJob } from './types'

const job = (id: number, stage: string, name: string, status = 'success'): CiJob => ({
  id,
  stage,
  name,
  status,
  webUrl: '',
})

describe('groupJobsByStage', () => {
  test('groups jobs under their stage', () => {
    const groups = groupJobsByStage([job(1, 'test', 'unit'), job(2, 'test', 'e2e')])
    expect(groups).toHaveLength(1)
    expect(groups[0].stage).toBe('test')
    expect(groups[0].jobs.map((j) => j.name)).toEqual(['unit', 'e2e'])
  })

  test('orders stages by ascending job id (pipeline run order)', () => {
    const groups = groupJobsByStage([
      job(9, 'deploy', 'k8s'),
      job(1, 'lint', 'prettier'),
      job(5, 'test', 'unit'),
    ])
    expect(groups.map((g) => g.stage)).toEqual(['lint', 'test', 'deploy'])
  })

  test('empty in → empty out', () => {
    expect(groupJobsByStage([])).toEqual([])
  })

  test('does not mutate the input array', () => {
    const input = [job(2, 'a', 'x'), job(1, 'b', 'y')]
    const order = input.map((j) => j.id)
    groupJobsByStage(input)
    expect(input.map((j) => j.id)).toEqual(order)
  })
})
