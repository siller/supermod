// USD per million tokens. Estimates only; first matching row wins.
export type Price = { input: number; output: number; cacheRead: number; cacheWrite: number }

export const PRICES_AS_OF = '2026-10-10'

const row = (input: number, output: number, cacheRead: number, cacheWrite: number): Price => ({
  input, output, cacheRead, cacheWrite,
})

const TABLE: [RegExp, Price][] = [
  [/opus-5-5/, row(4, 20, 0.2, 5)],
  [/sonnet-5-5/, row(2, 10, 0.2, 2.5)],
  [/haiku-5-5/, row(0.1, 0.5, 0.01, 0.125)],
  [/fable|mythos/, row(10, 50, 0.25, 12.5)],
  [/opus/, row(5, 25, 0.5, 6.25)],
  [/sonnet/, row(2, 10, 0.2, 2.5)],
  [/haiku/, row(1, 5, 0.1, 1.25)],
]

const FALLBACK: Price = row(4, 20, 0.2, 5)

export function priceFor(model: string): Price {
  for (const [re, price] of TABLE) if (re.test(model)) return { ...price }
  return { ...FALLBACK }
}
