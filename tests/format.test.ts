import { expect, test } from 'claude-code/testing'
import { bar, dur, fit, hm, k, pct, spark, usd } from '../hooks/format'

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

test('dur, hm, spark and usd', async () => {
  expect(dur(220_000)).toBe('3:40')
  expect(dur(3_600_000)).toBe('1:00:00')
  expect(dur(-5)).toBe('0:00')
  expect(hm(new Date(2026, 9, 10, 9, 5).getTime())).toBe('09:05')
  expect(spark([0, 10, 20, 25, 38, 50, 99, 100, null, 150])).toBe('▁▁▂▃▄▅██ █')
  expect(usd(3.1)).toBe('$3.10')
})
