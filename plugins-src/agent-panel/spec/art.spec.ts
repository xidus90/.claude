import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DARK, LIGHT, STATUS_COLOR, SVG_LIMIT, blockBar, costBarSvg, crabRaster, crabSvg, paletteOf, statusSvg, stripeSvg, tilesSvg, tokenColors } from '../hooks/art.ts'

const shares = { input: 0.1, output: 0.2, cacheRead: 0.6, cacheWrite: 0.1 }

test('picks the dark palette for a dark theme and light otherwise', () => {
  assert.equal(paletteOf('dark'), DARK)
  assert.equal(paletteOf('dark-daltonized'), DARK)
  assert.equal(paletteOf('light'), LIGHT)
  assert.equal(paletteOf(undefined), LIGHT)
  assert.equal(paletteOf(true), LIGHT)
})

test('draws the tiles with their labels and values in the palette', () => {
  const svg = tilesSvg(DARK, [{ label: 'Kosten', value: '≈ $4.12' }, { label: 'Tokens', value: '1.8M' }, { label: 'Zeit', value: '38:12' }])
  assert.match(svg, /^<svg /)
  assert.ok(svg.includes(DARK.tile) && svg.includes('Kosten') && svg.includes('38:12'))
  assert.ok(tilesSvg(LIGHT, [{ label: 'a', value: '<&>' }]).includes('&lt;&amp;&gt;'))
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
const costFill = (svg: string): string | null => /<rect x="0" y="0" width="([^"]+)" height="5" fill="#8f8cf4"\/>/.exec(svg)?.[1] ?? null

test('draws the cost bar as a share of the track, clamped to 0..1', () => {
  assert.equal(costFill(costBarSvg(LIGHT, 0.25)), '80')
  assert.equal(costFill(costBarSvg(LIGHT, 2)), '320')
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
  assert.deepEqual(bar, [{ text: '████', color: '#111111' }, { text: '██', color: '#222222' }, { text: '░░', color: '#999999' }])
  assert.deepEqual(blockBar([], 3, '#999999'), [{ text: '░░░', color: '#999999' }])
  assert.deepEqual(blockBar([{ share: 1, color: '#111111' }], 2, '#999999'), [{ text: '██', color: '#111111' }])
})

test('leaves out block bar parts that round to no cell and clips the rest to the width', () => {
  const bar = blockBar([{ share: 0, color: '#111111' }, { share: 0.01, color: '#222222' }, { share: 0.9, color: '#333333' }, { share: 0.5, color: '#444444' }], 4, '#999999')
  assert.deepEqual(bar, [{ text: '████', color: '#333333' }])
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
