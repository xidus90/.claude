import type { ElementTable, EngineInterface, Register } from 'claude-code'
import type { SessionInfo, Summary } from '../shared/summary.ts'
import { blockBar, CARD_GAP, COST_H, costBarSvg, costParts, crabRaster, crabSvg, layoutOf, legendColors, paletteOf, RULE_H, ruleSvg, STATUS_COLOR, STATUS_H, statusParts, statusSvg, stripeSvg, tokenParts, type BarPart, type Palette } from './art.ts'
import { EMPTY_LOG, onSpawn, type SpawnLog } from './open.ts'
import { costumeOf } from './sprites.ts'
import { buildView, countItems, dirsOf, isOpen, toggle, detailLine, glyphColor, groupLine, isGone, listArgs, moreLine, OWN, parseResult, pickerOptions, reportedCost, rowLine, scriptArgs, sessionsOf, startError, statusItems, visibleRows, type Group, type LiveAgent, type Row, type StatusItem, type View } from './view.ts'

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
let isPaneOpen = false
let palette: Palette = paletteOf(undefined)
let spawnLog: SpawnLog = EMPTY_LOG
let isOverviewOpen = true
let isAgentsOpen = true
let isHidingDone = false
const collapsed = new Set<string>()
const expanded = new Set<string>()
// The session picker: the others listed by the script, and the one picked.
const LIST_MS = 10_000
let sessions: SessionInfo[] = []
// Kept whole, so a session that drops out of the 20 newest stays picked.
let picked: SessionInfo | null = null
let lastList = Number.NEGATIVE_INFINITY
// Says that the picked session is gone, until the next pick.
let goneNotice = ''

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
    const { home, config, tmp } = dirsOf({
      USERPROFILE: await $.env.get('USERPROFILE'),
      HOME: await $.env.get('HOME'),
      TEMP: await $.env.get('TEMP'),
      TMPDIR: await $.env.get('TMPDIR'),
      CLAUDE_CONFIG_DIR: await $.env.get('CLAUDE_CONFIG_DIR'),
    })
    const script = `${$.plugin.root}/cli/summarize.ts`
    const now = await $.clock.now()
    if (now - lastList >= LIST_MS) {
      lastList = now
      try {
        const list = sessionsOf(await $.process.run(listArgs(script, home, config), { timeoutMs: 20_000 }))
        if (list) sessions = list.filter((s) => s.id !== session)
      } catch {
        // A failed list keeps the last good one: the picker is a convenience, not a finding.
      }
      const current = picked
      if (current) picked = sessions.find((s) => s.id === current.id) ?? current
    }
    const other = picked
    const argv = other ? scriptArgs(script, other.id, other.cwd || cwd, other.config, tmp) : scriptArgs(script, session, cwd, config, tmp)
    const parsed = parseResult(await $.process.run(argv, { timeoutMs: 20_000 }))
    if (other && isGone(parsed.summary, other.id)) {
      picked = null
      goneNotice = `Sitzung „${other.title}“ ist nicht mehr da`
      error = ''
    } else {
      if (parsed.summary) summary = parsed.summary
      error = parsed.error
    }
    // Live agents and the reported cost belong to this session alone.
    live = other ? [] : (await $.agent.list()).map((a) => ({ id: a.id, status: a.status }))
    reported = other ? null : reportedCost((await $.session.usage()).cost)
  } catch (err) {
    error = startError(err)
  } finally {
    isBusy = false
  }
  $.ui.invalidate('ui.render')
}

async function openPane($: EngineInterface, byUser: boolean): Promise<void> {
  hasOpened = true
  lastList = Number.NEGATIVE_INFINITY
  const opened = await $.ui.open(byUser ? { id: PANE, title: 'Agents', focus: true, closeOnEscape: true } : { id: PANE, title: 'Agents' })
  isPaneOpen = opened.isPlaced
  void refresh($)
}

// A pane listing that fails leaves what the opens and closes of this plugin say.
async function isShown($: EngineInterface): Promise<boolean> {
  try {
    return isOpen(await $.ui.panes(), PANE)
  } catch {
    return isPaneOpen
  }
}

// The plain text drawing, for when the graphic one cannot be built.
function textTree({ Box, Text, Button }: TextUi, v: View, redraw: () => void) {
  return Box({
    flexDirection: 'column',
    children: [
      Text({ bold: true, wrap: 'truncate-end', children: [v.gens ? `${v.title} · ${v.gens}` : v.title] }),
      ...(v.subtitle ? [Text({ dimColor: true, children: [v.subtitle] })] : []),
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
          : visibleRows(g, false).flatMap((r) => [
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
        ...(!collapsed.has(g.key) && moreLine(g, false) ? [Text({ dimColor: true, children: [moreLine(g, false)] })] : []),
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
    if (await isShown($)) await $.ui.close({ id: PANE })
    else await openPane($, true)
    return {}
  })

  // The person's close arrives here too, so a denied listing still knows the pane is gone.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    const result = await next(e)
    isPaneOpen = false
    return result
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
    const redraw = () => $.ui.invalidate('ui.render')
    let v: View
    let now: number
    const other = picked
    try {
      now = await $.clock.now()
      v = buildView({ summary, live, reportedCostUsd: reported, costIncludesAgents: REPORTED_COST_INCLUDES_AGENTS, now, error: error || goneNotice, foreign: other ? { title: other.title, isLive: other.isLive } : null })
    } catch (err) {
      return Text({ color: 'warning', children: [`⚠ ${err instanceof Error ? err.message : String(err)}`] })
    }
    try {
      // The terminal draws cells and rasters; every other surface draws SVG, which has no key of its own.
      const isTerminal = e.surface === 'terminal'
      const { isWide, barCells, cardBarCells } = layoutOf(e.props.bodyColumns, isTerminal)
      // The SVG is wider than any pane and stretches to the slot, so it needs its height given.
      const svg = (key: string, source: string, alt: string, height: number) => Box({ key, children: e.surface === 'terminal' ? [] : [$.ui.resolve(e).Svg({ source, alt, height })] })
      // The alt is words of its own: a key can hold an agent id, and the host refuses a control character in an alt.
      const bar = (key: string, alt: string, parts: BarPart[], source: string, height: number, cells: number) => isTerminal
        ? Box({ key, flexDirection: 'row', children: blockBar(parts, cells, palette.track).map((s) => Text({ color: s.color, children: [s.text] })) })
        : svg(key, source, alt, height)
      const crab = (g: Group) => isTerminal
        ? $.ui.resolve(e).Raster({ key: `crab-${g.role}`, ...crabRaster(costumeOf(g.role)) })
        : Box({ key: `crab-${g.role}`, children: [$.ui.resolve(e).Svg({ source: crabSvg(costumeOf(g.role), g.isRunning), alt: `Krabbe ${g.title}` })] })
      const colored = (items: StatusItem[]) => items.flatMap((item, i) => [...(i ? [Text({ children: [' '] })] : []), Text({ color: STATUS_COLOR[item.status], children: [item.text] })])
      // A section head reads in grey capitals; folded, it carries its summary after the name.
      const heading = (key: string, isOpen: boolean, name: string, folded: ReturnType<typeof Text>[], onPress: () => void) => Button({ key, plain: true, onPress, children: [
        Text({ bold: true, color: 'inactive', children: [`${isOpen ? '▾' : '▸'} ${name.toUpperCase()}`] }),
        ...(isOpen ? [] : [Text({ children: ['   '] }), ...folded]),
      ] })
      // A blank line above each agent sets it apart from the cost bar and from the agent before.
      const row = (r: Row) => [Box({ key: `row-${r.key}`, flexDirection: 'column', marginTop: 1, children: [
        Box({ key: `line-${r.key}`, flexDirection: 'row', justifyContent: 'space-between', columnGap: 2, children: [
          Box({ flexDirection: 'row', children: [
            Text({ color: STATUS_COLOR[r.status], children: [`${r.glyph} `] }),
            Button({ key: `r-${r.key}`, plain: true, label: r.label, onPress: () => { toggle(expanded, r.key); redraw() } }),
          ] }),
          Text({ dimColor: true, wrap: 'truncate-end', children: [r.meta] }),
        ] }),
        bar(`stripe-${r.key}`, 'Tokenverteilung', tokenParts(palette, r.shares), stripeSvg(palette, r.shares, 6), 6, cardBarCells),
        ...(expanded.has(r.key) ? [Text({ dimColor: true, children: [detailLine(r)] })] : []),
      ] })]
      const group = (g: Group) => {
        const isGroupOpen = !collapsed.has(g.key)
        const body = [
          Box({ flexDirection: 'row', justifyContent: 'space-between', children: [
            Button({ key: `g-${g.key}`, plain: true, onPress: () => { toggle(collapsed, g.key); redraw() }, children: [
              Text({ bold: true, children: [`${isGroupOpen ? '▾' : '▸'} ${g.title}  `] }),
              ...colored(countItems(g.counts)),
            ] }),
            Text({ bold: true, children: [g.cost] }),
          ] }),
          ...(isGroupOpen ? [bar(`cost-${g.key}`, 'Kostenanteil', costParts(g.costShare), costBarSvg(palette, g.costShare), COST_H, cardBarCells), ...visibleRows(g, isHidingDone).flatMap(row)] : []),
          ...(isGroupOpen && moreLine(g, isHidingDone) ? [Text({ dimColor: true, children: [moreLine(g, isHidingDone)] })] : []),
        ]
        // A terminal keeps its own background; a desktop card stands off the pane as in the draft.
        return Box({ key: `card-${g.key}`, flexDirection: 'row', borderStyle: 'round', paddingX: 1, columnGap: CARD_GAP,
          ...(isTerminal ? {} : { backgroundColor: palette.card, borderColor: palette.border }), children: [
          ...(isWide ? [crab(g)] : []),
          Box({ flexDirection: 'column', flexGrow: 1, children: body }),
        ] })
      }
      const keys = legendColors(palette)
      const amount = (color: string, name: string, value: string) => Box({ flexDirection: 'row', children: [
        Text({ color, children: ['■ '] }), Text({ dimColor: true, children: [`${name} `] }), Text({ bold: true, children: [value] }),
      ] })
      // The picker sits beside the title in a wide pane, on a row of its own in a narrow one.
      // A surface without a Select (mobile) shows the title alone.
      const table = $.ui.resolve(e)
      const picker = 'Select' in table
        ? [table.Select({
            key: 'session',
            value: other ? other.id : OWN,
            options: pickerOptions(sessions, picked, now),
            onSelect: (value: string) => { goneNotice = ''; picked = value === OWN ? null : sessions.find((s) => s.id === value) ?? picked; void refresh($) },
          })]
        : []
      return Box({ flexDirection: 'column', children: [
        Box({ key: 'title-row', flexDirection: 'row', justifyContent: 'space-between', columnGap: 2, children: [
          Box({ key: 'title', flexDirection: 'row', flexShrink: 1, children: [
            Text({ bold: true, wrap: 'truncate-end', children: [v.title] }),
            ...(v.gens ? [Text({ dimColor: true, wrap: 'truncate-end', children: [` · ${v.gens}`] })] : []),
          ] }),
          ...(isWide ? [Box({ key: 'picker-slot', flexShrink: 0, children: picker })] : []),
        ] }),
        ...(isWide ? [] : picker),
        ...(v.subtitle ? [Text({ dimColor: true, children: [v.subtitle] })] : []),
        ...v.notices.map((n) => Text({ color: 'warning', wrap: 'truncate-end', children: [n] })),
        heading('sec-overview', isOverviewOpen, 'Übersicht', [Text({ dimColor: true, children: [v.overview.line] })], () => { isOverviewOpen = !isOverviewOpen; redraw() }),
        ...(isOverviewOpen ? [
          isTerminal
            ? Text({ bold: true, children: [`Kosten ${v.overview.cost} · Tokens ${v.overview.tokens} · Zeit ${v.overview.time}`] })
            // Boxes, not SVG: an SVG stretched to the slot would stretch its text with it.
            : Box({ key: 'tiles', flexDirection: 'row', columnGap: 1, children: [{ label: 'Kosten', value: v.overview.cost }, { label: 'Tokens', value: v.overview.tokens }, { label: 'Zeit', value: v.overview.time }].map(({ label, value }) =>
                Box({ flexDirection: 'column', width: '33%', flexGrow: 1, flexShrink: 1, paddingX: 1, borderStyle: 'round', borderColor: palette.tile, backgroundColor: palette.tile, children: [
                  Text({ dimColor: true, children: [label] }), Text({ bold: true, children: [value] }),
                ] })) }),
          ...(v.overview.unpriced ? [Text({ color: 'warning', children: [v.overview.unpriced] })] : []),
          Box({ key: 'stripe-room', marginTop: 1, children: [bar('stripe-total', 'Tokenverteilung', tokenParts(palette, v.overview.shares), stripeSvg(palette, v.overview.shares, 10), 10, barCells)] }),
          Box({ key: 'legend', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: 2, children: [
            amount(keys.input, 'in', v.overview.amounts.input), amount(keys.output, 'out', v.overview.amounts.output),
            amount(keys.cacheRead, 'cache read', v.overview.amounts.cacheRead), amount(keys.cacheWrite, 'cache write', v.overview.amounts.cacheWrite),
          ] }),
        ] : []),
        isTerminal
          ? Box({ key: 'rule-agents', marginTop: 1, marginBottom: 1, children: [Text({ dimColor: true, children: ['─'.repeat(barCells)] })] })
          : Box({ key: 'rule-agents', marginTop: 1, marginBottom: 1, children: [$.ui.resolve(e).Svg({ source: ruleSvg(palette), alt: 'Trennlinie', height: RULE_H })] }),
        // A narrow terminal has no room beside the heading, so the buttons get a row of their own that wraps.
        ...((() => {
          const tools = isAgentsOpen ? [Box({ key: 'agents-tools', flexDirection: 'row', flexWrap: 'wrap', columnGap: 1, children: [
            Button({ key: 'hide-done', variant: isHidingDone ? 'primary' : 'secondary', label: 'Fertige ausblenden', onPress: () => { isHidingDone = !isHidingDone; redraw() } }),
            Button({ key: 'fold-all', variant: 'secondary', label: 'Alle einklappen', onPress: () => { for (const g of v.groups) collapsed.add(g.key); redraw() } }),
            Button({ key: 'open-all', variant: 'secondary', label: 'Alle ausklappen', onPress: () => { collapsed.clear(); redraw() } }),
          ] })] : []
          const head = Box({ key: 'agents-head', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: 2, children: [
            heading('sec-agents', isAgentsOpen, 'Agents', colored(countItems(v.status)), () => { isAgentsOpen = !isAgentsOpen; redraw() }),
            ...(isWide ? tools : []),
          ] })
          return isWide ? [head] : [head, ...tools]
        })()),
        ...(isAgentsOpen ? [
          Box({ key: 'status-room', marginTop: 1, children: [bar('status', 'Statusverteilung', statusParts(v.status), statusSvg(palette, v.status), STATUS_H, barCells)] }),
          Box({ key: 'status-line', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: 2, children: statusItems(v.status).map((item) => Text({ color: STATUS_COLOR[item.status], children: [item.text] })) }),
          // A line of space between the role cards.
          Box({ key: 'cards', flexDirection: 'column', rowGap: 1, children: v.groups.map(group) }),
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
