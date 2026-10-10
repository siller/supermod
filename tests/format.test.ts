import { expect, test } from 'claude-code/testing'
import { bar, fit, k, pct } from '../hooks/format'

test('k formats magnitudes', async () => {
  expect(k(42)).toBe('42')
  expect(k(381_000)).toBe('381k')
  expect(k(1_210_000)).toBe('1.21M')
  expect(k(12_000_000)).toBe('12M')
  expect(k(0)).toBe('0')
  expect(k(999_700)).toBe('1M')
  expect(k(1_200_000)).toBe('1.2M')
  expect(k(null)).toBe('–')
  expect(k(undefined)).toBe('–')
})

test('bar fills by percent', async () => {
  expect(bar(50, 10)).toBe('█████░░░░░')
  expect(bar(null, 4)).toBe('░░░░')
  expect(bar(150, 4)).toBe('████')
  expect(bar(-5, 4)).toBe('░░░░')
})

test('fit truncates with an ellipsis and pads', async () => {
  expect(fit('Englische Ansicht', 8)).toBe('Englisc…')
  expect(fit('ab', 4)).toBe('ab  ')
  expect(fit('abcd', 4)).toBe('abcd')
  expect(fit('abc', 0)).toBe('')
})

test('pct formats a percent or a dash', async () => {
  expect(pct(38)).toBe('38%')
  expect(pct(null)).toBe('–%')
})
