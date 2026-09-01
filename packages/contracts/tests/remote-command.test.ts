import { describe, expect, it } from 'vitest'
import { isValidRemoteRequestId, validateRemoteCommandEnvelope } from '../src/remote-command'

const valid = {
  schemaVersion: 1,
  requestId: 'req-123',
  userId: 'user-1',
  projectId: 'proj-1',
  sourceApp: 'desktop',
  capability: 'projects.read',
  mutationClass: 'read',
  createdAt: '2026-08-30T00:00:00.000Z',
}

describe('RemoteCommandEnvelopeV1 validation (RESERVE)', () => {
  it('validates idempotency key format', () => {
    expect(isValidRemoteRequestId('req-123')).toBe(true)
    expect(isValidRemoteRequestId('')).toBe(false)
    expect(isValidRemoteRequestId('has space')).toBe(false)
    expect(isValidRemoteRequestId('a'.repeat(129))).toBe(false)
  })

  it('accepts a valid envelope', () => {
    expect(() => validateRemoteCommandEnvelope(valid)).not.toThrow()
  })

  it('rejects invalid requestId / mutationClass / missing userId', () => {
    expect(() => validateRemoteCommandEnvelope({ ...valid, requestId: '' })).toThrow('requestId is invalid')
    expect(() => validateRemoteCommandEnvelope({ ...valid, mutationClass: 'delete' })).toThrow('mutationClass must be')
    expect(() => validateRemoteCommandEnvelope({ ...valid, userId: '' })).toThrow('userId is required')
  })
})