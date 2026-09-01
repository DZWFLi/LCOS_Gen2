import { describe, expect, it } from 'vitest'

import {
  resolveSkillDependencyOrder,
  validateSkillComposition,
  SkillDependencyCycleError,
  type SkillCompositionV1,
  type SkillDependencyNodeV1,
} from '@local-creative-os/contracts'

describe('SkillCompositionV1', () => {
  it('accepts a canonical root/subskill composition', () => {
    const input: SkillCompositionV1 = {
      schemaVersion: 1,
      rootSkillId: 'my-skill',
      subskills: [
        { skillId: 'util-a', order: 0 },
        { skillId: 'util-b', order: 1 },
      ],
      requiredCapabilities: ['fs.workspace'],
      optionalCapabilities: ['net.http'],
    }
    const result = validateSkillComposition(input)
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('rejects invalid rootSkillId and duplicate order', () => {
    const result = validateSkillComposition({
      schemaVersion: 1,
      rootSkillId: 'bad id with space',
      subskills: [
        { skillId: 'x', order: 0 },
        { skillId: 'y', order: 0 },
      ],
      requiredCapabilities: [],
      optionalCapabilities: [],
    })
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })
})

describe('resolveSkillDependencyOrder', () => {
  it('rejects A→B→A ring', () => {
    const nodes: SkillDependencyNodeV1[] = [
      { id: 'a', dependencies: ['b'] },
      { id: 'b', dependencies: ['a'] },
    ]
    expect(() => resolveSkillDependencyOrder(nodes)).toThrow(SkillDependencyCycleError)
  })

  it('rejects self-loop', () => {
    const nodes: SkillDependencyNodeV1[] = [{ id: 'a', dependencies: ['a'] }]
    expect(() => resolveSkillDependencyOrder(nodes)).toThrow(SkillDependencyCycleError)
  })

  it('orders independent chains deterministically', () => {
    const nodes: SkillDependencyNodeV1[] = [
      { id: 'a', dependencies: ['b', 'c'] },
      { id: 'b', dependencies: [] },
      { id: 'c', dependencies: [] },
    ]
    const order = resolveSkillDependencyOrder(nodes)
    expect(order).toHaveLength(3)
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('a'))
    expect(order.indexOf('c')).toBeLessThan(order.indexOf('a'))
  })
})
