import { GRID_H, GRID_W, pixelGrid, spriteOf, type Part } from './sprites.ts'
import type { Shares, Status, StatusCounts } from './view.ts'

export type Palette = { name: 'light' | 'dark'; tile: string; track: string; ink: string; sub: string; cacheRead: string }

export const LIGHT: Palette = { name: 'light', tile: '#f1efea', track: '#efece6', ink: '#1f1f1f', sub: '#6b6b68', cacheRead: '#d8d5ce' }
export const DARK: Palette = { name: 'dark', tile: '#2b2a28', track: '#3a3936', ink: '#ecebe8', sub: '#a3a29e', cacheRead: '#5a5853' }

export const STATUS_COLOR: Record<Status, string> = { running: '#1d6fb8', done: '#2f8a52', failed: '#c0392b', aborted: '#b07a12' }

export const tokenColors = (p: Palette): Record<keyof Shares, string> => ({ input: '#8f8cf4', output: '#5fbf8f', cacheRead: p.cacheRead, cacheWrite: '#f0b35b' })

const COST_COLOR = '#8f8cf4'

export const SVG_W = 320
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
// Pixels per side of the block one half cell of the terminal crab stands for.
const BLOCK = 3
export const CRAB_COLUMNS = Math.ceil(GRID_W / BLOCK)
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
    const w = part.share * SVG_W
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
  const out: Segment[] = []
  let used = 0
  let sum = 0
  // A lower half block draws the bar half a line high, the track in its own color.
  // Round the running total, not each part: shares summing to one fill the bar and a part worth a whole cell keeps one,
  // while a part below a cell may still get none. The nudge lifts sums a float short of an exact half (5.499…) over it.
  for (const part of parts) {
    sum += part.share
    const n = Math.min(width, Math.round(sum * width + 1e-9)) - used
    if (n <= 0) continue
    out.push({ text: '▄'.repeat(n), color: part.color })
    used += n
  }
  if (used < width) out.push({ text: '▄'.repeat(width - used), color: track })
  return out
}

const DEFAULT_COLOR = 0x01000000
const UPPER = 0x2580
const LOWER = 0x2584
const SPACE = 0x20

const rgb = (hex: string): number => Number.parseInt(hex.slice(1), 16)

// The commonest color of a 3×3 block of the grid, so a thin leg or claw survives the shrink.
function blockColor(grid: (string | null)[][], y: number, x: number): string | null {
  const counts = new Map<string, number>()
  for (let dy = 0; dy < BLOCK; dy++) {
    for (let dx = 0; dx < BLOCK; dx++) {
      const color = grid[y + dy]?.[x + dx] ?? null
      if (color) counts.set(color, (counts.get(color) ?? 0) + 1)
    }
  }
  let best: string | null = null
  for (const [color, n] of counts) if (best === null || n > (counts.get(best) as number)) best = color
  return best
}

// One 3×3 block of the 30×28 grid per half cell, two blocks per terminal row.
export function crabRaster(costume: string): { columns: number; rows: number; cells: string } {
  const grid = pixelGrid(spriteOf(costume))
  const columns = CRAB_COLUMNS
  // Start at the sprite's first row and end at its last, so the raster has no blank line above or below.
  const first = grid.findIndex((row) => row.some(Boolean))
  const last = GRID_H - 1 - [...grid].reverse().findIndex((row) => row.some(Boolean))
  const rows = Math.ceil((last - first + 1) / (2 * BLOCK))
  const words: number[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const top = blockColor(grid, first + r * 2 * BLOCK, c * BLOCK)
      const bottom = blockColor(grid, first + r * 2 * BLOCK + BLOCK, c * BLOCK)
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
