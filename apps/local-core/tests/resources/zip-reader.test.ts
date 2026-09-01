import { deflateRawSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import { readZipArchive, ZipReadError } from '../../src/resources/zip-reader.js'

function crc32(bytes: Buffer): number {
  const table: number[] = []
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const byte of bytes) crc = (table[(crc ^ byte) & 0xff]! ^ (crc >>> 8)) >>> 0
  return (crc ^ 0xffffffff) >>> 0
}

interface TestZipEntry {
  readonly name: string
  readonly bytes: Buffer
  readonly method?: number
  readonly flags?: number
  readonly mode?: number
}

function buildZip(entries: readonly TestZipEntry[]): Buffer {
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const data = (entry.method ?? 0) === 8 ? deflateRawSync(entry.bytes) : entry.bytes
    const crc = crc32(entry.bytes)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(entry.flags ?? 0, 6)
    local.writeUInt16LE(entry.method ?? 0, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(entry.bytes.length, 22)
    local.writeUInt16LE(name.length, 26)
    chunks.push(local, name, data)

    const centralEntry = Buffer.alloc(46)
    centralEntry.writeUInt32LE(0x02014b50, 0)
    centralEntry.writeUInt16LE(20, 4)
    centralEntry.writeUInt16LE(20, 6)
    centralEntry.writeUInt16LE(entry.flags ?? 0, 8)
    centralEntry.writeUInt16LE(entry.method ?? 0, 10)
    centralEntry.writeUInt32LE(crc, 16)
    centralEntry.writeUInt32LE(data.length, 20)
    centralEntry.writeUInt32LE(entry.bytes.length, 24)
    centralEntry.writeUInt16LE(name.length, 28)
    centralEntry.writeUInt32LE((((entry.mode ?? 0o100644) & 0xffff) << 16) >>> 0, 38)
    centralEntry.writeUInt32LE(offset, 42)
    central.push(centralEntry, name)
    offset += 30 + name.length + data.length
  }
  const centralStart = offset
  const centralBuffer = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuffer.length, 12)
  eocd.writeUInt32LE(centralStart, 16)
  return Buffer.concat([...chunks, centralBuffer, eocd])
}

describe('Safe ZIP reader (U3)', () => {
  it('extracts stored and deflated entries', () => {
    const zip = buildZip([
      { name: 'SKILL.md', bytes: Buffer.from('# Skill', 'utf8'), method: 0 },
      { name: 'scripts/run.sh', bytes: Buffer.from('echo hi', 'utf8'), method: 8 },
    ])
    const entries = readZipArchive(zip)
    expect(entries.map((entry) => entry.path)).toEqual(['SKILL.md', 'scripts/run.sh'])
    expect(entries[0]!.bytes.toString('utf8')).toBe('# Skill')
    expect(entries[1]!.bytes.toString('utf8')).toBe('echo hi')
  })

  it('silently drops traversal, absolute and directory entries', () => {
    const zip = buildZip([
      { name: '../evil.txt', bytes: Buffer.from('x') },
      { name: '/abs.txt', bytes: Buffer.from('y') },
      { name: 'folder/', bytes: Buffer.alloc(0) },
      { name: 'ok.txt', bytes: Buffer.from('z') },
    ])
    const entries = readZipArchive(zip)
    expect(entries.map((entry) => entry.path)).toEqual(['ok.txt'])
  })

  it('rejects symlink entries', () => {
    const zip = buildZip([{ name: 'link', bytes: Buffer.from('/etc/passwd'), mode: 0o120777 }])
    expect(() => readZipArchive(zip)).toThrow(ZipReadError)
  })

  it('rejects unsupported compression and encrypted flags', () => {
    const zip = buildZip([{ name: 'a.txt', bytes: Buffer.from('a'), method: 99 }])
    expect(() => readZipArchive(zip)).toThrow(/compression method/)
    const encrypted = buildZip([{ name: 'a.txt', bytes: Buffer.from('a'), flags: 0x1 }])
    expect(() => readZipArchive(encrypted)).toThrow(/Encrypted/)
  })

  it('rejects truncated archives', () => {
    const zip = buildZip([{ name: 'a.txt', bytes: Buffer.from('hello') }])
    expect(() => readZipArchive(zip.subarray(0, zip.length - 5))).toThrow(ZipReadError)
  })
})
