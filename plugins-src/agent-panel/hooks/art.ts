import { GRID_H, GRID_W, pixelGrid, spriteOf, type Part } from './sprites.ts'
import type { Shares, Status, StatusCounts } from './view.ts'

export type Palette = { name: 'light' | 'dark'; tile: string; track: string; ink: string; sub: string; cacheRead: string }

export const LIGHT: Palette = { name: 'light', tile: '#f1efea', track: '#efece6', ink: '#1f1f1f', sub: '#6b6b68', cacheRead: '#d8d5ce' }
export const DARK: Palette = { name: 'dark', tile: '#2b2a28', track: '#3a3936', ink: '#ecebe8', sub: '#a3a29e', cacheRead: '#5a5853' }

export const STATUS_COLOR: Record<Status, string> = { running: '#1d6fb8', done: '#2f8a52', failed: '#c0392b', aborted: '#b07a12' }

export const tokenColors = (p: Palette): Record<keyof Shares, string> => ({ input: '#8f8cf4', output: '#5fbf8f', cacheRead: p.cacheRead, cacheWrite: '#f0b35b' })

const COST_COLOR = '#8f8cf4'

export const SVG_W = 320
const MIN_PART = SVG_W / 80
export const SVG_LIMIT = 131_072

export function paletteOf(theme: unknown): Palette {
  return typeof theme === 'string' && theme.includes('dark') ? DARK : LIGHT
}

export type BarPart = { share: number; color: string }

export const tokenParts = (p: Palette, s: Shares): BarPart[] => {
  const c = tokenColors(p)
  return [{ share: s.input, color: c.input }, { share: s.output, color: c.output }, { share: s.cacheRead, color: c.cacheRead }, { share: s.cacheWrite, color: c.cacheWrite }]
}

export function statusParts(c: StatusCounts): BarPart[] {
  const total = c.running + c.done + c.failed + c.aborted
  const order: Status[] = ['running', 'done', 'failed', 'aborted']
  return order.map((k) => ({ share: total > 0 ? c[k] / total : 0, color: STATUS_COLOR[k] }))
}

export const costParts = (share: number): BarPart[] => [{ share: Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : 0, color: COST_COLOR }]

// A terminal pane at least this many columns wide draws a crab beside each role.
export const WIDE_COLUMNS = 70
export const CRAB_COLUMNS = GRID_W / 2
export const CARD_GAP = 1
// The role card's round border and its padding of one cell on each side.
const CARD_FRAME = 4

// Cells for the bars: those across the pane, and those inside a card, which lose the crab and its gap.
export function layoutOf(bodyColumns: number | undefined): { isWide: boolean; barCells: number; cardBarCells: number } {
  const isWide = (bodyColumns ?? 0) >= WIDE_COLUMNS
  const barCells = Math.max(10, (bodyColumns ?? 40) - CARD_FRAME)
  return { isWide, barCells, cardBarCells: Math.max(10, barCells - (isWide ? CRAB_COLUMNS + CARD_GAP : 0)) }
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const doc = (w: number, h: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`

const FONT = 'font-family="system-ui,sans-serif"'

export function tilesSvg(p: Palette, tiles: { label: string; value: string }[]): string {
  const gap = 6
  const w = (SVG_W - gap * (tiles.length - 1)) / tiles.length
  const body = tiles.map((t, i) => {
    const x = i * (w + gap)
    return `<rect x="${x}" y="0" width="${w}" height="42" rx="8" fill="${p.tile}"/>` +
      `<text x="${x + 8}" y="15" ${FONT} font-size="11" fill="${p.sub}">${esc(t.label)}</text>` +
      `<text x="${x + 8}" y="34" ${FONT} font-size="15" font-weight="600" fill="${p.ink}">${esc(t.value)}</text>`
  }).join('')
  return doc(SVG_W, 42, body)
}

// Segments laid end to end over a rounded track; empty segments draw nothing.
function segments(parts: BarPart[], height: number, track: string): string {
  let x = 0
  let body = `<rect x="0" y="0" width="${SVG_W}" height="${height}" rx="${height / 2}" fill="${track}"/>`
  for (const part of parts) {
    if (part.share <= 0) continue
    // As in the terminal, a part above zero stays visible: at least a cell's width of an 80-column bar.
    const w = Math.max(part.share * SVG_W, MIN_PART)
    body += `<rect x="${x}" y="0" width="${w}" height="${height}" fill="${part.color}"/>`
    x += w
  }
  return `<defs><clipPath id="c"><rect width="${SVG_W}" height="${height}" rx="${height / 2}"/></clipPath></defs><g clip-path="url(#c)">${body}</g>`
}

export function stripeSvg(p: Palette, s: Shares, height: number): string {
  return doc(SVG_W, height, segments(tokenParts(p, s), height, p.track))
}

export function statusSvg(p: Palette, c: StatusCounts): string {
  return doc(SVG_W, 10, segments(statusParts(c), 10, p.track))
}

export function costBarSvg(p: Palette, share: number): string {
  return doc(SVG_W, 5, segments(costParts(share), 5, p.track))
}

// Pure CSS, run by the compositor: a running crab lifts its two leg groups in turn.
const CRAB_CSS = '<style>.run .la{animation:st .5s steps(1) infinite}.run .lb{animation:st .5s steps(1) infinite -.25s}' +
  '.run .bd{animation:bob .5s steps(1) infinite -.125s}@keyframes st{50%{transform:translateY(-1px)}}' +
  '@keyframes bob{50%{transform:translateY(1px)}}@media (prefers-reduced-motion: reduce){.run *{animation:none!important}}</style>'

export function crabSvg(costume: string, isRunning: boolean): string {
  const parts: Record<Part, string[]> = { bd: [], la: [], lb: [] }
  for (const [x, y, w, h, color, part] of spriteOf(costume)) {
    parts[part ?? 'bd'].push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}"/>`)
  }
  const body = `<g${isRunning ? ' class="run"' : ''}><g class="bd">${parts.bd.join('')}</g><g class="la">${parts.la.join('')}</g><g class="lb">${parts.lb.join('')}</g></g>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="41" viewBox="0 0 ${GRID_W} ${GRID_H}" shape-rendering="crispEdges">${CRAB_CSS}${body}</svg>`
}

export type Segment = { text: string; color: string }

export function blockBar(parts: BarPart[], width: number, track: string): Segment[] {
  const cells = parts.map(() => 0)
  let used = 0
  let sum = 0
  // A lower half block draws the bar half a line high, the track in its own color.
  // Round the running total, not each part: shares summing to one fill the bar and a part worth a whole cell keeps one.
  // The nudge lifts sums a float short of an exact half (5.499…) over it.
  parts.forEach((part, i) => {
    sum += part.share
    const n = Math.min(width, Math.round(sum * width + 1e-9)) - used
    if (n <= 0) return
    cells[i] = n
    used += n
  })
  // A part above zero that rounded to no cell still shows: it takes a cell of the track, else one of the widest part.
  parts.forEach((part, i) => {
    if (part.share <= 0 || cells[i] !== 0) return
    if (used < width) {
      cells[i] = 1
      used += 1
      return
    }
    const widest = cells.indexOf(Math.max(...cells))
    if ((cells[widest] as number) < 2) return
    cells[widest] = (cells[widest] as number) - 1
    cells[i] = 1
  })
  const out: Segment[] = parts.flatMap((part, i) => (cells[i] ? [{ text: '▄'.repeat(cells[i] as number), color: part.color }] : []))
  if (used < width) out.push({ text: '▄'.repeat(width - used), color: track })
  return out
}

const DEFAULT_COLOR = 0x01000000
const UPPER = 0x2580
const LOWER = 0x2584
const SPACE = 0x20

const rgb = (hex: string): number => Number.parseInt(hex.slice(1), 16)

// Every second column and row of the 30×28 grid, two sampled rows per terminal row.
export function crabRaster(costume: string): { columns: number; rows: number; cells: string } {
  const grid = pixelGrid(spriteOf(costume))
  const columns = CRAB_COLUMNS
  const rows = GRID_H / 4
  const words: number[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const top = grid[r * 4]?.[c * 2] ?? null
      const bottom = grid[r * 4 + 2]?.[c * 2] ?? null
      if (top && bottom) words.push(UPPER, rgb(top), rgb(bottom))
      else if (top) words.push(UPPER, rgb(top), DEFAULT_COLOR)
      else if (bottom) words.push(LOWER, rgb(bottom), DEFAULT_COLOR)
      else words.push(SPACE, DEFAULT_COLOR, DEFAULT_COLOR)
    }
  }
  const bytes = new Uint8Array(Uint32Array.from(words).buffer)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return { columns, rows, cells: btoa(bin) }
}
