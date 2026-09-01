import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { OcrError, OcrService } from '../src/ocr-service.js'

const cleanup: string[] = []

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'local-core-ocr-'))
  cleanup.push(directory)
  const image = join(directory, 'shot.png')
  await writeFile(image, 'fake-png-bytes')
  return { directory, image }
}

async function serviceWithEngine(engine: string, timeoutMs = 2_000) {
  const directory = await mkdtemp(join(tmpdir(), 'local-core-ocr-engine-'))
  cleanup.push(directory)
  const enginePath = join(directory, 'engine.mjs')
  await writeFile(enginePath, engine)
  return new OcrService({
    scriptPath: enginePath,
    runtimeDir: directory,
    pythonCommand: process.execPath,
    timeoutMs,
  })
}

const OK_ENGINE = `
import { readFileSync } from 'node:fs'
const image = process.argv[2]
const size = readFileSync(image).byteLength
console.log(JSON.stringify({
  ok: true,
  text: 'LCOS本地OCR测试\\n第二行',
  lines: [
    { text: 'LCOS本地OCR测试', score: 0.999, box: [[1,2],[3,4]] },
    { text: '第二行', score: 0.98, box: null },
  ],
  durationMs: 321,
  size,
}))
`

describe('Phase 5 OCR — OcrService', () => {
  afterEach(async () => {
    for (const path of cleanup.splice(0)) void rm(path, { recursive: true, force: true }).catch(() => { /* best effort */ })
  })

  it('recognizes an image through the engine and parses the result', async () => {
    const { image } = await fixture()
    const service = await serviceWithEngine(OK_ENGINE)
    const result = await service.recognize(image)
    expect(result.engine).toBe('rapidocr')
    expect(result.text).toBe('LCOS本地OCR测试\n第二行')
    expect(result.lines).toHaveLength(2)
    expect(result.lines[0]).toMatchObject({ text: 'LCOS本地OCR测试', score: 0.999 })
    expect(result.lines[1]?.box).toBeNull()
  })

  it('rejects non-image paths and missing files before spawning', async () => {
    const { directory } = await fixture()
    const service = await serviceWithEngine(OK_ENGINE)
    await expect(service.recognize(join(directory, 'note.md'))).rejects.toBeInstanceOf(OcrError)
    await expect(service.recognize(join(directory, 'missing.png'))).rejects.toBeInstanceOf(OcrError)
  })

  it('surfaces engine failures as structured errors', async () => {
    const { image } = await fixture()
    const service = await serviceWithEngine(`console.log(JSON.stringify({ ok: false, error: '模型加载失败' }))`)
    await expect(service.recognize(image)).rejects.toMatchObject({ code: 'ENGINE_FAILED', message: '模型加载失败' })
  })

  it('times out when the engine hangs', async () => {
    const { image } = await fixture()
    const service = await serviceWithEngine(`await new Promise((resolve) => setTimeout(resolve, 60_000))`, 300)
    await expect(service.recognize(image)).rejects.toMatchObject({ code: 'TIMEOUT' })
  })
})
