import { closeSync, fstatSync, openSync, readSync, statSync } from 'node:fs'
import { costOf } from './price.ts'
import type { EndState, TokenCounts } from '../shared/summary.ts'

// A transcript line is untrusted JSON, so every count is unknown until count() has checked it.
type Usage = {
  input_tokens?: unknown
  output_tokens?: unknown
  cache_read_input_tokens?: unknown
  cache_creation_input_tokens?: unknown
  cache_creation?: { ephemeral_5m_input_tokens?: unknown; ephemeral_1h_input_tokens?: unknown }
}

type Line = {
  type?: string
  timestamp?: string
  effort?: unknown
  isApiErrorMessage?: boolean
  message?: { id?: string; model?: unknown; stop_reason?: string | null; usage?: Usage; content?: unknown }
}

type Pending = { id: string; model: string; tokens: TokenCounts }

export type FileState = {
  /** Bytes consumed, always just after a newline. */
  offset: number
  done: TokenCounts
  doneCost: number
  unpriced: boolean
  /** The newest message: later lines with its id replace it, a new id settles it into done. */
  pending: Pending | null
  model: string
  effort: string
  firstAt: number | null
  lastAt: number | null
  hasAnswer: boolean
  errorText: string
  unreadable: number
}

const zero = (): TokenCounts => ({ input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 })

const add = (a: TokenCounts, b: TokenCounts): TokenCounts => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite5m: a.cacheWrite5m + b.cacheWrite5m,
  cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
})

export function emptyState(): FileState {
  return { offset: 0, done: zero(), doneCost: 0, unpriced: false, pending: null, model: '', effort: '', firstAt: null, lastAt: null, hasAnswer: false, errorText: '', unreadable: 0 }
}

// Anything but a safe non-negative integer counts as 0: a wild value would put Infinity or text into the sums.
const count = (v: unknown): number => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : 0)

function tokensOf(u: Usage): TokenCounts {
  const c = u.cache_creation
  return {
    input: count(u.input_tokens),
    output: count(u.output_tokens),
    cacheRead: count(u.cache_read_input_tokens),
    cacheWrite5m: count(c ? c.ephemeral_5m_input_tokens : u.cache_creation_input_tokens),
    cacheWrite1h: count(c ? c.ephemeral_1h_input_tokens : 0),
  }
}

function settle(s: FileState): FileState {
  if (!s.pending) return s
  const cost = costOf(s.pending.model, s.pending.tokens)
  return { ...s, done: add(s.done, s.pending.tokens), doneCost: s.doneCost + (cost ?? 0), unpriced: s.unpriced || cost === null, pending: null }
}

function firstText(content: unknown): string {
  if (!Array.isArray(content)) return 'API-Fehler'
  const block = content.find((b): b is { text: string } => typeof b === 'object' && b !== null && typeof (b as { text?: unknown }).text === 'string')
  return block ? block.text.slice(0, 80) : 'API-Fehler'
}

function applyAssistant(s: FileState, line: Line): FileState {
  const msg = line.message ?? {}
  if (line.isApiErrorMessage) return { ...s, errorText: firstText(msg.content) }
  const hasAnswer = s.hasAnswer || msg.stop_reason === 'end_turn'
  const model = typeof msg.model === 'string' ? msg.model : ''
  if (!msg.usage || model === '<synthetic>') return { ...s, hasAnswer, errorText: '' }
  const id = msg.id ?? ''
  const next: Pending = { id, model, tokens: tokensOf(msg.usage) }
  const base = s.pending && id !== '' && s.pending.id === id ? s : settle(s)
  return { ...base, pending: next, model, hasAnswer, errorText: '' }
}

/** Null for a line that is not JSON, or JSON that is not an object. */
function parseLine(raw: string): Line | null {
  try {
    const value: unknown = JSON.parse(raw)
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Line) : null
  } catch {
    return null
  }
}

export function applyLines(prev: FileState, text: string): FileState {
  let s = prev
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue
    const line = parseLine(raw)
    if (!line) {
      s = { ...s, unreadable: s.unreadable + 1 }
      continue
    }
    const at = Date.parse(line.timestamp ?? '')
    if (!Number.isNaN(at)) s = { ...s, firstAt: s.firstAt ?? at, lastAt: at }
    if (typeof line.effort === 'string' && line.effort !== '') s = { ...s, effort: line.effort }
    if (line.type === 'assistant') s = applyAssistant(s, line)
  }
  return s
}

export function readTranscript(path: string, prev: FileState): FileState {
  // POSIX opens a directory and reports size 0, which would read as an empty transcript.
  if (statSync(path).isDirectory()) throw new Error('ist ein Ordner')
  const fd = openSync(path, 'r')
  try {
    const size = fstatSync(fd).size
    const shrunk = size < prev.offset
    const base = shrunk ? emptyState() : prev
    if (size === base.offset) return base
    const buf = Buffer.alloc(size - base.offset)
    readSync(fd, buf, 0, buf.length, base.offset)
    const end = buf.lastIndexOf(0x0a)
    if (end < 0) return base
    const next = applyLines(base, buf.subarray(0, end + 1).toString('utf8'))
    return { ...next, offset: base.offset + end + 1 }
  } finally {
    closeSync(fd)
  }
}

export function totals(s: FileState): { tokens: TokenCounts; costUsd: number; unpriced: boolean } {
  if (!s.pending) return { tokens: s.done, costUsd: s.doneCost, unpriced: s.unpriced }
  const cost = costOf(s.pending.model, s.pending.tokens)
  return { tokens: add(s.done, s.pending.tokens), costUsd: s.doneCost + (cost ?? 0), unpriced: s.unpriced || cost === null }
}

export function endOf(s: FileState): EndState {
  if (s.errorText !== '') return 'error'
  return s.hasAnswer ? 'answered' : 'open'
}
