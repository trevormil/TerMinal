import type { KnowledgeBase, KnowledgeItem } from './types'

export const knowledgeSlug = (input: string) =>
  input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item'

export const singleHttpUrl = (text: string) => {
  const trimmed = text.trim()
  if (!/^https?:\/\/\S+$/i.test(trimmed)) return ''
  try {
    const url = new URL(trimmed)
    return url.toString()
  } catch {
    return ''
  }
}

export function appendKnowledgeItem(
  kb: KnowledgeBase,
  item: Omit<KnowledgeItem, 'id' | 'categoryId' | 'createdAt' | 'updatedAt'>,
  categoryInput: { id: string; title: string; description: string },
): KnowledgeBase {
  const ts = Date.now()
  const categoryId = knowledgeSlug(categoryInput.id)
  const categories = [...kb.categories]
  let category = categories.find((c) => c.id === categoryId)
  if (!category) {
    category = {
      id: categoryId,
      title: categoryInput.title,
      description: categoryInput.description,
      order: categories.length,
      createdAt: ts,
      updatedAt: ts,
    }
    categories.push(category)
  }
  const base = knowledgeSlug(item.title || item.kind)
  const seen = new Set(kb.items.map((i) => i.id))
  let id = base
  let n = 2
  while (seen.has(id)) id = `${base}-${n++}`
  return {
    ...kb,
    categories: categories.map((c) => (c.id === category.id ? { ...c, updatedAt: ts } : c)),
    items: [
      {
        ...item,
        id,
        categoryId: category.id,
        createdAt: ts,
        updatedAt: ts,
      },
      ...kb.items,
    ],
  }
}
