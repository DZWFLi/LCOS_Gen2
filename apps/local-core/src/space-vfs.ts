/**
 * 虚拟 /space/ 命名空间 — 纯路径层（任务四 P1，借鉴 huabu acp/capabilities/fs.ts MIT）。
 *
 * huabu：wire 路径 /space/nodes/foo.md → safeResolve(canvasId, rel) 落到真实画布目录。
 * LCOS 化差异：节点活在 SQLite + 文件仓库里，虚拟路径只解析到 artifact
 * （title → safeLabel → nodes/<safeLabel>.md），永不接触磁盘路径——
 * 「symlink / 穿越」在纯虚拟层无面可攻，但仍按同构纪律拒绝
 * （防御纵深 + 拒绝消息可指导 agent 自纠）。
 *
 * 允许区域（allowlist）：仅 nodes/**。其余（space.json / skills/** / .history/** …）
 * 一律拒绝——与 huabu 只许 nodes/** + .artifacts/** 的精神一致，V0 收得更紧。
 *
 * 写边界：本模块不提供任何写形态。写入只走 CAS 守卫的 curation/text
 * （任务三已落地 not-read/stale 检测），这是 huabu「fs/write 明确关闭」的直译。
 *
 * 纯函数零副作用。
 */

/** Agent 在 wire 上看到的虚拟根。前缀之外一律拒绝。 */
export const SPACE_VFS_PREFIX = '/space/'

/** safeLabel 长度上限（节点 label 规范是 1-5 词，正常远达不到）。 */
export const SPACE_LABEL_MAX_CHARS = 64

/** 拒绝类型：route 层按 kind 映射 400/404 与错误文案。 */
export type SpaceVfsRejection =
  | { readonly kind: 'invalid'; readonly message: string }
  | { readonly kind: 'escape'; readonly message: string }
  | { readonly kind: 'allowlist'; readonly message: string }

export class SpaceVfsError extends Error {
  constructor(public readonly rejection: SpaceVfsRejection) {
    super(rejection.message)
    this.name = 'SpaceVfsError'
  }
}

/**
 * 节点 label → 文件名安全的 safeLabel。
 * CJK 全保留；空白折叠为连字符；剥 Windows 保留字符与控制字符；
 * 首尾连字符修剪；空结果回退 'node'。
 */
export function toSafeLabel(title: string): string {
  const cleaned = title
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  const sliced = cleaned.slice(0, SPACE_LABEL_MAX_CHARS)
  return sliced.length > 0 ? sliced : 'node'
}

/** 节点的命名空间相对路径（不含 /space/ 前缀）。 */
export function nodeSpaceRel(label: string): string {
  return `nodes/${toSafeLabel(label)}.md`
}

/**
 * 校验 wire 路径并返回命名空间相对路径（rel）。
 * 拒绝：非 /space/ 前缀、空 rel、绝对段、反斜杠、null 字节、
 * '.'/'..'/空段（穿越）、nodes/** 之外的任何区域。
 */
export function parseSpacePath(wirePath: string): string {
  if (typeof wirePath !== 'string' || wirePath.length === 0) {
    throw new SpaceVfsError({ kind: 'invalid', message: 'space path is required.' })
  }
  if (!wirePath.startsWith(SPACE_VFS_PREFIX)) {
    throw new SpaceVfsError({
      kind: 'invalid',
      message: `space path must begin with "${SPACE_VFS_PREFIX}".`,
    })
  }
  const rel = wirePath.slice(SPACE_VFS_PREFIX.length)
  if (rel.length === 0) {
    throw new SpaceVfsError({ kind: 'invalid', message: 'space path must address something under /space/.' })
  }
  if (rel.startsWith('/')) {
    throw new SpaceVfsError({ kind: 'invalid', message: 'space path must be relative under /space/.' })
  }
  if (rel.includes('\\')) {
    throw new SpaceVfsError({ kind: 'escape', message: 'backslash is not allowed in space paths.' })
  }
  if (rel.includes('\0')) {
    throw new SpaceVfsError({ kind: 'escape', message: 'null bytes are not allowed in space paths.' })
  }
  for (const segment of rel.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new SpaceVfsError({
        kind: 'escape',
        message: `space path segment "${segment}" is not allowed (no traversal).`,
      })
    }
  }
  if (rel !== 'nodes' && !rel.startsWith('nodes/')) {
    throw new SpaceVfsError({
      kind: 'allowlist',
      message: `"${rel}" is outside the agent read allowlist (only nodes/**).`,
    })
  }
  return rel
}
