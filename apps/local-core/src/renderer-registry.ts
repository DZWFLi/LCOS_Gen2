import type { FileRecord } from '@local-creative-os/domain'

export interface RendererDescriptor {
  readonly id: string
  readonly version: string
  readonly supportedMimeTypes: readonly string[]
  readonly previewProfiles: readonly string[]
  readonly outputMimeType: string
}

const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

export const DEFAULT_RENDERERS: readonly RendererDescriptor[] = [
  {
    id: 'image',
    version: '2',
    supportedMimeTypes: IMAGE_MIME_TYPES,
    previewProfiles: ['thumbnail', 'original'],
    outputMimeType: 'image/png',
  },
  {
    id: 'text',
    version: '1',
    supportedMimeTypes: ['text/plain'],
    previewProfiles: ['thumbnail', 'original'],
    outputMimeType: 'text/plain',
  },
  {
    id: 'markdown',
    version: '1',
    supportedMimeTypes: ['text/markdown', 'text/x-markdown'],
    previewProfiles: ['thumbnail', 'original'],
    outputMimeType: 'text/plain',
  },
  {
    id: 'pdf',
    version: '1',
    supportedMimeTypes: ['application/pdf'],
    previewProfiles: ['thumbnail'],
    outputMimeType: 'image/png',
  },
  {
    id: 'office',
    version: '1',
    supportedMimeTypes: [
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
    ],
    previewProfiles: ['thumbnail'],
    outputMimeType: 'image/png',
  },
]

export class RendererRegistry {
  readonly #renderers: readonly RendererDescriptor[]

  constructor(renderers: readonly RendererDescriptor[] = DEFAULT_RENDERERS) {
    this.#renderers = renderers
  }

  select(fileRecord: FileRecord, previewProfile: string): RendererDescriptor | undefined {
    return this.#renderers.find((renderer) =>
      renderer.previewProfiles.includes(previewProfile)
      && renderer.supportedMimeTypes.includes(fileRecord.mimeType),
    )
  }
}
