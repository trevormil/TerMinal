import type { MrListResult } from '../../lib/types'

export function openMrsView(
  data: MrListResult,
): { error: string } | { count: number; limited: boolean } {
  if (data.error) return { error: data.error }
  return {
    count: data.mrs.filter((mr) => mr.state === 'opened').length,
    limited: data.mrs.length >= 100,
  }
}
