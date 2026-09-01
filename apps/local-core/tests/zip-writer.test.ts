import { describe, expect, it } from 'vitest'
import { buildZip, crc32 } from '../src/zip-writer.js'

function parseZip(bytes: Uint8Array): Array<{ name: string; data: Uint8Array }> {
  const buf = Buffer.from(bytes)
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  expect(eocd).toBeGreaterThanOrEqual(0)
  const count = buf.readUInt16LE(eocd + 10)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  const entries: Array<{ name: string; data: Uint8Array }> = []
  let p = cdOffset
  for (let i = 0; i < count; i++) {
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    const lNameLen = buf.readUInt16LE(localOffset + 26)
    const lExtraLen = buf.readUInt16LE(localOffset + 28)
    const size = buf.readUInt32LE(localOffset + 18)
    const data = buf.subarray(localOffset + 30 + lNameLen + lExtraLen, localOffset + 30 + lNameLen + lExtraLen + size)
    expect(crc32(data).toString(16)).toBe(buf.readUInt32LE(p + 16).toString(16))
    entries.push({ name, data: new Uint8Array(data) })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

describe('zip-writer (STORE)', () => {
  it('writes a structurally valid zip with correct names, sizes and CRCs', () => {
    const zip = buildZip([
      { path: 'handoff.md', bytes: new TextEncoder().encode('# Handoff\nhello') },
      { path: 'files/文本-01.md', bytes: new TextEncoder().encode('中文内容') },
      { path: 'files/图片.png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) },
    ])
    const entries = parseZip(zip)
    expect(entries.map((entry) => entry.name)).toEqual(['handoff.md', 'files/文本-01.md', 'files/图片.png'])
    expect(new TextDecoder().decode(entries[0]!.data)).toBe('# Handoff\nhello')
    expect(new TextDecoder().decode(entries[1]!.data)).toBe('中文内容')
    expect([...entries[2]!.data]).toEqual([0x89, 0x50, 0x4e, 0x47])
  })

  it('normalizes backslash paths to forward slashes', () => {
    const zip = buildZip([{ path: 'files\\a.md', bytes: new TextEncoder().encode('x') }])
    expect(parseZip(zip)[0]!.name).toBe('files/a.md')
  })
})
