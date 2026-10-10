// In-memory Fs fake for scan tests. Directories are implied by the file paths
// (or declared with `dir: true`); every call is recorded so tests can assert
// which paths were never touched.

import type { Fs } from '../hooks/scan'

export type Op = 'read' | 'list' | 'stat'
export type FakeNode =
  | string
  | { text?: string; dir?: boolean; mtimeMs?: number; realPath?: string; fails?: Op[] }
export type Call = { op: Op; path: string }
export type FakeFs = Fs & { calls: Call[] }

type Node = { kind: 'file' | 'dir'; text: string | null; mtimeMs: number; realPath?: string; fails: Op[] }

const parentOf = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/'

export function fakeFs(tree: Record<string, FakeNode>): FakeFs {
  const nodes = new Map<string, Node>()
  for (const [path, raw] of Object.entries(tree)) {
    const n = typeof raw === 'string' ? { text: raw } : raw
    nodes.set(path, {
      kind: n.dir ? 'dir' : 'file',
      text: n.dir ? null : n.text ?? '',
      mtimeMs: n.mtimeMs ?? 0,
      realPath: n.realPath,
      fails: n.fails ?? [],
    })
    for (let p = parentOf(path); p !== '/' && !nodes.has(p); p = parentOf(p)) {
      nodes.set(p, { kind: 'dir', text: null, mtimeMs: 0, fails: [] })
    }
  }
  const calls: Call[] = []
  const enter = (op: Op, path: string) => {
    calls.push({ op, path })
    const node = nodes.get(path)
    if (node?.fails.includes(op)) throw new Error('EIO: ' + op + ' ' + path)
    return node
  }
  return {
    calls,
    async read(path) {
      const node = enter('read', path)
      if (!node || node.kind !== 'file') throw new Error('ENOENT: ' + path)
      return node.text ?? ''
    },
    async list(path) {
      const node = enter('list', path)
      if (!node || node.kind !== 'dir') throw new Error('ENOTDIR: ' + path)
      return [...nodes.entries()]
        .filter(([p]) => parentOf(p) === path && p !== path)
        .map(([p, n]) => ({ name: p.slice(path.length + 1), kind: n.kind, mtimeMs: n.mtimeMs }))
    },
    async stat(path) {
      const node = enter('stat', path)
      if (!node) return null
      return node.realPath === undefined
        ? { kind: node.kind, mtimeMs: node.mtimeMs }
        : { kind: node.kind, mtimeMs: node.mtimeMs, realPath: node.realPath }
    },
  }
}
