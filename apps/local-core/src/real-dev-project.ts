import { createHash } from 'node:crypto'
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

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
import type { ProjectGraphSnapshot } from '@local-creative-os/contracts'
import type { SqliteMetadataRepository } from './metadata-repository.js'

/**
 * dev 工作台：真实项目种子（替代 disposable-mvp-sample 作为前端默认项目）。
 * 内容为 LCOS Gen2 真实定位/纪律/里程碑，非占位文案；幂等（已存在则不动）。
 * MVP sample 保留为测试 fixture，不再作为 dev 前端默认。
 */
export const REAL_DEV_PROJECT_ID = 'lcos-gen2-dev' as ProjectId

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

export function ensureRealDevProject(repository: SqliteMetadataRepository, workspaceRoot: string): boolean {
  if (repository.getProject(REAL_DEV_PROJECT_ID) !== undefined) return false

  const createdAt = new Date().toISOString()
  const sourceFiles = [
    { id: 'positioning', title: '项目定位', relativePath: '项目定位.md', body: DEV_POSITIONING },
    { id: 'rules', title: '施工纪律', relativePath: '施工纪律.md', body: DEV_RULES },
    { id: 'milestone', title: '当前里程碑', relativePath: '当前里程碑.md', body: DEV_MILESTONE },
  ]
  mkdirSync(workspaceRoot, { recursive: true })
  const files = sourceFiles.map((file) => {
    const absolutePath = join(workspaceRoot, file.relativePath)
    writeFileSync(absolutePath, file.body)
    const stat = statSync(absolutePath)
    return {
      ...file,
      absolutePath,
      bytes: Buffer.from(file.body, 'utf8'),
      contentHash: createHash('sha256').update(file.body).digest('hex') as ContentHash,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    }
  })

  const project: Project = {
    id: REAL_DEV_PROJECT_ID,
    name: 'LCOS Gen2 开发工作台',
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
    mimeType: 'text/markdown',
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
    kind: 'markdown',
    availability: 'available',
    currentRevisionId: `revision-${file.id}-initial` as ArtifactRevision['id'],
    createdAt,
    updatedAt: createdAt,
  }))
  const artifactViews: ArtifactView[] = files.map((file, index) => ({
    id: `view-${file.id}` as ArtifactView['id'],
    artifactId: `artifact-${file.id}` as Artifact['id'],
    revisionId: `revision-${file.id}-initial` as ArtifactRevision['id'],
    scopeId,
    referenceKind: 'primary',
    position: { x: 0, y: index * 120 },
    size: { width: 280, height: 110 },
    displayMode: 'card',
    collapsed: false,
  }))
  const relation: Relation = {
    id: 'relation-rules-milestone' as Relation['id'],
    projectId: project.id,
    sourceEntityType: 'artifact',
    sourceEntityId: `artifact-rules`,
    targetEntityType: 'artifact',
    targetEntityId: `artifact-milestone`,
    kind: 'references',
    createdAt,
    updatedAt: createdAt,
  }

  const snapshot: ProjectGraphSnapshot = {
    schemaVersion: 7,
    graphVersion: 1 as ProjectGraphSnapshot['graphVersion'],
    project,
    scopes: [scope],
    workspaces,
    artifacts,
    artifactViews,
    relations: [relation],
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
  return true
}
