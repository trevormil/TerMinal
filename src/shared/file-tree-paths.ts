export const withinTreePath = (path: string, root: string): boolean =>
  path === root || path.startsWith(root + '/')

export const remapTreePath = (path: string, from: string, to: string): string =>
  withinTreePath(path, from) ? to + path.slice(from.length) : path

export const validEntryName = (name: string): boolean =>
  !!name && name !== '.' && name !== '..' && !/[\\/\x00-\x1f]/.test(name)
