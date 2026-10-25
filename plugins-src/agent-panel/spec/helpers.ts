import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'agent-panel-'))
}

export type LineOpts = {
  id?: string
  model?: string
  usage?: Record<string, unknown>
  at?: string
  stop?: string | null
}

const AT = '2026-10-09T10:00:00.000Z'

export function assistant(o: LineOpts): string {
  const message = {
    id: o.id,
    model: o.model ?? 'claude-opus-5-5',
    stop_reason: o.stop === undefined ? 'end_turn' : o.stop,
    usage: o.usage ?? { input_tokens: 10, output_tokens: 20 },
  }
  return JSON.stringify({ type: 'assistant', timestamp: o.at ?? AT, message }) + '\n'
}

export function apiError(text: string, at = AT): string {
  const message = { id: 'e1', model: '<synthetic>', stop_reason: 'stop_sequence', usage: { input_tokens: 0, output_tokens: 0 }, content: [{ type: 'text', text }] }
  return JSON.stringify({ type: 'assistant', isApiErrorMessage: true, timestamp: at, message }) + '\n'
}

export function user(at = AT): string {
  return JSON.stringify({ type: 'user', timestamp: at, message: { role: 'user', content: 'x' } }) + '\n'
}
