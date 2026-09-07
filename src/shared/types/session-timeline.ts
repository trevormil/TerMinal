export type SessionTimelineTurn = {
  line: number
  timestamp?: number
  prompt: string
  response: string
}

export type SessionTimeline = {
  sessionId: string
  turns: SessionTimelineTurn[]
  truncated?: boolean
  error?: string
}
