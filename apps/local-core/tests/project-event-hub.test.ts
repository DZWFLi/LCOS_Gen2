import { describe, expect, it } from 'vitest'

import { ProjectEventHub } from '../src/project-events/project-event-hub.js'

const changed = (id: string) => ({ channel: 'presentation' as const, type: 'presentation.changed' as const, entityRefs: [id], payload: { presentationId: id, version: 1 } })

describe('ProjectEventHub', () => {
  it('orders events per project and isolates projects', () => {
    const hub = new ProjectEventHub(20, 60_000, () => new Date('2026-08-15T00:00:00.000Z'), 'runtime-a')
    expect(hub.publish('a', changed('one')).projectSeq).toBe(1)
    expect(hub.publish('a', changed('two')).projectSeq).toBe(2)
    expect(hub.publish('b', changed('three')).projectSeq).toBe(1)
  })

  it('replays a retained suffix and requires snapshot across a gap or runtime restart', () => {
    const hub = new ProjectEventHub(2, 60_000, () => new Date('2026-08-15T00:00:00.000Z'), 'runtime-a')
    hub.publish('a', changed('one')); hub.publish('a', changed('two')); hub.publish('a', changed('three'))
    expect(hub.reconnect('a', 1, 'runtime-a')).toMatchObject({ kind: 'replay', currentSeq: 3 })
    expect(hub.reconnect('a', 0, 'runtime-a')).toEqual({ kind: 'snapshot_required', runtimeId: 'runtime-a', currentSeq: 3 })
    expect(hub.reconnect('a', 3, 'runtime-old')).toEqual({ kind: 'snapshot_required', runtimeId: 'runtime-a', currentSeq: 3 })
  })

  it('releases subscribers and does not let observers break publication', () => {
    const hub = new ProjectEventHub()
    const unsubscribe = hub.subscribe('a', () => { throw new Error('observer') })
    expect(() => hub.publish('a', changed('one'))).not.toThrow()
    expect(hub.debugSnapshot().a?.subscribers).toBe(1)
    unsubscribe()
    expect(hub.debugSnapshot().a?.subscribers).toBe(0)
  })
})
