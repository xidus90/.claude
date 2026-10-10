import { test } from 'node:test'
import assert from 'node:assert/strict'
import { costOf, modelKey } from '../cli/price.ts'
import type { TokenCounts } from '../shared/summary.ts'

const t = (p: Partial<TokenCounts>): TokenCounts => ({ input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, ...p })
const M = 1_000_000

test('normalizes model ids', () => {
  assert.equal(modelKey('claude-opus-5-5'), 'opus-5-5')
  assert.equal(modelKey('claude-opus-5[1m]'), 'opus-5')
  assert.equal(modelKey('claude-haiku-4-5-20251001'), 'haiku-4-5')
  assert.equal(modelKey('Claude-Sonnet-5-5'), 'sonnet-5-5')
})

test('puts the version of a 3.x id after its family like every other id', () => {
  assert.equal(modelKey('claude-3-5-haiku-20241022'), 'haiku-3-5')
  assert.equal(modelKey('claude-3-5-haiku-latest'), 'haiku-3-5')
  assert.equal(modelKey('claude-3-7-sonnet-20250219'), 'sonnet-3-7')
  assert.equal(modelKey('claude-3-opus-20240229'), 'opus-3')
})

test('prices each token kind of Opus 5.5', () => {
  assert.equal(costOf('claude-opus-5-5', t({ input: M })), 4)
  assert.equal(costOf('claude-opus-5-5', t({ output: M })), 20)
  assert.equal(costOf('claude-opus-5-5', t({ cacheRead: M })), 0.2)
  assert.equal(costOf('claude-opus-5-5', t({ cacheWrite5m: M })), 5)
  assert.equal(costOf('claude-opus-5-5', t({ cacheWrite1h: M })), 8)
})

test('knows every current and older model on the pricing page', () => {
  const cases: [string, number][] = [
    ['claude-fable-5-1', 10], ['claude-mythos-5-1', 10], ['claude-fable-5', 10], ['claude-mythos-5', 10],
    ['claude-opus-5', 5], ['claude-opus-4-8', 5], ['claude-opus-4-7', 5], ['claude-opus-4-6', 5], ['claude-opus-4-5', 5],
    ['claude-opus-4-1', 15], ['claude-opus-4', 15],
    ['claude-sonnet-5-5', 2], ['claude-sonnet-5', 2], ['claude-sonnet-4-6', 3], ['claude-sonnet-4-5', 3], ['claude-sonnet-4', 3],
    ['claude-haiku-5-5', 0.5], ['claude-haiku-4-5-20251001', 1],
    ['claude-3-5-haiku-20241022', 0.8], ['claude-3-5-haiku-latest', 0.8], ['claude-haiku-3-5', 0.8],
  ]
  // A million prompt tokens puts Haiku 5.5 past its long-prompt threshold.
  for (const [model, input] of cases) assert.equal(costOf(model, t({ input: M })), input, model)
})

test('uses the reduced cache-read rates of Fable 5.1 and Sonnet 5.5', () => {
  assert.equal(costOf('claude-fable-5-1', t({ cacheRead: M })), 0.25)
  assert.equal(costOf('claude-sonnet-5-5', t({ cacheRead: M })), 0.1)
  assert.equal(costOf('claude-sonnet-5', t({ cacheRead: M })), 0.2)
})

test('bills Haiku 5.5 at the long-prompt rates above 100,000 prompt tokens', () => {
  assert.equal(costOf('claude-haiku-5-5', t({ input: 100_000, output: M })), 0.01 + 0.5)
  assert.equal(costOf('claude-haiku-5-5', t({ input: 60_000, cacheRead: 50_000, output: M })), 0.03 + 0.0025 + 2.5)
})

test('returns null for a model without a price', () => {
  assert.equal(costOf('opus', t({ input: M })), null)
  assert.equal(costOf('<synthetic>', t({})), null)
})

test('returns null for a model named like an Object.prototype member', () => {
  for (const model of ['constructor', '__proto__', 'claude-constructor', '__proto__[1m]', 'toString', 'claude-hasOwnProperty']) {
    assert.equal(costOf(model, t({ output: M })), null, model)
  }
})
