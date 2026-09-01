import { extname } from 'node:path'
import type { Artifact } from '@local-creative-os/domain'

export const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.md': 'text/markdown', '.txt': 'text/plain', '.csv': 'text/csv', '.json': 'application/json',
  '.yaml': 'application/yaml', '.yml': 'application/yaml', '.xml': 'application/xml', '.html': 'text/html',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.bmp': 'image/bmp', '.tif': 'image/tiff', '.tiff': 'image/tiff', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf', '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.psd': 'image/vnd.adobe.photoshop', '.ai': 'application/postscript',
}

export interface KnownFileFormatV0 {
  readonly extension: string
  readonly mimeType: string
}

export const KNOWN_FILE_FORMATS_V0: readonly KnownFileFormatV0[] = Object.entries(MIME_BY_EXTENSION)
  .map(([extension, mimeType]) => ({ extension, mimeType }))
  .sort((left, right) => left.extension.localeCompare(right.extension))

export function extensionOf(path: string): string {
  return extname(path).toLocaleLowerCase('en-US')
}

export function mimeTypeForFile(path: string, provided = ''): string {
  return MIME_BY_EXTENSION[extensionOf(path)] ?? (provided && provided !== 'application/octet-stream' ? provided : 'application/octet-stream')
}

export function artifactKindForFile(path: string, mimeType = mimeTypeForFile(path)): Artifact['kind'] {
  const extension = extensionOf(path)
  if (mimeType.startsWith('image/')) return 'image'
  if (extension === '.pdf') return 'pdf'
  if (extension === '.ppt' || extension === '.pptx') return 'presentation'
  if (mimeType.startsWith('text/')) return 'markdown'
  return 'other'
}
