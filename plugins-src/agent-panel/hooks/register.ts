import type { ElementTable, EngineInterface, Register } from 'claude-code'
import type { Summary } from '../shared/summary.ts'
import { blockBar, CARD_GAP, costBarSvg, costParts, crabRaster, crabSvg, layoutOf, paletteOf, STATUS_COLOR, statusParts, statusSvg, stripeSvg, tilesSvg, tokenParts, type BarPart, type Palette } from './art.ts'
import { EMPTY_LOG, onSpawn, type SpawnLog } from './open.ts'
import { costumeOf } from './sprites.ts'
import { buildView, countsLine, dirsOf, isOpen, toggle, detailLine, glyphColor, groupLine, parseResult, reportedCost, rowLine, scriptArgs, startError, statusLine, visibleRows, type Group, type LiveAgent, type Row, type View } from './view.ts'

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
let palette: Palette = paletteOf(undefined)
let spawnLog: SpawnLog = EMPTY_LOG
let isOverviewOpen = true
let isAgentsOpen = true
let isHidingDone = false
const collapsed = new Set<string>()
const expanded = new Set<string>()

type TextUi = Pick<ElementTable, 'Box' | 'Text' | 'Button'>

async function readTheme($: EngineInterface): Promise<void> {
  try {
    palette = paletteOf((await $.config.list()).find((row) => row.key === 'theme')?.value)
  } catch {
    palette = paletteOf(undefined)
  }
}

async function refresh($: EngineInterface): Promise<void> {
  // A session that never showed the panel never pays for a node start.
  if (!hasOpened || isBusy) return
  isBusy = true
  try {
    if (!(await isShown($))) return
    await readTheme($)
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

// A pane listing that fails leaves what is known: a pane this session opened counts as still shown.
async function isShown($: EngineInterface): Promise<boolean> {
  try {
    return isOpen(await $.ui.panes(), PANE)
  } catch {
    return hasOpened
  }
}

// The plain text drawing, for when the graphic one cannot be built.
function textTree({ Box, Text, Button }: TextUi, v: View, redraw: () => void) {
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
            redraw()
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
                      redraw()
                    },
                  }),
                ],
              }),
              ...(expanded.has(r.key) ? [Text({ dimColor: true, children: [detailLine(r)] })] : []),
            ])),
      ]),
    ],
  })
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await readTheme($)
    $.clock.every(TICK_MS, () => refresh($))
    await $.command.register({
      name: 'agent-panel',
      description: 'Show or hide the panel of agents with cost, tokens, time and status',
      immediate: true,
    })
    return next(e)
  })

  on('command.run', { command: 'agent-panel' }, async ($) => {
    if (isOpen(await $.ui.panes(), PANE)) await $.ui.close({ id: PANE })
    else await openPane($, true)
    return {}
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny !== undefined) return started
    const decision = onSpawn(spawnLog, await $.clock.now(), e.isTeammate === true)
    spawnLog = decision.log
    if (!(await isShown($)) && (!hasOpened || decision.shouldOpen)) await openPane($, false)
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
    const redraw = () => $.ui.invalidate('ui.render')
    try {
      // The terminal draws cells and rasters; every other surface draws SVG, which has no key of its own.
      const { isWide, barCells, cardBarCells } = layoutOf(e.props.bodyColumns)
      const bar = (key: string, parts: BarPart[], svg: string, cells: number) => e.surface === 'terminal'
        ? Box({ key, flexDirection: 'row', children: blockBar(parts, cells, palette.track).map((s) => Text({ color: s.color, children: [s.text] })) })
        : Box({ key, children: [$.ui.resolve(e).Svg({ source: svg, alt: key })] })
      const crab = (g: Group) => e.surface === 'terminal'
        ? $.ui.resolve(e).Raster({ key: `crab-${g.role}`, ...crabRaster(costumeOf(g.role)) })
        : Box({ key: `crab-${g.role}`, children: [$.ui.resolve(e).Svg({ source: crabSvg(costumeOf(g.role), g.isRunning), alt: `Krabbe ${g.title}` })] })
      const row = (r: Row) => [
        Box({ flexDirection: 'row', children: [
          Text({ color: STATUS_COLOR[r.status], children: [`${r.glyph} `] }),
          Button({ key: `r-${r.key}`, plain: true, label: r.label, onPress: () => { toggle(expanded, r.key); redraw() } }),
          Text({ dimColor: true, wrap: 'truncate-end', children: [`  ${r.meta}`] }),
        ] }),
        bar(`stripe-${r.key}`, tokenParts(palette, r.shares), stripeSvg(palette, r.shares, 6), cardBarCells),
        ...(expanded.has(r.key) ? [Text({ dimColor: true, children: [detailLine(r)] })] : []),
      ]
      const group = (g: Group) => {
        const isGroupOpen = !collapsed.has(g.key)
        const body = [
          Box({ flexDirection: 'row', justifyContent: 'space-between', children: [
            Button({ key: `g-${g.key}`, plain: true, label: `${isGroupOpen ? '▾' : '▸'} ${g.title}  ${countsLine(g.counts)}`, onPress: () => { toggle(collapsed, g.key); redraw() } }),
            Text({ bold: true, children: [g.cost] }),
          ] }),
          ...(isGroupOpen ? [bar(`cost-${g.key}`, costParts(g.costShare), costBarSvg(palette, g.costShare), cardBarCells), ...visibleRows(g, isHidingDone).flatMap(row)] : []),
        ]
        return Box({ key: `card-${g.key}`, flexDirection: 'row', borderStyle: 'round', paddingX: 1, columnGap: CARD_GAP, children: [
          ...(isWide ? [crab(g)] : []),
          Box({ flexDirection: 'column', flexGrow: 1, children: body }),
        ] })
      }
      return Box({ flexDirection: 'column', children: [
        Text({ bold: true, wrap: 'truncate-end', children: [v.title] }),
        ...v.notices.map((n) => Text({ color: 'warning', wrap: 'truncate-end', children: [n] })),
        Button({ key: 'sec-overview', plain: true, label: `${isOverviewOpen ? '▾' : '▸'} Übersicht${isOverviewOpen ? '' : `   ${v.overview.line}`}`, onPress: () => { isOverviewOpen = !isOverviewOpen; redraw() } }),
        ...(isOverviewOpen ? [
          e.surface === 'terminal'
            ? Text({ bold: true, children: [`Kosten ${v.overview.cost} · Tokens ${v.overview.tokens} · Zeit ${v.overview.time}`] })
            : Box({ key: 'svg-tiles', children: [$.ui.resolve(e).Svg({ source: tilesSvg(palette, [{ label: 'Kosten', value: v.overview.cost }, { label: 'Tokens', value: v.overview.tokens }, { label: 'Zeit', value: v.overview.time }]), alt: v.overview.line })] }),
          ...(v.overview.unpriced ? [Text({ color: 'warning', children: [v.overview.unpriced] })] : []),
          bar('stripe-total', tokenParts(palette, v.overview.shares), stripeSvg(palette, v.overview.shares, 10), barCells),
          Text({ dimColor: true, children: [`in ${v.overview.amounts.input} · out ${v.overview.amounts.output} · cache read ${v.overview.amounts.cacheRead} · cache write ${v.overview.amounts.cacheWrite}`] }),
        ] : []),
        Box({ flexDirection: 'row', justifyContent: 'space-between', children: [
          Button({ key: 'sec-agents', plain: true, label: `${isAgentsOpen ? '▾' : '▸'} Agents${isAgentsOpen ? '' : `   ${countsLine(v.status)}`}`, onPress: () => { isAgentsOpen = !isAgentsOpen; redraw() } }),
          ...(isAgentsOpen ? [Box({ flexDirection: 'row', columnGap: 1, children: [
            Button({ key: 'hide-done', plain: true, label: isHidingDone ? '[x] Fertige ausblenden' : '[ ] Fertige ausblenden', onPress: () => { isHidingDone = !isHidingDone; redraw() } }),
            Button({ key: 'fold-all', plain: true, label: 'Alle einklappen', onPress: () => { for (const g of v.groups) collapsed.add(g.key); redraw() } }),
            Button({ key: 'open-all', plain: true, label: 'Alle ausklappen', onPress: () => { collapsed.clear(); redraw() } }),
          ] })] : []),
        ] }),
        ...(isAgentsOpen ? [
          bar('status', statusParts(v.status), statusSvg(palette, v.status), barCells),
          Text({ dimColor: true, children: [statusLine(v.status)] }),
          ...v.groups.map(group),
        ] : []),
      ] })
    } catch (err) {
      return Box({ flexDirection: 'column', children: [
        Text({ color: 'warning', children: [`⚠ Grafik: ${err instanceof Error ? err.message : String(err)}`] }),
        textTree({ Box, Text, Button }, v, redraw),
      ] })
    }
  })
}
