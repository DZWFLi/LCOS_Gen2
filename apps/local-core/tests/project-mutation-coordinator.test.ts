import { describe, expect, it } from 'vitest'

import { ProjectEventHub } from '../src/project-events/project-event-hub.js'
import { ProjectMutationCoordinator } from '../src/project-events/project-mutation-coordinator.js'

const origin = { clientId: 'browser-a', sessionId: 'tab-a', clientSeq: 1, operationId: 'op-1', sourceSurface: 'arrange' }

describe('ProjectMutationCoordinator', () => {
  it('deduplicates one operationId and returns the original receipt', () => {
    const events = new ProjectEventHub()
    const coordinator = new ProjectMutationCoordinator(events)
    let writes = 0
    const persist = () => { writes += 1; events.publish('p', { channel: 'presentation', type: 'presentation.changed', origin, payload: {} }); return { response: { version: writes }, resultingVersion: writes } }
    const first = coordinator.commit({ projectId: 'p', origin, persist })
    const duplicate = coordinator.commit({ projectId: 'p', origin, persist })
    expect(writes).toBe(1)
    expect(duplicate).toEqual(first)
    expect(first.projectSeq).toBe(1)
  })

  it('does not create a receipt when persistence fails', () => {
    const coordinator = new ProjectMutationCoordinator(new ProjectEventHub())
    expect(() => coordinator.commit({ projectId: 'p', origin, persist: () => { throw new Error('db') } })).toThrow('db')
    expect(coordinator.lookup('p', origin.operationId)).toBeUndefined()
  })
})
