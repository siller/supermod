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

/** A duration as m:ss, or h:mm:ss from an hour on; below zero counts as zero. */
export function dur(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const two = (n: number) => String(n).padStart(2, '0')
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`
}

/** Local wall-clock time as HH:MM. */
export function hm(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const SPARK = '▁▂▃▄▅▆▇█'

/** One glyph per percent (clamped to 0..100), a space for an unknown reading. */
export function spark(values: (number | null)[]): string {
  return values
    .map(v => (v === null || Number.isNaN(v) ? ' ' : SPARK[Math.min(SPARK.length - 1, Math.floor((Math.min(100, Math.max(0, v)) / 100) * SPARK.length))]))
    .join('')
}

/** US dollars with cents: $3.10. */
export function usd(n: number): string {
  return `$${n.toFixed(2)}`
}
