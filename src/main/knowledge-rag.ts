import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { KnowledgeItem, KnowledgeScope } from './knowledge'

export type KnowledgeRagStatus = {
  ok: boolean
  rootDir: string
  documentsDir: string
  dataDir: string
  command: string
  args: string[]
  stats?: unknown
  error?: string
}

export type KnowledgeRagSearchResult = {
  ok: boolean
  query: string
  rootDir: string
  results: unknown[]
  raw?: unknown
  error?: string
}

type RagRequest = {
  scope: KnowledgeScope
  repoRoot: string
  item: KnowledgeItem
}

type RagAddDocumentRequest = RagRequest & {
  content: string
  filepath?: string
}

type RagAddUrlRequest = RagRequest & {
  url: string
  title?: string
}

type RagSearchRequest = RagRequest & {
  query: string
}

const DEFAULT_COMMAND = 'uvx'
const DEFAULT_ARGS = ['--python', '3.11', 'knowledge-rag==3.9.0']

const slug = (input: string) =>
  input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'rag'

function defaultRootDir(scope: KnowledgeScope, repoRoot: string, item: KnowledgeItem): string {
  const base =
    scope === 'repo' && repoRoot
      ? join(repoRoot, '.TerMinal')
      : join(homedir(), '.config', 'TerMinal')
  return join(
    base,
    'knowledge-rag',
    slug(item.rag?.category || item.title || item.categoryId || item.id),
  )
}

function ragCommand(item: KnowledgeItem): { command: string; args: string[] } {
  return {
    command: item.rag?.command?.trim() || DEFAULT_COMMAND,
    args: item.rag?.args?.length ? item.rag.args : DEFAULT_ARGS,
  }
}

function ragCategory(item: KnowledgeItem): string {
  return slug(item.rag?.category || item.title || item.categoryId || 'general')
}

function yamlString(value: string): string {
  return JSON.stringify(value)
}

function ensureWorkspace(req: RagRequest): {
  rootDir: string
  documentsDir: string
  dataDir: string
  command: string
  args: string[]
  category: string
} {
  const rootDir = req.item.rag?.rootDir?.trim() || defaultRootDir(req.scope, req.repoRoot, req.item)
  const documentsDir = join(rootDir, 'documents')
  const dataDir = join(rootDir, 'data')
  const modelsCacheDir = join(rootDir, 'models_cache')
  mkdirSync(documentsDir, { recursive: true })
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(modelsCacheDir, { recursive: true })
  const category = ragCategory(req.item)
  const configPath = join(rootDir, 'config.yaml')
  if (!existsSync(configPath)) {
    writeFileSync(
      configPath,
      [
        'paths:',
        `  documents_dir: ${yamlString(documentsDir)}`,
        `  data_dir: ${yamlString(dataDir)}`,
        `  models_cache_dir: ${yamlString(modelsCacheDir)}`,
        'documents:',
        '  supported_formats:',
        '    - .md',
        '    - .txt',
        '    - .pdf',
        '    - .docx',
        '    - .py',
        '    - .js',
        '    - .ts',
        '    - .tsx',
        '    - .json',
        '  exclude_patterns:',
        '    - node_modules',
        '    - .git',
        '    - .venv',
        '    - __pycache__',
        'models:',
        '  embedding:',
        '    model: "BAAI/bge-small-en-v1.5"',
        '    dimensions: 384',
        '    gpu: false',
        '  reranker:',
        '    enabled: true',
        '    model: "Xenova/ms-marco-MiniLM-L-6-v2"',
        '    top_k_multiplier: 3',
        'search:',
        '  default_results: 5',
        '  max_results: 20',
        '  collection_name: "knowledge_base"',
        'category_mappings:',
        `  ${yamlString(category)}: ${yamlString(category)}`,
        'keyword_routes: {}',
        'query_expansions: {}',
        '',
      ].join('\n'),
    )
  }
  const { command, args } = ragCommand(req.item)
  return { rootDir, documentsDir, dataDir, command, args, category }
}

async function callRagTool(
  workspace: ReturnType<typeof ensureWorkspace>,
  tool: string,
  args: Record<string, unknown>,
  timeoutMs = 180_000,
): Promise<unknown> {
  const child = spawn(workspace.command, workspace.args, {
    cwd: workspace.rootDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, KNOWLEDGE_RAG_DIR: workspace.rootDir },
  })
  let nextId = 1
  const pending = new Map<number, (msg: any) => void>()
  const stderr: Buffer[] = []
  let stdoutBuffer = ''
  child.stderr.on('data', (d) => stderr.push(Buffer.from(d)))
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += String(chunk)
    const lines = stdoutBuffer.split(/\r?\n/)
    stdoutBuffer = lines.pop() || ''
    for (const line of lines.filter(Boolean)) {
      try {
        const msg = JSON.parse(line)
        if (typeof msg.id === 'number') pending.get(msg.id)?.(msg)
      } catch {
        /* MCP servers may log non-JSON status lines. */
      }
    }
  })
  const send = (method: string, params?: unknown) =>
    new Promise<any>((resolve, reject) => {
      const id = nextId++
      const timer = setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`Knowledge RAG timeout calling ${method}`))
      }, timeoutMs)
      pending.set(id, (msg) => {
        clearTimeout(timer)
        pending.delete(id)
        msg.error
          ? reject(new Error(msg.error.message || 'Knowledge RAG MCP error'))
          : resolve(msg.result)
      })
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  try {
    await send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'TerMinal', version: '1' },
    })
    child.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n',
    )
    const result = await send('tools/call', { name: tool, arguments: args })
    const content = Array.isArray(result?.content) ? result.content : []
    const text = content
      .map((c: any) => (typeof c?.text === 'string' ? c.text : ''))
      .join('\n')
      .trim()
    if (!text) return result
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  } catch (e) {
    const err = Buffer.concat(stderr).toString().trim()
    throw new Error(err || (e as Error).message)
  } finally {
    child.kill()
  }
}

export async function knowledgeRagStatus(req: RagRequest): Promise<KnowledgeRagStatus> {
  const workspace = ensureWorkspace(req)
  try {
    const stats = await callRagTool(workspace, 'get_index_stats', {})
    return {
      ok: true,
      rootDir: workspace.rootDir,
      documentsDir: workspace.documentsDir,
      dataDir: workspace.dataDir,
      command: workspace.command,
      args: workspace.args,
      stats,
    }
  } catch (e) {
    return {
      ok: false,
      rootDir: workspace.rootDir,
      documentsDir: workspace.documentsDir,
      dataDir: workspace.dataDir,
      command: workspace.command,
      args: workspace.args,
      error: (e as Error).message,
    }
  }
}

export async function knowledgeRagReindex(
  req: RagRequest,
  fullRebuild = false,
): Promise<KnowledgeRagStatus> {
  const workspace = ensureWorkspace(req)
  try {
    const stats = await callRagTool(
      workspace,
      'reindex_documents',
      { force: !fullRebuild, full_rebuild: fullRebuild },
      300_000,
    )
    return {
      ok: true,
      rootDir: workspace.rootDir,
      documentsDir: workspace.documentsDir,
      dataDir: workspace.dataDir,
      command: workspace.command,
      args: workspace.args,
      stats,
    }
  } catch (e) {
    return {
      ok: false,
      rootDir: workspace.rootDir,
      documentsDir: workspace.documentsDir,
      dataDir: workspace.dataDir,
      command: workspace.command,
      args: workspace.args,
      error: (e as Error).message,
    }
  }
}

export async function knowledgeRagAddDocument(
  req: RagAddDocumentRequest,
): Promise<KnowledgeRagStatus> {
  const workspace = ensureWorkspace(req)
  const filename =
    req.filepath?.trim() ||
    `${workspace.category}/${slug(req.item.title || 'note')}-${Date.now()}.md`
  try {
    const stats = await callRagTool(
      workspace,
      'add_document',
      { content: req.content, filepath: filename, category: workspace.category },
      300_000,
    )
    return {
      ok: true,
      rootDir: workspace.rootDir,
      documentsDir: workspace.documentsDir,
      dataDir: workspace.dataDir,
      command: workspace.command,
      args: workspace.args,
      stats,
    }
  } catch (e) {
    return {
      ok: false,
      rootDir: workspace.rootDir,
      documentsDir: workspace.documentsDir,
      dataDir: workspace.dataDir,
      command: workspace.command,
      args: workspace.args,
      error: (e as Error).message,
    }
  }
}

export async function knowledgeRagAddUrl(req: RagAddUrlRequest): Promise<KnowledgeRagStatus> {
  const workspace = ensureWorkspace(req)
  try {
    const stats = await callRagTool(
      workspace,
      'add_from_url',
      {
        url: req.url,
        category: workspace.category,
        title: req.title || req.item.title || undefined,
      },
      300_000,
    )
    return {
      ok: true,
      rootDir: workspace.rootDir,
      documentsDir: workspace.documentsDir,
      dataDir: workspace.dataDir,
      command: workspace.command,
      args: workspace.args,
      stats,
    }
  } catch (e) {
    return {
      ok: false,
      rootDir: workspace.rootDir,
      documentsDir: workspace.documentsDir,
      dataDir: workspace.dataDir,
      command: workspace.command,
      args: workspace.args,
      error: (e as Error).message,
    }
  }
}

export async function knowledgeRagSearch(req: RagSearchRequest): Promise<KnowledgeRagSearchResult> {
  const workspace = ensureWorkspace(req)
  try {
    const raw = await callRagTool(workspace, 'search_knowledge', {
      query: req.query,
      max_results: req.item.rag?.maxResults || 5,
      category: workspace.category,
      hybrid_alpha: req.item.rag?.hybridAlpha ?? 0.3,
    })
    const results = Array.isArray((raw as any)?.results) ? (raw as any).results : []
    return { ok: true, query: req.query, rootDir: workspace.rootDir, results, raw }
  } catch (e) {
    return {
      ok: false,
      query: req.query,
      rootDir: workspace.rootDir,
      results: [],
      error: (e as Error).message,
    }
  }
}
