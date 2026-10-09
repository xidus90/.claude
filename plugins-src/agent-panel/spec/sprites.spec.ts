import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { COSTUMES, GRID_H, GRID_W, costumeOf, pixelGrid, spriteOf } from '../hooks/sprites.ts'

test('has a costume for every agent role in the repo and for browser-tester', () => {
  const agents = join(import.meta.dirname, '..', '..', '..', 'agents')
  const roles = readdirSync(agents).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3))
  for (const role of [...roles.filter((r) => r !== 'orchestrator'), 'browser-tester', 'lead']) {
    assert.notEqual(costumeOf(role), 'plain', role)
  }
})

test('maps roles to costumes, with plugin prefixes, browser names and a plain fallback', () => {
  assert.equal(costumeOf('lead'), 'lead')
  assert.equal(costumeOf('implementer-backend'), 'backend')
  assert.equal(costumeOf('x:browser-agent'), 'browser')
  assert.equal(costumeOf('playwright-runner'), 'browser')
  assert.equal(costumeOf('Explore'), 'explorer')
  assert.equal(costumeOf('general-purpose'), 'plain')
})

test('treats names inherited from Object.prototype as unknown roles', () => {
  for (const role of ['constructor', '__proto__', 'x:valueOf']) assert.equal(costumeOf(role), 'plain', role)
})

test('keeps every pixel inside the grid', () => {
  for (const key of Object.keys(COSTUMES)) {
    for (const [x, y, w, h] of spriteOf(key)) {
      assert.ok(x >= 0 && y >= 0 && x + w <= GRID_W && y + h <= GRID_H, `${key} ${x},${y},${w},${h}`)
    }
  }
})

test('paints a grid with the body clay and empty cells', () => {
  const g = pixelGrid(spriteOf('plain'))
  assert.equal(g.length, GRID_H)
  assert.equal(g[0]?.length, GRID_W)
  assert.equal(g[10]?.[7], '#D97757')
  assert.equal(g[12]?.[9], '#1F1E1D')
  assert.equal(g[0]?.[0], null)
})

test('falls back to the plain crab for an unknown costume key', () => {
  assert.deepEqual(spriteOf('nope'), spriteOf('plain'))
})

test('falls back to the plain crab for a costume key inherited from Object.prototype', () => {
  for (const key of ['constructor', '__proto__']) assert.deepEqual(spriteOf(key), spriteOf('plain'), key)
})
