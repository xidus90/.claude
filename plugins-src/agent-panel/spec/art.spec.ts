import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CARD_GAP, DARK, LIGHT, STATUS_COLOR, SVG_LIMIT, SVG_W, blockBar, costBarSvg, costParts, crabRaster, crabSvg, layoutOf, legendColors, paletteOf, ruleSvg, statusParts, statusSvg, stripeSvg, tokenColors, tokenParts } from '../hooks/art.ts'

const shares = { input: 0.1, output: 0.2, cacheRead: 0.6, cacheWrite: 0.1 }

test('picks the dark palette for a dark theme and light otherwise', () => {
  assert.equal(paletteOf('dark'), DARK)
  assert.equal(paletteOf('dark-daltonized'), DARK)
  assert.equal(paletteOf('light'), LIGHT)
  assert.equal(paletteOf(undefined), LIGHT)
  assert.equal(paletteOf(true), LIGHT)
})

test('draws every bar wider than a pane and free to stretch, so the host fits it to the slot', () => {
  const pieces = [stripeSvg(LIGHT, shares, 6), statusSvg(LIGHT, { running: 1, done: 0, failed: 0, aborted: 0 }), costBarSvg(LIGHT, 0.5), ruleSvg(LIGHT)]
  for (const p of pieces) {
    assert.match(p, new RegExp(`^<svg [^>]*width="${SVG_W}"[^>]*preserveAspectRatio="none"`))
    assert.doesNotMatch(p, /<text/)
  }
})

test('widens the round ends by what the stretch takes away, so they stay round in a pane of the usual width', () => {
  assert.match(stripeSvg(LIGHT, shares, 6), /<rect x="0" y="0" width="100%" height="6" rx="8.57" ry="3" fill="#efece6"\/>/)
})

test('draws the separator line in the border colour of the palette', () => {
  assert.ok(ruleSvg(DARK).includes(DARK.border))
  assert.ok(ruleSvg(LIGHT).includes(LIGHT.border))
})

test('gives the cards a background and border of their own in each palette', () => {
  assert.deepEqual([LIGHT.card, LIGHT.border], ['#ffffff', '#e9e7e2'])
  assert.deepEqual([DARK.card, DARK.border], ['#262523', '#3a3936'])
})

test('marks cache read in the legend darker than its light bar, so the square shows on white', () => {
  assert.equal(legendColors(LIGHT).cacheRead, '#b9b5ac')
  assert.equal(legendColors(DARK).cacheRead, DARK.cacheRead)
  assert.equal(legendColors(LIGHT).input, tokenColors(LIGHT).input)
})

test('draws a token stripe with one rect per non-empty share, and only the track for no tokens', () => {
  const svg = stripeSvg(LIGHT, shares, 10)
  const colors = tokenColors(LIGHT)
  for (const c of Object.values(colors)) assert.ok(svg.includes(c), c)
  assert.equal((stripeSvg(LIGHT, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, 6).match(/<rect/g) ?? []).length, 2)
  assert.ok(stripeSvg(DARK, shares, 6).includes(DARK.cacheRead))
})

test('draws the status bar in the status colours, skipping empty statuses', () => {
  const svg = statusSvg(LIGHT, { running: 2, done: 9, failed: 1, aborted: 0 })
  assert.ok(svg.includes(STATUS_COLOR.running) && svg.includes(STATUS_COLOR.done) && svg.includes(STATUS_COLOR.failed))
  assert.ok(!svg.includes(STATUS_COLOR.aborted))
  assert.equal((statusSvg(LIGHT, { running: 0, done: 0, failed: 0, aborted: 0 }).match(/<rect/g) ?? []).length, 2)
})

// Width of the cost bar's fill rect, or null when only the track is drawn.
const costFill = (svg: string): string | null => /<rect x="0%" y="0" width="([^"]+)" height="5" fill="#8f8cf4"\/>/.exec(svg)?.[1] ?? null

test('draws the cost bar as a share of the track, clamped to 0..1', () => {
  assert.equal(costFill(costBarSvg(LIGHT, 0.25)), '25%')
  assert.equal(costFill(costBarSvg(LIGHT, 2)), '100%')
  assert.equal(costFill(costBarSvg(LIGHT, 0)), null)
  assert.equal(costFill(costBarSvg(LIGHT, -1)), null)
  assert.equal((costBarSvg(LIGHT, 0).match(/<rect/g) ?? []).length, 2)
})

test('draws only the track for a cost share that is not a finite number', () => {
  for (const share of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const svg = costBarSvg(LIGHT, share)
    assert.equal(costFill(svg), null, String(share))
    assert.ok(!svg.includes('NaN') && !svg.includes('Infinity'), String(share))
  }
})

test('splits token shares into bar parts in the order of the token colours', () => {
  const c = tokenColors(LIGHT)
  assert.deepEqual(tokenParts(LIGHT, shares), [
    { share: 0.1, color: c.input }, { share: 0.2, color: c.output }, { share: 0.6, color: c.cacheRead }, { share: 0.1, color: c.cacheWrite },
  ])
})

test('splits status counts into bar parts, all empty for no agents', () => {
  assert.deepEqual(statusParts({ running: 1, done: 2, failed: 1, aborted: 0 }), [
    { share: 0.25, color: STATUS_COLOR.running }, { share: 0.5, color: STATUS_COLOR.done },
    { share: 0.25, color: STATUS_COLOR.failed }, { share: 0, color: STATUS_COLOR.aborted },
  ])
  assert.deepEqual(statusParts({ running: 0, done: 0, failed: 0, aborted: 0 }).map((p) => p.share), [0, 0, 0, 0])
})

test('makes one cost bar part, clamped to 0..1 and empty for a share that is not finite', () => {
  assert.deepEqual(costParts(0.4), [{ share: 0.4, color: '#8f8cf4' }])
  assert.equal(costParts(2)[0]?.share, 1)
  assert.equal(costParts(-1)[0]?.share, 0)
  assert.equal(costParts(Number.NaN)[0]?.share, 0)
})

test('sizes the bars to the terminal cells the pane and its crab card leave', () => {
  assert.deepEqual(layoutOf(80, true), { isWide: true, barCells: 76, cardBarCells: 60 })
  // The 80 columns hold the card's border and padding (4), the crab raster, the gap and the bar.
  assert.equal(layoutOf(80, true).cardBarCells + 4 + crabRaster('plain').columns + CARD_GAP, 80)
  assert.deepEqual(layoutOf(70, true), { isWide: true, barCells: 66, cardBarCells: 50 })
  assert.deepEqual(layoutOf(69, true), { isWide: false, barCells: 65, cardBarCells: 65 })
  assert.deepEqual(layoutOf(undefined, true), { isWide: false, barCells: 36, cardBarCells: 36 })
  assert.equal(layoutOf(8, true).barCells, 10)
})

test('counts a desktop pane as wide at any column count, since it lays out in pixels', () => {
  assert.equal(layoutOf(40, false).isWide, true)
  assert.equal(layoutOf(undefined, false).isWide, true)
})

test('draws the crab at the size of the draft', () => {
  assert.match(crabSvg('plain', false), /^<svg [^>]*width="36" height="34"/)
})

test('animates a running crab only, and honours reduced motion', () => {
  const run = crabSvg('verifier', true)
  assert.ok(run.includes('class="run"') && run.includes('prefers-reduced-motion'))
  assert.ok(!crabSvg('verifier', false).includes('class="run"'))
  assert.ok(run.includes('#2F6DB5'))
})

test('keeps every piece under the SVG limit with 200 agents', () => {
  const pieces = Array.from({ length: 200 }, () => [stripeSvg(LIGHT, shares, 6), costBarSvg(LIGHT, 0.5), crabSvg('browser', true)]).flat()
  for (const p of pieces) assert.ok(p.length < SVG_LIMIT)
  assert.ok(statusSvg(LIGHT, { running: 50, done: 140, failed: 5, aborted: 5 }).length < SVG_LIMIT)
})

test('builds a block bar of the given width from shares', () => {
  const bar = blockBar([{ share: 0.5, color: '#111111' }, { share: 0.25, color: '#222222' }], 8, '#999999')
  assert.deepEqual(bar, [{ text: '▄▄▄▄', color: '#111111' }, { text: '▄▄', color: '#222222' }, { text: '▄▄', color: '#999999' }])
  assert.deepEqual(blockBar([], 3, '#999999'), [{ text: '▄▄▄', color: '#999999' }])
  assert.deepEqual(blockBar([{ share: 1, color: '#111111' }], 2, '#999999'), [{ text: '▄▄', color: '#111111' }])
})

test('gives every block bar part above zero a cell, taken from the widest, within the width', () => {
  const bar = blockBar([{ share: 0, color: '#111111' }, { share: 0.01, color: '#222222' }, { share: 0.9, color: '#333333' }, { share: 0.5, color: '#444444' }], 4, '#999999')
  assert.deepEqual(bar, [{ text: '▄', color: '#222222' }, { text: '▄▄', color: '#333333' }, { text: '▄', color: '#444444' }])
  // The lead of a real session: 8 in, 263 out, 158k cache read, 33k cache write.
  const lead = blockBar([{ share: 0.00004, color: 'in' }, { share: 0.0014, color: 'out' }, { share: 0.827, color: 'read' }, { share: 0.171, color: 'write' }], 60, 'track')
  assert.deepEqual(lead.map((s) => [s.color, s.text.length]), [['in', 1], ['out', 1], ['read', 48], ['write', 10]])
  // A tiny part beside a short track takes the track's cell first.
  assert.deepEqual(blockBar([{ share: 0.01, color: 'a' }, { share: 0.5, color: 'b' }], 4, 't').map((s) => [s.color, s.text.length]), [['a', 1], ['b', 2], ['t', 1]])
  // No more parts than cells: a part that finds no cell left to take stays out.
  assert.deepEqual(blockBar([{ share: 0.5, color: 'a' }, { share: 0.25, color: 'b' }, { share: 0.25, color: 'c' }], 2, 't').map((s) => s.color), ['a', 'b'])
})

test('draws every SVG bar part above zero at least a terminal cell wide', () => {
  const svg = stripeSvg(LIGHT, { input: 0.0001, output: 0, cacheRead: 0.9, cacheWrite: 0.0999 }, 6)
  assert.match(svg, new RegExp(`<rect x="0%" y="0" width="1.25%" height="6" fill="#8f8cf4"/>`))
  assert.doesNotMatch(svg, /fill="#5fbf8f"/)
})

const cells = (bar: { text: string; color: string }[], color: string): number => bar.filter((s) => s.color === color).reduce((n, s) => n + s.text.length, 0)

test('keeps a status worth a whole cell when the parts before it round up', () => {
  // Running and done are worth 4.5 cells each; the first rounds up to 5, and the failed part, worth one cell, still gets its cell.
  const bar = blockBar(statusParts({ running: 9, done: 9, failed: 2, aborted: 0 }), 10, '#999999')
  assert.equal(cells(bar, STATUS_COLOR.failed), 1)
})

test('fills the whole block bar when the shares add up to one', () => {
  const third = 1 / 3
  const bar = blockBar([{ share: third, color: '#111111' }, { share: third, color: '#222222' }, { share: third, color: '#333333' }], 10, '#999999')
  assert.equal(cells(bar, '#999999'), 0)
})

test('keeps a status worth exactly a cell although the running share sums to just under a half', () => {
  // 2 of 20 is one cell at 10, but (2 + 7 + 2) / 20 * 10 comes out as 5.499999999999999.
  const bar = blockBar(statusParts({ running: 2, done: 7, failed: 2, aborted: 9 }), 10, '#999999')
  assert.equal(cells(bar, STATUS_COLOR.failed), 1)
})

test('gives every status worth a whole cell its cell and fills the bar, for any counts', () => {
  const statuses = ['running', 'done', 'failed', 'aborted'] as const
  for (let width = 10; width <= 20; width++) {
    for (let n = 0; n < 10 ** 4; n++) {
      const counts = { running: n % 10, done: Math.floor(n / 10) % 10, failed: Math.floor(n / 100) % 10, aborted: Math.floor(n / 1000) }
      const total = counts.running + counts.done + counts.failed + counts.aborted
      if (total === 0) continue
      const bar = blockBar(statusParts(counts), width, '#999999')
      assert.equal(cells(bar, '#999999'), 0, `${width} ${JSON.stringify(counts)}`)
      for (const k of statuses) if (counts[k] * width >= total) assert.ok(cells(bar, STATUS_COLOR[k]) >= 1, `${width} ${k} ${JSON.stringify(counts)}`)
    }
  }
})

test('packs the crab into a 15×7 raster of half blocks', () => {
  const r = crabRaster('plain')
  assert.equal(r.columns, 15)
  assert.equal(r.rows, 7)
  const bytes = Uint8Array.from(atob(r.cells), (ch) => ch.charCodeAt(0))
  assert.equal(bytes.length, 15 * 7 * 12)
  const words = new Uint32Array(bytes.buffer)
  const chars = new Set<number>()
  for (let i = 0; i < words.length; i += 3) chars.add(words[i] as number)
  for (const c of chars) assert.ok([0x20, 0x2580, 0x2584].includes(c), c.toString(16))
  assert.ok(chars.has(0x2580) && chars.has(0x20))
})

test('uses a lower half block where only the bottom pixel is set', () => {
  // The body's top edge and the claws begin on a cell's lower sampled row, so those cells carry only their lower pixel.
  const words = new Uint32Array(Uint8Array.from(atob(crabRaster('plain').cells), (ch) => ch.charCodeAt(0)).buffer)
  const chars: number[] = []
  for (let i = 0; i < words.length; i += 3) chars.push(words[i] as number)
  assert.ok(chars.includes(0x2584))
})
