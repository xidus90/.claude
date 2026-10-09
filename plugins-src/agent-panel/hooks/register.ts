import type { EngineInterface, Register } from 'claude-code'
import type { Summary } from '../shared/summary.ts'
import { buildView, dirsOf, toggle,detailLine, glyphColor, groupLine, parseResult, reportedCost, rowLine, scriptArgs, startError, type LiveAgent } from './view.ts'

const PANE = 'agent-panel'
// Measured in docs/.superpowers/smoke/2026-10-09-agent-panel-probe.md.
const TICK_MS = 2000
const REPORTED_COST_INCLUDES_AGENTS = true

let summary: Summary | null = null
let error = ''
let live: LiveAgent[] = []
let reported: number | null = null
let isBusy = false
let hasOpened = false
const collapsed = new Set<string>()
const expanded = new Set<string>()

async function refresh($: EngineInterface): Promise<void> {
  // A session that never showed the panel never pays for a node start.
  if (!hasOpened || isBusy) return
  isBusy = true
  try {
    const session = await $.session.id()
    const cwd = await $.session.cwd()
    const { home, tmp } = dirsOf({
      USERPROFILE: await $.env.get('USERPROFILE'),
      HOME: await $.env.get('HOME'),
      TEMP: await $.env.get('TEMP'),
      TMPDIR: await $.env.get('TMPDIR'),
    })
    const argv = scriptArgs(`${$.plugin.root}/cli/summarize.ts`, session, cwd, home, tmp)
    const parsed = parseResult(await $.process.run(argv, { timeoutMs: 20_000 }))
    if (parsed.summary) summary = parsed.summary
    error = parsed.error
    live = (await $.agent.list()).map((a) => ({ id: a.id, status: a.status }))
    reported = reportedCost((await $.session.usage()).cost)
  } catch (err) {
    error = startError(err)
  } finally {
    isBusy = false
  }
  $.ui.invalidate('ui.render')
}

async function openPane($: EngineInterface, byUser: boolean): Promise<void> {
  hasOpened = true
  await $.ui.open(byUser ? { id: PANE, title: 'Agents', focus: true, closeOnEscape: true } : { id: PANE, title: 'Agents' })
  void refresh($)
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    $.clock.every(TICK_MS, () => refresh($))
    await $.command.register({
      name: 'agent-panel',
      description: 'Show or hide the panel of agents with cost, tokens, time and status',
      immediate: true,
    })
    return next(e)
  })

  on('command.run', { command: 'agent-panel' }, async ($) => {
    const isOpen = (await $.ui.panes()).some((p) => p.id === PANE)
    if (isOpen) await $.ui.close({ id: PANE })
    else await openPane($, true)
    return {}
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny !== undefined) return started
    if (!hasOpened) await openPane($, false)
    else void refresh($)
    return started
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    void refresh($)
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const v = buildView({ summary, live, reportedCostUsd: reported, costIncludesAgents: REPORTED_COST_INCLUDES_AGENTS, now: await $.clock.now(), error })
    return Box({
      flexDirection: 'column',
      children: [
        Text({ bold: true, wrap: 'truncate-end', children: [v.title] }),
        Text({ wrap: 'truncate-end', children: [v.totals] }),
        Text({ dimColor: true, children: [v.counts] }),
        ...v.notices.map((n) => Text({ color: 'yellow', wrap: 'truncate-end', children: [n] })),
        ...v.groups.flatMap((g) => [
          Button({
            key: `g-${g.key}`,
            plain: true,
            label: groupLine(g, collapsed.has(g.key)),
            onPress: () => {
              toggle(collapsed, g.key)
              $.ui.invalidate('ui.render')
            },
          }),
          ...(collapsed.has(g.key)
            ? []
            : g.rows.flatMap((r) => [
                Box({
                  flexDirection: 'row',
                  children: [
                    Text({ color: glyphColor(r.glyph), children: [`  ${r.glyph} `] }),
                    Button({
                      key: `r-${r.key}`,
                      plain: true,
                      label: rowLine(r),
                      onPress: () => {
                        toggle(expanded, r.key)
                        $.ui.invalidate('ui.render')
                      },
                    }),
                  ],
                }),
                ...(expanded.has(r.key) ? [Text({ dimColor: true, children: [detailLine(r)] })] : []),
              ])),
        ]),
      ],
    })
  })
}
