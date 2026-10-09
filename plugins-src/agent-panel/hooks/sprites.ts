// The crab follows Pixel Clawd as savvy-progress draws it (claude-kit, MIT License,
// Copyright (c) 2026 johnnyvizz): a 24×18 crab on a 30×28 grid, legs in two
// groups so a walk can lift them in turn. The costumes are this plugin's own.

export type Part = 'bd' | 'la' | 'lb'
export type Pixel = readonly [x: number, y: number, w: number, h: number, color: string, part?: Part]

export const GRID_W = 30
export const GRID_H = 28

const CLAY = '#D97757'
const INK = '#1F1E1D'

const BODY: readonly Pixel[] = [
  [7, 10, 16, 12, CLAY], [3, 14, 4, 4, CLAY], [23, 14, 4, 4, CLAY],
  [9, 12, 2, 2, INK], [19, 12, 2, 2, INK],
  [7, 22, 2, 4, CLAY, 'la'], [17, 22, 2, 4, CLAY, 'la'], [11, 22, 2, 4, CLAY, 'lb'], [21, 22, 2, 4, CLAY, 'lb'],
]

export const COSTUMES: Record<string, { label: string; props: readonly Pixel[] }> = {
  lead: { label: 'Krone', props: [[9, 5, 12, 3, '#E3B341'], [9, 3, 2, 2, '#E3B341'], [14, 2, 2, 3, '#E3B341'], [19, 3, 2, 2, '#E3B341'], [14, 6, 2, 1, '#C0392B']] },
  backend: { label: 'Bauhelm', props: [[8, 6, 14, 4, '#F0B35B'], [6, 9, 18, 1, '#F0B35B'], [14, 5, 2, 1, '#F0B35B']] },
  frontend: { label: 'Pinsel', props: [[25, 6, 2, 8, '#8B5A2B'], [24, 3, 4, 3, '#8F8CF4'], [9, 7, 12, 3, '#8F8CF4']] },
  infra: { label: 'Schraubenschlüssel', props: [[25, 6, 2, 8, '#7A8794'], [23, 3, 6, 3, '#7A8794'], [25, 4, 2, 1, '#FBFAF8']] },
  ux: { label: 'Barett', props: [[8, 7, 14, 3, '#C2185B'], [13, 5, 6, 2, '#C2185B'], [15, 4, 2, 1, '#C2185B']] },
  verifier: { label: 'Lupe', props: [[23, 4, 6, 6, '#2F6DB5'], [24, 5, 4, 4, '#CFE3F7'], [24, 10, 2, 4, '#5A3E2B']] },
  reviewer: { label: 'Brille', props: [[8, 11, 4, 4, INK], [18, 11, 4, 4, INK], [9, 12, 2, 2, '#CFE3F7'], [19, 12, 2, 2, '#CFE3F7'], [12, 12, 6, 1, INK]] },
  security: { label: 'Schild', props: [[0, 10, 6, 8, '#2F8A52'], [1, 18, 4, 2, '#2F8A52'], [2, 12, 2, 4, '#E4F4EA']] },
  hunter: { label: 'Kescher', props: [[25, 8, 1, 8, '#8B5A2B'], [22, 2, 7, 6, '#5FBF8F'], [23, 3, 5, 4, '#E4F4EA']] },
  cleaner: { label: 'Besen', props: [[25, 4, 1, 12, '#8B5A2B'], [23, 16, 5, 3, '#E3B341']] },
  explorer: { label: 'Kompass', props: [[23, 5, 6, 6, '#E4E4E1'], [25, 6, 2, 2, '#C0392B'], [25, 8, 2, 2, INK]] },
  researcher: { label: 'Buch', props: [[22, 6, 7, 6, '#6D4C9F'], [25, 6, 1, 6, '#E4E4E1']] },
  planner: { label: 'Karte', props: [[21, 3, 8, 7, '#F3E6C4'], [22, 5, 6, 1, '#3A9E9E'], [23, 7, 4, 1, '#C0392B']] },
  browser: {
    label: 'Browserfenster',
    props: [
      [20, 1, 10, 8, '#2F6DB5'], [21, 3, 8, 5, '#F4F7FB'], [21, 2, 1, 1, '#E06C5B'], [23, 2, 1, 1, '#E3B341'], [25, 2, 1, 1, '#5FBF8F'],
      [22, 4, 5, 1, '#B8C7DA'], [22, 6, 3, 1, '#B8C7DA'],
      [26, 9, 1, 4, INK], [27, 10, 1, 2, INK], [28, 11, 1, 1, INK],
    ],
  },
  plain: { label: 'ohne Kostüm', props: [] },
}

const BY_ROLE: Record<string, string> = {
  lead: 'lead',
  orchestrator: 'lead',
  'implementer-backend': 'backend',
  'implementer-frontend': 'frontend',
  'implementer-infra': 'infra',
  'implementer-ux': 'ux',
  verifier: 'verifier',
  'code-reviewer': 'reviewer',
  'security-reviewer': 'security',
  'bug-hunter': 'hunter',
  cleaner: 'cleaner',
  explorer: 'explorer',
  Explore: 'explorer',
  researcher: 'researcher',
  planner: 'planner',
  'browser-tester': 'browser',
}

export function costumeOf(role: string): string {
  const bare = role.replace(/^[^:]*:/, '')
  if (/browser|playwright/i.test(bare)) return 'browser'
  return BY_ROLE[bare] ?? 'plain'
}

export function spriteOf(costume: string): readonly Pixel[] {
  return [...BODY, ...(COSTUMES[costume] ?? (COSTUMES.plain as { props: readonly Pixel[] })).props]
}

export function pixelGrid(pixels: readonly Pixel[]): (string | null)[][] {
  const grid: (string | null)[][] = Array.from({ length: GRID_H }, () => Array<string | null>(GRID_W).fill(null))
  for (const [x, y, w, h, color] of pixels) {
    for (let r = y; r < y + h; r++) for (let c = x; c < x + w; c++) (grid[r] as (string | null)[])[c] = color
  }
  return grid
}
