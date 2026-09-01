import { describe, expect, it } from 'vitest'

import { decodePickerPath, encodePickerPath } from '../src/native-directory-picker.js'

describe('Native directory picker path encoding (GBK/UTF-8 mojibake fix)', () => {
  it('round-trips Chinese paths through Base64 untouched', () => {
    const paths = [
      'E:\\Codex 项目\\OS开发\\测试文件夹',
      'D:\\工作\\万视引光实习\\项目\\西子',
      'C:\\Users\\1\\Desktop\\中文目录\\子目录',
    ]
    for (const path of paths) {
      expect(decodePickerPath(encodePickerPath(path))).toBe(path)
    }
  })

  it('produces ASCII-only transport that is immune to console code pages', () => {
    const encoded = encodePickerPath('E:\\项目\\文件')
    expect(/^[A-Za-z0-9+/=]+$/.test(encoded)).toBe(true)
  })
})
