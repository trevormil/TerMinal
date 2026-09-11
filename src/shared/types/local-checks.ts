export type LocalCheck = { id: string; executable: string; args: string[]; detail: string }
export type LocalCheckPlan = { root: string; checks: LocalCheck[]; error?: string }
export type LocalCheckResult = {
  status: 'passed' | 'failed' | 'error'
  summary: string
  output: string
}
