import { expect, test } from 'claude-code/testing'
import { LABEL_KEYS, t } from '../hooks/i18n'

test('every label exists in both languages', async () => {
  for (const key of LABEL_KEYS) {
    expect(t('en', key)).not.toBe('')
    expect(t('de', key)).not.toBe('')
  }
})

test('a de label differs from en for context', async () => {
  expect(t('de', 'context')).toBe('Kontext')
  expect(t('en', 'context')).toBe('Context')
})

test('toast texts keep the percent placeholder', async () => {
  expect(t('en', 'toast.warn')).toBe('Context at {p}%: consider finishing the task in a fresh subagent or compacting')
  expect(t('de', 'toast.warn')).toBe('Kontext bei {p}%: Aufgabe in frischem Subagenten beenden oder kompaktieren')
  expect(t('en', 'toast.critical')).toContain('{p}')
  expect(t('de', 'toast.critical')).toContain('{p}')
})
