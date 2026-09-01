import { describe, expect, it } from 'vitest'

import {
  nodeSpaceRel,
  parseSpacePath,
  SPACE_LABEL_MAX_CHARS,
  SPACE_VFS_PREFIX,
  SpaceVfsError,
  toSafeLabel,
} from '../src/space-vfs.js'

describe('toSafeLabel / nodeSpaceRel', () => {
  it('ASCII label 原样保留', () => {
    expect(toSafeLabel('competitor analysis')).toBe('competitor-analysis')
    expect(nodeSpaceRel('doc')).toBe('nodes/doc.md')
  })

  it('CJK 全保留（label 规范 1-5 词，CJK 是一等公民）', () => {
    expect(toSafeLabel('竞品分析')).toBe('竞品分析')
    expect(nodeSpaceRel('竞品分析')).toBe('nodes/竞品分析.md')
  })

  it('Windows 保留字符与路径分隔符被剥除', () => {
    expect(toSafeLabel('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij')
  })

  it('空白折叠为单连字符，首尾连字符修剪', () => {
    expect(toSafeLabel('  多   个   空格  ')).toBe('多-个-空格')
    expect(toSafeLabel('--trim--')).toBe('trim')
  })

  it('超长 label 截断到上限', () => {
    expect(toSafeLabel('a'.repeat(500)).length).toBe(SPACE_LABEL_MAX_CHARS)
  })

  it('剥完为空 → 回退 node（不产生空段）', () => {
    expect(toSafeLabel('???')).toBe('node')
    expect(toSafeLabel('   ')).toBe('node')
  })
})

describe('parseSpacePath（前缀 + 穿越防护 + allowlist）', () => {
  it('合法 nodes 路径 → 返回 rel', () => {
    expect(parseSpacePath('/space/nodes/foo.md')).toBe('nodes/foo.md')
    expect(parseSpacePath('/space/nodes/竞品分析.md')).toBe('nodes/竞品分析.md')
  })

  it('缺少 /space/ 前缀 → invalid', () => {
    expect(() => parseSpacePath('nodes/foo.md')).toThrow(SpaceVfsError)
    expect(() => parseSpacePath('/other/nodes/foo.md')).toThrow(/must begin with/)
    expect(() => parseSpacePath('')).toThrow(SpaceVfsError)
  })

  it('空 rel / 绝对段 → invalid', () => {
    expect(() => parseSpacePath('/space/')).toThrow(/must address something/)
    expect(() => parseSpacePath('/space//nodes/foo.md')).toThrow(SpaceVfsError)
  })

  it('穿越与非法字节 → escape', () => {
    expect(() => parseSpacePath('/space/nodes/../secrets.json')).toThrow(/traversal/)
    expect(() => parseSpacePath('/space/nodes/..%2fescape.md')).not.toThrow(/traversal/)
    expect(() => parseSpacePath('/space/nodes\\foo.md')).toThrow(/backslash/)
    expect(() => parseSpacePath(`/space/nodes/foo${'\0'}.md`)).toThrow(/null bytes/)
  })

  it('allowlist：nodes/** 之外全部拒绝且消息可指导自纠', () => {
    expect(() => parseSpacePath('/space/space.json')).toThrow(/outside the agent read allowlist/)
    expect(() => parseSpacePath('/space/skills/some/SKILL.md')).toThrow(/outside the agent read allowlist/)
    expect(() => parseSpacePath('/space/.history/transcript.json')).toThrow(/outside the agent read allowlist/)
    expect(() => parseSpacePath('/space/.artifacts/pic.png')).toThrow(/outside the agent read allowlist/)
  })

  it('拒绝类型带 kind（route 映射 400 用）', () => {
    let allowlistThrown = false
    try {
      parseSpacePath('/space/skills/a.md')
    } catch (error) {
      allowlistThrown = true
      expect((error as SpaceVfsError).rejection.kind).toBe('allowlist')
    }
    expect(allowlistThrown).toBe(true)

    let invalidThrown = false
    try {
      parseSpacePath('no-prefix')
    } catch (error) {
      invalidThrown = true
      expect((error as SpaceVfsError).rejection.kind).toBe('invalid')
    }
    expect(invalidThrown).toBe(true)
  })

  it('前缀常量与 huabu 一致', () => {
    expect(SPACE_VFS_PREFIX).toBe('/space/')
  })
})
