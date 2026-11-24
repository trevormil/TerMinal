import type { SessionTimelineTurn } from '../../../shared/types/session-timeline'

export function selectedTimelineTurn(
  turns: SessionTimelineTurn[],
  line: number | null,
): SessionTimelineTurn | undefined {
  return turns.find((turn) => turn.line === line) ?? turns.at(-1)
}
