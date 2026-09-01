import { describe, expect, it } from 'vitest'
import { assertContainmentWrite, validateContainmentWrite, type Scope } from '../src/index'

const scope = (id: string, kind: Scope['kind'], parentScopeId: string | null): Scope => ({
  id, projectId: 'project-1', parentScopeId, containerViewId: null, kind, name: id, createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z',
} as Scope)

const root = scope('root', 'root', null)

describe('B3R5 structural containment guard', () => {
  it('allows exactly two Collection levels below Project Root', () => {
    expect(validateContainmentWrite({ nextScopes: [root, scope('a', 'collection', 'root'), scope('b', 'collection', 'a')] }).ok).toBe(true)
  })

  it('rejects depth three and cycles', () => {
    expect(() => assertContainmentWrite({ nextScopes: [root, scope('a', 'collection', 'root'), scope('b', 'collection', 'a'), scope('c', 'collection', 'b')] })).toThrow('STRUCTURAL_DEPTH_EXCEEDED')
    expect(() => assertContainmentWrite({ nextScopes: [root, scope('a', 'collection', 'b'), scope('b', 'collection', 'a')] })).toThrow('STRUCTURAL_CYCLE')
  })

  it('rejects cross-type structural nesting while references remain outside this guard', () => {
    expect(() => assertContainmentWrite({ nextScopes: [root, scope('a', 'collection', 'root'), scope('context', 'context', 'a')] })).toThrow('CROSS_TYPE_CONTAINMENT')
  })

  it('limits one Agent action to one newly-created container level', () => {
    expect(() => assertContainmentWrite({ previousScopes: [root], nextScopes: [root, scope('a', 'collection', 'root'), scope('b', 'collection', 'a')], actor: 'agent' })).toThrow('AI_CONTAINER_DEPTH_EXCEEDED')
  })

  it('keeps legacy over-depth data readable but blocks further deepening', () => {
    const legacy = [root, scope('a', 'collection', 'root'), scope('b', 'collection', 'a'), scope('c', 'collection', 'b')]
    const read = validateContainmentWrite({ previousScopes: legacy, nextScopes: legacy })
    expect(read.ok).toBe(true)
    expect(read.legacyOverDepthScopeIds).toEqual(['c'])
    expect(() => assertContainmentWrite({ previousScopes: legacy, nextScopes: [...legacy, scope('d', 'collection', 'c')] })).toThrow('STRUCTURAL_DEPTH_EXCEEDED')
  })
})
