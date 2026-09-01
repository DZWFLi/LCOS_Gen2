import type { HealthStatus } from '@local-creative-os/contracts'

export const LOCAL_CORE_VERSION = '0.3.0-phase2'

export function getHealthStatus(): HealthStatus {
  return {
    status: 'ok',
    service: 'local-core',
    mode: 'phase_2_lite',
    version: LOCAL_CORE_VERSION,
  }
}
