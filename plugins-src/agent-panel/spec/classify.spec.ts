import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseMeta, roleOf, taskOf } from '../cli/classify.ts'

test('keeps only the string fields of a meta file', () => {
  assert.deepEqual(parseMeta({ name: 'a', description: 'b', agentType: 'c', customAgentType: 'd', teamName: 't', other: 'e' }), { name: 'a', description: 'b', agentType: 'c', customAgentType: 'd', teamName: 't' })
  assert.deepEqual(parseMeta({ name: 5, description: [], agentType: { toString: 0 }, customAgentType: true }), {})
  for (const raw of [null, 5, 's', [], undefined]) assert.deepEqual(parseMeta(raw), {}, String(raw))
})

test('takes the role from the custom agent type, without a plugin prefix', () => {
  assert.equal(roleOf({ customAgentType: 'implementer-backend', agentType: 'fix-B1' }), 'implementer-backend')
  assert.equal(roleOf({ customAgentType: 'savvy-flow:savvy-light' }), 'savvy-light')
  assert.equal(roleOf({ agentType: 'Explore' }), 'Explore')
  assert.equal(roleOf({}), 'agent')
})

test('turns team names into task lines', () => {
  const cases: [string, string][] = [
    ['impl-T3', 'impl T3'],
    ['fix-B1', 'fix B1'],
    ['fix-B3-4', 'fix B3 #4'],
    ['fix-conflict-T3', 'fix:conflict T3'],
    ['verify-T2-1', 'verify T2 #1'],
    ['verify-rebase-T3', 'verify:rebase T3'],
    ['verify-final-F', 'verify:final F'],
    ['review-code-B2', 'review:code B2'],
    ['review-sec-T1-1', 'review:security T1 #1'],
    ['merge-T3', 'merge T3'],
    ['hunt-R1-P2', 'hunt R1.P2'],
    ['final', 'final'],
    ['cleanup', 'cleanup'],
  ]
  for (const [name, task] of cases) assert.equal(taskOf(name), task, name)
})

test('leaves names that fit no form unchanged', () => {
  for (const name of ['code-review', 'ux', 'hunt', 'hunt-R1', 'verify-T3-x', 'impl-T3-1-2', 'fix-conflict', '']) {
    assert.equal(taskOf(name), name, name)
  }
})
