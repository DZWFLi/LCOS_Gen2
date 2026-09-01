import { describe, expect, it } from 'vitest'
import { validateExtensionManifest } from '../src/extension-manifest'

const valid = {
  schemaVersion: 1,
  extensionId: 'my-plugin',
  name: 'My Plugin',
  version: '1.0.0',
  capabilities: [{ capabilityId: 'orbit.nudge', slot: 'OrbitAction', label: 'Nudge', readWrite: 'write' }],
}

describe('ExtensionManifestV1 validation (RESERVE)', () => {
  it('accepts a valid manifest', () => {
    expect(() => validateExtensionManifest(valid)).not.toThrow()
  })

  it('rejects non-object / missing extensionId / name', () => {
    expect(() => validateExtensionManifest('x')).toThrow('must be an object')
    expect(() => validateExtensionManifest({ ...valid, extensionId: '' })).toThrow('extensionId is required')
    expect(() => validateExtensionManifest({ ...valid, name: '' })).toThrow('name is required')
  })

  it('rejects missing capabilities / invalid readWrite', () => {
    expect(() => validateExtensionManifest({ ...valid, capabilities: [] })).toThrow('must declare at least one capability')
    expect(() => validateExtensionManifest({ ...valid, capabilities: [{ capabilityId: 'x', slot: 'OrbitAction', label: 'x', readWrite: 'delete' }] })).toThrow('readWrite must be')
  })
})