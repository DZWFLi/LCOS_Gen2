import { describe, expect, it } from 'vitest'

import { buildLinkMarkdown } from '../../src/resources/link-document.js'

describe('Link document (server-side .link.md)', () => {
  it('builds a zero-form link document with url and default title', () => {
    const result = buildLinkMarkdown({ url: 'https://example.com/page' })
    expect(result.provider).toBe('web')
    expect(result.resourceType).toBe('web')
    expect(result.title).toBe('example.com')
    expect(result.fileName).toBe('example.com.link.md')
    expect(result.markdown).toContain('url: https://example.com/page')
    expect(result.markdown).toContain('fetchedAt: null')
    expect(result.markdown).toContain('Link resource imported into LCOS.')
  })

  it('detects feishu provider and resource type', () => {
    const result = buildLinkMarkdown({ url: 'https://x.feishu.cn/wiki/abc', title: '客户简报' })
    expect(result.provider).toBe('feishu')
    expect(result.resourceType).toBe('wiki')
    expect(result.fileName).toBe('客户简报.link.md')
    expect(result.markdown).toContain('sourceKind: feishu_link')
  })

  it('keeps the honest access rule', () => {
    const result = buildLinkMarkdown({ url: 'https://example.com', note: '第二轮反馈' })
    expect(result.markdown).toContain('第二轮反馈')
    expect(result.markdown).toContain('do not claim the page was read when unavailable')
  })
})
