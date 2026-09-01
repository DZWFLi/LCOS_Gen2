interface MultipartFilePart {
  readonly fileName: string
  readonly contentType: string
  readonly bytes: Buffer
}

export interface MultipartImportBody {
  readonly fields: Record<string, string>
  readonly file: MultipartFilePart
}

function decodeMultipartFileName(headerText: string): string | undefined {
  const encoded = /filename\*\s*=\s*UTF-8''([^;\r\n]+)/i.exec(headerText)?.[1]?.trim()
  if (encoded !== undefined) {
    try { return decodeURIComponent(encoded) } catch { throw new Error('Multipart filename* is not valid UTF-8.') }
  }
  const legacy = /filename="([^"]*)"/i.exec(headerText)?.[1]
  if (legacy === undefined || !/[\x80-\xff]/.test(legacy)) return legacy
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(legacy, 'latin1'))
  } catch {
    return legacy
  }
}

export function parseMultipartImport(contentType: string | undefined, body: Buffer): MultipartImportBody {
  const boundary = /boundary=([^;]+)/i.exec(contentType ?? '')?.[1]?.replace(/^"|"$/g, '')
  if (!boundary) throw new Error('Multipart boundary is required.')
  const raw = body.toString('latin1')
  const parts = raw.split(`--${boundary}`).slice(1, -1)
  const fields: Record<string, string> = {}
  let file: MultipartFilePart | undefined
  for (const part of parts) {
    const normalized = part.replace(/^\r\n/, '').replace(/\r\n$/, '')
    const separator = normalized.indexOf('\r\n\r\n')
    if (separator < 0) continue
    const headerText = normalized.slice(0, separator)
    const contentText = normalized.slice(separator + 4)
    const name = /name="([^"]+)"/i.exec(headerText)?.[1]
    if (!name) continue
    const fileName = decodeMultipartFileName(headerText)
    if (fileName !== undefined) {
      const contentTypeHeader = /content-type:\s*([^\r\n]+)/i.exec(headerText)?.[1]?.trim() ?? 'application/octet-stream'
      file = { fileName, contentType: contentTypeHeader, bytes: Buffer.from(contentText, 'latin1') }
    } else {
      fields[name] = Buffer.from(contentText, 'latin1').toString('utf8')
    }
  }
  if (file === undefined) throw new Error('Multipart import requires file.')
  return { fields, file }
}
