import type { TokenCounts } from '../shared/summary.ts'

// USD per million tokens: input, output, cache read, cache write 5m, cache write 1h.
// Source: platform.claude.com/docs/en/about-claude/pricing, read 2026-10-09.
type Rates = readonly [number, number, number, number, number]

const OPUS_4_5_TO_5: Rates = [5, 25, 0.5, 6.25, 10]
const OPUS_4_AND_4_1: Rates = [15, 75, 1.5, 18.75, 30]
const SONNET_4_TO_4_6: Rates = [3, 15, 0.3, 3.75, 6]

const RATES: Record<string, Rates> = {
  'fable-5-1': [10, 50, 0.25, 12.5, 20],
  'mythos-5-1': [10, 50, 0.25, 12.5, 20],
  'fable-5': [10, 50, 1, 12.5, 20],
  'mythos-5': [10, 50, 1, 12.5, 20],
  'opus-5-5': [4, 20, 0.2, 5, 8],
  'opus-5': OPUS_4_5_TO_5,
  'opus-4-8': OPUS_4_5_TO_5,
  'opus-4-7': OPUS_4_5_TO_5,
  'opus-4-6': OPUS_4_5_TO_5,
  'opus-4-5': OPUS_4_5_TO_5,
  'opus-4-1': OPUS_4_AND_4_1,
  'opus-4': OPUS_4_AND_4_1,
  'sonnet-5-5': [2, 10, 0.1, 2.5, 4],
  'sonnet-5': [2, 10, 0.2, 2.5, 4],
  'sonnet-4-6': SONNET_4_TO_4_6,
  'sonnet-4-5': SONNET_4_TO_4_6,
  'sonnet-4': SONNET_4_TO_4_6,
  'haiku-5-5': [0.1, 0.5, 0.01, 0.125, 0.2],
  'haiku-4-5': [1, 5, 0.1, 1.25, 2],
  'haiku-3-5': [0.8, 4, 0.08, 1, 1.6],
}

// Haiku 5.5 bills a whole request at these rates once its prompt exceeds the threshold.
const HAIKU_5_5_LONG: Rates = [0.5, 2.5, 0.05, 0.625, 1]
const HAIKU_LONG_PROMPT = 100_000

// 3.x ids put the version before the family (claude-3-5-haiku-20241022); the keys put it after.
export function modelKey(model: string): string {
  return model.toLowerCase().replace(/\[.*\]$/, '').replace(/^claude-/, '')
    .replace(/^(\d+(?:-\d+)?)-(haiku|sonnet|opus)/, '$2-$1').replace(/-(\d{8}|latest)$/, '')
}

export function costOf(model: string, t: TokenCounts): number | null {
  const key = modelKey(model)
  const base = RATES[key]
  if (!base) return null
  const prompt = t.input + t.cacheRead + t.cacheWrite5m + t.cacheWrite1h
  const r = key === 'haiku-5-5' && prompt > HAIKU_LONG_PROMPT ? HAIKU_5_5_LONG : base
  const micro = t.input * r[0] + t.output * r[1] + t.cacheRead * r[2] + t.cacheWrite5m * r[3] + t.cacheWrite1h * r[4]
  return micro / 1e6
}
