export type Meta = { name?: string; description?: string; agentType?: string; customAgentType?: string }

export function roleOf(meta: Meta): string {
  const raw = meta.customAgentType || meta.agentType || ''
  return raw.replace(/^[^:]*:/, '') || 'agent'
}

// The task title forms of the agent-team spec, section 5, as the orchestrator abbreviates them in names.
const KINDS: Record<string, string> = {
  impl: 'impl',
  fix: 'fix',
  verify: 'verify',
  merge: 'merge',
  'review-code': 'review:code',
  'review-sec': 'review:security',
  final: 'final',
  cleanup: 'cleanup',
}
const NAME = /^(review-code|review-sec|impl|fix|verify|merge|hunt|final|cleanup)(?:-(.+))?$/
const ROOT = /^(?:[TB]\d+|F)$/

export function taskOf(name: string): string {
  const m = NAME.exec(name)
  if (!m) return name
  const head = m[1] as string
  const rest = m[2]
  if (head === 'hunt') {
    const h = /^R(\d+)-P(\d+)$/.exec(rest ?? '')
    return h ? `hunt R${h[1]}.P${h[2]}` : name
  }
  const kind = KINDS[head] as string
  if (rest === undefined) return kind
  const parts = rest.split('-')
  const at = parts.findIndex((p) => ROOT.test(p))
  if (at < 0) return name
  const after = parts.slice(at + 1)
  if (after.length > 1 || (after.length === 1 && !/^\d+$/.test(after[0] as string))) return name
  const label = [kind, ...parts.slice(0, at)].join(':')
  return `${label} ${parts[at]}${after.length === 1 ? ` #${after[0]}` : ''}`
}
