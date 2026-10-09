import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY_LOG, onSpawn, type SpawnLog } from '../hooks/open.ts'

const S = 1000
const run = (spawns: [number, boolean][]): boolean[] => {
  let log: SpawnLog = EMPTY_LOG
  return spawns.map(([at, isTeammate]) => {
    const r = onSpawn(log, at, isTeammate)
    log = r.log
    return r.shouldOpen
  })
}

test('opens on the first teammate of a run, not on the second', () => {
  assert.deepEqual(run([[0, true], [60 * S, true]]), [true, false])
})

test('opens again for a teammate after ten quiet minutes', () => {
  assert.deepEqual(run([[0, true], [601 * S, true]]), [true, true])
  assert.deepEqual(run([[0, true], [600 * S, true]]), [true, false])
})

test('a plain spawn does not restart the teammate gap', () => {
  assert.deepEqual(run([[0, true], [300 * S, false], [700 * S, true]]), [true, false, true])
})

test('measures the teammate gap from the last teammate, not the first', () => {
  assert.deepEqual(run([[0, true], [500 * S, true], [900 * S, true]]), [true, false, false])
})

test('a plain spawn between two teammates keeps the gap running', () => {
  assert.deepEqual(run([[0, true], [100 * S, false], [200 * S, true]]), [true, false, false])
})

test('opens again for a teammate 600.5 s after the last one', () => {
  assert.deepEqual(run([[0, true], [600_500, true]]), [true, true])
})

test('counts teammate spawns towards the swarm', () => {
  assert.deepEqual(run([[0, true], [5 * S, true], [10 * S, true]]), [true, false, true])
})

test('does not open for three spawns spread over 30.5 s', () => {
  assert.deepEqual(run([[0, false], [15 * S, false], [30_500, false]]), [false, false, false])
})

test('opens on the third spawn within thirty seconds', () => {
  assert.deepEqual(run([[0, false], [10 * S, false], [29 * S, false]]), [false, false, true])
})

test('does not open for two spawns, nor three spread over 31 s', () => {
  assert.deepEqual(run([[0, false], [5 * S, false]]), [false, false])
  assert.deepEqual(run([[0, false], [16 * S, false], [31 * S, false]]), [false, false, false])
})

test('keeps only the spawns of the last thirty seconds', () => {
  let log: SpawnLog = EMPTY_LOG
  for (const at of [0, 1 * S, 40 * S]) log = onSpawn(log, at, false).log
  assert.deepEqual(log.recent, [40 * S])
})
