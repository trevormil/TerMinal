export type ForgeCreateInput = { title: string; body: string; head: string; base: string }
export type ForgeCreateContext = {
  repoRoot: string
  label: 'PR' | 'MR'
  head: string
  base: string
  error?: string
}
export type ForgeCreateResult = { url?: string; error?: string; warning?: string }
