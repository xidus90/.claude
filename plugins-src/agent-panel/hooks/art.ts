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
function segments(parts: { share: number; color: string }[], height: number, track: string): string {
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
  const c = tokenColors(p)
  return doc(SVG_W, height, segments([
    { share: s.input, color: c.input }, { share: s.output, color: c.output },
    { share: s.cacheRead, color: c.cacheRead }, { share: s.cacheWrite, color: c.cacheWrite },
  ], height, p.track))
}

export function statusSvg(p: Palette, c: StatusCounts): string {
  const total = c.running + c.done + c.failed + c.aborted
  const order: Status[] = ['running', 'done', 'failed', 'aborted']
  const parts = order.map((k) => ({ share: total > 0 ? c[k] / total : 0, color: STATUS_COLOR[k] }))
  return doc(SVG_W, 10, segments(parts, 10, p.track))
}

export function costBarSvg(p: Palette, share: number): string {
  const s = Math.min(1, Math.max(0, share))
  return doc(SVG_W, 5, segments([{ share: s, color: COST_COLOR }], 5, p.track))
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

export function blockBar(parts: { share: number; color: string }[], width: number, track: string): Segment[] {
  const out: Segment[] = []
  let used = 0
  for (const part of parts) {
    const n = Math.min(width - used, Math.round(part.share * width))
    if (n <= 0) continue
    out.push({ text: '█'.repeat(n), color: part.color })
    used += n
  }
  if (used < width) out.push({ text: '░'.repeat(width - used), color: track })
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
  const at = (y: number, x: number): string | null => (grid[y] as (string | null)[])[x] as string | null
  const columns = GRID_W / 2
  const rows = GRID_H / 4
  const words: number[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const top = at(r * 4, c * 2)
      const bottom = at(r * 4 + 2, c * 2)
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
