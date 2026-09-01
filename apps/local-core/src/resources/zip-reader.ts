import { inflateRawSync } from 'node:zlib'

const MAX_ENTRIES = 500
const MAX_ENTRY_UNCOMPRESSED = 10 * 1024 * 1024
const MAX_TOTAL_UNCOMPRESSED = 50 * 1024 * 1024
const MAX_NAME_LENGTH = 512

export interface ZipEntryData {
  readonly path: string
  readonly bytes: Buffer
}

export class ZipReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZipReadError'
  }
}

interface CentralEntry {
  readonly method: number
  readonly flags: number
  readonly compressedSize: number
  readonly uncompressedSize: number
  readonly name: string
  readonly localOffset: number
  readonly unixMode: number
  readonly crc32: number
}

const WINDOWS_RESERVED_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
])

export function readZipArchive(bytes: Buffer): ZipEntryData[] {
  const eocd = findEndOfCentralDirectory(bytes)
  if (eocd === undefined) throw new ZipReadError('Not a ZIP archive (EOCD not found).')
  const totalEntries = eocd.readUInt16LE(10)
  const centralOffset = eocd.readUInt32LE(16)
  if (totalEntries === 0xffff || centralOffset === 0xffffffff) throw new ZipReadError('ZIP64 archives are not supported.')
  if (totalEntries > MAX_ENTRIES) throw new ZipReadError(`Archive has too many entries (max ${MAX_ENTRIES}).`)

  const entries: CentralEntry[] = []
  let cursor = centralOffset
  let totalUncompressed = 0
  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > bytes.length) throw new ZipReadError('Central directory is truncated.')
    if (bytes.readUInt32LE(cursor) !== 0x02014b50) throw new ZipReadError('Central directory signature mismatch.')
    const method = bytes.readUInt16LE(cursor + 10)
    const flags = bytes.readUInt16LE(cursor + 8)
    const compressedSize = bytes.readUInt32LE(cursor + 20)
    const uncompressedSize = bytes.readUInt32LE(cursor + 24)
    const nameLength = bytes.readUInt16LE(cursor + 28)
    const extraLength = bytes.readUInt16LE(cursor + 30)
    const commentLength = bytes.readUInt16LE(cursor + 32)
    const externalAttributes = bytes.readUInt32LE(cursor + 38)
    const crc32 = bytes.readUInt32LE(cursor + 16)
    const localOffset = bytes.readUInt32LE(cursor + 42)
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')
    if (nameLength === 0 || nameLength > MAX_NAME_LENGTH) throw new ZipReadError('Invalid entry name length.')
    if ((flags & 0x1) !== 0) throw new ZipReadError('Encrypted ZIP entries are not supported.')
    if (method !== 0 && method !== 8) throw new ZipReadError(`Unsupported compression method: ${method}.`)
    const unixMode = (externalAttributes >>> 16) & 0xffff
    if ((unixMode & 0xf000) === 0xa000) throw new ZipReadError(`Symlink entries are rejected: ${name}`)
    entries.push({ method, flags, compressedSize, uncompressedSize, name, localOffset, unixMode, crc32 })
    totalUncompressed += uncompressedSize
    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED) throw new ZipReadError('Archive exceeds the total uncompressed size limit.')
    cursor += 46 + nameLength + extraLength + commentLength
  }

  const result: ZipEntryData[] = []
  const normalizedPaths = new Set<string>()
  let materialized = 0
  for (const entry of entries) {
    const path = safeZipPath(entry.name)
    if (path === undefined) continue
    const collisionKey = path.normalize('NFC').toLocaleLowerCase('en-US')
    if (normalizedPaths.has(collisionKey)) throw new ZipReadError(`Duplicate normalized ZIP path: ${entry.name}`)
    normalizedPaths.add(collisionKey)
    if (entry.uncompressedSize > MAX_ENTRY_UNCOMPRESSED) {
      throw new ZipReadError(`Entry exceeds the per-file size limit: ${entry.name}`)
    }
    if (entry.localOffset + 30 > bytes.length) throw new ZipReadError('Local header is truncated.')
    if (bytes.readUInt32LE(entry.localOffset) !== 0x04034b50) throw new ZipReadError('Local header signature mismatch.')
    const localNameLength = bytes.readUInt16LE(entry.localOffset + 26)
    const localExtraLength = bytes.readUInt16LE(entry.localOffset + 28)
    const dataStart = entry.localOffset + 30 + localNameLength + localExtraLength
    const localName = bytes.subarray(entry.localOffset + 30, entry.localOffset + 30 + localNameLength).toString('utf8')
    if (localName !== entry.name) throw new ZipReadError(`Local header name mismatch: ${entry.name}`)
    const dataEnd = dataStart + entry.compressedSize
    if (dataEnd > bytes.length) throw new ZipReadError('Entry data is truncated.')
    const compressed = bytes.subarray(dataStart, dataEnd)
    const content = entry.method === 0
      ? Buffer.from(compressed)
      : inflateRawSync(compressed, { maxOutputLength: entry.uncompressedSize })
    if (content.length !== entry.uncompressedSize) {
      throw new ZipReadError(`Entry size mismatch: ${entry.name}`)
    }
    if (crc32(content) !== entry.crc32) throw new ZipReadError(`CRC mismatch: ${entry.name}`)
    materialized += content.length
    if (materialized > MAX_TOTAL_UNCOMPRESSED) throw new ZipReadError('Archive exceeds the total uncompressed size limit.')
    result.push({ path, bytes: content })
  }
  return result
}

function findEndOfCentralDirectory(bytes: Buffer): Buffer | undefined {
  const minimum = Math.max(0, bytes.length - 22 - 0xffff)
  for (let cursor = bytes.length - 22; cursor >= minimum; cursor -= 1) {
    if (bytes.readUInt32LE(cursor) === 0x06054b50) {
      const commentLength = bytes.readUInt16LE(cursor + 20)
      if (cursor + 22 + commentLength === bytes.length) {
        return bytes.subarray(cursor, cursor + 22)
      }
    }
  }
  return undefined
}

function safeZipPath(rawName: string): string | undefined {
  let name = rawName.normalize('NFC').replace(/\\/g, '/')
  if (name.startsWith('/')) return undefined
  if (name.endsWith('/')) return undefined
  name = name.replace(/^\/+/, '')
  const segments = name.split('/')
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') return undefined
    if (segment.length > 240) return undefined
    if (segment.endsWith('.') || segment.endsWith(' ') || segment.includes(':')) return undefined
    if (WINDOWS_RESERVED_NAMES.has(segment.split('.')[0]!.toLocaleLowerCase('en-US'))) return undefined
  }
  if (segments.length > 16) return undefined
  return name
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}
