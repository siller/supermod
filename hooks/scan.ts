// ── Search roots, path guard and run discovery ────────────────────────────
// Decides which files the mod may ever look at (spec §5.1, §7). Pure apart
// from the Fs port that register.tsx fills. Every list and read, and every stat
// but two, goes through `guard`: the path must lie inside a search root, match
// one of the allowed shapes below for the access asked for, exist, and its
// realPath must be present and match the same shape inside a search root (a
// symlink out, or an answer without realPath, is refused).
// The two documented exceptions are the raw stats in `resolveRoots`: the
// project root itself (to learn its realPath) and `<main checkout>/.git` (to
// confirm the main checkout is one); both are stat only, never read or listed.
// Paths are POSIX strings; `..` that climbs above `/` is refused.

import { parseLedger, parsePlan } from './progress'
import type { WorkspaceFile } from './progress'

export type FsKind = 'file' | 'dir' | 'other'
export type FsEntry = { name: string; kind: FsKind; mtimeMs: number }
export type FsStat = { kind: FsKind; mtimeMs: number; realPath?: string }
export type Fs = {
  read(path: string): Promise<string>
  list(path: string): Promise<FsEntry[]>
  /**
   * Resolves null when the path is missing. Must be called with resolution on
   * (the engine's `stat(path, { resolve: true })`) so the answer carries
   * `realPath`; an answer without a string `realPath` is treated as leading nowhere.
   */
  stat(path: string): Promise<FsStat | null>
}

export type RunFiles = {
  /** The search root the run was found in. */
  root: string | null
  ledgerPath: string | null
  ledgerText: string | null
  planPath: string | null
  planText: string | null
  specPath: string | null
  specText: string | null
  workspaceDir: string | null
  workspaceFiles: WorkspaceFile[]
  workspaceExists: boolean
}

export type DiscoverOptions = { pinned: string | null; sessionSpec: string | null; now: number; maxAgeMs: number }

const PLAN_HEADINGS_ONLY_ABOVE = 1_048_576
const WORKTREE_FOLDERS = [['.claude', 'worktrees'], ['.worktrees'], ['worktrees']]

// ── Paths ─────────────────────────────────────────────────────────────────

/** Absolute path without `.`, `..`, empty segments or a trailing slash; null when relative or climbing above `/`. */
function normalize(path: string): string | null {
  if (!path.startsWith('/')) return null
  const out: string[] = []
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (out.length === 0) return null
      out.pop()
    } else out.push(seg)
  }
  return '/' + out.join('/')
}

function join(root: string, ...parts: string[]): string {
  return [root, ...parts].join('/')
}

function dirname(path: string): string {
  return path.slice(0, path.lastIndexOf('/')) || '/'
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** A listing name that stays one segment when joined to its folder. */
function isPlainName(name: unknown): name is string {
  return typeof name === 'string' && name !== '' && name !== '.' && name !== '..' && !name.includes('/')
}

/** Normalized absolute roots; `/` is never a root. */
function cleanRoots(roots: string[]): string[] {
  const out: string[] = []
  for (const r of roots) {
    const n = normalize(r)
    if (n !== null && n !== '/' && !out.includes(n)) out.push(n)
  }
  return out
}

function relSegments(path: string, root: string): string[] | null {
  if (path === root) return []
  return path.startsWith(root + '/') ? path.slice(root.length + 1).split('/') : null
}

export function isInsideRoots(realPath: string, roots: string[]): boolean {
  const path = normalize(realPath)
  return path !== null && cleanRoots(roots).some(r => relSegments(path, r) !== null)
}

/**
 * The project root, plus the main checkout when the root is itself a worktree
 * (`…/.claude/worktrees/<n>`, `…/.worktrees/<n>`, `…/worktrees/<n>`; the last such segment wins).
 */
export function searchRoots(projectRoot: string): string[] {
  const root = normalize(projectRoot)
  if (root === null) return []
  const segs = root.split('/').slice(1)
  for (let i = segs.length - 2; i >= 0; i--) {
    let cut = -1
    if (segs[i] === '.worktrees') cut = i
    else if (segs[i] === 'worktrees') cut = i > 0 && segs[i - 1] === '.claude' ? i - 1 : i
    if (cut < 0) continue
    const main = '/' + segs.slice(0, cut).join('/')
    return main === '/' ? [root] : [root, main]
  }
  return [root]
}

/**
 * The search roots for a session: the project root resolved through `stat`
 * (lexical when the stat fails or has no realPath), plus the main checkout from
 * `searchRoots` when `<main>/.git` exists. `/` is never a root.
 */
export async function resolveRoots(fs: Fs, projectRoot: string): Promise<string[]> {
  const lexical = normalize(projectRoot)
  if (lexical === null) return []
  const stat = await attempt(() => fs.stat(lexical), null)
  const real = stat && typeof stat.realPath === 'string' ? normalize(stat.realPath) : null
  const root = real ?? lexical
  if (root === '/') return []
  const main = searchRoots(root)[1]
  if (main === undefined) return [root]
  const git = await attempt(() => fs.stat(join(main, '.git')), null)
  return git ? [root, main] : [root]
}

// ── Allowed shapes and the guard ──────────────────────────────────────────

type Shape = 'plans' | 'specs' | 'sdd' | 'workspace' | 'plan' | 'spec' | 'ledger' | 'marker' | 'worktrees'

/** What a path relative to a root is allowed to be, if anything. */
function shapeOf(s: string[]): Shape | null {
  const docs = s.length >= 3 && s[0] === 'docs' && s[1] === 'superpowers'
  const sdd = s.length >= 2 && s[0] === '.superpowers' && s[1] === 'sdd'
  if (docs && s.length === 3 && s[2] === 'plans') return 'plans'
  if (docs && s.length === 3 && s[2] === 'specs') return 'specs'
  if (docs && s.length === 4 && s[2] === 'plans' && s[3].endsWith('.md') && s[3].length > 3) return 'plan'
  if (docs && s.length === 4 && s[2] === 'specs' && s[3].endsWith('-design.md') && s[3].length > 10) return 'spec'
  if (sdd && s.length === 2) return 'sdd'
  if (sdd && s.length === 3) return 'workspace'
  if (sdd && s.length === 4 && s[3] === 'progress.md') return 'ledger'
  if (sdd && s.length === 4 && s[3] === 'plan-path') return 'marker'
  if (WORKTREE_FOLDERS.some(f => f.length === s.length && f.every((x, i) => x === s[i]))) return 'worktrees'
  return null
}

/** The root under which `path` has `shape`, or null. */
function rootFor(path: string, roots: string[], shape: Shape): string | null {
  for (const r of roots) {
    const s = relSegments(path, r)
    if (s !== null && shapeOf(s) === shape) return r
  }
  return null
}

/** The first root under which `path` has any allowed shape. */
function locate(path: string, roots: string[]): { root: string; shape: Shape } | null {
  for (const r of roots) {
    const s = relSegments(path, r)
    const shape = s === null ? null : shapeOf(s)
    if (shape !== null) return { root: r, shape }
  }
  return null
}

async function attempt<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch {
    return fallback
  }
}

type Guard = { fs: Fs; roots: string[] }
type Admitted = { path: string; root: string; stat: FsStat }

/** The gate to the Fs: shape inside a root, exists, realPath present and of the same shape inside a root. */
async function guard(g: Guard, path: string, shape: Shape): Promise<Admitted | null> {
  const norm = normalize(path)
  if (norm === null) return null
  const root = rootFor(norm, g.roots, shape)
  if (root === null) return null
  const stat = await attempt(() => g.fs.stat(norm), null)
  if (!stat) return null
  if (typeof stat.realPath !== 'string') return null
  const real = normalize(stat.realPath)
  if (real === null || rootFor(real, g.roots, shape) === null) return null
  return { path: norm, root, stat }
}

/** Entries of an admitted folder; null when refused or missing. */
async function listDir(g: Guard, path: string, shape: Shape): Promise<{ path: string; entries: FsEntry[] } | null> {
  const ok = await guard(g, path, shape)
  if (!ok || ok.stat.kind !== 'dir') return null
  const entries = await attempt(() => g.fs.list(ok.path), [] as FsEntry[])
  return { path: ok.path, entries: Array.isArray(entries) ? entries.filter(e => e !== null && typeof e === 'object' && isPlainName(e.name)) : [] }
}

/** Text of an admitted file; null when refused or missing, text null when the read fails. */
async function load(g: Guard, path: string, shape: Shape): Promise<{ path: string; root: string; text: string | null } | null> {
  const ok = await guard(g, path, shape)
  if (!ok || ok.stat.kind !== 'file') return null
  const text = await attempt(() => g.fs.read(ok.path), null)
  return { path: ok.path, root: ok.root, text: typeof text === 'string' ? text : null }
}

// ── Run assembly ──────────────────────────────────────────────────────────

const emptyRun = (): RunFiles => ({
  root: null, ledgerPath: null, ledgerText: null, planPath: null, planText: null,
  specPath: null, specText: null, workspaceDir: null, workspaceFiles: [], workspaceExists: false,
})

const foundAnything = (r: RunFiles) => r.ledgerPath !== null || r.planPath !== null || r.specPath !== null || r.workspaceExists

/** A path from a marker, Spec line or option: absolute as given, relative against `base`. */
function resolveAgainst(base: string, ref: string): string | null {
  return normalize(ref.startsWith('/') ? ref : join(base, ref))
}

/** A plan over 1 MiB keeps only headings, fence lines (so code stays code) and the Spec line. */
function trimPlan(text: string): string {
  if (text.length <= PLAN_HEADINGS_ONLY_ABOVE) return text
  return text
    .split(/\r?\n/)
    .filter(l => l.startsWith('#') || l.startsWith('**Spec:**') || l.trimStart().startsWith('```'))
    .join('\n')
}

async function withPlan(g: Guard, run: RunFiles, planPath: string): Promise<void> {
  const plan = await load(g, planPath, 'plan')
  if (!plan) return
  run.planPath = plan.path
  run.planText = plan.text === null ? null : trimPlan(plan.text)
  if (run.planText === null) return
  const ref = parsePlan(run.planText, basename(plan.path)).specPath
  if (ref === null) return
  // Relative to the plan's folder first (a Markdown link), then to its root.
  for (const base of [dirname(plan.path), plan.root]) {
    const specPath = resolveAgainst(base, ref)
    if (specPath !== null) await withSpec(g, run, specPath)
    if (run.specPath !== null) return
  }
}

async function withSpec(g: Guard, run: RunFiles, specPath: string): Promise<void> {
  const spec = await load(g, specPath, 'spec')
  if (!spec) return
  run.specPath = spec.path
  run.specText = spec.text
}

async function withWorkspace(g: Guard, run: RunFiles, dir: string): Promise<void> {
  const ws = await listDir(g, dir, 'workspace')
  if (!ws) return
  run.workspaceDir = ws.path
  run.workspaceExists = true
  run.workspaceFiles = ws.entries.filter(e => e.kind === 'file').map(e => ({ name: e.name, mtimeMs: e.mtimeMs }))
  const ledger = await load(g, join(ws.path, 'progress.md'), 'ledger')
  if (ledger) {
    run.ledgerPath = ledger.path
    run.ledgerText = ledger.text
  }
}

/** Ledger, marker, plan and spec of one workspace; the marker names the plan, the ledger header is the fallback. */
async function runFromWorkspace(g: Guard, root: string, dir: string): Promise<RunFiles> {
  const run = { ...emptyRun(), root }
  await withWorkspace(g, run, dir)
  if (!run.workspaceExists) return run
  const marker = await load(g, join(dir, 'plan-path'), 'marker')
  const fromMarker = marker?.text?.split(/\r?\n/)[0].trim() || null
  const ref = fromMarker ?? (run.ledgerText === null ? null : parseLedger(run.ledgerText).planPath)
  const planPath = ref ? resolveAgainst(root, ref) : null
  if (planPath !== null) await withPlan(g, run, planPath)
  return run
}

/** A plan, its spec, and its workspace `.superpowers/sdd/<plan basename>/` when present. */
async function runFromPlan(g: Guard, root: string, planPath: string): Promise<RunFiles> {
  const run = { ...emptyRun(), root }
  await withPlan(g, run, planPath)
  if (run.planPath === null) return run
  await withWorkspace(g, run, join(root, '.superpowers', 'sdd', basename(run.planPath).slice(0, -'.md'.length)))
  return run
}

async function runFromSpec(g: Guard, root: string, specPath: string): Promise<RunFiles> {
  const run = { ...emptyRun(), root }
  await withSpec(g, run, specPath)
  return run
}

/** The run a pinned path names: a workspace (or its ledger or marker), a plan, or a spec. */
async function runFromPinned(g: Guard, pinned: string): Promise<RunFiles | null> {
  const path = resolveAgainst(g.roots[0], pinned)
  const at = path === null ? null : locate(path, g.roots)
  if (path === null || at === null) return null
  if (at.shape === 'workspace') return runFromWorkspace(g, at.root, path)
  if (at.shape === 'ledger' || at.shape === 'marker') return runFromWorkspace(g, at.root, dirname(path))
  if (at.shape === 'plan') return runFromPlan(g, at.root, path)
  if (at.shape === 'spec') return runFromSpec(g, at.root, path)
  return null
}

type Candidate = { root: string; path: string; mtimeMs: number }

const newest = (cs: Candidate[]): Candidate | null => cs.reduce<Candidate | null>((best, c) => (best === null || c.mtimeMs > best.mtimeMs ? c : best), null)

async function freshLedgers(g: Guard, fresh: (mtimeMs: number) => boolean): Promise<Candidate[]> {
  const out: Candidate[] = []
  for (const root of g.roots) {
    const sdd = await listDir(g, join(root, '.superpowers', 'sdd'), 'sdd')
    if (!sdd) continue
    for (const e of sdd.entries) {
      if (e.kind !== 'dir') continue
      const ledger = await guard(g, join(sdd.path, e.name, 'progress.md'), 'ledger')
      if (ledger && ledger.stat.kind === 'file' && fresh(ledger.stat.mtimeMs)) {
        out.push({ root, path: join(sdd.path, e.name), mtimeMs: ledger.stat.mtimeMs })
      }
    }
  }
  return out
}

async function freshPlans(g: Guard, fresh: (mtimeMs: number) => boolean): Promise<Candidate[]> {
  const out: Candidate[] = []
  for (const root of g.roots) {
    const plans = await listDir(g, join(root, 'docs', 'superpowers', 'plans'), 'plans')
    if (!plans) continue
    for (const e of plans.entries) {
      if (e.kind === 'file' && e.name.endsWith('.md') && fresh(e.mtimeMs)) out.push({ root, path: join(plans.path, e.name), mtimeMs: e.mtimeMs })
    }
  }
  return out
}

/**
 * The current run: pinned path → newest ledger in the age window → spec written
 * this session → newest plan in the age window → nothing. Never throws.
 */
export async function discoverRun(fs: Fs, roots: string[], opts: DiscoverOptions): Promise<RunFiles> {
  const g: Guard = { fs, roots: cleanRoots(roots) }
  if (g.roots.length === 0) return emptyRun()
  const fresh = (mtimeMs: number) => opts.now - mtimeMs <= opts.maxAgeMs

  if (opts.pinned) {
    const run = await runFromPinned(g, opts.pinned)
    if (run && foundAnything(run)) return run
  }
  const ledger = newest(await freshLedgers(g, fresh))
  if (ledger) return runFromWorkspace(g, ledger.root, ledger.path)
  if (opts.sessionSpec) {
    const path = resolveAgainst(g.roots[0], opts.sessionSpec)
    const root = path === null ? null : rootFor(path, g.roots, 'spec')
    if (path !== null && root !== null) {
      const run = await runFromSpec(g, root, path)
      if (foundAnything(run)) return run
    }
  }
  const plan = newest(await freshPlans(g, fresh))
  if (plan) return runFromPlan(g, plan.root, plan.path)
  return emptyRun()
}

/** Folders under the main checkout's worktree folders (names only), as further search roots. */
export async function discoverWorktreeRoots(fs: Fs, mainRoot: string): Promise<string[]> {
  const g: Guard = { fs, roots: cleanRoots([mainRoot]) }
  if (g.roots.length === 0) return []
  const out: string[] = []
  for (const folder of WORKTREE_FOLDERS) {
    const listed = await listDir(g, join(g.roots[0], ...folder), 'worktrees')
    if (!listed) continue
    for (const e of listed.entries) if (e.kind === 'dir') out.push(join(listed.path, e.name))
  }
  return out
}
