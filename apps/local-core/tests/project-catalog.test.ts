import { describe, expect, it } from 'vitest'

import { ExplicitProjectCatalog } from '../src/project-catalog.js'

describe('ExplicitProjectCatalog', () => {
  it('returns an empty explicitly injected catalog', async () => {
    await expect(new ExplicitProjectCatalog([]).list()).resolves.toEqual({ ok: true, value: [] })
  })

  it('returns defensive copies of explicitly injected entries', async () => {
    const entry = { id: 'project-1', name: 'PortaSplit', rootPath: 'C:\\projects\\portasplit', graphVersion: 1 }
    const catalog = new ExplicitProjectCatalog([entry])
    const result = await catalog.list()

    expect(result).toEqual({ ok: true, value: [entry] })
    if (result.ok) expect(result.value[0]).not.toBe(entry)
  })

  it('rejects duplicate project ids', async () => {
    const catalog = new ExplicitProjectCatalog([
      { id: 'same', name: 'One', rootPath: 'C:\\one' },
      { id: 'same', name: 'Two', rootPath: 'C:\\two' },
    ])

    await expect(catalog.list()).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT', origin: 'runtime' },
    })
  })

  it('returns ABORTED for an already aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(new ExplicitProjectCatalog([]).list(controller.signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'ABORTED' },
    })
  })
})
