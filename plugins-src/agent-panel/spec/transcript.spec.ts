import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyLines, emptyState, endOf, readTranscript, totals } from '../cli/transcript.ts'
import { apiError, assistant, tempDir, user } from './helpers.ts'

const read = (text: string) => applyLines(emptyState(), text)

test('counts only the last line of a streamed message', () => {
  const s = read(
    assistant({ id: 'm1', stop: null, usage: { input_tokens: 2, output_tokens: 5, cache_read_input_tokens: 100 } }) +
      assistant({ id: 'm1', stop: 'tool_use', usage: { input_tokens: 2, output_tokens: 234, cache_read_input_tokens: 100 } }),
  )
  assert.deepEqual(totals(s).tokens, { input: 2, output: 234, cacheRead: 100, cacheWrite5m: 0, cacheWrite1h: 0 })
})

test('adds distinct messages and lines without an id', () => {
  const s = read(assistant({ id: 'm1' }) + assistant({ id: 'm2' }) + assistant({}) + assistant({}))
  assert.equal(totals(s).tokens.output, 80)
})

test('splits cache writes by duration, and counts an undivided write as five minutes', () => {
  const s = read(
    assistant({ id: 'a', usage: { cache_creation_input_tokens: 30, cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 20 } } }) +
      assistant({ id: 'b', usage: { cache_creation_input_tokens: 7 } }) +
      assistant({ id: 'c', usage: { cache_creation: {} } }),
  )
  assert.deepEqual(totals(s).tokens, { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 17, cacheWrite1h: 20 })
})

test('prices each message by its own model and flags an unpriced one', () => {
  const s = read(
    assistant({ id: 'a', model: 'claude-opus-5-5', usage: { output_tokens: 1_000_000 } }) +
      assistant({ id: 'b', model: 'opus' }) +
      assistant({ id: 'c', usage: { output_tokens: 0 } }),
  )
  const t = totals(s)
  assert.equal(t.costUsd, 20)
  assert.equal(t.unpriced, true)
  assert.equal(t.tokens.output, 1_000_020)
})

test('flags an unpriced message that is still streaming', () => {
  assert.equal(totals(read(assistant({ id: 'a', model: 'opus' }))).unpriced, true)
  assert.equal(totals(read(assistant({ id: 'a' }))).unpriced, false)
})

test('ignores synthetic lines and assistant lines without a message', () => {
  const s = read(assistant({ id: 'a' }) + assistant({ id: 's', model: '<synthetic>' }) + JSON.stringify({ type: 'assistant' }) + '\n')
  assert.equal(totals(s).tokens.output, 20)
  assert.equal(s.model, 'claude-opus-5-5')
})

test('is answered once any message ended its turn', () => {
  assert.equal(endOf(read(assistant({ id: 'a', stop: 'tool_use' }))), 'open')
  assert.equal(endOf(read(assistant({ id: 'a' }) + user() + assistant({ id: 'b', stop: null }) + user())), 'answered')
})

test('is an error while the last assistant line is an API error, with its text', () => {
  const s = read(assistant({ id: 'a' }) + apiError("You've hit your session limit · resets 10:50pm"))
  assert.equal(endOf(s), 'error')
  assert.equal(s.errorText, "You've hit your session limit · resets 10:50pm")
  assert.equal(endOf(applyLines(s, assistant({ id: 'b' }))), 'answered')
})

test('keeps the error text short and copes with an error without text', () => {
  assert.equal(read(apiError('x'.repeat(200))).errorText.length, 80)
  const bare = JSON.stringify({ type: 'assistant', isApiErrorMessage: true, message: { content: 'not a list' } }) + '\n'
  assert.equal(read(bare).errorText, 'API-Fehler')
  const noText = JSON.stringify({ type: 'assistant', isApiErrorMessage: true, message: { content: [null, 'x', { type: 'image' }] } }) + '\n'
  assert.equal(read(noText).errorText, 'API-Fehler')
})

test('tracks first and last time and skips lines without a valid time', () => {
  const s = read(user('2026-10-09T10:00:00.000Z') + JSON.stringify({ type: 'system', timestamp: 'nonsense' }) + '\n' + assistant({ id: 'a', at: '2026-10-09T10:05:00.000Z' }))
  assert.equal(s.firstAt, Date.parse('2026-10-09T10:00:00.000Z'))
  assert.equal(s.lastAt, Date.parse('2026-10-09T10:05:00.000Z'))
})

test('counts unreadable lines and reads on', () => {
  const s = read('{"type":\n' + '\n' + assistant({ id: 'a' }))
  assert.equal(s.unreadable, 1)
  assert.equal(totals(s).tokens.output, 20)
})

test('reads only new bytes, and leaves a half-written last line for later', () => {
  const dir = tempDir()
  const file = join(dir, 't.jsonl')
  const second = assistant({ id: 'm2' })
  writeFileSync(file, assistant({ id: 'm1' }) + second.slice(0, 15))
  const s1 = readTranscript(file, emptyState())
  assert.equal(totals(s1).tokens.output, 20)
  appendFileSync(file, second.slice(15))
  const s2 = readTranscript(file, s1)
  assert.equal(totals(s2).tokens.output, 40)
  assert.equal(readTranscript(file, s2), s2)
})

test('replaces a message whose lines span two reads', () => {
  const dir = tempDir()
  const file = join(dir, 't.jsonl')
  writeFileSync(file, assistant({ id: 'm1', stop: null, usage: { output_tokens: 5 } }))
  const s1 = readTranscript(file, emptyState())
  appendFileSync(file, assistant({ id: 'm1', usage: { output_tokens: 234 } }))
  assert.equal(totals(readTranscript(file, s1)).tokens.output, 234)
})

test('keeps byte offsets right across multibyte text', () => {
  const dir = tempDir()
  const file = join(dir, 't.jsonl')
  const umlaut = JSON.stringify({ type: 'user', timestamp: '2026-10-09T10:00:00.000Z', message: { content: 'Prüfung über Größe' } }) + '\n'
  writeFileSync(file, umlaut + assistant({ id: 'a' }))
  const s1 = readTranscript(file, emptyState())
  appendFileSync(file, umlaut + assistant({ id: 'b' }))
  const s2 = readTranscript(file, s1)
  assert.equal(s2.unreadable, 0)
  assert.equal(totals(s2).tokens.output, 40)
})

test('rereads a file that shrank', () => {
  const dir = tempDir()
  const file = join(dir, 't.jsonl')
  writeFileSync(file, assistant({ id: 'a' }) + assistant({ id: 'b' }))
  const s1 = readTranscript(file, emptyState())
  writeFileSync(file, assistant({ id: 'c', usage: { output_tokens: 1 } }))
  assert.equal(totals(readTranscript(file, s1)).tokens.output, 1)
})

test('reads a file without any complete line as nothing yet', () => {
  const dir = tempDir()
  const file = join(dir, 't.jsonl')
  writeFileSync(file, '{"type":"assis')
  const s = readTranscript(file, emptyState())
  assert.equal(s.offset, 0)
  assert.equal(totals(s).tokens.output, 0)
})

test('refuses a directory instead of reading it as empty', () => {
  assert.throws(() => readTranscript(tempDir(), emptyState()), /ist ein Ordner/)
})

test('matches the independent tally of a real teammate transcript', () => {
  const s = readTranscript(join(import.meta.dirname, 'fixtures', 'teammate.jsonl'), emptyState())
  const t = totals(s)
  assert.deepEqual(t.tokens, { input: 68, output: 3517, cacheRead: 1430684, cacheWrite5m: 163348, cacheWrite1h: 0 })
  assert.ok(Math.abs(t.costUsd - 0.5867444) < 1e-9)
  assert.equal(s.model, 'claude-sonnet-5-5')
  assert.equal(s.firstAt, 1791548983015)
  assert.equal(s.lastAt, 1791549963815)
  assert.equal(endOf(s), 'answered')
})

test('remembers the last effort a line names', () => {
  const lines = [
    JSON.stringify({ type: 'user', effort: 'low', timestamp: '2026-10-09T10:00:00.000Z' }),
    JSON.stringify({ type: 'assistant', effort: 'medium', message: { id: 'a', model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { output_tokens: 1 } } }),
    JSON.stringify({ type: 'system' }),
    JSON.stringify({ type: 'user', effort: '' }),
  ].join('\n') + '\n'
  assert.equal(applyLines(emptyState(), lines).effort, 'medium')
  assert.equal(emptyState().effort, '')
})

const rawModel = (id: string, model: unknown) =>
  JSON.stringify({ type: 'assistant', message: { id, model, stop_reason: 'end_turn', usage: { output_tokens: 20 } } }) + '\n'

test('treats a model that is not a string as unpriced, on the newest line', () => {
  const s = read(assistant({ id: 'a' }) + rawModel('b', 5))
  const t = totals(s)
  assert.equal(t.tokens.output, 40)
  assert.equal(t.unpriced, true)
  assert.equal(s.model, '')
})

test('treats a model that is not a string as unpriced, once a later message settles it', () => {
  const s = read(rawModel('a', { name: 'opus' }) + assistant({ id: 'b' }))
  const t = totals(s)
  assert.equal(t.tokens.output, 40)
  assert.equal(t.unpriced, true)
  assert.equal(s.model, 'claude-opus-5-5')
})
