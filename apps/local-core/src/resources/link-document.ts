export interface LinkDocumentInput {
  readonly url: string
  readonly title?: string
  readonly note?: string
}

export interface LinkDocumentResult {
  readonly fileName: string
  readonly markdown: string
  readonly provider: 'feishu' | 'web'
  readonly resourceType: 'wiki' | 'document' | 'sheet' | 'base' | 'web'
  readonly title: string
}

function safeTitle(value: string): string {
  return value.trim().slice(0, 120)
}

export function buildLinkMarkdown(input: LinkDocumentInput): LinkDocumentResult {
  const url = new URL(input.url)
  const provider = /(^|\.)feishu\.cn$|(^|\.)larksuite\.com$|(^|\.)feishu\.com$/i.test(url.hostname)
    ? 'feishu'
    : 'web'
  const resourceType = /\/wiki\//i.test(url.pathname)
    ? 'wiki'
    : /\/docx?\//i.test(url.pathname)
      ? 'document'
      : /\/sheets?\//i.test(url.pathname)
        ? 'sheet'
        : /\/base\//i.test(url.pathname)
          ? 'base'
          : 'web'
  const title = safeTitle(input.title ?? '') || url.hostname
  const slug = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim() || 'link-reference'
  const markdown = [
    '---',
    `sourceKind: ${provider === 'feishu' ? 'feishu_link' : 'external_url'}`,
    `provider: ${provider}`,
    `resourceType: ${resourceType}`,
    `url: ${input.url}`,
    `title: ${title}`,
    'accessMode: open_with_available_tool',
    'fetchedAt: null',
    '---',
    '',
    input.note?.trim() || 'Link resource imported into LCOS.',
    '',
    '> Agent rule: report access failure honestly; do not claim the page was read when unavailable.',
    '',
  ].join('\n')
  return {
    fileName: `${slug}.link.md`,
    markdown,
    provider,
    resourceType,
    title,
  }
}
