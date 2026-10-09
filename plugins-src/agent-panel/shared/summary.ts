export type TokenCounts = {
  input: number
  output: number
  cacheRead: number
  cacheWrite5m: number
  cacheWrite1h: number
}

/** answered: at least one finished answer; error: the last assistant line is an API error; open: neither. */
export type EndState = 'answered' | 'error' | 'open'

export type AgentSummary = {
  /** `lead:<sessionId>` for a lead, else the agent id from the file name `agent-<id>.jsonl`. */
  id: string
  sessionId: string
  kind: 'lead' | 'agent'
  name: string
  role: string
  task: string
  model: string
  /** The reasoning effort the transcript names last; '' when none. */
  effort: string
  tokens: TokenCounts
  costUsd: number
  /** True when some message used a model without a price; costUsd then covers only the priced ones. */
  unpriced: boolean
  firstAt: number | null
  lastAt: number | null
  end: EndState
  errorText: string
}

export type Summary = {
  runId: string | null
  /** Session ids in generation order; a plain session is one generation. */
  generations: string[]
  agents: AgentSummary[]
  unreadableLines: number
  problems: string[]
}
