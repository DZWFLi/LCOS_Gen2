import { describe, expect, it } from 'vitest'

import {
  buildAgentNodePreview,
  extractAgentNodePreview,
  flattenPreview,
  NODE_PREVIEW_MAX_LENGTH,
} from '../src/node-ref.js'

describe('node-ref flattenPreview（huabu 同构缩略参数）', () => {
  it('先折叠空白再截断：多行 markdown 的换行不占 120 字预算', () => {
    const multiLine = '# 标题\n\n- 要点一\n- 要点二\n\n正文段落...'
    expect(flattenPreview(multiLine)).toBe('# 标题 - 要点一 - 要点二 正文段落...')
  })

  it('超长内容截断到 120 字（NODE_PREVIEW_MAX_LENGTH）', () => {
    expect(flattenPreview('a'.repeat(500)).length).toBe(NODE_PREVIEW_MAX_LENGTH)
    expect(NODE_PREVIEW_MAX_LENGTH).toBe(120)
  })

  it('首尾空白被 trim', () => {
    expect(flattenPreview('   hello world   ')).toBe('hello world')
  })
})

describe('node-ref extractAgentNodePreview（L1 preview 提取）', () => {
  it('content 存在且非空白 → 出折叠切片', () => {
    expect(extractAgentNodePreview({ content: '# Hi\nbody' })).toBe('# Hi body')
  })

  it('content 缺席 / 空白 → undefined（调用方省略字段，不伪造）', () => {
    expect(extractAgentNodePreview({})).toBeUndefined()
    expect(extractAgentNodePreview({ content: '' })).toBeUndefined()
    expect(extractAgentNodePreview({ content: '   \n\t  ' })).toBeUndefined()
  })
})

describe('node-ref buildAgentNodePreview（L1 阶梯构造）', () => {
  it('content 与 rev 齐备 → L1 完整形状', () => {
    const l1 = buildAgentNodePreview({
      viewId: 'view-1', artifactId: 'art-1', title: '竞品分析', kind: 'markdown',
      revisionId: 'rev-9', content: '# 竞品\n\n三维度对比', rev: 'hash-abc',
    })
    expect(l1).toMatchObject({ viewId: 'view-1', artifactId: 'art-1', title: '竞品分析', kind: 'markdown', revisionId: 'rev-9', rev: 'hash-abc' })
    expect(l1.preview).toBe('# 竞品 三维度对比')
  })

  it('content 缺席 → 不出 preview 字段（可选字段省略而非空串）', () => {
    const l1 = buildAgentNodePreview({ viewId: 'v', artifactId: 'a', title: 't', kind: 'note' })
    expect('preview' in l1).toBe(false)
    expect('rev' in l1).toBe(false)
    expect('revisionId' in l1).toBe(false)
  })
})