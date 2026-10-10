const DASH = '–'

/** Compact token count: 42, 381k, 1.21M, 12M; an en dash when unknown. */
export function k(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return DASH
  if (n < 1000) return String(Math.round(n))
  if (n < 999_500) return `${Math.round(n / 1000)}k`
  const m = n / 1_000_000
  return m < 10 ? `${m.toFixed(2).replace(/\.?0+$/, '')}M` : `${Math.round(m)}M`
}

/** Text bar of `width` cells, filled by percent (clamped to 0..100); null is empty. */
export function bar(percent: number | null, width: number): string {
  const cells = Math.max(0, Math.floor(width))
  const clamped = percent === null || Number.isNaN(percent) ? 0 : Math.min(100, Math.max(0, percent))
  const filled = Math.round((clamped / 100) * cells)
  return '█'.repeat(filled) + '░'.repeat(cells - filled)
}

/** Exactly `width` characters: longer text ends in an ellipsis, shorter text is padded right. */
export function fit(text: string, width: number): string {
  const cells = Math.max(0, Math.floor(width))
  if (cells === 0) return ''
  if (text.length > cells) return text.slice(0, cells - 1) + '…'
  return text.padEnd(cells, ' ')
}

/** Percent label: 38%, or –% when unknown. */
export function pct(n: number | null): string {
  return n === null || Number.isNaN(n) ? `${DASH}%` : `${Math.round(n)}%`
}
