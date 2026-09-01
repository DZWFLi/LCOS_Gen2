/**
 * F6 B6 P1-A：docx/pptx 静态正文提取验收（fflate 解 zip + XML 文本 run）。
 * 测试内用 fflate zipSync 生成真实 OOXML 容器——不依赖外部 fixture 文件。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'

import { extractOoxmlText, readArtifactIndexBody } from '../src/search-artifact-body.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } }
})

function writeFixture(name: string, bytes: Uint8Array): string {
  const root = mkdtempSync(join(tmpdir(), 'lcos-b6-ooxml-'))
  roots.push(root)
  const path = join(root, name)
  writeFileSync(path, bytes)
  return path
}

describe('F6 B6 P1-A: OOXML 静态正文提取', () => {
  it('docx：word/document.xml 的 <w:t> run 逐段落提取（\\n 分段）', async () => {
    const documentXml = `<?xml version="1.0"?><w:document><w:body><w:p><w:r><w:t>First paragraph alpha</w:t></w:r></w:p><w:p><w:r><w:t>Second paragraph beta</w:t></w:r></w:p></w:body></w:document>`
    const path = writeFixture('b6.docx', zipSync({ 'word/document.xml': strToU8(documentXml) }))
    const text = await extractOoxmlText(path, 'docx')
    expect(text).toContain('First paragraph alpha')
    expect(text).toContain('Second paragraph beta')
    expect(text.indexOf('First')).toBeLessThan(text.indexOf('Second'))
    // 段落间有换行（anchor docx:pN 的切分依据）
    expect(text).toMatch(/alpha\n/)

    const viaBody = await readArtifactIndexBody({
      fileRecord: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', observedPath: path },
    })
    expect(viaBody).toContain('First paragraph alpha')
  })

  it('pptx：slideN.xml 的 <a:t> run 逐 slide 提取（\\f 分页，anchor pptx:slideN）', async () => {
    const slide = (title: string) => `<?xml version="1.0"?><p:sld><p:cSld><p:spTree><p:sp><a:t>${title}</a:t></p:sp></p:spTree></p:cSld></p:sld>`
    const path = writeFixture('b6.pptx', zipSync({
      'ppt/slides/slide1.xml': strToU8(slide('Slide one content gamma')),
      'ppt/slides/slide2.xml': strToU8(slide('Slide two content delta')),
    }))
    const text = await extractOoxmlText(path, 'pptx')
    expect(text).toContain('Slide one content gamma')
    expect(text).toContain('Slide two content delta')
    expect(text).toContain('\f')

    const viaBody = await readArtifactIndexBody({
      fileRecord: { mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', observedPath: path },
    })
    expect(viaBody).toContain('Slide two content delta')
  })

  it('损坏容器 / 缺部件：诚实返回空串', async () => {
    const notZip = writeFixture('broken.docx', strToU8('this is not a zip'))
    await expect(extractOoxmlText(notZip, 'docx')).rejects.toThrow()
    const noDocument = writeFixture('empty.docx', zipSync({ 'random.xml': strToU8('<x/>') }))
    await expect(extractOoxmlText(noDocument, 'docx')).resolves.toBe('')
  })
})