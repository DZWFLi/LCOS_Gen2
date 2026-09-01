/**
 * 最小 ZIP writer（STORE 无压缩）。
 *
 * 仅用于 LCOS 自身生成的受控交付包（Handoff zip 等），不承担通用压缩库职责：
 * - 不引入第三方依赖，跨平台；
 * - 文件采用 STORE 方法（CRC32 校验 + 原始字节），适合 markdown/小文件；
 * - 输入字节必须已受调用方大小限制（见 handoff-zip-service）。
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export interface ZipEntry {
  readonly path: string
  readonly bytes: Uint8Array
}

function dosDateTime(date = new Date()): { readonly time: number; readonly date: number } {
  const year = Math.max(1980, date.getFullYear())
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time: time & 0xffff, date: day & 0xffff }
}

function writeU16(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff
  target[offset + 1] = (value >>> 8) & 0xff
}

function writeU32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff
  target[offset + 1] = (value >>> 8) & 0xff
  target[offset + 2] = (value >>> 16) & 0xff
  target[offset + 3] = (value >>> 24) & 0xff
}

const LOCAL_HEADER_SIZE = 30
const CENTRAL_HEADER_SIZE = 46
const EOCD_SIZE = 22

export function buildZip(entries: readonly ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder()
  const prepared = entries.map((entry) => {
    const name = encoder.encode(entry.path.replace(/\\/g, '/'))
    return { ...entry, name, crc: crc32(entry.bytes) }
  })
  const totalLocalSize = prepared.reduce((sum, entry) => sum + LOCAL_HEADER_SIZE + entry.name.length + entry.bytes.length, 0)
  const centralSize = prepared.reduce((sum, entry) => sum + CENTRAL_HEADER_SIZE + entry.name.length, 0)
  const output = new Uint8Array(totalLocalSize + centralSize + EOCD_SIZE)
  const now = dosDateTime()

  let cursor = 0
  const centralOffsets: number[] = []
  for (const entry of prepared) {
    centralOffsets.push(cursor)
    writeU32(output, cursor, 0x04034b50)
    writeU16(output, cursor + 4, 20)
    writeU16(output, cursor + 6, 0)
    writeU16(output, cursor + 8, 0)
    writeU16(output, cursor + 10, now.time)
    writeU16(output, cursor + 12, now.date)
    writeU32(output, cursor + 14, entry.crc)
    writeU32(output, cursor + 18, entry.bytes.length)
    writeU32(output, cursor + 22, entry.bytes.length)
    writeU16(output, cursor + 26, entry.name.length)
    writeU16(output, cursor + 28, 0)
    output.set(entry.name, cursor + LOCAL_HEADER_SIZE)
    output.set(entry.bytes, cursor + LOCAL_HEADER_SIZE + entry.name.length)
    cursor += LOCAL_HEADER_SIZE + entry.name.length + entry.bytes.length
  }

  const centralStart = cursor
  prepared.forEach((entry, index) => {
    writeU32(output, cursor, 0x02014b50)
    writeU16(output, cursor + 4, 20)
    writeU16(output, cursor + 6, 20)
    writeU16(output, cursor + 8, 0)
    writeU16(output, cursor + 10, 0)
    writeU16(output, cursor + 12, now.time)
    writeU16(output, cursor + 14, now.date)
    writeU32(output, cursor + 16, entry.crc)
    writeU32(output, cursor + 20, entry.bytes.length)
    writeU32(output, cursor + 24, entry.bytes.length)
    writeU16(output, cursor + 28, entry.name.length)
    writeU16(output, cursor + 30, 0)
    writeU16(output, cursor + 32, 0)
    writeU16(output, cursor + 34, 0)
    writeU16(output, cursor + 36, 0)
    writeU32(output, cursor + 38, 0)
    writeU32(output, cursor + 42, centralOffsets[index] ?? 0)
    output.set(entry.name, cursor + CENTRAL_HEADER_SIZE)
    cursor += CENTRAL_HEADER_SIZE + entry.name.length
  })
  const centralEnd = cursor

  writeU32(output, cursor, 0x06054b50)
  writeU16(output, cursor + 4, 0)
  writeU16(output, cursor + 6, 0)
  writeU16(output, cursor + 8, prepared.length)
  writeU16(output, cursor + 10, prepared.length)
  writeU32(output, cursor + 12, centralEnd - centralStart)
  writeU32(output, cursor + 16, centralStart)
  writeU16(output, cursor + 20, 0)
  return output
}
