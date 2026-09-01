import { describe, expect, it } from 'vitest'

import { getHealthStatus } from '../src/health.js'

describe('health', () => {
  it('reports the real Phase 2 Lite metadata capability', () => {
    expect(getHealthStatus()).toEqual({
      status: 'ok',
      service: 'local-core',
      mode: 'phase_2_lite',
      version: '0.3.0-phase2',
    })
  })
})
