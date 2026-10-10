import { expect, test } from 'claude-code/testing'
import { parsePlan, slugFromFileName, specTitle } from '../hooks/progress'
import { PLAN_NINE, PLAN_NO_SPEC } from './fixtures'

test('parsePlan counts tasks across heading levels and reads the spec line', async () => {
  const p = parsePlan(PLAN_NINE, '2026-10-07-englische-ansicht.md')
  expect(p.taskCount).toBe(9)
  expect(p.taskTitles.get(5)).toBe('Sprachumschalter')
  expect(p.taskTitles.get(4)).toBe('Korrekturen')
  expect(p.specPath).toBe('docs/superpowers/specs/2026-10-07-englische-ansicht-design.md')
  expect(p.title).toBe('Englische Ansicht Implementation Plan')
})

test('a plan without a title falls back to the slug', async () => {
  expect(parsePlan('### Task 1\n', '2026-10-01-pages-abschalten.md').title).toBe('pages-abschalten')
})

test('a plan without a spec line has no spec path and a task without a title stores an empty string', async () => {
  const p = parsePlan(PLAN_NO_SPEC, '2026-10-01-pages-abschalten.md')
  expect(p.specPath).toBeNull()
  expect(p.taskCount).toBe(1)
  expect(p.taskTitles.get(1)).toBe('')
})

test('taskCount counts distinct task numbers, not the highest number', async () => {
  const p = parsePlan('### Task 1: a\n### Task 1: again\n### Task 5: e\n', 'x.md')
  expect(p.taskCount).toBe(2)
})

test('task headings inside fenced code blocks are ignored', async () => {
  const p = parsePlan('# T\n\n```md\n### Task 7: example\n```\n### Task 1: real\n', 'x.md')
  expect(p.taskCount).toBe(1)
  expect(p.taskTitles.has(7)).toBe(false)
})

test('titles are trimmed', async () => {
  const p = parsePlan('# Plan  \n### Task 1:   spaced title  \n', 'x.md')
  expect(p.title).toBe('Plan')
  expect(p.taskTitles.get(1)).toBe('spaced title')
})

test('the spec path is unwrapped from brackets and backticks', async () => {
  expect(parsePlan('**Spec:** [docs/s.md]\n', 'x.md').specPath).toBe('docs/s.md')
  expect(parsePlan('**Spec:** `docs/s.md`\n', 'x.md').specPath).toBe('docs/s.md')
  expect(parsePlan('**Spec:** docs/s.md (draft)\n', 'x.md').specPath).toBe('docs/s.md')
})

test('a Markdown link in the spec line yields its target path', async () => {
  expect(parsePlan('**Spec:** [x](docs/s.md)\n', 'x.md').specPath).toBe('docs/s.md')
  expect(parsePlan('**Spec:** [the design spec](docs/s.md) (draft)\n', 'x.md').specPath).toBe('docs/s.md')
})

test('an empty plan has no tasks and falls back to the slug', async () => {
  const p = parsePlan('', '2026-10-01-leer.md')
  expect(p.taskCount).toBe(0)
  expect(p.title).toBe('leer')
  expect(p.specPath).toBeNull()
})

test('slugFromFileName strips date, extension and -design', async () => {
  expect(slugFromFileName('2026-10-07-englische-ansicht-design.md')).toBe('englische-ansicht')
  expect(slugFromFileName('2026-10-07-englische-ansicht.md')).toBe('englische-ansicht')
  expect(slugFromFileName('plan.md')).toBe('plan')
})

test('specTitle takes the first H1 or falls back to the slug', async () => {
  expect(specTitle('# Englische Ansicht Design  \n\n## Ziel\n', '2026-10-07-englische-ansicht-design.md')).toBe('Englische Ansicht Design')
  expect(specTitle('## Ziel\n', '2026-10-07-englische-ansicht-design.md')).toBe('englische-ansicht')
})
