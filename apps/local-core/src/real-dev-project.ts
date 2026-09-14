import { createHash } from 'node:crypto'
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'

import type {
  Artifact,
  ArtifactRevision,
  ArtifactRevisionId,
  ArtifactView,
  ContentHash,
  FileRecord,
  Project,
  ProjectId,
  Relation,
  Scope,
  ScopeId,
  Workspace,
} from '@local-creative-os/domain'
import type { ConnectedConversationV1, ProjectGraphSnapshot } from '@local-creative-os/contracts'
import type { SqliteMetadataRepository } from './metadata-repository.js'

/**
 * dev 工作台：真实项目种子（替代 disposable-mvp-sample 作为前端默认项目）。
 * 内容为 LCOS Gen2 真实定位/纪律/里程碑，非占位文案；幂等（已存在则不动）。
 * MVP sample 保留为测试 fixture，不再作为 dev 前端默认。
 *
 * e2e 隔离 fixture（LOCAL_CORE_E2E_FIXTURE=1，由 scripts/e2e/r0-e2e-env.ps1 启动隔离 Core 时注入）
 * 在此基础上追加可见验收所需事实：真实 PNG 参考图、决策记录、更多 relation、按 displayMode 分组的
 * ArtifactView、1 个承接会话。未设置该环境变量时行为与历史完全一致（3 个 markdown + 1 条 relation + 3 个 card view）。
 */
export const REAL_DEV_PROJECT_ID = 'lcos-gen2-dev' as ProjectId

/** e2e 隔离 fixture 开关。设成 '1' 才追加可见验收 fixture；其余值/未设置 = 保持历史行为。 */
const E2E_FIXTURE_ENV = 'LOCAL_CORE_E2E_FIXTURE'

const DEV_POSITIONING = `# LCOS Gen2 项目定位

Local Creative OS Gen2 是一个以 Project + 持续 Canvas 为工作容器的本地创意项目操作系统。

它负责：理解项目、组织 Context、派发 Agent、追踪 Run、接回结果并归档。
它不替代：Figma、PPT、Photoshop、浏览器或代码编辑器本身。

一个 Project 只有一套持续项目真相，但有 Main / Context / Workflow 三个独立 Worksite，
三者复用同一 Canvas kernel，各自拥有 canvasId、camera、selection、layout 与 history。
`

const DEV_RULES = `# 施工纪律（摘要）

- 两条权威链：产品「应该做什么」走用户要求 → 获批 Sprint 卡 → T5 V4 总装正本与六路裁决 → owner addendum；代码「现在有什么」走当前 checkout 的 exact source/caller。
- 核心架构边界：Local Core 是 Project/Artifact/Run/Conversation 的唯一 truth；Huabu 是 Canvas topology/geometry/selection 的唯一 truth；Bridge/T7 只接外部能力证据。
- 按用户链路交付：组件实现、宿主挂载、用户可达、动作处理、结果回读分层如实报告；registry 注册不等于功能接通。
- 不自动 commit/push；每个 Sprint 回传 docs/handoffs/ 写施工交付。
`

const DEV_MILESTONE = `# 当前里程碑

- T6 continuation journal / work-view 聚合：CURRENT。
- T7 provider adapter（fake 驱动，真实 transport EXTERNAL_GAP）：CURRENT。
- T1 生产宿主挂载 + T4 容器（Stage/Registry/Assembly/Work View）：CURRENT。
- T5 用户链路 body（Recovery/WaitingInput/Composer/CaptureInbox/ConnectorSource/RuntimeDoctor）：CURRENT。
- Figma 视觉落地（token/尺寸/动效/a11y）：NEXT。
- Browser / Desktop：EXTERNAL_GAP / 独立审批。
`

const DEV_E2E_DECISION = `# 决策记录（e2e fixture）

这是隔离 e2e 环境的可见验收 fixture，不是 provider 生产结果，也不是真实项目决策。

- 采用 Local Core 作为唯一域真值（Domain Truth），Huabu 作为唯一空间运行时（Spatial Truth）。
- 本文件、同目录参考图（reference.e2e-fixture.png）与承接会话均随 LOCAL_CORE_E2E_FIXTURE=1 种入。
- 目的：让隔离 profile 首屏能到达 source/decision/reference 与真实 relation 边。
`

interface DevSourceFile {
  readonly id: string
  readonly title: string
  readonly relativePath: string
  readonly mimeType: string
  readonly kind: Artifact['kind']
  readonly bytes: Buffer
}

interface DevViewLayout {
  readonly displayMode: ArtifactView['displayMode']
  readonly size: { readonly width: number; readonly height: number }
  readonly position: { readonly x: number; readonly y: number }
}

/**
 * e2e 视图布局：按 displayMode 给出不同尺寸档位（card / thumbnail / compact），
 * 并按网格给出互不重叠、间距 ≥40 的整齐摆放。这里只保证 ArtifactView 的初始 box 不打架，
 * 位置不是空间真值（Spatial Truth 在 Huabu：真实落位/camera/topology 由 Canvas runtime 决定）。
 */
const E2E_VIEW_LAYOUT: Record<string, DevViewLayout> = {
  positioning: { displayMode: 'card', size: { width: 360, height: 260 }, position: { x: 0, y: 0 } },
  rules: { displayMode: 'card', size: { width: 360, height: 260 }, position: { x: 440, y: 0 } },
  reference: { displayMode: 'card', size: { width: 360, height: 260 }, position: { x: 880, y: 0 } },
  milestone: { displayMode: 'thumbnail', size: { width: 240, height: 160 }, position: { x: 0, y: 300 } },
  reference2: { displayMode: 'thumbnail', size: { width: 240, height: 160 }, position: { x: 280, y: 300 } },
  decision: { displayMode: 'compact', size: { width: 220, height: 96 }, position: { x: 560, y: 300 } },
}

/**
 * 生成 width×height 的 8-bit truecolor（color type 2）、filter type 0 的合法 PNG：
 * 自己拼 IHDR/IDAT/IEND（zlib deflate），不引入第三方依赖。
 * 画面 = 竖直渐变 from→to + 一条柔和的斜向（对角）亮带 + 轻微水平明暗变化，做出「像一张真实素材」的观感。
 */
function createGradientPng(
  width: number,
  height: number,
  from: readonly [number, number, number],
  to: readonly [number, number, number],
): Buffer {
  const stride = width * 3 + 1
  const raw = Buffer.alloc(height * stride)
  const bandWidth = 0.28
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * stride
    raw[rowStart] = 0 // filter type: none
    const t = height > 1 ? y / (height - 1) : 0
    for (let x = 0; x < width; x += 1) {
      const u = width > 1 ? x / (width - 1) : 0
      const baseR = from[0] + (to[0] - from[0]) * t
      const baseG = from[1] + (to[1] - from[1]) * t
      const baseB = from[2] + (to[2] - from[2]) * t
      // 斜向亮带：以「到对角线的距离」为相位的 sin 窗，对角线处最亮、外侧平滑衰减到 0
      const bandPhase = Math.abs(u - t) / bandWidth
      const band = bandPhase >= 1 ? 0 : Math.sin((1 - bandPhase) * (Math.PI / 2))
      // 轻微的水平方向明暗变化，模拟素材的自然光照
      const horizontal = 1 + 0.05 * Math.cos((u - 0.5) * Math.PI)
      const gain = (1 + 0.28 * band) * horizontal
      const lift = 20 * band
      const pixel = rowStart + 1 + x * 3
      raw[pixel] = clampByte(baseR * gain + lift)
      raw[pixel + 1] = clampByte(baseG * gain + lift)
      raw[pixel + 2] = clampByte(baseB * gain + lift)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: truecolor
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function clampByte(value: number): number {
  if (value <= 0) return 0
  if (value >= 255) return 255
  return Math.round(value)
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData), 0)
  return Buffer.concat([length, typeAndData, crc])
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * conversation/Glyth：ConnectedConversation 是可直接写入的真实 Core 实体
 * （进 connected_conversations，经 ProjectReceiverBinding 投影，无需 provider/bridge），故种入 1 个。
 * run/process：真实创建路径 RuntimeApplicationService.create() 需要查询 provider 能力并走 Bridge dispatch，
 *   仅凭 repository 直写 runs 会伪造 provider 进程 —— 记为 GAP: needs provider，此处不种入。
 */
function seedE2eConnectedConversation(repository: SqliteMetadataRepository, projectId: ProjectId, timestamp: string): void {
  const conversation: ConnectedConversationV1 = {
    schemaVersion: 1,
    id: 'conversation-e2e-fixture',
    projectId: String(projectId),
    provider: 'codex',
    executorId: 'executor-e2e-fixture',
    conversationRef: 'conversation-ref-e2e-fixture',
    label: '承接会话（e2e fixture）',
    isRunning: false,
    waitingReason: null,
    lastActiveAt: timestamp,
    workspaceRef: null,
    branchRef: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  repository.upsertConnectedConversation(conversation)
}

export function ensureRealDevProject(repository: SqliteMetadataRepository, workspaceRoot: string): boolean {
  if (repository.getProject(REAL_DEV_PROJECT_ID) !== undefined) return false

  const e2eFixture = process.env[E2E_FIXTURE_ENV] === '1'
  const createdAt = new Date().toISOString()
  const sourceFiles: DevSourceFile[] = [
    { id: 'positioning', title: '项目定位', relativePath: '项目定位.md', mimeType: 'text/markdown', kind: 'markdown', bytes: Buffer.from(DEV_POSITIONING, 'utf8') },
    { id: 'rules', title: '施工纪律', relativePath: '施工纪律.md', mimeType: 'text/markdown', kind: 'markdown', bytes: Buffer.from(DEV_RULES, 'utf8') },
    { id: 'milestone', title: '当前里程碑', relativePath: '当前里程碑.md', mimeType: 'text/markdown', kind: 'markdown', bytes: Buffer.from(DEV_MILESTONE, 'utf8') },
  ]
  if (e2eFixture) {
    // 可见验收 fixture：真实 PNG 参考图 + 决策记录 markdown。内容显式标注 e2e fixture，不冒充 provider 生产结果。
    sourceFiles.push({
      id: 'decision',
      title: '决策记录（e2e fixture）',
      relativePath: '决策记录.e2e-fixture.md',
      mimeType: 'text/markdown',
      kind: 'markdown',
      bytes: Buffer.from(DEV_E2E_DECISION, 'utf8'),
    })
    sourceFiles.push({
      id: 'reference',
      title: '参考图（e2e fixture）',
      relativePath: 'reference.e2e-fixture.png',
      mimeType: 'image/png',
      kind: 'image',
      bytes: createGradientPng(512, 320, [26, 42, 92], [92, 58, 140]),
    })
    sourceFiles.push({
      id: 'reference2',
      title: '参考图 B（e2e fixture）',
      relativePath: 'reference-b.e2e-fixture.png',
      mimeType: 'image/png',
      kind: 'image',
      bytes: createGradientPng(512, 320, [20, 62, 74], [28, 96, 84]),
    })
  }
  mkdirSync(workspaceRoot, { recursive: true })
  const files = sourceFiles.map((file) => {
    const absolutePath = join(workspaceRoot, file.relativePath)
    writeFileSync(absolutePath, file.bytes)
    const stat = statSync(absolutePath)
    return {
      ...file,
      absolutePath,
      contentHash: createHash('sha256').update(file.bytes).digest('hex') as ContentHash,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    }
  })

  const project: Project = {
    id: REAL_DEV_PROJECT_ID,
    name: e2eFixture ? 'LCOS Gen2 开发工作台（e2e fixture）' : 'LCOS Gen2 开发工作台',
    rootPath: workspaceRoot,
    graphVersion: 1 as Project['graphVersion'],
    createdAt,
    updatedAt: createdAt,
  }
  const scopeId = 'scope-real-root' as Scope['id']
  const scope: Scope = {
    id: scopeId,
    projectId: project.id,
    parentScopeId: null,
    containerViewId: null,
    kind: 'root',
    name: 'Real Root',
    createdAt,
    updatedAt: createdAt,
  }
  const workspaces: readonly Workspace[] = [
    {
      id: 'workspace-real-main' as Workspace['id'],
      projectId: project.id,
      scopeId,
      name: '施工主线',
      intent: 'understand',
      viewport: { x: 80, y: 60, zoom: 0.9 },
      focusedViewIds: files.slice(0, 2).map((file) => `view-${file.id}` as ArtifactView['id']),
      visibleLayers: ['core', 'process'],
      contextPolicy: 'workspace-related',
      preferredSurface: 'main',
      canvasId: 'canvas-lcos-main',
      updatedAt: createdAt,
    },
    {
      id: 'workspace-real-context' as Workspace['id'],
      projectId: project.id,
      scopeId,
      name: 'Context · 理解现场',
      intent: 'understand',
      viewport: { x: 0, y: 0, zoom: 0.8 },
      focusedViewIds: [],
      visibleLayers: ['core', 'process'],
      contextPolicy: 'workspace-related',
      preferredSurface: 'context',
      canvasId: 'canvas-lcos-context',
      updatedAt: createdAt,
    },
    {
      id: 'workspace-real-workflow' as Workspace['id'],
      projectId: project.id,
      scopeId,
      name: 'Workflow · 行动现场',
      intent: 'build',
      viewport: { x: 0, y: 0, zoom: 0.8 },
      focusedViewIds: [],
      visibleLayers: ['core', 'process'],
      contextPolicy: 'workspace-related',
      preferredSurface: 'workflow',
      canvasId: 'canvas-lcos-workflow',
      updatedAt: createdAt,
    },
  ]
  const fileRecords: FileRecord[] = files.map((file) => ({
    id: `file-${file.id}` as FileRecord['id'],
    projectId: project.id,
    observedPath: file.absolutePath,
    observedHash: file.contentHash,
    size: file.size,
    modifiedAt: file.modifiedAt,
    mimeType: file.mimeType,
    availability: 'current',
    observedAt: createdAt,
  }))
  const artifactRevisions: ArtifactRevision[] = files.map((file) => ({
    id: `revision-${file.id}-initial` as ArtifactRevision['id'],
    artifactId: `artifact-${file.id}` as Artifact['id'],
    fileRecordId: `file-${file.id}` as FileRecord['id'],
    contentHash: file.contentHash,
    source: 'import',
    status: 'current',
    createdAt,
  }))
  const artifacts: Artifact[] = files.map((file) => ({
    id: `artifact-${file.id}` as Artifact['id'],
    projectId: project.id,
    title: file.title,
    kind: file.kind,
    availability: 'available',
    currentRevisionId: `revision-${file.id}-initial` as ArtifactRevision['id'],
    createdAt,
    updatedAt: createdAt,
  }))
  const artifactViews: ArtifactView[] = e2eFixture
    ? files.map((file) => {
        const layout = E2E_VIEW_LAYOUT[file.id]
        if (layout === undefined) throw new Error(`e2e fixture layout missing for ${file.id}`)
        return {
          id: `view-${file.id}` as ArtifactView['id'],
          artifactId: `artifact-${file.id}` as Artifact['id'],
          revisionId: `revision-${file.id}-initial` as ArtifactRevision['id'],
          scopeId,
          referenceKind: 'primary' as const,
          position: layout.position,
          size: layout.size,
          displayMode: layout.displayMode,
          collapsed: false,
        }
      })
    : files.map((file, index) => ({
        id: `view-${file.id}` as ArtifactView['id'],
        artifactId: `artifact-${file.id}` as Artifact['id'],
        revisionId: `revision-${file.id}-initial` as ArtifactRevision['id'],
        scopeId,
        referenceKind: 'primary' as const,
        position: { x: 0, y: index * 120 },
        size: { width: 280, height: 110 },
        displayMode: 'card' as const,
        collapsed: false,
      }))
  const relations: Relation[] = [
    {
      id: 'relation-rules-milestone' as Relation['id'],
      projectId: project.id,
      sourceEntityType: 'artifact',
      sourceEntityId: 'artifact-rules',
      targetEntityType: 'artifact',
      targetEntityId: 'artifact-milestone',
      kind: 'references',
      createdAt,
      updatedAt: createdAt,
    },
  ]
  if (e2eFixture) {
    // domain 的 Relation.kind 是自由字符串（packages/domain 无 RelationKind 枚举；routes/relations.ts 只校验非空 ≤80）。
    // 这里沿用仓库既有的 kind 取值约定：references（引用）、decision（决策指向目标）、governs（决策约束）。
    relations.push(
      {
        id: 'relation-decision-milestone' as Relation['id'],
        projectId: project.id,
        sourceEntityType: 'artifact',
        sourceEntityId: 'artifact-decision',
        targetEntityType: 'artifact',
        targetEntityId: 'artifact-milestone',
        kind: 'decision',
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: 'relation-milestone-decision' as Relation['id'],
        projectId: project.id,
        sourceEntityType: 'artifact',
        sourceEntityId: 'artifact-milestone',
        targetEntityType: 'artifact',
        targetEntityId: 'artifact-decision',
        kind: 'governs',
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: 'relation-reference-positioning' as Relation['id'],
        projectId: project.id,
        sourceEntityType: 'artifact',
        sourceEntityId: 'artifact-reference',
        targetEntityType: 'artifact',
        targetEntityId: 'artifact-positioning',
        kind: 'references',
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: 'relation-reference2-reference' as Relation['id'],
        projectId: project.id,
        sourceEntityType: 'artifact',
        sourceEntityId: 'artifact-reference2',
        targetEntityType: 'artifact',
        targetEntityId: 'artifact-reference',
        kind: 'references',
        createdAt,
        updatedAt: createdAt,
      },
    )
  }

  const snapshot: ProjectGraphSnapshot = {
    schemaVersion: 7,
    graphVersion: 1 as ProjectGraphSnapshot['graphVersion'],
    project,
    scopes: [scope],
    workspaces,
    artifacts,
    artifactViews,
    relations,
    notes: [],
    artifactRevisions,
    fileRecords,
    checkpoints: [],
  }
  repository.save(snapshot)
  // T2 C2-1C：种子 rail order（当前现场 = Main workspace），让 Railway 可见体有真实结构导航数据。
  try {
    repository.saveProjectViewRailOrder(
      String(project.id),
      workspaces.map((workspace) => ({ kind: 'scene' as const, viewId: String(workspace.id) })),
      0,
    )
  } catch {
    // 幂等/并发无关的种子写失败不阻塞项目创建（rail order 可随后由用户操作写入）。
  }
  if (e2eFixture) seedE2eConnectedConversation(repository, project.id, createdAt)
  return true
}
