import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

import type {
  Artifact,
  ArtifactId,
  ArtifactReturn,
  ArtifactReturnId,
  ArtifactRevision,
  ArtifactRevisionId,
  ArtifactView,
  ArtifactViewId,
  Checkpoint,
  CheckpointId,
  FileRecord,
  FileRecordId,
  GraphVersion,
  HandoffRecord,
  Run,
  RunId,
  RuntimeBinding,
  RuntimeDispatch,
  Note,
  NoteId,
  Project,
  ProjectId,
  PreviewRecord,
  PreviewRecordId,
  Relation,
  RelationId,
  RunEvent,
  RunEventId,
  SessionSummary,
  Scope,
  ScopeId,
  Workspace,
  WorkspaceId,
  WorkspaceMembership,
  WorkspaceMembershipSource,
  WorkspaceEntityMembership,
} from '@local-creative-os/domain'
import { assertContainmentWrite } from '@local-creative-os/domain'
import type { ColorPinDefinitionV0, ColorPinMembershipV0, SpatialMarkerIntentV0 } from '@local-creative-os/contracts'
import type {
  AcceptArtifactReturnResult,
  ActiveContextV2,
  CaptureReceiptV0,
  CaptureSpacePresentationV1,
  CaptureStagingItemV0,
  CaptureWatchRuleV0,
  CurationPatchReceiptV0,
  MutationChangeItemV1,
  MutationChangeSetV1,
  ReorganizeProposalV0,
  CommandDraftV1,
  ConnectedConversationV1,
  ContextChangeProposalV1,
  SkillProposalV1,
  DerivedWriteGuardV0,
  DerivedWriteStatusV0,
  ProviderSessionBindingV1,
  RunInputRequestV1,
  AnswerRunInputRequestV1,
  MutationBatch,
  PersistedContextManifestV0,
  PresentationViewV0,
  ProjectGraphSnapshot,
  ProjectHandoffPackV1,
  ProjectReceiverBindingV1,
  ProjectViewRailOrderV0,
  ProjectViewRailRefV0,
  RejectArtifactReturnResult,
  ResourceDescriptorV0,
  ImportBatchRefV1,
  RetryRunResult,
} from '@local-creative-os/contracts'

type Row = Record<string, SQLInputValue | undefined>

function resourceDescriptorHash(descriptor: ResourceDescriptorV0): string {
  return createHash('sha256').update(JSON.stringify(descriptor)).digest('hex')
}

type ForeignKeyCheckRow = {
  readonly table: string
  readonly rowid: number
  readonly parent: string
  readonly fkid: number
}

export interface MetadataForeignKeyContext {
  readonly operationType: string
  readonly entityId: string
  readonly table: string
  readonly statement: string
  readonly foreignKeyColumn: string
  readonly referencedTable: string
  readonly referencedId: string
  readonly foreignKeyCheck: readonly ForeignKeyCheckRow[]
}

/** F6 P1-A2：VisualProfile CAS 版本冲突（current 是库内现值，expected 是请求期望值）。 */
export class StaleVisualProfileVersionError extends Error {
  constructor(readonly current: number, readonly expected: number) {
    super(`STALE_VISUAL_PROFILE_VERSION current=${current} expected=${expected}`)
    this.name = 'StaleVisualProfileVersionError'
  }
}

export class MetadataForeignKeyConstraintError extends Error {
  readonly context: MetadataForeignKeyContext

  constructor(context: MetadataForeignKeyContext, cause?: unknown) {
    super(`${context.operationType} ${context.entityId} violates ${context.table}.${context.foreignKeyColumn} -> ${context.referencedTable}.id (${context.referencedId})`)
    this.name = 'MetadataForeignKeyConstraintError'
    this.context = context
    this.cause = cause
  }
}

/** Phase A：统一 TitlePolicy。名称 ≠ Identity；mode 决定谁可以改显示名。 */
export type TitleModeV0 = 'auto' | 'manual' | 'locked'

export interface EntityTitleInputV0 {
  readonly title: string
  readonly mode: TitleModeV0
  readonly generatedBy?: string
}

const TITLE_TABLE_COLUMN: Record<'project' | 'workspace' | 'artifact' | 'scope', { readonly table: string; readonly column: string }> = {
  project: { table: 'projects', column: 'name' },
  workspace: { table: 'workspaces', column: 'name' },
  artifact: { table: 'artifacts', column: 'title' },
  scope: { table: 'scopes', column: 'name' },
}

export type TitleEntityKind = keyof typeof TITLE_TABLE_COLUMN

function json<T>(value: SQLInputValue): T {
  if (typeof value !== 'string') return JSON.parse('null') as unknown as T
  try { return JSON.parse(value) as T } catch { return JSON.parse('null') as unknown as T }
}

export class RuntimeLifecycleConflictError extends Error {
  readonly code = 'RUNTIME_LIFECYCLE_CONFLICT'
}

const FORBIDDEN_MANIFEST_KEYS = new Set([
  'provider',
  'bridgeTaskId',
  'externalTaskId',
  'externalSessionId',
  'runtimeRoot',
  'stagingPath',
  'mcpUrl',
])

function assertCanonicalManifest(manifest: PersistedContextManifestV0): void {
  if (manifest.schemaVersion !== 0) throw new Error('ContextManifest schemaVersion must be 0.')
  const expectedHash = createHash('sha256').update(manifest.canonicalJson, 'utf8').digest('hex')
  if (manifest.manifestHash !== expectedHash) throw new Error('ContextManifest hash does not match canonical JSON.')
  let parsed: unknown
  try { parsed = JSON.parse(manifest.canonicalJson) } catch { throw new Error('ContextManifest canonical JSON is invalid.') }
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      if (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith('/') || value.startsWith('\\\\')) {
        throw new Error('ContextManifest cannot contain absolute paths.')
      }
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (typeof value !== 'object' || value === null) return
    for (const [key, nested] of Object.entries(value)) {
      if (FORBIDDEN_MANIFEST_KEYS.has(key)) throw new Error(`ContextManifest cannot contain ${key}.`)
      visit(nested)
    }
  }
  visit(parsed)
}

export interface MetadataRepositoryOptions {
  readonly disposableOnly?: boolean
}

/** Phase 5 Live Session Binding：会话七态持久化行（contracts session-lifecycle taxonomy）。 */
export interface SessionLifecycleRecordV1 {
  readonly projectId: string
  readonly provider: string
  readonly phase: string
  readonly staleFrom?: string
  readonly lastTransitionReason?: string
  readonly updatedAt: string
}

export class SqliteMetadataRepository {
  readonly databasePath: string
  readonly #database: DatabaseSync
  readonly #disposableOnly: boolean
  #vectorLoaded = false
  #vectorLoadError: string | undefined

  constructor(databasePath: string, options: MetadataRepositoryOptions = {}) {
    this.databasePath = resolve(databasePath)
    this.#disposableOnly = options.disposableOnly ?? false
    mkdirSync(dirname(this.databasePath), { recursive: true })
    this.#database = new DatabaseSync(this.databasePath, { allowExtension: true })
    try {
      // busy_timeout：多进程/多连接并发访问同一库时（Core + Bridge + worker），
      // 避免立刻 SQLITE_BUSY；Windows 下 AV 扫描短暂锁文件也会因此被容忍重试。
      this.#database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;')
      this.#migrate()
      this.#tryLoadVectorExtension()
    } catch (error: unknown) {
      this.#database.close()
      throw error
    }
  }

  close(): void { this.#database.close() }

  foreignKeyCheck(): readonly ForeignKeyCheckRow[] {
    return (this.#database.prepare('PRAGMA foreign_key_check').all() as Row[]).map((row) => ({
      table: String(row.table),
      rowid: Number(row.rowid),
      parent: String(row.parent),
      fkid: Number(row.fkid),
    }))
  }

  // ==================== Migration ====================

  #migrate(): void {
    let current = Number((this.#database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
    if (current === 0) { this.#migrate_001(); current = 6 }
    if (current === 1) { this.#migrate_002_from_v1(); current = 3 }
    if (current === 2) { this.#migrate_003_from_v2(); current = 3 }
    if (current === 3) { this.#migrate_004_from_v3(); current = 4 }
    if (current === 4) { this.#migrate_005_from_v4(); current = 5 }
    if (current === 5) { this.#migrate_006_from_v5(); current = 6 }
    if (current === 6) { this.#migrate_007_from_v6(); current = 7 }
    if (current === 7) { this.#migrate_008_from_v7(); current = 8 }
    if (current === 8) { this.#migrate_009_from_v8(); current = 9 }
    if (current === 9) { this.#migrate_010_from_v9(); current = 10 }
    if (current === 10) { this.#migrate_011_from_v10(); current = 11 }
    if (current === 11) { this.#migrate_012_from_v11(); current = 12 }
    if (current === 12) { this.#migrate_013_from_v12(); current = 13 }
    if (current === 13) { this.#migrate_014_from_v13(); current = 14 }
    if (current === 14) { this.#migrate_015_from_v14(); current = 15 }
    if (current === 15) { this.#migrate_016_from_v15(); current = 16 }
    if (current === 16) { this.#migrate_017_from_v16(); current = 17 }
    if (current === 17) { this.#migrate_018_from_v17(); current = 18 }
    if (current === 18) { this.#migrate_019_from_v18(); current = 19 }
    if (current === 19) { this.#migrate_020_from_v19(); current = 20 }
    if (current === 20) { this.#migrate_021_from_v20(); current = 21 }
    if (current === 21) { this.#migrate_022_from_v21(); current = 22 }
    if (current === 22) { this.#migrate_023_from_v22(); current = 23 }
    if (current === 23) { this.#migrate_024_from_v23(); current = 24 }
    if (current === 24) { this.#migrate_025_from_v24(); current = 25 }
    if (current === 25) { this.#migrate_026_from_v25(); current = 26 }
    if (current === 26) { this.#migrate_027_from_v26(); current = 27 }
    if (current === 27) { this.#migrate_028_from_v27(); current = 28 }
    if (current === 28) { this.#migrate_029_from_v28(); current = 29 }
    if (current === 29) { this.#migrate_030_from_v29(); current = 30 }
    if (current === 30) { this.#migrate_031_from_v30(); current = 31 }
    if (current === 31) { this.#migrate_032_from_v31(); current = 32 }
    if (current === 32) { this.#migrate_033_from_v32(); current = 33 }
    if (current === 33) { this.#migrate_034_from_v33(); current = 34 }
    if (current === 34) { this.#migrate_035_from_v34(); current = 35 }
    if (current === 35) { this.#migrate_036_from_v35(); current = 36 }
    if (current === 36) { this.#migrate_037_from_v36(); current = 37 }
    if (current === 37) { this.#migrate_038_from_v37(); current = 38 }
    if (current === 38) { this.#migrate_039_from_v38(); current = 39 }
    if (current === 39) { this.#migrate_040_from_v39(); current = 40 }
    if (current === 40) { this.#migrate_041_from_v40(); current = 41 }
    if (current === 41) { this.#migrate_042_from_v41(); current = 42 }
    if (current === 42) { this.#migrate_043_from_v42(); current = 43 }
    if (current === 43) { this.#migrate_044_from_v43(); current = 44 }
    if (current === 44) { this.#migrate_045_from_v44(); current = 45 }
    if (current === 45) { this.#migrate_046_from_v45(); current = 46 }
    if (current === 46) { this.#migrate_047_from_v46(); current = 47 }
    if (current === 47) { this.#migrate_048_from_v47(); current = 48 }
    if (current === 48) { this.#migrate_049_from_v48(); current = 49 }
    if (current === 49) { this.#migrate_050_from_v49(); current = 50 }
    if (current === 50) { this.#migrate_051_from_v50(); current = 51 }
    if (current !== 51) throw new Error(`Unsupported metadata schema version ${current}.`)
  }

  #migrate_037_from_v36(): void {
    // 0.1 Capture Space: system-level presentation state. Payload truth stays in capture_staging_items.
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS capture_space_presentation (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        presentation_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      PRAGMA user_version = 37;
    `)
  }

  #migrate_038_from_v37(): void {
    // RECEIVER-0 会话承接关系层：ConnectedConversation 承接关系 + ProjectReceiverBinding。
    // 与 provider_session_bindings（lease 运行时层）并存；connectedConversationIds 由
    // connected_conversations 投影得出，binding 表只存 activeReceiverId 与 revision 原料。
    this.#database.exec(`
      BEGIN;
      CREATE TABLE IF NOT EXISTS connected_conversations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK(provider IN ('codex','workbuddy')),
        executor_id TEXT NOT NULL,
        conversation_ref TEXT NOT NULL,
        label TEXT NOT NULL,
        is_running INTEGER NOT NULL DEFAULT 0 CHECK(is_running IN (0,1)),
        waiting_reason TEXT,
        last_active_at TEXT NOT NULL,
        workspace_ref TEXT,
        branch_ref TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, conversation_ref)
      );
      CREATE INDEX IF NOT EXISTS idx_connected_conversations_project
        ON connected_conversations(project_id, last_active_at DESC);
      CREATE TABLE IF NOT EXISTS project_receiver_bindings (
        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        active_receiver_id TEXT REFERENCES connected_conversations(id) ON DELETE SET NULL,
        revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
        updated_at TEXT NOT NULL
      );
      PRAGMA user_version = 38;
      COMMIT;
    `)
  }

  #migrate_039_from_v38(): void {
    // 第一梯队核心能力 B：语义索引 chunk 维度 —— 块级锚点（chunkAnchor）让检索能引用到
    // 'pdf:p3-p5' / 'section:风险' 粒度而不是整份文档。与 search_document_embeddings
    // （整文档向量）并存：新索引写入 chunk 表；旧整文档向量行成为历史数据，
    // 由 deleteSearchDocument 随实体删除一并清理。
    this.#database.exec(`
      BEGIN;
      CREATE TABLE IF NOT EXISTS search_document_chunks (
        entity_id TEXT NOT NULL,
        model TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        chunk_count INTEGER NOT NULL,
        chunk_anchor TEXT NOT NULL,
        chunk_kind TEXT NOT NULL CHECK(chunk_kind IN ('title','body')),
        chunk_text TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        dimensions INTEGER,
        embedding_blob BLOB,
        indexed_at TEXT NOT NULL,
        PRIMARY KEY(entity_id, model, chunk_index)
      );
      CREATE INDEX IF NOT EXISTS idx_search_document_chunks_model
        ON search_document_chunks(model);
      PRAGMA user_version = 39;
      COMMIT;
    `)
  }

  #migrate_040_from_v39(): void {
    // RECEIVER-3 Handoff 快照：切换 Active Receiver 时冻结的承接现场
    // （surface + selection + from/to）。同一 to_conversation 只保留最新
    // 未消费行（service 层 prepare 时清理旧行）；consumed_at 非空表示已注入。
    this.#database.exec(`
      BEGIN;
      CREATE TABLE IF NOT EXISTS project_handoff_packs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        from_conversation_id TEXT,
        to_conversation_id TEXT NOT NULL,
        surface_kind TEXT NOT NULL CHECK(surface_kind IN ('main','context','workflow')),
        surface_id TEXT NOT NULL,
        selection_entity_ids_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        consumed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_project_handoff_packs_pending
        ON project_handoff_packs(project_id, to_conversation_id, created_at DESC);
      PRAGMA user_version = 40;
      COMMIT;
    `)
  }

  #migrate_041_from_v40(): void {
    // Phase 5 Live Session Binding：会话七态持久化（contracts session-lifecycle taxonomy）。
    // 无行 = dormant；stale 是 freshness 旁路（stale_from 记被中断的主轨前态）。
    this.#database.exec(`
      BEGIN;
      CREATE TABLE IF NOT EXISTS session_lifecycle_states (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK(provider IN ('codex','workbuddy')),
        phase TEXT NOT NULL CHECK(phase IN ('dormant','connecting','online','busy','waiting_input','disconnected','stale')),
        stale_from TEXT,
        last_transition_reason TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, provider)
      );
      PRAGMA user_version = 41;
      COMMIT;
    `)
  }

  #migrate_042_from_v41(): void {
    // Conversation Identity Bridge + Birth Provenance（20260827 P0）：
    // connected_conversations.conversation_session_id：canonical 链接（唯一写路径 link-session）。
    // artifacts.birth_run_id：出生 Run 盖戳（acceptArtifactReturn 诞生分支写入；读取侧带
    // adopted-returns 兜底覆盖迁移前存量）。
    this.#database.exec(`
      BEGIN;
      ALTER TABLE connected_conversations ADD COLUMN conversation_session_id TEXT;
      ALTER TABLE artifacts ADD COLUMN birth_run_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_artifacts_birth_run ON artifacts(birth_run_id);
      PRAGMA user_version = 42;
      COMMIT;
    `)
  }

  #migrate_043_from_v42(): void {
    // F6 P0-A3（20260828）：OCR evidence 持久化——图片 artifact 的文本证据层。
    // 显式触发（/runtime/ocr 跑完落库）+ reindex 时读取；没有 evidence 的图片
    // 正文诚实为空（绝不拿 filename 冒充语义索引）。同 artifact 重跑 OCR = 覆盖。
    this.#database.exec(`
      BEGIN;
      CREATE TABLE IF NOT EXISTS ocr_evidence (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        artifact_id TEXT NOT NULL,
        text TEXT NOT NULL,
        engine TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (project_id, artifact_id)
      );
      PRAGMA user_version = 43;
      COMMIT;
    `)
  }

  #migrate_047_from_v46(): void {
    // 裁决 1（20260828）：Scene working-set 泛化——无 view 的可投影 Project Entity（Note 等）
    // 以 entity 成员进入 workspace truth。与 workspace_memberships（view 成员）同一逻辑 truth
    // 的两个物理表；FK 到 workspaces，删除级联。
    this.#database.exec(`
      BEGIN;
      CREATE TABLE IF NOT EXISTS workspace_entity_memberships (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        entity_type TEXT NOT NULL CHECK(entity_type IN ('note','scope','workspace','conversation')),
        entity_id TEXT NOT NULL,
        added_at TEXT NOT NULL,
        added_by TEXT NOT NULL CHECK(added_by IN ('user','agent','run','import')),
        PRIMARY KEY(workspace_id, entity_type, entity_id)
      );
      PRAGMA user_version = 47;
      COMMIT;
    `)
  }

  #migrate_048_from_v47(): void {
    // F6A2（20260829）：Spatial Marker 意图持久化。只存 intent（targetRef/scope/
    // sourceSurfaceRef）——Pin/Edge Cursor/Cluster/坐标/zoom 全部是前端 viewport
    // 投影，禁止进 Core truth。跨 Project fail-close 由写路径校验（不存 target projectId 列）。
    this.#database.exec(`
      BEGIN;
      CREATE TABLE IF NOT EXISTS spatial_marker_intents (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        target_kind TEXT NOT NULL CHECK(target_kind IN ('view','entity','surface')),
        target_id TEXT NOT NULL,
        scope TEXT NOT NULL CHECK(scope IN ('local','cross-surface')),
        source_surface_ref TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      PRAGMA user_version = 48;
      COMMIT;
    `)
  }

  #migrate_049_from_v48(): void {
    // R1-C：CommandDraft 从“Main 输入框草稿”升级为跨 Surface 的共享 Command State。
    // Selection 与 Reference Set 分列；Receiver / Surface / Intent 一并持久化，避免
    // Conversation / Assembly / Canvas / Composer 切换后互相失忆。
    this.#database.exec(`
      BEGIN;
      ALTER TABLE command_drafts ADD COLUMN surface_kind TEXT NOT NULL DEFAULT 'main' CHECK(surface_kind IN ('main','context','workflow','conversation'));
      ALTER TABLE command_drafts ADD COLUMN surface_id TEXT;
      ALTER TABLE command_drafts ADD COLUMN selection_view_ids_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE command_drafts ADD COLUMN receiver_id TEXT;
      ALTER TABLE command_drafts ADD COLUMN intent TEXT NOT NULL DEFAULT 'analyze' CHECK(intent IN ('analyze','create','revise'));
      ALTER TABLE command_drafts ADD COLUMN result_policy TEXT NOT NULL DEFAULT 'reply_only' CHECK(result_policy IN ('reply_only','create_artifact','create_collection','draft_revision_per_target'));
      PRAGMA user_version = 49;
      COMMIT;
    `)
  }

  #migrate_050_from_v49(): void {
    // S3：RunRecipe → Skill Proposal seam。与 context_proposals 同款提案表模式
    // （proposal_id PK + status 四态 CHECK + proposal_json 快照 + 时间戳 upsert）——
    // 状态机/审批通道复用现有 proposal 机制，accept 后经 S2 Skill Builder 落盘。
    this.#database.exec(`
      BEGIN;
      CREATE TABLE IF NOT EXISTS skill_proposals (
        proposal_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected','stale')),
        proposal_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_skill_proposals_project_status
        ON skill_proposals(project_id, status, created_at);
      PRAGMA user_version = 50;
      COMMIT;
    `)
  }

  #migrate_051_from_v50(): void {
    // A25-6: Color Pin is an independent many-to-many Project index relationship.
    // Definitions own color identity; memberships bind canonical targets. No screen/world coordinates.
    this.#database.exec(`
      BEGIN;
      CREATE TABLE IF NOT EXISTS color_pin_definitions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        color_value TEXT NOT NULL,
        label TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, color_value)
      );
      CREATE TABLE IF NOT EXISTS color_pin_memberships (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        color_pin_id TEXT NOT NULL REFERENCES color_pin_definitions(id) ON DELETE CASCADE,
        target_kind TEXT NOT NULL CHECK(target_kind IN ('view','entity','surface')),
        target_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, color_pin_id, target_kind, target_id)
      );
      CREATE INDEX IF NOT EXISTS idx_color_pin_memberships_project_color
        ON color_pin_memberships(project_id, color_pin_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_color_pin_memberships_project_target
        ON color_pin_memberships(project_id, target_kind, target_id);
      PRAGMA user_version = 51;
      COMMIT;
    `)
  }
  #migrate_046_from_v45(): void {
    // F6 follow-up（20260828 补充冻结）：capture materialize 产物回链——
    // resolvedArtifactId/resolvedViewId 使 capture→surface 的 apply 可安全重试（幂等复用）。
    // 存量已 resolved 行两列为 NULL，保持旧行为（fail-close），不回填猜测。
    this.#database.exec(`
      BEGIN;
      ALTER TABLE capture_staging_items ADD COLUMN resolved_artifact_id TEXT;
      ALTER TABLE capture_staging_items ADD COLUMN resolved_view_id TEXT;
      PRAGMA user_version = 46;
      COMMIT;
    `)
  }

  #migrate_045_from_v44(): void {
    // F6 P1-A2（20260828）：ProjectVisualProfile——Presentation-only 的项目视觉身份。
    // versioned + CAS（PUT 带 expectedVersion）；不影响 Project business truth；
    // glythMarkId/tintToken 白名单校验在 service 层（contracts 常量为唯一定义源）。
    this.#database.exec(`
      BEGIN;
      CREATE TABLE IF NOT EXISTS project_visual_profiles (
        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        version INTEGER NOT NULL CHECK(version >= 0),
        tint TEXT NOT NULL,
        glyth_mark_id TEXT NOT NULL,
        glyth_mark_color TEXT,
        scale REAL,
        orientation REAL,
        updated_at TEXT NOT NULL
      );
      PRAGMA user_version = 45;
      COMMIT;
    `)
  }
  #migrate_044_from_v43(): void {
    // F6 P0-D（20260828）：ResultSlot 表 + Run 的 Composer 三列。
    // result_slots：Blank Result authoritative truth（empty/running/review/materialized）；
    // runs.receiver_conversation_id：canonical ReceiverRef（Core 解析，前端不猜 session）；
    // runs.ordered_references_json：heterogeneous ordered refs V2（artifact/view/scope/
    // workspace/conversation/component）；runs.result_slot_id：Run→槽位关联。
    this.#database.exec(`
      BEGIN;
      CREATE TABLE IF NOT EXISTS result_slots (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        scope_id TEXT NOT NULL,
        workspace_id TEXT,
        x REAL NOT NULL,
        y REAL NOT NULL,
        width REAL,
        height REAL,
        status TEXT NOT NULL CHECK(status IN ('empty','running','review','materialized')),
        artifact_view_id TEXT,
        artifact_id TEXT,
        run_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_result_slots_project
        ON result_slots(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_result_slots_run
        ON result_slots(run_id);
      ALTER TABLE runs ADD COLUMN receiver_conversation_id TEXT;
      ALTER TABLE runs ADD COLUMN ordered_references_json TEXT;
      ALTER TABLE runs ADD COLUMN result_slot_id TEXT;
      PRAGMA user_version = 44;
      COMMIT;
    `)
  }
  #migrate_036_from_v35(): void {
    // S6: one durable batch identity for one user-visible import action.
    // Keep this as provenance only; it must never imply Collection membership.
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS import_batches (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        source_kind TEXT NOT NULL,
        status TEXT NOT NULL,
        scope_id TEXT,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        completed_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_import_batches_project_completed
        ON import_batches(project_id, completed_at DESC);
      PRAGMA user_version = 36;
    `)
  }

  #migrate_035_from_v34(): void {
    // B0 Safety Gate: Relation is a first-class relation object. Keep source/target/type
    // traversal indexed so Agent Attention and graph projections never require a full scan.
    this.#database.exec(`
      CREATE INDEX IF NOT EXISTS idx_relations_project_source
        ON relations(project_id, source_entity_type, source_entity_id);
      CREATE INDEX IF NOT EXISTS idx_relations_project_target
        ON relations(project_id, target_entity_type, target_entity_id);
      CREATE INDEX IF NOT EXISTS idx_relations_project_kind
        ON relations(project_id, kind);
      PRAGMA user_version = 35;
    `)
  }

  #migrate_034_from_v33(): void {
    // R2 P0：项目视图栏混合顺序（Collection/Context/Workflow 跨类别持久化）。
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS project_view_rail_order (
        project_id TEXT PRIMARY KEY,
        ordered_refs TEXT NOT NULL,
        version INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
      PRAGMA user_version = 34;
    `)
  }

  #migrate_033_from_v32(): void {
    // Phase 1（GUI Closeout）：Workspace 排序持久化（Left Rail 保存视图顺序）。
    try { this.#database.exec('ALTER TABLE workspaces ADD COLUMN sort_index INTEGER NOT NULL DEFAULT 0') } catch { /* already present */ }
    this.#database.exec(`
      UPDATE workspaces SET sort_index = (SELECT COUNT(*) FROM workspaces w2 WHERE w2.project_id = workspaces.project_id AND w2.rowid <= workspaces.rowid) - 1;
      PRAGMA user_version = 33;
    `)
  }

  #migrate_032_from_v31(): void {
    // HU-1B: Reorganize proposal 关联 ChangeSet（安全回滚依据）。
    try { this.#database.exec(`ALTER TABLE reorganize_proposals ADD COLUMN change_set_id TEXT`) } catch {}
    this.#database.exec(`PRAGMA user_version = 32`)
  }

  #migrate_031_from_v30(): void {
    // HU-1B: Mutation Change Sets（technical audit，可逆性由 inverse + fingerprint 保证）。
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS mutation_change_sets (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        actor_kind TEXT NOT NULL,
        actor_id TEXT,
        changes_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        reverted_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_mutation_change_sets_project
      ON mutation_change_sets(project_id, created_at);
      PRAGMA user_version = 31;
    `)
  }

  #migrate_030_from_v29(): void {
    // HU-1A: Curation receipts 持久化（operationId 幂等跨重启）。
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS curation_operation_receipts (
        operation_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        status TEXT NOT NULL,
        receipt_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_curation_receipts_project
      ON curation_operation_receipts(project_id, created_at);
      PRAGMA user_version = 30;
    `)
  }

  #migrate_029_from_v28(): void {
    // Phase G: Session Context Continuity —— 只存 refs，不复制完整 Project Context。
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS session_context_refs (
        session_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        selected_view_ids TEXT NOT NULL DEFAULT '[]',
        retrieval_entity_refs TEXT NOT NULL DEFAULT '[]',
        source_refs_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'idle',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        closed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_session_refs_project
      ON session_context_refs(project_id);
      PRAGMA user_version = 29;
    `)
  }

  #migrate_028_from_v27(): void {
    // Phase D: Reorganize proposals（Agent 画布整理，含回滚快照）。
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS reorganize_proposals (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        proposal_json TEXT NOT NULL,
        snapshot_json TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_reorganize_proposals_project
      ON reorganize_proposals(project_id);
      PRAGMA user_version = 28;
    `)
  }

  #migrate_027_from_v26(): void {
    // Phase C: Capture Watch 规则（截图/文件夹监控）。
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS capture_watch_rules (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        patterns_json TEXT NOT NULL,
        project_hint TEXT,
        settle_ms INTEGER NOT NULL DEFAULT 750,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );
      PRAGMA user_version = 27;
    `)
  }

  #migrate_026_from_v25(): void {
    // Phase C: Capture receipts —— operationId 幂等，<2s 返回收据。
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS capture_receipts (
        operation_id TEXT PRIMARY KEY,
        receipt_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      PRAGMA user_version = 26;
    `)
  }

  #migrate_025_from_v24(): void {
    // Phase B: Capture Staging Buffer —— transport buffer，不是 Inbox domain。
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS capture_staging_items (
        id TEXT PRIMARY KEY,
        operation_id TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        payload_ref TEXT NOT NULL,
        source_json TEXT NOT NULL,
        suggested_projects_json TEXT NOT NULL,
        semantic_hint_json TEXT,
        captured_at TEXT NOT NULL,
        resolved_project_id TEXT,
        resolved_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_capture_staging_captured
      ON capture_staging_items(captured_at);
      PRAGMA user_version = 25;
    `)
  }

  #migrate_024_from_v23(): void {
    // Phase A: Zero Naming —— display title 与 identity 解耦。
    // title_mode: 'auto'（默认，Agent 可改）| 'manual'（用户改过，Agent 不覆盖）| 'locked'
    // 兼容策略：name/title 仍 NOT NULL（第一阶段存内部 fallback），只加 mode 标记。
    try { this.#database.exec(`ALTER TABLE projects ADD COLUMN title_mode TEXT NOT NULL DEFAULT 'auto'`) } catch {}
    try { this.#database.exec(`ALTER TABLE scopes ADD COLUMN title_mode TEXT NOT NULL DEFAULT 'auto'`) } catch {}
    try { this.#database.exec(`ALTER TABLE workspaces ADD COLUMN title_mode TEXT NOT NULL DEFAULT 'auto'`) } catch {}
    try { this.#database.exec(`ALTER TABLE artifacts ADD COLUMN title_mode TEXT NOT NULL DEFAULT 'auto'`) } catch {}
    this.#database.exec(`PRAGMA user_version = 24`)
  }

  #migrate_023_from_v22(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS search_documents (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        title TEXT,
        body TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, entity_type, entity_id)
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS search_documents_fts USING fts5(
        entity_id UNINDEXED,
        project_id UNINDEXED,
        title,
        body
      );
      CREATE TABLE IF NOT EXISTS search_document_embeddings (
        entity_id TEXT NOT NULL,
        model TEXT NOT NULL,
        dimensions INTEGER,
        content_hash TEXT NOT NULL,
        embedding_blob BLOB,
        indexed_at TEXT NOT NULL,
        PRIMARY KEY(entity_id, model)
      );
      CREATE INDEX IF NOT EXISTS idx_search_documents_project
      ON search_documents(project_id);
      PRAGMA user_version = 23;
    `)
  }

  #migrate_022_from_v21(): void {
    try { this.#database.exec(`ALTER TABLE relations ADD COLUMN origin TEXT`) } catch {}
    try { this.#database.exec(`ALTER TABLE relations ADD COLUMN created_by TEXT`) } catch {}
    try { this.#database.exec(`ALTER TABLE relations ADD COLUMN evidence_json TEXT`) } catch {}
    try { this.#database.exec(`ALTER TABLE relations ADD COLUMN confidence REAL`) } catch {}
    this.#database.exec(`PRAGMA user_version = 22`)
  }

  #migrate_021_from_v20(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS presentation_views (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        scope_id TEXT NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
        capability TEXT NOT NULL,
        renderer TEXT NOT NULL,
        state_json TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_presentation_views_project
      ON presentation_views(project_id);
      CREATE INDEX IF NOT EXISTS idx_presentation_views_scope
      ON presentation_views(project_id, scope_id);
      PRAGMA user_version = 21;
    `)
  }


  #migrate_020_from_v19(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS handoffs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        resume_mode TEXT NOT NULL DEFAULT 'standard-handoff',
        from_provider TEXT,
        to_provider TEXT,
        session_summary_id TEXT,
        context_snapshot_id TEXT,
        decisions TEXT NOT NULL DEFAULT '[]',
        open_questions TEXT NOT NULL DEFAULT '[]',
        next_actions TEXT NOT NULL DEFAULT '[]',
        artifact_refs TEXT NOT NULL DEFAULT '[]',
        message_refs TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      PRAGMA user_version = 20;
    `)
  }

  #migrate_019_from_v18(): void {
    try { this.#database.exec(`ALTER TABLE workspaces ADD COLUMN frame_bounds TEXT`) } catch {}
    try { this.#database.exec(`ALTER TABLE workspaces ADD COLUMN preferred_surface TEXT`) } catch {}
    try { this.#database.exec(`ALTER TABLE workspaces ADD COLUMN version INTEGER NOT NULL DEFAULT 0`) } catch {}
    this.#database.exec(`PRAGMA user_version = 19`)
  }


  #migrate_001(): void {
    this.#database.exec(`
      BEGIN;
      CREATE TABLE projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL,
        graph_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE scopes (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        parent_scope_id TEXT, container_view_id TEXT,
        kind TEXT NOT NULL, name TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        scope_id TEXT NOT NULL, name TEXT NOT NULL, intent TEXT,
        viewport TEXT NOT NULL, focused_node_ids TEXT NOT NULL DEFAULT '[]',
        visible_layers TEXT NOT NULL DEFAULT '["core","process"]',
        context_policy TEXT NOT NULL DEFAULT 'selection-only',
        updated_at TEXT NOT NULL,
        frame_bounds TEXT,
        preferred_surface TEXT,
        version INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE artifacts (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL, kind TEXT NOT NULL, local_path TEXT NOT NULL,
        availability TEXT NOT NULL, current_revision_id TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE artifact_views (
        id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE RESTRICT,
        scope_id TEXT NOT NULL, revision_id TEXT,
        reference_kind TEXT NOT NULL, position TEXT NOT NULL, size TEXT NOT NULL,
        display_mode TEXT NOT NULL, collapsed INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE relations (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        source_entity_type TEXT NOT NULL, source_entity_id TEXT NOT NULL,
        target_entity_type TEXT NOT NULL, target_entity_id TEXT NOT NULL,
        kind TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE artifact_revisions (
        id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
        file_record_id TEXT NOT NULL REFERENCES file_records(id) ON DELETE RESTRICT,
        parent_revision_id TEXT, local_path TEXT NOT NULL, content_hash TEXT NOT NULL,
        source TEXT NOT NULL, run_id TEXT, status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE notes (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        anchor_scope TEXT NOT NULL, artifact_id TEXT, artifact_view_id TEXT, page_index INTEGER,
        body TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE checkpoints (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        scope_id TEXT NOT NULL, label TEXT NOT NULL DEFAULT '',
        snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE file_records (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        observed_path TEXT NOT NULL, observed_hash TEXT NOT NULL,
        size INTEGER NOT NULL, modified_at TEXT NOT NULL, mime_type TEXT NOT NULL,
        availability TEXT NOT NULL, observed_at TEXT NOT NULL
      );
      CREATE TABLE preview_records (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        revision_id TEXT NOT NULL REFERENCES artifact_revisions(id) ON DELETE CASCADE,
        source_content_hash TEXT NOT NULL, renderer_id TEXT NOT NULL, renderer_version TEXT NOT NULL,
        preview_profile TEXT NOT NULL, cache_key TEXT NOT NULL UNIQUE, cache_path TEXT NOT NULL,
        mime_type TEXT NOT NULL, size INTEGER NOT NULL, status TEXT NOT NULL,
        error_message TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE context_manifests (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        schema_version INTEGER NOT NULL CHECK (schema_version = 0),
        target_artifact_id TEXT REFERENCES artifacts(id) ON DELETE RESTRICT,
        target_revision_id TEXT REFERENCES artifact_revisions(id) ON DELETE RESTRICT,
        canonical_json TEXT NOT NULL,
        manifest_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(project_id, manifest_hash)
      );
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
        target_artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE RESTRICT,
        target_revision_id TEXT NOT NULL REFERENCES artifact_revisions(id) ON DELETE RESTRICT,
        context_manifest_id TEXT NOT NULL REFERENCES context_manifests(id) ON DELETE RESTRICT,
        retry_of_run_id TEXT REFERENCES runs(id) ON DELETE RESTRICT,
        provider TEXT NOT NULL CHECK (provider = 'workbuddy'),
        status TEXT NOT NULL CHECK (status IN ('created','queued','running','waiting_input','completed','failed','cancelled')),
        instruction TEXT NOT NULL,
        result_summary TEXT,
        short_summary TEXT,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE TABLE runtime_dispatches (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL UNIQUE REFERENCES runs(id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK (provider = 'workbuddy'),
        idempotency_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('planned','dispatching','bound','failed','recovery_required')),
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        last_error_code TEXT,
        last_error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE runtime_bindings (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL UNIQUE REFERENCES runs(id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK (provider = 'workbuddy'),
        external_task_id TEXT,
        external_session_id TEXT,
        provider_status TEXT,
        last_synced_at TEXT,
        finalize_pending INTEGER NOT NULL DEFAULT 0 CHECK (finalize_pending IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(provider, external_task_id)
      );
      CREATE TABLE artifact_returns (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        target_artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE RESTRICT,
        base_revision_id TEXT NOT NULL REFERENCES artifact_revisions(id) ON DELETE RESTRICT,
        returned_file_id TEXT NOT NULL REFERENCES file_records(id) ON DELETE RESTRICT,
        content_hash TEXT NOT NULL,
        canonical_path TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action = 'created'),
        status TEXT NOT NULL CHECK (status IN ('pending_review','adopted','rejected')),
        draft_revision_id TEXT REFERENCES artifact_revisions(id) ON DELETE RESTRICT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(run_id, canonical_path, content_hash, action)
      );
      CREATE INDEX idx_runs_project_status ON runs(project_id, status);
      CREATE INDEX idx_runtime_dispatches_status ON runtime_dispatches(status);
      CREATE INDEX idx_runtime_bindings_provider_status ON runtime_bindings(provider, provider_status);
      PRAGMA user_version = 6;
      CREATE UNIQUE INDEX idx_revision_current
        ON artifact_revisions(artifact_id) WHERE status = 'current';
      COMMIT;
    `)
  }

  #migrate_002_from_v1(): void {
    // v1 → v3: drop old schema, create new. Phase 2 data is disposable.
    const backup = this.databasePath + '.bak'
    this.#database.exec(`VACUUM INTO '${backup.replace(/\\/g, '\\\\')}'`)
    this.#database.exec(`
      BEGIN;
      DROP TABLE IF EXISTS workspaces;
      DROP TABLE IF EXISTS artifacts;
      DROP TABLE IF EXISTS artifact_views;
      DROP TABLE IF EXISTS relations;
      DROP TABLE IF EXISTS artifact_revisions;
      DROP TABLE IF EXISTS notes;
      DROP TABLE IF EXISTS checkpoints;
      DROP TABLE IF EXISTS projects;
      CREATE TABLE projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL,
        graph_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE scopes (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        parent_scope_id TEXT, container_view_id TEXT,
        kind TEXT NOT NULL, name TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        scope_id TEXT NOT NULL, name TEXT NOT NULL, intent TEXT,
        viewport TEXT NOT NULL, focused_node_ids TEXT NOT NULL DEFAULT '[]',
        visible_layers TEXT NOT NULL DEFAULT '["core","process"]',
        context_policy TEXT NOT NULL DEFAULT 'selection-only',
        updated_at TEXT NOT NULL,
        frame_bounds TEXT,
        preferred_surface TEXT,
        version INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE artifacts (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL, kind TEXT NOT NULL, local_path TEXT NOT NULL,
        availability TEXT NOT NULL, current_revision_id TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE artifact_views (
        id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE RESTRICT,
        scope_id TEXT NOT NULL, revision_id TEXT,
        reference_kind TEXT NOT NULL, position TEXT NOT NULL, size TEXT NOT NULL,
        display_mode TEXT NOT NULL, collapsed INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE relations (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        source_entity_type TEXT NOT NULL, source_entity_id TEXT NOT NULL,
        target_entity_type TEXT NOT NULL, target_entity_id TEXT NOT NULL,
        kind TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE artifact_revisions (
        id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
        parent_revision_id TEXT, local_path TEXT NOT NULL, content_hash TEXT NOT NULL,
        source TEXT NOT NULL, run_id TEXT, status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE notes (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        anchor_scope TEXT NOT NULL, artifact_id TEXT, artifact_view_id TEXT, page_index INTEGER,
        body TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE checkpoints (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        scope_id TEXT NOT NULL, label TEXT NOT NULL DEFAULT '',
        snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL
      );
      PRAGMA user_version = 3;
      CREATE UNIQUE INDEX idx_revision_current
        ON artifact_revisions(artifact_id) WHERE status = 'current';
      COMMIT;
    `)
  }

  #migrate_003_from_v2(): void {
    // v2 (old Phase 2 schema with canvas_snapshot) → v3
    const backup = this.databasePath + '.bak'
    this.#database.exec(`VACUUM INTO '${backup.replace(/\\/g, '\\\\')}'`)
    this.#database.exec(`DROP TABLE IF EXISTS checkpoint_revision_ids`)
    this.#database.exec(`DROP TABLE IF EXISTS checkpoint_run_ids`)
    this.#database.exec(`DROP TABLE IF EXISTS checkpoints`)
    this.#database.exec(`
      CREATE TABLE checkpoints (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        scope_id TEXT NOT NULL, label TEXT NOT NULL DEFAULT '',
        snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL
      );
    `)
    // Add scope_id to workspaces if missing
    try { this.#database.exec(`ALTER TABLE workspaces ADD COLUMN scope_id TEXT NOT NULL DEFAULT ''`) } catch {}
    try { this.#database.exec(`ALTER TABLE workspaces ADD COLUMN context_policy TEXT NOT NULL DEFAULT 'selection-only'`) } catch {}
    try { this.#database.exec(`ALTER TABLE workspaces ADD COLUMN frame_bounds TEXT`) } catch {}
    try { this.#database.exec(`ALTER TABLE workspaces ADD COLUMN preferred_surface TEXT`) } catch {}
    try { this.#database.exec(`ALTER TABLE workspaces ADD COLUMN version INTEGER NOT NULL DEFAULT 0`) } catch {}
    try { this.#database.exec(`ALTER TABLE projects ADD COLUMN graph_version INTEGER NOT NULL DEFAULT 1`) } catch {}
    this.#database.exec(`PRAGMA user_version = 3`)
  }

  #migrate_004_from_v3(): void {
    const backup = this.databasePath + '.v3.bak'
    this.#database.exec(`VACUUM INTO '${backup.replace(/\\/g, '\\\\')}'`)
    this.#database.exec(`
      BEGIN;
      CREATE TABLE file_records (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        observed_path TEXT NOT NULL, observed_hash TEXT NOT NULL,
        size INTEGER NOT NULL, modified_at TEXT NOT NULL, mime_type TEXT NOT NULL,
        availability TEXT NOT NULL, observed_at TEXT NOT NULL
      );
      ALTER TABLE artifact_revisions ADD COLUMN file_record_id TEXT REFERENCES file_records(id) ON DELETE RESTRICT;
      INSERT INTO file_records (
        id, project_id, observed_path, observed_hash, size,
        modified_at, mime_type, availability, observed_at
      )
      SELECT
        'migrated-' || r.id, a.project_id, r.local_path, r.content_hash, 0,
        r.created_at, 'application/octet-stream', 'unreadable', r.created_at
      FROM artifact_revisions r
      JOIN artifacts a ON a.id = r.artifact_id;
      UPDATE artifact_revisions SET file_record_id = 'migrated-' || id WHERE file_record_id IS NULL;
      PRAGMA user_version = 4;
      COMMIT;
    `)
  }

  #migrate_005_from_v4(): void {
    this.#database.exec(`
      BEGIN;
      CREATE TABLE IF NOT EXISTS preview_records (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        revision_id TEXT NOT NULL REFERENCES artifact_revisions(id) ON DELETE CASCADE,
        source_content_hash TEXT NOT NULL, renderer_id TEXT NOT NULL, renderer_version TEXT NOT NULL,
        preview_profile TEXT NOT NULL, cache_key TEXT NOT NULL UNIQUE, cache_path TEXT NOT NULL,
        mime_type TEXT NOT NULL, size INTEGER NOT NULL, status TEXT NOT NULL,
        error_message TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      PRAGMA user_version = 5;
      COMMIT;
    `)
  }

  #migrate_006_from_v5(): void {
    const backup = this.databasePath + '.v5.bak'
    this.#database.exec(`VACUUM INTO '${backup.replace(/\\/g, '\\\\')}'`)
    this.#database.exec(`
      BEGIN;
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        scope_id TEXT NOT NULL, name TEXT NOT NULL, intent TEXT,
        viewport TEXT NOT NULL, focused_node_ids TEXT NOT NULL DEFAULT '[]',
        visible_layers TEXT NOT NULL DEFAULT '["core","process"]',
        context_policy TEXT NOT NULL DEFAULT 'selection-only',
        updated_at TEXT NOT NULL,
        frame_bounds TEXT,
        preferred_surface TEXT,
        version INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE context_manifests (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        schema_version INTEGER NOT NULL CHECK (schema_version = 0),
        target_artifact_id TEXT REFERENCES artifacts(id) ON DELETE RESTRICT,
        target_revision_id TEXT REFERENCES artifact_revisions(id) ON DELETE RESTRICT,
        canonical_json TEXT NOT NULL,
        manifest_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(project_id, manifest_hash)
      );
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
        target_artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE RESTRICT,
        target_revision_id TEXT NOT NULL REFERENCES artifact_revisions(id) ON DELETE RESTRICT,
        context_manifest_id TEXT NOT NULL REFERENCES context_manifests(id) ON DELETE RESTRICT,
        retry_of_run_id TEXT REFERENCES runs(id) ON DELETE RESTRICT,
        provider TEXT NOT NULL CHECK (provider = 'workbuddy'),
        status TEXT NOT NULL CHECK (status IN ('created','queued','running','waiting_input','completed','failed','cancelled')),
        instruction TEXT NOT NULL,
        result_summary TEXT,
        short_summary TEXT,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE TABLE runtime_dispatches (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL UNIQUE REFERENCES runs(id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK (provider = 'workbuddy'),
        idempotency_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('planned','dispatching','bound','failed','recovery_required')),
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        last_error_code TEXT,
        last_error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE runtime_bindings (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL UNIQUE REFERENCES runs(id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK (provider = 'workbuddy'),
        external_task_id TEXT,
        external_session_id TEXT,
        provider_status TEXT,
        last_synced_at TEXT,
        finalize_pending INTEGER NOT NULL DEFAULT 0 CHECK (finalize_pending IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(provider, external_task_id)
      );
      CREATE TABLE artifact_returns (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        target_artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE RESTRICT,
        base_revision_id TEXT NOT NULL REFERENCES artifact_revisions(id) ON DELETE RESTRICT,
        returned_file_id TEXT NOT NULL REFERENCES file_records(id) ON DELETE RESTRICT,
        content_hash TEXT NOT NULL,
        canonical_path TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action = 'created'),
        status TEXT NOT NULL CHECK (status IN ('pending_review','adopted','rejected')),
        draft_revision_id TEXT REFERENCES artifact_revisions(id) ON DELETE RESTRICT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(run_id, canonical_path, content_hash, action)
      );
      CREATE INDEX idx_runs_project_status ON runs(project_id, status);
      CREATE INDEX idx_runtime_dispatches_status ON runtime_dispatches(status);
      CREATE INDEX idx_runtime_bindings_provider_status ON runtime_bindings(provider, provider_status);
      PRAGMA user_version = 6;
      COMMIT;
    `)
  }

  #migrate_007_from_v6(): void {
    this.#database.exec(`
      BEGIN;
      CREATE TABLE resource_descriptors (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        artifact_id TEXT NOT NULL,
        source_revision_id TEXT NOT NULL,
        descriptor_version TEXT NOT NULL,
        analyzer_version TEXT NOT NULL,
        status TEXT NOT NULL
          CHECK(status IN ('pending','ready','partial','failed')),
        source_content_hash TEXT,
        descriptor_hash TEXT NOT NULL,
        descriptor_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(project_id) REFERENCES projects(id),
        FOREIGN KEY(artifact_id) REFERENCES artifacts(id),
        FOREIGN KEY(source_revision_id) REFERENCES artifact_revisions(id),
        UNIQUE(artifact_id, source_revision_id, analyzer_version)
      );
      CREATE INDEX idx_resource_descriptors_project ON resource_descriptors(project_id);
      CREATE INDEX idx_resource_descriptors_status ON resource_descriptors(status);
      PRAGMA user_version = 7;
      COMMIT;
    `)
  }

  #migrate_008_from_v7(): void {
    this.#database.exec(`
      BEGIN;
      CREATE TABLE resource_analysis_jobs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        resource_id TEXT NOT NULL,
        source_revision_id TEXT NOT NULL REFERENCES artifact_revisions(id) ON DELETE CASCADE,
        analyzer_version TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','running','retryable','failed','completed')),
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        next_attempt_at TEXT,
        lease_owner TEXT,
        lease_expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(resource_id, source_revision_id, analyzer_version)
      );
      CREATE INDEX idx_resource_analysis_jobs_ready
        ON resource_analysis_jobs(status, next_attempt_at, created_at);
      CREATE TABLE resource_policies (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        resource_id TEXT NOT NULL,
        trust_level TEXT NOT NULL DEFAULT 'untrusted' CHECK(trust_level IN ('untrusted','reviewed','trusted')),
        approved_context INTEGER NOT NULL DEFAULT 0 CHECK(approved_context IN (0,1)),
        executable INTEGER NOT NULL DEFAULT 0 CHECK(executable IN (0,1)),
        annotation_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL,
        PRIMARY KEY(project_id, resource_id)
      );
      PRAGMA user_version = 8;
      COMMIT;
    `)
  }

  #migrate_009_from_v8(): void {
    this.#database.exec(`
      PRAGMA legacy_alter_table = ON;
      ALTER TABLE artifact_returns RENAME TO artifact_returns_v8;
      ALTER TABLE runtime_bindings RENAME TO runtime_bindings_v8;
      ALTER TABLE runtime_dispatches RENAME TO runtime_dispatches_v8;
      ALTER TABLE runs RENAME TO runs_v8;
      CREATE TABLE runs (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
        target_artifact_id TEXT REFERENCES artifacts(id) ON DELETE RESTRICT,
        target_revision_id TEXT REFERENCES artifact_revisions(id) ON DELETE RESTRICT,
        context_manifest_id TEXT NOT NULL REFERENCES context_manifests(id) ON DELETE RESTRICT,
        retry_of_run_id TEXT REFERENCES runs(id) ON DELETE RESTRICT,
        provider TEXT NOT NULL CHECK(provider IN ('workbuddy','codex')),
        requested_provider TEXT NOT NULL CHECK(requested_provider IN ('workbuddy','codex')),
        output_intent TEXT NOT NULL CHECK(output_intent IN ('create','revise','analyze')),
        return_group_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('created','queued','running','waiting_input','completed','failed','cancelled')),
        instruction TEXT NOT NULL, result_summary TEXT, short_summary TEXT, error_code TEXT, error_message TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT
      );
      INSERT INTO runs SELECT id, project_id, workspace_id, target_artifact_id, target_revision_id,
        context_manifest_id, retry_of_run_id, provider, provider, 'revise', 'return-group-' || id,
        status, instruction, result_summary, short_summary, error_code, error_message, created_at, updated_at, completed_at FROM runs_v8;
      CREATE TABLE runtime_dispatches (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE REFERENCES runs(id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK(provider IN ('workbuddy','codex')), idempotency_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK(status IN ('planned','dispatching','bound','failed','recovery_required')),
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0), last_error_code TEXT, last_error_message TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      INSERT INTO runtime_dispatches SELECT * FROM runtime_dispatches_v8;
      CREATE TABLE runtime_bindings (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE REFERENCES runs(id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK(provider IN ('workbuddy','codex')), external_task_id TEXT, external_session_id TEXT,
        provider_status TEXT, last_synced_at TEXT, finalize_pending INTEGER NOT NULL DEFAULT 0 CHECK(finalize_pending IN (0,1)),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(provider, external_task_id)
      );
      INSERT INTO runtime_bindings SELECT * FROM runtime_bindings_v8;
      CREATE TABLE artifact_returns (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        target_artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE RESTRICT,
        base_revision_id TEXT NOT NULL REFERENCES artifact_revisions(id) ON DELETE RESTRICT,
        returned_file_id TEXT NOT NULL REFERENCES file_records(id) ON DELETE RESTRICT,
        content_hash TEXT NOT NULL, canonical_path TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action = 'created'),
        status TEXT NOT NULL CHECK(status IN ('pending_review','adopted','rejected')),
        draft_revision_id TEXT REFERENCES artifact_revisions(id) ON DELETE RESTRICT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(run_id, canonical_path, content_hash, action)
      );
      INSERT INTO artifact_returns SELECT * FROM artifact_returns_v8;
      DROP TABLE artifact_returns_v8;
      DROP TABLE runtime_bindings_v8;
      DROP TABLE runtime_dispatches_v8;
      DROP TABLE runs_v8;
      CREATE INDEX idx_runs_project_status ON runs(project_id, status);
      CREATE INDEX idx_runtime_dispatches_status ON runtime_dispatches(status);
      CREATE INDEX idx_runtime_bindings_provider_status ON runtime_bindings(provider, provider_status);
      PRAGMA legacy_alter_table = OFF;
      PRAGMA user_version = 9;
    `)
  }

  #migrate_010_from_v9(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS run_events (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        occurred_at TEXT NOT NULL,
        UNIQUE(run_id, sequence)
      );
      CREATE INDEX IF NOT EXISTS idx_run_events_run_sequence ON run_events(run_id, sequence);
      PRAGMA user_version = 10;
    `)
  }

  #migrate_011_from_v10(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS workspace_memberships (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        artifact_view_id TEXT NOT NULL REFERENCES artifact_views(id) ON DELETE CASCADE,
        added_at TEXT NOT NULL,
        added_by TEXT NOT NULL CHECK(added_by IN ('user','agent','run','import')),
        sort_order INTEGER,
        PRIMARY KEY(workspace_id, artifact_view_id)
      );
      CREATE INDEX IF NOT EXISTS idx_workspace_memberships_view ON workspace_memberships(artifact_view_id);
      ALTER TABLE runs ADD COLUMN result_policy TEXT;
      PRAGMA user_version = 11;
    `)
  }

  #migrate_012_from_v11(): void {
    this.#database.exec(`
      ALTER TABLE artifacts ADD COLUMN managed INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE checkpoints ADD COLUMN workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL;
      CREATE TABLE IF NOT EXISTS session_summaries (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        run_ids TEXT NOT NULL DEFAULT '[]',
        handoff_ref TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      PRAGMA user_version = 12;
    `)
  }

  #migrate_013_from_v12(): void {
    this.#database.exec(`
      ALTER TABLE projects ADD COLUMN last_opened_at TEXT;
      PRAGMA user_version = 13;
    `)
  }

  #migrate_014_from_v13(): void {
    this.#database.exec(`
      BEGIN;
      CREATE TABLE IF NOT EXISTS active_contexts (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        workspace_key TEXT NOT NULL,
        version INTEGER NOT NULL CHECK(version >= 0),
        projection_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(project_id, workspace_key)
      );
      CREATE TABLE IF NOT EXISTS context_proposals (
        proposal_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        workspace_key TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected','stale')),
        proposal_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_context_proposals_project_status
        ON context_proposals(project_id, workspace_key, status, created_at);
      CREATE TABLE IF NOT EXISTS command_drafts (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        workspace_key TEXT NOT NULL,
        composer_anchor TEXT NOT NULL,
        prompt TEXT NOT NULL,
        context_view_ids_json TEXT NOT NULL DEFAULT '[]',
        provider TEXT NOT NULL DEFAULT 'auto',
        create_as_new_node INTEGER NOT NULL DEFAULT 0 CHECK(create_as_new_node IN (0,1)),
        updated_at TEXT NOT NULL,
        PRIMARY KEY(project_id, workspace_key, composer_anchor)
      );
      CREATE TABLE IF NOT EXISTS provider_session_bindings (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK(provider IN ('codex','workbuddy')),
        external_session_id TEXT NOT NULL,
        origin TEXT NOT NULL CHECK(origin IN ('manual','watchdog')),
        status TEXT NOT NULL CHECK(status IN ('active','stale','closed')),
        last_seen_at TEXT NOT NULL,
        last_run_id TEXT,
        lease_owner TEXT,
        lease_expires_at TEXT,
        failure_count INTEGER NOT NULL DEFAULT 0 CHECK(failure_count >= 0),
        updated_at TEXT NOT NULL,
        PRIMARY KEY(project_id, provider)
      );
      PRAGMA user_version = 14;
      COMMIT;
    `)
  }

  #migrate_015_from_v14(): void {
    this.#database.exec(`
      BEGIN;
      CREATE TABLE IF NOT EXISTS run_input_requests (
        request_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        question TEXT NOT NULL,
        options_json TEXT NOT NULL DEFAULT '[]',
        allow_free_text INTEGER NOT NULL DEFAULT 1 CHECK(allow_free_text IN (0,1)),
        context_version INTEGER,
        status TEXT NOT NULL CHECK(status IN ('pending','answered','cancelled')),
        answer_text TEXT,
        selected_options_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        answered_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_run_input_requests_run_status
        ON run_input_requests(run_id, status, created_at);
      PRAGMA user_version = 15;
      COMMIT;
    `)
  }

  #migrate_016_from_v15(): void {
    this.#database.exec(`
      BEGIN;
      CREATE TABLE IF NOT EXISTS conversation_import_sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        source_kind TEXT NOT NULL CHECK(source_kind IN ('codex','chatgpt','claude','manual')),
        title TEXT NOT NULL,
        source_file_name TEXT NOT NULL,
        expected_bytes INTEGER,
        received_bytes INTEGER NOT NULL DEFAULT 0,
        received_chunks INTEGER NOT NULL DEFAULT 0,
        workspace_id TEXT,
        scope_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('receiving','parsing','ready','failed')),
        staging_path TEXT NOT NULL,
        conversation_id TEXT REFERENCES conversation_sessions(id) ON DELETE SET NULL,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversation_import_chunks (
        import_session_id TEXT NOT NULL REFERENCES conversation_import_sessions(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL CHECK(chunk_index >= 0),
        size INTEGER NOT NULL CHECK(size >= 0),
        content_hash TEXT NOT NULL,
        chunk_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(import_session_id, chunk_index)
      );
      CREATE TABLE IF NOT EXISTS conversation_sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        source_kind TEXT NOT NULL CHECK(source_kind IN ('codex','chatgpt','claude','manual')),
        title TEXT NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 0,
        section_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL CHECK(status IN ('receiving','parsing','ready','failed')),
        source_content_hash TEXT,
        source_file_name TEXT,
        source_path TEXT,
        origin_meta_json TEXT NOT NULL DEFAULT '{}',
        conversation_artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL,
        conversation_view_id TEXT REFERENCES artifact_views(id) ON DELETE SET NULL,
        imported_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_conversation_sessions_project
        ON conversation_sessions(project_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS conversation_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES conversation_sessions(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL CHECK(seq >= 0),
        role TEXT NOT NULL CHECK(role IN ('user','assistant','tool','system','event')),
        event_kind TEXT NOT NULL,
        source_event_id TEXT,
        content_text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        tool_name TEXT,
        tool_call_json TEXT,
        file_refs_json TEXT NOT NULL DEFAULT '[]',
        parent_id TEXT,
        pinned_as_decision INTEGER NOT NULL DEFAULT 0 CHECK(pinned_as_decision IN (0,1)),
        decision_artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL,
        content_hash TEXT NOT NULL,
        UNIQUE(session_id, seq),
        UNIQUE(session_id, content_hash, created_at, role)
      );
      CREATE INDEX IF NOT EXISTS idx_conversation_messages_session_seq
        ON conversation_messages(session_id, seq);
      CREATE TABLE IF NOT EXISTS conversation_sections (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES conversation_sessions(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL CHECK(seq >= 0),
        kind TEXT NOT NULL CHECK(kind IN ('turn','instruction','tool_cluster','long_message')),
        title TEXT NOT NULL,
        start_seq INTEGER NOT NULL,
        end_seq INTEGER NOT NULL,
        locked_by_user INTEGER NOT NULL DEFAULT 0 CHECK(locked_by_user IN (0,1)),
        derived_at TEXT NOT NULL,
        UNIQUE(session_id, seq)
      );
      CREATE INDEX IF NOT EXISTS idx_conversation_sections_session_range
        ON conversation_sections(session_id, start_seq, end_seq);
      CREATE TABLE IF NOT EXISTS conversation_section_annotations (
        section_id TEXT PRIMARY KEY REFERENCES conversation_sections(id) ON DELETE CASCADE,
        source_hash TEXT NOT NULL,
        title TEXT NOT NULL,
        decisions_json TEXT NOT NULL DEFAULT '[]',
        todos_json TEXT NOT NULL DEFAULT '[]',
        involved_files_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL CHECK(status IN ('none','ready','failed')),
        annotated_by TEXT NOT NULL CHECK(annotated_by IN ('agent','user')),
        annotated_at TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS conversation_messages_fts USING fts5(
        message_id UNINDEXED,
        session_id UNINDEXED,
        project_id UNINDEXED,
        role,
        content_text,
        tokenize='unicode61 remove_diacritics 2'
      );
      CREATE TABLE IF NOT EXISTS conversation_embedding_jobs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        session_id TEXT REFERENCES conversation_sessions(id) ON DELETE CASCADE,
        provider TEXT NOT NULL DEFAULT 'ollama',
        model TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','running','ready','partial','failed')),
        attempt_count INTEGER NOT NULL DEFAULT 0,
        indexed_messages INTEGER NOT NULL DEFAULT 0,
        stale_messages INTEGER NOT NULL DEFAULT 0,
        dimensions INTEGER,
        backend TEXT NOT NULL CHECK(backend IN ('sqlite-vec','sqlite-blob-fallback')),
        last_error TEXT,
        lease_owner TEXT,
        lease_expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_conversation_embedding_jobs_project
        ON conversation_embedding_jobs(project_id, status, updated_at);
      CREATE TABLE IF NOT EXISTS conversation_embeddings (
        message_id TEXT NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        embedding_blob BLOB NOT NULL,
        indexed_at TEXT NOT NULL,
        PRIMARY KEY(message_id, model)
      );
      PRAGMA user_version = 16;
      COMMIT;
    `)
  }

  #migrate_017_from_v16(): void {
    this.#database.exec(`
      BEGIN;
      DELETE FROM conversation_messages_fts;
      INSERT INTO conversation_messages_fts(message_id, session_id, project_id, role, content_text)
      SELECT m.id, m.session_id, s.project_id, m.role, m.content_text
      FROM conversation_messages m JOIN conversation_sessions s ON s.id = m.session_id;
      CREATE TRIGGER IF NOT EXISTS conversation_messages_fts_insert AFTER INSERT ON conversation_messages BEGIN
        INSERT INTO conversation_messages_fts(message_id, session_id, project_id, role, content_text)
        SELECT NEW.id, NEW.session_id, s.project_id, NEW.role, NEW.content_text
        FROM conversation_sessions s WHERE s.id = NEW.session_id;
      END;
      CREATE TRIGGER IF NOT EXISTS conversation_messages_fts_update AFTER UPDATE OF role, content_text, session_id ON conversation_messages BEGIN
        DELETE FROM conversation_messages_fts WHERE message_id = OLD.id;
        INSERT INTO conversation_messages_fts(message_id, session_id, project_id, role, content_text)
        SELECT NEW.id, NEW.session_id, s.project_id, NEW.role, NEW.content_text
        FROM conversation_sessions s WHERE s.id = NEW.session_id;
      END;
      CREATE TRIGGER IF NOT EXISTS conversation_messages_fts_delete AFTER DELETE ON conversation_messages BEGIN
        DELETE FROM conversation_messages_fts WHERE message_id = OLD.id;
      END;
      PRAGMA user_version = 17;
      COMMIT;
    `)
  }


  #migrate_018_from_v17(): void {
    const backupPath = `${this.databasePath}.v17.bak`
    if (!existsSync(backupPath)) {
      this.#database.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`)
    }
    this.#database.exec(`
      BEGIN;
      ALTER TABLE conversation_sessions ADD COLUMN parsed_line_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE conversation_sessions ADD COLUMN invalid_line_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE conversation_sessions ADD COLUMN ignored_event_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE conversation_sessions ADD COLUMN duplicate_event_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE conversation_sessions ADD COLUMN matched_file_reference_count INTEGER NOT NULL DEFAULT 0;

      ALTER TABLE conversation_messages ADD COLUMN embedding_input_hash TEXT;
      ALTER TABLE conversation_messages ADD COLUMN embedding_version TEXT;

      ALTER TABLE conversation_embedding_jobs ADD COLUMN index_version TEXT NOT NULL DEFAULT 'message-v1';
      ALTER TABLE conversation_embedding_jobs ADD COLUMN force_rebuild INTEGER NOT NULL DEFAULT 0 CHECK(force_rebuild IN (0,1));
      ALTER TABLE conversation_embedding_jobs ADD COLUMN batch_size INTEGER NOT NULL DEFAULT 16 CHECK(batch_size BETWEEN 1 AND 64);
      ALTER TABLE conversation_embedding_jobs ADD COLUMN next_attempt_at TEXT;

      ALTER TABLE conversation_embeddings ADD COLUMN input_hash TEXT;
      ALTER TABLE conversation_embeddings ADD COLUMN embedding_version TEXT NOT NULL DEFAULT 'legacy-v0';
      UPDATE conversation_embeddings SET input_hash=content_hash WHERE input_hash IS NULL;

      CREATE TABLE conversation_file_references (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
        raw TEXT NOT NULL,
        normalized TEXT,
        artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL,
        relation_id TEXT REFERENCES relations(id) ON DELETE SET NULL,
        in_project INTEGER NOT NULL DEFAULT 0 CHECK(in_project IN (0,1)),
        created_at TEXT NOT NULL,
        UNIQUE(message_id, ordinal)
      );
      CREATE INDEX idx_conversation_file_refs_message
        ON conversation_file_references(message_id, ordinal);
      CREATE INDEX idx_conversation_file_refs_artifact
        ON conversation_file_references(artifact_id, message_id);

      PRAGMA user_version = 18;
      COMMIT;
    `)
  }

  // ==================== Graph Save/Load ====================

  save(snapshot: ProjectGraphSnapshot): void {
    if (this.#disposableOnly) {
      if (!String(snapshot.project.id).startsWith('disposable-')) {
        throw new Error('Only disposable projects are accepted.')
      }
    }
    this.#validateSnapshotReferences(snapshot)
    assertContainmentWrite({ previousScopes: this.get(String(snapshot.project.id))?.scopes ?? [], nextScopes: snapshot.scopes })
    for (const artifact of snapshot.artifacts) this.#assertArtifactCurrentRevisionUnchanged(artifact)
    this.#database.exec('BEGIN IMMEDIATE;')
    try {
      const pid = snapshot.project.id
      // Delete in reverse dependency order
      this.#database.prepare('DELETE FROM checkpoints WHERE project_id = ?').run(pid as SQLInputValue)
      this.#database.prepare('DELETE FROM notes WHERE project_id = ?').run(pid as SQLInputValue)
      this.#database.prepare('DELETE FROM relations WHERE project_id = ?').run(pid as SQLInputValue)
      this.#database.prepare('DELETE FROM artifact_views WHERE artifact_id IN (SELECT id FROM artifacts WHERE project_id = ?)').run(pid as SQLInputValue)
      this.#database.prepare('DELETE FROM preview_records WHERE project_id = ?').run(pid as SQLInputValue)
      this.#database.prepare('DELETE FROM artifact_revisions WHERE artifact_id IN (SELECT id FROM artifacts WHERE project_id = ?)').run(pid as SQLInputValue)
      this.#database.prepare('DELETE FROM artifacts WHERE project_id = ?').run(pid as SQLInputValue)
      this.#database.prepare('DELETE FROM file_records WHERE project_id = ?').run(pid as SQLInputValue)
      this.#database.prepare('DELETE FROM workspaces WHERE project_id = ?').run(pid as SQLInputValue)
      this.#database.prepare('DELETE FROM scopes WHERE project_id = ?').run(pid as SQLInputValue)

      // Re-insert
      this.#upsertProject(snapshot.project)
      for (const scope of snapshot.scopes) this.#upsertScope(scope, pid)
      for (const workspace of snapshot.workspaces) this.#upsertWorkspace(workspace)
      for (const artifact of snapshot.artifacts) this.#upsertArtifact(artifact)
      for (const fileRecord of snapshot.fileRecords) this.#upsertFileRecord(fileRecord)
      for (const revision of snapshot.artifactRevisions) this.#upsertArtifactRevision(revision)
      for (const view of snapshot.artifactViews) this.#upsertArtifactView(view)
      for (const relation of snapshot.relations) this.#upsertRelation(relation)
      for (const note of snapshot.notes) this.#upsertNote(note)
      for (const checkpoint of snapshot.checkpoints) this.#upsertCheckpoint(checkpoint)

      this.#database.exec('COMMIT;')
    } catch (error: unknown) {
      this.#database.exec('ROLLBACK;')
      throw error
    }
  }

  get(projectId: string): ProjectGraphSnapshot | undefined {
    const projectRows = this.#database.prepare('SELECT * FROM projects WHERE id = ?').all(projectId as SQLInputValue) as Row[]
    if (!projectRows.length) return undefined
    const project = this.#project(projectRows[0] as Row)

    const scopes = (this.#database.prepare('SELECT * FROM scopes WHERE project_id = ?').all(project.id as SQLInputValue) as Row[]).map((r) => this.#scope(r))
    const workspaces = (this.#database.prepare('SELECT * FROM workspaces WHERE project_id = ? ORDER BY sort_index, rowid').all(project.id as SQLInputValue) as Row[]).map((r) => this.#workspace(r))
    const artifacts = (this.#database.prepare('SELECT * FROM artifacts WHERE project_id = ?').all(project.id as SQLInputValue) as Row[]).map((r) => this.#artifact(r))
    const fileRecords = (this.#database.prepare('SELECT * FROM file_records WHERE project_id = ?').all(project.id as SQLInputValue) as Row[]).map((r) => this.#fileRecord(r))
    const revisionRows = (this.#database.prepare('SELECT r.* FROM artifact_revisions r JOIN artifacts a ON r.artifact_id = a.id WHERE a.project_id = ?').all(project.id as SQLInputValue) as Row[])
    const artifactRevisions = revisionRows.map((r) => this.#artifactRevision(r))
    const viewRows = (this.#database.prepare('SELECT v.* FROM artifact_views v JOIN artifacts a ON v.artifact_id = a.id WHERE a.project_id = ?').all(project.id as SQLInputValue) as Row[])
    const artifactViews = viewRows.map((r) => this.#artifactView(r))
    const relations = (this.#database.prepare('SELECT * FROM relations WHERE project_id = ?').all(project.id as SQLInputValue) as Row[]).map((r) => this.#relation(r))
    const notes = (this.#database.prepare('SELECT * FROM notes WHERE project_id = ?').all(project.id as SQLInputValue) as Row[]).map((r) => this.#note(r))
    const checkpoints = (this.#database.prepare('SELECT * FROM checkpoints WHERE project_id = ?').all(project.id as SQLInputValue) as Row[]).map((r) => this.#checkpoint(r))

    return {
      schemaVersion: 7,
      graphVersion: project.graphVersion as GraphVersion,
      project,
      scopes,
      workspaces,
      artifacts,
      fileRecords,
      artifactViews,
      relations,
      artifactRevisions,
      notes,
      checkpoints,
    }
  }

  // ==================== Mutation ====================

  applyMutations(batch: MutationBatch, fallbackProjectId?: string): GraphVersion {
    if (batch.ops.length === 1 && batch.ops[0]?.type === 'bootstrap') {
      this.save(batch.ops[0].snapshot)
      return batch.ops[0].snapshot.graphVersion
    }
    const projectId = this.#resolveMutationProjectId(batch.ops, fallbackProjectId)
    if (projectId) {
      const previousScopes = this.get(projectId)?.scopes ?? []
      const nextById = new Map(previousScopes.map((scope) => [String(scope.id), scope]))
      for (const op of batch.ops) if (op.type === 'upsert_scope') nextById.set(String(op.scope.id), op.scope)
      assertContainmentWrite({
        previousScopes,
        nextScopes: [...nextById.values()],
        ...(batch.actorKind ? { actor: batch.actorKind } : {}),
      })
    }
    this.#database.exec('BEGIN IMMEDIATE;')
    try {
      this.#assertMutationProjectExists(projectId, batch.ops)
      const hasSemantic = batch.ops.some(isSemanticOp)
      if (batch.ops.length > 0) {
        if (projectId) {
          const current = this.#database.prepare('SELECT graph_version FROM projects WHERE id = ?').get(projectId as SQLInputValue) as Row | undefined
          const cv = (current?.graph_version as number) ?? 0
          if (Number(batch.baseVersion) !== cv && cv > 0) {
            const err = new Error('Graph version is stale. Refresh and retry.') as unknown as Record<string, unknown>
            err.code = 'STALE_GRAPH_VERSION'
            err.currentVersion = cv
            throw err
          }
          if (hasSemantic) {
            this.#database.prepare('UPDATE projects SET graph_version = graph_version + 1 WHERE id = ?').run(projectId as SQLInputValue)
          }
        }
      }

      for (const op of batch.ops) {
        switch (op.type) {
          case 'bootstrap':
            throw new Error('Bootstrap must be the only operation in its batch.')
          case 'move_artifact_view':
            this.#database.prepare(`UPDATE artifact_views SET position = json_set(position, '$.x', ?, '$.y', ?) WHERE id = ?`)
              .run(op.x as SQLInputValue, op.y as SQLInputValue, op.viewId as SQLInputValue)
            break
          case 'resize_artifact_view':
            this.#database.prepare('UPDATE artifact_views SET size = ? WHERE id = ?')
              .run(JSON.stringify({ width: op.width, height: op.height }), op.viewId as SQLInputValue)
            break
          case 'update_workspace_viewport':
            this.#database.prepare(`UPDATE workspaces SET viewport = ?, updated_at = ? WHERE id = ?`)
              .run(JSON.stringify(op.viewport) as SQLInputValue, new Date().toISOString(), op.workspaceId as SQLInputValue)
            break
          case 'update_workspace_presentation':
            this.#database.prepare('UPDATE workspaces SET focused_node_ids = ?, visible_layers = ?, updated_at = ? WHERE id = ?')
              .run(JSON.stringify(op.focusedViewIds), JSON.stringify(op.visibleLayers), new Date().toISOString(), op.workspaceId as SQLInputValue)
            break
          case 'update_workspace_frame': {
            const current = this.#database.prepare('SELECT version FROM workspaces WHERE id = ?').get(op.workspaceId as SQLInputValue) as Row | undefined
            if (current === undefined) throw new Error(`WORKSPACE_NOT_FOUND: ${String(op.workspaceId)}`)
            const currentVersion = (current.version as number) ?? 0
            if (op.expectedVersion !== undefined && currentVersion !== op.expectedVersion) {
              const err = new Error(`Workspace frame version conflict: expected ${op.expectedVersion}, current ${currentVersion}.`) as unknown as Record<string, unknown>
              err.code = 'STALE_WORKSPACE_VERSION'
              err.currentVersion = currentVersion
              throw err
            }
            const nextVersion = currentVersion + 1
            this.#database.prepare('UPDATE workspaces SET frame_bounds = ?, preferred_surface = ?, version = ?, updated_at = ? WHERE id = ?')
              .run(
                op.frameBounds === undefined ? null : JSON.stringify(op.frameBounds),
                op.preferredSurface ?? null,
                nextVersion,
                new Date().toISOString(),
                op.workspaceId as SQLInputValue,
              )
            break
          }
          case 'upsert_workspace':
            this.#upsertWorkspace(op.workspace)
            break
          case 'delete_workspace':
            // Workspace is a first-class Project Entity. Deleting it must also
            // remove its own saved-scene Presentation and every aggregate
            // Presentation reference to that Workspace in the same transaction.
            if (projectId) {
              this.#removePresentationEntityRefs(projectId, 'workspace', String(op.workspaceId))
              this.#database.prepare('DELETE FROM presentation_views WHERE project_id = ? AND id = ?')
                .run(projectId as SQLInputValue, `presentation:custom:workspace:${String(op.workspaceId)}` as SQLInputValue)
            }
            this.#database.prepare('DELETE FROM workspace_memberships WHERE workspace_id = ?').run(op.workspaceId as SQLInputValue)
          this.#database.prepare('DELETE FROM workspace_entity_memberships WHERE workspace_id = ?').run(op.workspaceId as SQLInputValue)
            this.#database.prepare('DELETE FROM workspaces WHERE id = ?').run(op.workspaceId as SQLInputValue)
            break
          case 'reorder_workspaces': {
            const ids = (op.workspaceIds ?? []) as readonly string[]
            if (ids.length === 0 || new Set(ids).size !== ids.length) throw new Error('reorder_workspaces requires a non-empty unique workspace id list.')
            const rows = this.#database.prepare('SELECT id FROM workspaces WHERE project_id = ?').all(projectId as SQLInputValue) as Row[]
            const existing = new Set(rows.map((row) => String(row.id)))
            if (ids.length !== existing.size || ids.some((id) => !existing.has(id))) {
              throw new Error('reorder_workspaces must cover every workspace of the project exactly once.')
            }
            const reorder = this.#database.prepare('UPDATE workspaces SET sort_index = ?, updated_at = ? WHERE id = ? AND project_id = ?')
            const now = new Date().toISOString()
            ids.forEach((id, index) => reorder.run(index, now, id as SQLInputValue, projectId as SQLInputValue))
            break
          }
          case 'upsert_scope':
            this.#upsertScope(op.scope, op.scope.projectId)
            break
          case 'upsert_artifact':
            this.#assertArtifactCurrentRevisionUnchanged(op.artifact)
            this.#upsertArtifact(op.artifact)
            break
          case 'upsert_artifact_view':
            this.#upsertArtifactView(op.view)
            break
          case 'update_artifact_view_presentation':
            this.#database.prepare('UPDATE artifact_views SET collapsed = ?, display_mode = ? WHERE id = ?')
              .run(op.collapsed ? 1 : 0, op.displayMode, op.viewId as SQLInputValue)
            break
          case 'delete_artifact_view':
            this.#database.prepare('DELETE FROM artifact_views WHERE id = ?').run(op.viewId as SQLInputValue)
            break
          case 'upsert_relation':
            this.#upsertRelation(op.relation)
            break
          case 'delete_relation':
            this.#database.prepare('DELETE FROM relations WHERE id = ?').run(op.relationId as SQLInputValue)
            break
          case 'upsert_note':
            this.#upsertNote(op.note)
            break
        }
      }

      this.#database.exec('COMMIT;')
      if (projectId === undefined) return 0 as GraphVersion
      const row = this.#database.prepare('SELECT graph_version FROM projects WHERE id = ?').get(projectId as SQLInputValue) as Row | undefined
      return ((row?.graph_version as number | undefined) ?? 0) as GraphVersion
    } catch (error: unknown) {
      this.#database.exec('ROLLBACK;')
      throw error
    }
  }

  #resolveMutationProjectId(
    ops: MutationBatch['ops'],
    fallbackProjectId?: string,
  ): string | undefined {
    const direct = resolveProjectId(ops)
    if (direct !== null && direct !== '') return direct
    if (fallbackProjectId !== undefined) return fallbackProjectId
    for (const op of ops) {
      if (op.type === 'move_artifact_view'
        || op.type === 'resize_artifact_view'
        || op.type === 'update_artifact_view_presentation'
        || op.type === 'delete_artifact_view') {
        const row = this.#database.prepare(`
          SELECT a.project_id
          FROM artifact_views v
          JOIN artifacts a ON a.id = v.artifact_id
          WHERE v.id = ?
        `).get(op.viewId as SQLInputValue) as Row | undefined
        if (typeof row?.project_id === 'string') return row.project_id
      }
      if (op.type === 'update_workspace_viewport'
        || op.type === 'update_workspace_presentation'
        || op.type === 'delete_workspace') {
        const row = this.#database.prepare('SELECT project_id FROM workspaces WHERE id = ?')
          .get(op.workspaceId as SQLInputValue) as Row | undefined
        if (typeof row?.project_id === 'string') return row.project_id
      }
      if (op.type === 'delete_relation') {
        const row = this.#database.prepare('SELECT project_id FROM relations WHERE id = ?')
          .get(op.relationId as SQLInputValue) as Row | undefined
        if (typeof row?.project_id === 'string') return row.project_id
      }
    }
    return undefined
  }

  #assertMutationProjectExists(
    projectId: string | undefined,
    ops: MutationBatch['ops'],
  ): void {
    if (projectId === undefined) return
    if (ops.length === 1 && ops[0]?.type === 'bootstrap') return
    const project = this.#database.prepare('SELECT id FROM projects WHERE id = ?').get(projectId as SQLInputValue) as Row | undefined
    if (project !== undefined) return
    const op = ops[0]
    throw new MetadataForeignKeyConstraintError({
      operationType: op?.type ?? 'mutation_batch',
      entityId: entityIdForOperation(op),
      table: tableForOperation(op),
      statement: statementForOperation(op),
      foreignKeyColumn: 'project_id',
      referencedTable: 'projects',
      referencedId: projectId,
      foreignKeyCheck: this.foreignKeyCheck(),
    })
  }

  #validateSnapshotReferences(snapshot: ProjectGraphSnapshot): void {
    const projectId = String(snapshot.project.id)
    const scopeIds = new Set(snapshot.scopes.map((scope) => String(scope.id)))
    const artifactIds = new Set(snapshot.artifacts.map((artifact) => String(artifact.id)))
    const revisionIds = new Set(snapshot.artifactRevisions.map((revision) => String(revision.id)))
    const fileRecordIds = new Set(snapshot.fileRecords.map((fileRecord) => String(fileRecord.id)))

    for (const workspace of snapshot.workspaces) {
      if (!scopeIds.has(String(workspace.scopeId))) {
        this.#throwReferenceError('save_workspace', String(workspace.id), 'workspaces', 'INSERT INTO workspaces', 'scope_id', 'scopes', String(workspace.scopeId))
      }
    }
    for (const artifact of snapshot.artifacts) {
      if (String(artifact.projectId) !== projectId) {
        this.#throwReferenceError('save_artifact', String(artifact.id), 'artifacts', 'INSERT INTO artifacts', 'project_id', 'projects', String(artifact.projectId))
      }
      if (artifact.currentRevisionId !== undefined && !revisionIds.has(String(artifact.currentRevisionId))) {
        this.#throwReferenceError('save_artifact', String(artifact.id), 'artifacts', 'INSERT INTO artifacts', 'current_revision_id', 'artifact_revisions', String(artifact.currentRevisionId))
      }
    }
    for (const view of snapshot.artifactViews) {
      if (!artifactIds.has(String(view.artifactId))) {
        this.#throwReferenceError('save_artifact_view', String(view.id), 'artifact_views', 'INSERT INTO artifact_views', 'artifact_id', 'artifacts', String(view.artifactId))
      }
      if (!scopeIds.has(String(view.scopeId))) {
        this.#throwReferenceError('save_artifact_view', String(view.id), 'artifact_views', 'INSERT INTO artifact_views', 'scope_id', 'scopes', String(view.scopeId))
      }
      if (view.revisionId !== undefined && !revisionIds.has(String(view.revisionId))) {
        this.#throwReferenceError('save_artifact_view', String(view.id), 'artifact_views', 'INSERT INTO artifact_views', 'revision_id', 'artifact_revisions', String(view.revisionId))
      }
    }
    for (const revision of snapshot.artifactRevisions) {
      if (!artifactIds.has(String(revision.artifactId))) {
        this.#throwReferenceError('save_artifact_revision', String(revision.id), 'artifact_revisions', 'INSERT INTO artifact_revisions', 'artifact_id', 'artifacts', String(revision.artifactId))
      }
      if (!fileRecordIds.has(String(revision.fileRecordId))) {
        this.#throwReferenceError('save_artifact_revision', String(revision.id), 'artifact_revisions', 'INSERT INTO artifact_revisions', 'file_record_id', 'file_records', String(revision.fileRecordId))
      }
      if (revision.parentRevisionId !== undefined && !revisionIds.has(String(revision.parentRevisionId))) {
        this.#throwReferenceError('save_artifact_revision', String(revision.id), 'artifact_revisions', 'INSERT INTO artifact_revisions', 'parent_revision_id', 'artifact_revisions', String(revision.parentRevisionId))
      }
    }
  }

  #throwReferenceError(
    operationType: string,
    entityId: string,
    table: string,
    statement: string,
    foreignKeyColumn: string,
    referencedTable: string,
    referencedId: string,
  ): never {
    throw new MetadataForeignKeyConstraintError({
      operationType,
      entityId,
      table,
      statement,
      foreignKeyColumn,
      referencedTable,
      referencedId,
      foreignKeyCheck: this.foreignKeyCheck(),
    })
  }

  // ==================== Public CRUD (exposed for server routes) ====================

  getProject(projectId: string): Project | undefined {
    const rows = this.#database.prepare('SELECT * FROM projects WHERE id = ?').all(projectId as SQLInputValue) as Row[]
    return rows.length ? this.#project(rows[0] as Row) : undefined
  }

  getScopes(projectId: string): Scope[] {
    return (this.#database.prepare('SELECT * FROM scopes WHERE project_id = ?').all(projectId as SQLInputValue) as Row[]).map((row) => this.#scope(row as Row))
  }

  /**
   * Phase A：更新任意可展示实体的显示标题。
   * mode='manual'（用户改过）→ Agent 不得自动覆盖；mode='locked' → 任何 Agent 不能改。
   * 表/列来自内部白名单，不接受外部拼接。
   */
  updateEntityTitle(entity: TitleEntityKind, id: string, input: EntityTitleInputV0): void {
    const { table, column } = TITLE_TABLE_COLUMN[entity]
    const title = input.title.trim()
    if (title.length === 0 || title.length > 500) throw new Error('Title must be 1..500 characters.')
    const now = new Date().toISOString()
    const result = this.#database.prepare(
      `UPDATE ${table} SET ${column} = ?, title_mode = ?, updated_at = ? WHERE id = ?`,
    ).run(title, input.mode, now, id as SQLInputValue)
    if (result.changes !== 1) throw new Error(`${entity} not found.`)
  }

  getEntityTitleMode(entity: TitleEntityKind, id: string): TitleModeV0 | undefined {
    const { table } = TITLE_TABLE_COLUMN[entity]
    const row = this.#database.prepare(`SELECT title_mode FROM ${table} WHERE id = ?`).get(id as SQLInputValue) as Row | undefined
    if (row === undefined || row.title_mode === undefined || row.title_mode === null) return undefined
    return String(row.title_mode) as TitleModeV0
  }

  listProjects(): Project[] {
    return (this.#database.prepare('SELECT * FROM projects ORDER BY COALESCE(last_opened_at, created_at) DESC, id').all() as Row[]).map((r) => this.#project(r as Row))
  }

  touchProjectOpened(projectId: ProjectId, openedAt: string): Project {
    const result = this.#database.prepare(
      'UPDATE projects SET last_opened_at = ?, updated_at = ? WHERE id = ?',
    ).run(openedAt, openedAt, projectId as SQLInputValue)
    if (result.changes !== 1) throw new Error('Project not found.')
    const project = this.getProject(String(projectId))
    if (project === undefined) throw new Error('Project not found after touch.')
    return project
  }

  createProject(input: {
    readonly id: ProjectId
    readonly name: string
    readonly rootPath: string
  }): void {
    if (this.getProject(String(input.id)) !== undefined) {
      throw new Error(`Project already exists: ${String(input.id)}`)
    }
    const createdAt = new Date().toISOString()
    const rootScopeId = `scope-${String(input.id)}-root` as ScopeId
    const defaultWorkspaceId = `workspace-${String(input.id)}-main` as WorkspaceId
    this.#database.exec('BEGIN IMMEDIATE;')
    try {
      this.#upsertProject({
        id: input.id,
        name: input.name,
        rootPath: input.rootPath,
        graphVersion: 1 as GraphVersion,
        createdAt,
        updatedAt: createdAt,
      })
      this.#upsertScope({
        id: rootScopeId,
        projectId: input.id,
        parentScopeId: null,
        containerViewId: null,
        kind: 'root',
        name: 'Root',
        createdAt,
        updatedAt: createdAt,
      }, input.id)
      this.#upsertWorkspace({
        id: defaultWorkspaceId,
        projectId: input.id,
        scopeId: rootScopeId,
        name: 'Main',
        intent: null,
        viewport: { x: 0, y: 0, zoom: 1 },
        focusedViewIds: [],
        visibleLayers: ['core', 'process'],
        contextPolicy: 'selection-only',
        updatedAt: createdAt,
      })
      this.#database.exec('COMMIT;')
    } catch (error: unknown) {
      this.#database.exec('ROLLBACK;')
      throw error
    }
  }

  deleteProject(projectId: string): void {
    this.#database.exec('BEGIN IMMEDIATE;')
    try {
      for (const sql of PROJECT_TRUTH_DELETE_SQL) {
        try {
          this.#database.prepare(sql).run(projectId as SQLInputValue)
        } catch (error: unknown) {
          console.error(`[LocalCore] deleteProject failed at: ${sql.slice(0, 110)}`, error)
          throw error
        }
      }
      this.#database.exec('COMMIT;')
    } catch (error: unknown) {
      try { this.#database.exec('ROLLBACK;') } catch { /* already rolled back */ }
      throw error
    }
  }

  /**
   * .lcosproj P1：把单个 Project 的完整真相（Canvas + Content + Work History + Memberships）
   * 原样拷贝到目标 SQLite 文件。目标文件必须已由同一 Schema（v12）初始化。
   */
  exportProjectTruth(projectId: ProjectId, targetDbPath: string): Record<string, number> {
    const counts: Record<string, number> = {}
    this.#database.prepare('ATTACH DATABASE ? AS dst').run(targetDbPath)
    try {
      for (const table of PROJECT_TRUTH_TABLES) {
        const sql = `INSERT INTO dst.${table.table} SELECT * FROM main.${table.table} WHERE ${table.where}`
        const result = this.#database.prepare(sql).run(projectId as SQLInputValue)
        counts[table.table] = Number(result.changes)
      }
      this.#database.exec('DETACH DATABASE dst')
    } catch (error: unknown) {
      try { this.#database.exec('DETACH DATABASE dst') } catch { /* 忽略二次 DETACH */ }
      throw error
    }
    return counts
  }

  /**
   * .lcosproj P1：从工程文件导入同一 Project（先按反向 FK 顺序清空本库该项目的旧行，再整表插入）。
   */
  importProjectTruth(sourceDbPath: string, projectId: ProjectId): Record<string, number> {
    const counts: Record<string, number> = {}
    this.#database.prepare('ATTACH DATABASE ? AS src').run(sourceDbPath)
    const foreignKeys = (this.#database.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys
    this.#database.exec('PRAGMA foreign_keys = OFF')
    this.#database.exec('BEGIN IMMEDIATE;')
    try {
      for (const sql of PROJECT_TRUTH_DELETE_SQL) {
        this.#database.prepare(sql).run(projectId as SQLInputValue)
      }
      for (const table of PROJECT_TRUTH_TABLES) {
        const sql = `INSERT INTO main.${table.table} SELECT * FROM src.${table.table} WHERE ${table.where}`
        const result = this.#database.prepare(sql).run(projectId as SQLInputValue)
        counts[table.table] = Number(result.changes)
      }
      this.#database.exec('COMMIT;')
      this.#database.exec('PRAGMA foreign_keys = ON')
      this.#database.exec('DETACH DATABASE src')
    } catch (error: unknown) {
      try { this.#database.exec('ROLLBACK;') } catch { /* 事务可能未开启 */ }
      if (foreignKeys === 1) { try { this.#database.exec('PRAGMA foreign_keys = ON') } catch { /* 忽略 */ } }
      try { this.#database.exec('DETACH DATABASE src') } catch { /* 忽略 */ }
      throw error
    }
    return counts
  }

  getWorkspaces(projectId: string): Workspace[] {
    return (this.#database.prepare('SELECT * FROM workspaces WHERE project_id = ? ORDER BY sort_index, rowid').all(projectId as SQLInputValue) as Row[]).map((r) => this.#workspace(r))
  }

  getWorkspace(workspaceId: string): Workspace | undefined {
    const rows = this.#database.prepare('SELECT * FROM workspaces WHERE id = ?').all(workspaceId as SQLInputValue) as Row[]
    return rows.length ? this.#workspace(rows[0] as Row) : undefined
  }

  getProjectViewRailOrder(projectId: string): ProjectViewRailOrderV0 | undefined {
    const row = this.#database.prepare('SELECT * FROM project_view_rail_order WHERE project_id = ?').get(projectId as SQLInputValue) as Row | undefined
    if (row === undefined) return undefined
    let orderedRefs: ProjectViewRailRefV0[] = []
    try {
      const parsed: unknown = JSON.parse(String(row.ordered_refs ?? '[]'))
      if (Array.isArray(parsed)) {
        orderedRefs = parsed.filter((item): item is ProjectViewRailRefV0 =>
          typeof item === 'object' && item !== null
          && typeof (item as { viewId?: unknown }).viewId === 'string'
          && ['scene', 'collection', 'context', 'workflow'].includes(String((item as { kind?: unknown }).kind)),
        )
      }
    } catch { /* malformed rows degrade to empty deterministically */ }
    return {
      projectId,
      orderedRefs,
      version: Number(row.version ?? 0),
      updatedAt: String(row.updated_at ?? ''),
    }
  }

  saveProjectViewRailOrder(
    projectId: string,
    orderedRefs: readonly ProjectViewRailRefV0[],
    expectedVersion: number,
  ): ProjectViewRailOrderV0 {
    const now = new Date().toISOString()
    this.#database.exec('BEGIN')
    try {
      const current = this.#database.prepare('SELECT version FROM project_view_rail_order WHERE project_id = ?').get(projectId as SQLInputValue) as Row | undefined
      const currentVersion = current === undefined ? 0 : Number(current.version ?? 0)
      if (currentVersion !== expectedVersion) {
        throw new Error(`Stale view rail order version: expected ${expectedVersion}, current ${currentVersion}.`)
      }
      const nextVersion = currentVersion + 1
      const json = JSON.stringify(orderedRefs.map((ref) => ({ kind: ref.kind, viewId: ref.viewId })))
      this.#database.prepare(`
        INSERT INTO project_view_rail_order (project_id, ordered_refs, version, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET
          ordered_refs = excluded.ordered_refs,
          version = excluded.version,
          updated_at = excluded.updated_at
      `).run(projectId as SQLInputValue, json, nextVersion, now)
      this.#database.exec('COMMIT')
      return { projectId, orderedRefs: orderedRefs.map((ref) => ({ kind: ref.kind, viewId: ref.viewId })), version: nextVersion, updatedAt: now }
    } catch (error: unknown) {
      this.#database.exec('ROLLBACK')
      throw error
    }
  }

  upsertWorkspace(value: Workspace): void { this.#upsertWorkspace(value) }

  getArtifacts(projectId: string): Artifact[] {
    return (this.#database.prepare('SELECT * FROM artifacts WHERE project_id = ?').all(projectId as SQLInputValue) as Row[]).map((r) => this.#artifact(r))
  }

  getArtifact(artifactId: string): Artifact | undefined {
    const rows = this.#database.prepare('SELECT * FROM artifacts WHERE id = ?').all(artifactId as SQLInputValue) as Row[]
    return rows.length ? this.#artifact(rows[0] as Row) : undefined
  }

  /** Phase 2：Source actions 需要的源路径与存在性（含 URL 识别）。 */
  getArtifactSourcePath(artifactId: string): { readonly path: string; readonly exists: boolean; readonly isUrl: boolean } | undefined {
    const row = this.#database.prepare(`
      SELECT a.local_path, r.file_record_id
      FROM artifacts a
      LEFT JOIN artifact_revisions r ON r.artifact_id = a.id AND r.status = 'current'
      WHERE a.id = ?
    `).get(artifactId as SQLInputValue) as Row | undefined
    if (row === undefined) return undefined
    let path = ''
    if (row.file_record_id !== undefined && row.file_record_id !== null) {
      const fileRecord = this.#database.prepare('SELECT observed_path FROM file_records WHERE id = ?').get(row.file_record_id as SQLInputValue) as Row | undefined
      path = String(fileRecord?.observed_path ?? '').trim()
    }
    if (path === '') path = String(row.local_path ?? '').trim()
    if (path === '') return { path: '', exists: false, isUrl: false }
    const isUrl = /^https?:\/\//i.test(path)
    return { path, exists: !isUrl && existsSync(path), isUrl }
  }

  /** Phase 2：把 Artifact 的本地源重新指向新路径（快捷方式失效后的 relink）。 */
  relinkArtifactSource(artifactId: string, path: string): boolean {
    const artifact = this.getArtifact(artifactId)
    if (artifact === undefined) return false
    const now = new Date().toISOString()
    this.#database.exec('BEGIN IMMEDIATE;')
    try {
      this.#database.prepare('UPDATE artifacts SET local_path = ?, availability = ?, updated_at = ? WHERE id = ?')
        .run(path as SQLInputValue, 'available', now, artifactId as SQLInputValue)
      const revision = this.#database.prepare('SELECT file_record_id FROM artifact_revisions WHERE artifact_id = ? AND status = \'current\' ORDER BY created_at DESC LIMIT 1')
        .get(artifactId as SQLInputValue) as Row | undefined
      if (revision?.file_record_id !== undefined && revision.file_record_id !== null) {
        this.#database.prepare('UPDATE file_records SET observed_path = ?, availability = \'current\', observed_at = ? WHERE id = ?')
          .run(path as SQLInputValue, now, revision.file_record_id as SQLInputValue)
      }
      this.#database.exec('COMMIT;')
      return true
    } catch (error: unknown) {
      this.#database.exec('ROLLBACK;')
      throw error
    }
  }

  upsertArtifact(value: Artifact): void {
    this.#assertArtifactCurrentRevisionUnchanged(value)
    this.#upsertArtifact(value)
  }

  /**
   * Phase E: Curation edit of a managed Text Artifact becomes the new Current
   * Revision directly (no Draft Review). Managed Run results keep the
   * draft → review → accept path in runtime services.
   */
  commitManagedTextRevision(input: {
    readonly artifact: Artifact
    readonly previousRevision: ArtifactRevision
    readonly newFileRecord: FileRecord
    readonly newRevision: ArtifactRevision
  }): ArtifactRevision {
    const current = this.getArtifact(String(input.artifact.id))?.currentRevisionId
    if (current === undefined || String(current) !== String(input.previousRevision.id)) {
      throw new Error('Managed text commit requires the current revision as base.')
    }
    if (input.newRevision.status !== 'current' || input.newRevision.source !== 'external') {
      throw new Error('Managed text revision must be external source with current status.')
    }
    this.#database.exec('BEGIN IMMEDIATE;')
    try {
      this.#upsertFileRecord(input.newFileRecord)
      this.#database.prepare('UPDATE artifact_revisions SET status = ? WHERE id = ?').run('superseded', input.previousRevision.id as SQLInputValue)
      this.#upsertArtifactRevision(input.newRevision)
      this.#database.prepare('UPDATE artifacts SET current_revision_id = ?, updated_at = ? WHERE id = ?')
        .run(input.newRevision.id as SQLInputValue, input.newRevision.createdAt, input.artifact.id as SQLInputValue)
      // HU-2: view 的 revision 指针必须跟随 current（否则 readViews 永远读到旧 revision，lease 恒 stale）
      this.#database.prepare('UPDATE artifact_views SET revision_id = ? WHERE artifact_id = ?')
        .run(input.newRevision.id as SQLInputValue, input.artifact.id as SQLInputValue)
      this.#database.exec('COMMIT;')
      return input.newRevision
    } catch (error: unknown) {
      this.#database.exec('ROLLBACK;')
      throw error
    }
  }

  /** 任务四 P1 change-review：restore_artifact_text 的执行体——current 指针回拨到 target（CAS：current 必须仍是 expected）。 */
  restoreArtifactCurrentRevision(input: {
    readonly artifactId: string
    readonly targetRevisionId: string
    readonly expectedCurrentRevisionId: string
  }): void {
    const artifact = this.getArtifact(input.artifactId)
    if (artifact === undefined) throw new Error('Artifact not found.')
    const current = artifact.currentRevisionId
    if (current === undefined || String(current) !== input.expectedCurrentRevisionId) {
      throw new Error('Artifact current revision moved; refusing to restore over newer work.')
    }
    const target = this.getArtifactRevision(input.targetRevisionId)
    if (target === undefined || String(target.artifactId) !== input.artifactId) {
      throw new Error('Target revision does not belong to the artifact.')
    }
    const now = new Date().toISOString()
    this.#database.exec('BEGIN IMMEDIATE;')
    try {
      this.#database.prepare('UPDATE artifact_revisions SET status = ? WHERE id = ?').run('superseded', input.expectedCurrentRevisionId as SQLInputValue)
      this.#database.prepare('UPDATE artifact_revisions SET status = ? WHERE id = ?').run('current', input.targetRevisionId as SQLInputValue)
      this.#database.prepare('UPDATE artifacts SET current_revision_id = ?, updated_at = ? WHERE id = ?')
        .run(input.targetRevisionId as SQLInputValue, now, input.artifactId as SQLInputValue)
      this.#database.prepare('UPDATE artifact_views SET revision_id = ? WHERE artifact_id = ?')
        .run(input.targetRevisionId as SQLInputValue, input.artifactId as SQLInputValue)
      this.#database.exec('COMMIT;')
    } catch (error: unknown) {
      this.#database.exec('ROLLBACK;')
      throw error
    }
  }

  getArtifactViews(artifactId: string): ArtifactView[] {
    return (this.#database.prepare('SELECT * FROM artifact_views WHERE artifact_id = ?').all(artifactId as SQLInputValue) as Row[]).map((r) => this.#artifactView(r))
  }

  getArtifactView(viewId: string): ArtifactView | undefined {
    const rows = this.#database.prepare('SELECT * FROM artifact_views WHERE id = ?').all(viewId as SQLInputValue) as Row[]
    return rows.length ? this.#artifactView(rows[0] as Row) : undefined
  }

  upsertArtifactView(value: ArtifactView): void { this.#upsertArtifactView(value) }
  deleteArtifactView(viewId: string): void { this.#database.prepare('DELETE FROM artifact_views WHERE id = ?').run(viewId as SQLInputValue) }

  /** Phase D：删除 Artifact（级联 views/revisions）。file_records 保留（可能被其他 artifact 引用）。 */
  deleteArtifact(artifactId: string): boolean {
    this.#database.exec('BEGIN IMMEDIATE;')
    try {
      this.#database.prepare('DELETE FROM artifact_views WHERE artifact_id = ?').run(artifactId as SQLInputValue)
      this.#database.prepare('DELETE FROM artifact_revisions WHERE artifact_id = ?').run(artifactId as SQLInputValue)
      const result = this.#database.prepare('DELETE FROM artifacts WHERE id = ?').run(artifactId as SQLInputValue)
      this.#database.exec('COMMIT;')
      return Number(result.changes) > 0
    } catch (error) {
      this.#database.exec('ROLLBACK;')
      throw error
    }
  }

  getRelations(projectId: string): Relation[] {
    return (this.#database.prepare('SELECT * FROM relations WHERE project_id = ?').all(projectId as SQLInputValue) as Row[]).map((r) => this.#relation(r))
  }

  getRelation(relationId: string): Relation | undefined {
    const rows = this.#database.prepare('SELECT * FROM relations WHERE id = ?').all(relationId as SQLInputValue) as Row[]
    return rows.length ? this.#relation(rows[0] as Row) : undefined
  }

  upsertRelation(value: Relation): void { this.#upsertRelation(value) }
  deleteRelation(relationId: string): void { this.#database.prepare('DELETE FROM relations WHERE id = ?').run(relationId as SQLInputValue) }

  // ==================== Presentation Views (schema v21) ====================

  getPresentationView(projectId: string, id: string): PresentationViewV0 | undefined {
    const rows = this.#database.prepare('SELECT * FROM presentation_views WHERE id = ? AND project_id = ?').all(id as SQLInputValue, projectId as SQLInputValue) as Row[]
    return rows.length ? this.#presentationView(rows[0] as Row) : undefined
  }

  listPresentationViews(projectId: string): PresentationViewV0[] {
    return (this.#database.prepare('SELECT * FROM presentation_views WHERE project_id = ? ORDER BY id').all(projectId as SQLInputValue) as Row[])
      .map((row) => this.#presentationView(row))
  }

  insertPresentationView(value: PresentationViewV0): void {
    this.#database.prepare(`
      INSERT INTO presentation_views (id, project_id, scope_id, capability, renderer, state_json, version, created_at, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      value.id as SQLInputValue, value.projectId as SQLInputValue, value.scopeId as SQLInputValue,
      value.capability, value.renderer, JSON.stringify(value.state), value.version,
      value.createdAt, value.updatedAt, value.updatedBy,
    )
  }

  compareAndSwapPresentationView(value: PresentationViewV0, expectedVersion: number): { readonly updated: boolean; readonly currentVersion: number } {
    const existing = this.#database.prepare('SELECT version FROM presentation_views WHERE id = ? AND project_id = ?').get(value.id as SQLInputValue, value.projectId as SQLInputValue) as Row | undefined
    if (existing === undefined) return { updated: false, currentVersion: 0 }
    const currentVersion = Number(existing.version ?? 0)
    if (currentVersion !== expectedVersion) return { updated: false, currentVersion }
    const result = this.#database.prepare(`
      UPDATE presentation_views
      SET scope_id = ?, capability = ?, renderer = ?, state_json = ?, version = version + 1, updated_at = ?, updated_by = ?
      WHERE id = ? AND project_id = ? AND version = ?
    `).run(
      value.scopeId as SQLInputValue, value.capability, value.renderer, JSON.stringify(value.state),
      value.updatedAt, value.updatedBy, value.id as SQLInputValue, value.projectId as SQLInputValue, expectedVersion,
    )
    return { updated: result.changes === 1, currentVersion: expectedVersion + 1 }
  }

  /**
   * HU-1: Curation composite mutation —— text(DB 部分) + relations + presentation CAS + change set + receipt 一个事务。
   * 调用方负责：事务前写 staged 文件，事务成功后 rename；事务失败清理 staged。
   */
  runCurationMutation(plan: {
    readonly projectId: string
    readonly textCreates?: readonly {
      readonly fileRecord: FileRecord
      readonly artifact: Artifact
      readonly revision: ArtifactRevision
      readonly view: ArtifactView
      readonly workspaceId?: WorkspaceId
    }[]
    readonly relationUpserts?: readonly Relation[]
    readonly relationDeletes?: readonly string[]
    readonly presentation?: {
      readonly value: PresentationViewV0
      readonly expectedVersion: number
    }
    readonly workspaceMembershipAdds?: readonly { readonly workspaceId: WorkspaceId; readonly viewId: ArtifactViewId; readonly addedBy: 'user' | 'agent' | 'run' | 'import'; readonly addedAt: string }[]
    readonly workspaceMembershipRemoves?: readonly { readonly workspaceId: WorkspaceId; readonly viewId: ArtifactViewId }[]
    readonly workspaceEntityMembershipAdds?: readonly { readonly workspaceId: WorkspaceId; readonly entityType: WorkspaceEntityMembership['entityType']; readonly entityId: string; readonly addedBy: WorkspaceMembershipSource; readonly addedAt: string }[]
    readonly workspaceEntityMembershipRemoves?: readonly { readonly workspaceId: WorkspaceId; readonly entityType: WorkspaceEntityMembership['entityType']; readonly entityId: string }[]
    /** F6A2：Spatial Marker 意图增删（与 changeSet 同事务）。 */
    readonly spatialMarkerAdds?: readonly SpatialMarkerIntentV0[]
    readonly spatialMarkerDeletes?: readonly string[]
    /** A25-6: Color Pin identity + membership changes share the same semantic ChangeSet transaction. */
    readonly colorPinDefinitionAdds?: readonly ColorPinDefinitionV0[]
    readonly colorPinDefinitionDeletes?: readonly string[]
    readonly colorPinMembershipAdds?: readonly ColorPinMembershipV0[]
    readonly colorPinMembershipDeletes?: readonly string[]
    readonly artifactViewDeletes?: readonly ArtifactViewId[]
    readonly noteDeletes?: readonly NoteId[]
    readonly changeSet?: MutationChangeSetV1
    readonly receipt?: CurationPatchReceiptV0
  }): { readonly presentationUpdated: boolean } {
    this.#database.exec('BEGIN IMMEDIATE;')
    try {
      for (const text of plan.textCreates ?? []) {
        if (String(text.fileRecord.projectId) !== String(text.artifact.projectId)
          || String(text.revision.artifactId) !== String(text.artifact.id)
          || String(text.revision.fileRecordId) !== String(text.fileRecord.id)
          || String(text.artifact.currentRevisionId) !== String(text.revision.id)
          || String(text.revision.contentHash) !== String(text.fileRecord.observedHash)
          || text.revision.source !== 'import'
          || text.revision.status !== 'current') {
          throw new Error('Initial source registration invariants are invalid.')
        }
        this.#upsertFileRecord(text.fileRecord)
        this.#upsertArtifact(text.artifact)
        this.#upsertArtifactRevision(text.revision)
        this.#upsertArtifactView(text.view)
        if (text.workspaceId !== undefined) {
          const row = this.#database.prepare(
            'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM workspace_memberships WHERE workspace_id = ?',
          ).get(text.workspaceId as SQLInputValue) as Row
          this.#database.prepare(`
            INSERT OR IGNORE INTO workspace_memberships (workspace_id, artifact_view_id, added_at, added_by, sort_order)
            VALUES (?, ?, ?, ?, ?)
          `).run(text.workspaceId as SQLInputValue, text.view.id as SQLInputValue, new Date().toISOString(), 'user', Number(row.next_order))
        }
      }
      for (const relation of plan.relationUpserts ?? []) this.#upsertRelation(relation)
      for (const relationId of plan.relationDeletes ?? []) this.#database.prepare('DELETE FROM relations WHERE id = ?').run(relationId as SQLInputValue)
      let presentationUpdated = false
      if (plan.presentation !== undefined) {
        const cas = this.compareAndSwapPresentationView(plan.presentation.value, plan.presentation.expectedVersion)
        if (!cas.updated) throw new Error(`STALE_PRESENTATION_VERSION current=${cas.currentVersion}`)
        presentationUpdated = true
      }
      for (const membership of plan.workspaceMembershipAdds ?? []) {
        const row = this.#database.prepare(
          'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM workspace_memberships WHERE workspace_id = ?',
        ).get(membership.workspaceId as SQLInputValue) as Row
        this.#database.prepare(`
          INSERT OR IGNORE INTO workspace_memberships (workspace_id, artifact_view_id, added_at, added_by, sort_order)
          VALUES (?, ?, ?, ?, ?)
        `).run(membership.workspaceId as SQLInputValue, membership.viewId as SQLInputValue, membership.addedAt, membership.addedBy, Number(row.next_order))
      }
      for (const membership of plan.workspaceMembershipRemoves ?? []) {
        this.#database.prepare('DELETE FROM workspace_memberships WHERE workspace_id = ? AND artifact_view_id = ?')
          .run(membership.workspaceId as SQLInputValue, membership.viewId as SQLInputValue)
      }
      for (const membership of plan.workspaceEntityMembershipAdds ?? []) {
        this.#database.prepare(`
          INSERT OR IGNORE INTO workspace_entity_memberships (workspace_id, entity_type, entity_id, added_at, added_by)
          VALUES (?, ?, ?, ?, ?)
        `).run(membership.workspaceId as SQLInputValue, membership.entityType, membership.entityId, membership.addedAt, membership.addedBy)
      }
      for (const membership of plan.workspaceEntityMembershipRemoves ?? []) {
        this.#database.prepare('DELETE FROM workspace_entity_memberships WHERE workspace_id = ? AND entity_type = ? AND entity_id = ?')
          .run(membership.workspaceId as SQLInputValue, membership.entityType, membership.entityId)
      }
      for (const marker of plan.spatialMarkerAdds ?? []) this.#insertSpatialMarkerIntent(marker)
      for (const markerId of plan.spatialMarkerDeletes ?? []) this.#database.prepare('DELETE FROM spatial_marker_intents WHERE id = ?').run(markerId as SQLInputValue)
      for (const definition of plan.colorPinDefinitionAdds ?? []) this.#insertColorPinDefinition(definition)
      for (const membership of plan.colorPinMembershipAdds ?? []) this.#insertColorPinMembership(membership)
      for (const membershipId of plan.colorPinMembershipDeletes ?? []) this.#database.prepare('DELETE FROM color_pin_memberships WHERE id = ?').run(membershipId as SQLInputValue)
      for (const colorPinId of plan.colorPinDefinitionDeletes ?? []) this.#database.prepare('DELETE FROM color_pin_definitions WHERE id = ?').run(colorPinId as SQLInputValue)
      for (const viewId of plan.artifactViewDeletes ?? []) this.#database.prepare('DELETE FROM artifact_views WHERE id = ?').run(viewId as SQLInputValue)
      for (const noteId of plan.noteDeletes ?? []) this.#database.prepare('DELETE FROM notes WHERE id = ?').run(noteId as SQLInputValue)
      if (plan.changeSet !== undefined) this.createMutationChangeSet(plan.changeSet)
      if (plan.receipt !== undefined) this.saveCurationReceipt(plan.receipt, plan.projectId)
      this.#database.exec('COMMIT;')
      return { presentationUpdated }
    } catch (error: unknown) {
      this.#database.exec('ROLLBACK;')
      throw error
    }
  }

  deletePresentationView(projectId: string, id: string): void {
    this.#database.prepare('DELETE FROM presentation_views WHERE id = ? AND project_id = ?').run(id as SQLInputValue, projectId as SQLInputValue)
  }

  // ==================== Search Documents (schema v23, derived index) ====================

  getSearchDocument(projectId: string, entityType: string, entityId: string): { readonly contentHash: string } | undefined {
    const row = this.#database.prepare('SELECT content_hash FROM search_documents WHERE project_id = ? AND entity_type = ? AND entity_id = ?')
      .get(projectId as SQLInputValue, entityType, entityId) as Row | undefined
    return row === undefined ? undefined : { contentHash: String(row.content_hash) }
  }

  upsertSearchDocument(doc: { readonly id: string; readonly projectId: string; readonly entityType: string; readonly entityId: string; readonly title: string; readonly body: string; readonly contentHash: string; readonly updatedAt: string }): void {
    this.#database.exec('BEGIN IMMEDIATE;')
    try {
      this.#database.prepare('DELETE FROM search_documents_fts WHERE entity_id = ? AND project_id = ?').run(doc.entityId, doc.projectId)
      this.#database.prepare(`
        INSERT INTO search_documents (id, project_id, entity_type, entity_id, title, body, content_hash, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id, entity_type, entity_id) DO UPDATE SET
          id=excluded.id, title=excluded.title, body=excluded.body, content_hash=excluded.content_hash, updated_at=excluded.updated_at
      `).run(doc.id, doc.projectId, doc.entityType, doc.entityId, doc.title, doc.body, doc.contentHash, doc.updatedAt)
      this.#database.prepare('INSERT INTO search_documents_fts (entity_id, project_id, title, body) VALUES (?, ?, ?, ?)')
        .run(doc.entityId, doc.projectId, doc.title, doc.body)
      this.#database.exec('COMMIT;')
    } catch (error: unknown) {
      this.#database.exec('ROLLBACK;')
      throw error
    }
  }

  deleteSearchDocument(projectId: string, entityType: string, entityId: string): void {
    this.#database.prepare('DELETE FROM search_documents_fts WHERE entity_id = ? AND project_id = ?').run(entityId, projectId)
    this.#database.prepare('DELETE FROM search_documents WHERE project_id = ? AND entity_type = ? AND entity_id = ?').run(projectId, entityType, entityId)
    const modelRows = this.#database.prepare('SELECT model, dimensions FROM search_document_embeddings WHERE entity_id = ?').all(entityId as SQLInputValue) as Row[]
    for (const row of modelRows) {
      const table = this.#ensureSearchVecTable(String(row.model), Number(row.dimensions))
      if (table !== undefined) {
        try { this.#database.prepare(`DELETE FROM ${table} WHERE entity_id = ?`).run(entityId) } catch { /* best effort */ }
      }
    }
    this.#database.prepare('DELETE FROM search_document_embeddings WHERE entity_id = ?').run(entityId)
    // chunk 维度（schema v39）：元数据行与 vec0 chunk 向量行同步清理。
    const chunkModelRows = this.#database.prepare('SELECT DISTINCT model, dimensions FROM search_document_chunks WHERE entity_id = ? AND dimensions IS NOT NULL')
      .all(entityId as SQLInputValue) as Row[]
    for (const row of chunkModelRows) {
      const table = this.#ensureSearchChunkVecTable(String(row.model), Number(row.dimensions))
      if (table !== undefined) {
        try { this.#database.prepare(`DELETE FROM ${table} WHERE entity_id = ?`).run(entityId) } catch { /* best effort */ }
      }
    }
    this.#database.prepare('DELETE FROM search_document_chunks WHERE entity_id = ?').run(entityId as SQLInputValue)
  }

  upsertSearchDocumentEmbedding(embedding: { readonly entityId: string; readonly model: string; readonly dimensions: number; readonly contentHash: string; readonly embeddingBlob: Buffer; readonly indexedAt: string }): void {
    this.#database.prepare(`
      INSERT INTO search_document_embeddings (entity_id, model, dimensions, content_hash, embedding_blob, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(entity_id, model) DO UPDATE SET
        dimensions=excluded.dimensions, content_hash=excluded.content_hash, embedding_blob=excluded.embedding_blob, indexed_at=excluded.indexed_at
    `).run(embedding.entityId, embedding.model, embedding.dimensions, embedding.contentHash, embedding.embeddingBlob, embedding.indexedAt)
    const table = this.#ensureSearchVecTable(embedding.model, embedding.dimensions)
    if (table !== undefined) {
      try {
        const floats = new Float32Array(embedding.embeddingBlob.buffer, embedding.embeddingBlob.byteOffset, embedding.embeddingBlob.byteLength / 4)
        const vector = [...floats]
        this.#database.prepare(`DELETE FROM ${table} WHERE entity_id = ?`).run(embedding.entityId)
        this.#database.prepare(`INSERT INTO ${table}(entity_id, project_id, embedding) VALUES (?, ?, ?)`)
          .run(embedding.entityId, this.#projectIdForSearchDocument(embedding.entityId), JSON.stringify(vector))
      } catch { /* vec0 写入失败不影响 blob 主索引 */ }
    }
  }

  // ==================== Search Document Chunks（schema v39，块级语义索引） ====================

  #chunkKey(entityId: string, chunkIndex: number): string {
    return `${entityId}#c${chunkIndex}`
  }

  getSearchDocumentChunks(entityId: string, model: string): Array<{ readonly chunkIndex: number; readonly contentHash: string }> {
    const rows = this.#database.prepare('SELECT chunk_index, content_hash FROM search_document_chunks WHERE entity_id = ? AND model = ? ORDER BY chunk_index')
      .all(entityId as SQLInputValue, model as SQLInputValue) as Row[]
    return rows.map((row) => ({ chunkIndex: Number(row.chunk_index), contentHash: String(row.content_hash) }))
  }

  /** FTS 块级化查询(核心能力 B):读文档完整分块计划(anchor/kind/text),供 FTS 命中映射到块级锚点。 */
  getSearchDocumentChunkPlan(entityId: string): Array<{
    readonly chunkKind: 'title' | 'body'
    readonly chunkAnchor: string
    readonly chunkIndex: number
    readonly chunkCount: number
    readonly chunkText: string
  }> {
    const rows = this.#database.prepare(`
      SELECT chunk_kind, chunk_anchor, chunk_index, chunk_count, chunk_text
      FROM search_document_chunks WHERE entity_id = ? ORDER BY model, chunk_index
    `).all(entityId as SQLInputValue) as Row[]
    return rows.map((row) => ({
      chunkKind: String(row.chunk_kind) === 'title' ? 'title' : 'body',
      chunkAnchor: String(row.chunk_anchor ?? ''),
      chunkIndex: Number(row.chunk_index),
      chunkCount: Number(row.chunk_count),
      chunkText: String(row.chunk_text ?? ''),
    }))
  }

  /**
   * 块元数据（分块计划）落库：不触碰已有 embedding_blob（差分块向量由
   * commitSearchDocumentChunkEmbeddings 单独补写），并删除超出新 chunkCount 的旧块
   * （同步清理其 vec0 向量行，best effort）。
   */
  upsertSearchDocumentChunkPlan(entityId: string, model: string, chunks: ReadonlyArray<{
    readonly chunkIndex: number
    readonly chunkCount: number
    readonly chunkAnchor: string
    readonly chunkKind: 'title' | 'body'
    readonly chunkText: string
    readonly contentHash: string
  }>): void {
    const chunkCount = chunks[0]?.chunkCount ?? 0
    this.#database.exec('BEGIN IMMEDIATE;')
    try {
      const staleRows = this.#database.prepare('SELECT chunk_index FROM search_document_chunks WHERE entity_id = ? AND model = ? AND chunk_index >= ?')
        .all(entityId as SQLInputValue, model as SQLInputValue, chunkCount as SQLInputValue) as Row[]
      const insert = this.#database.prepare(`
        INSERT INTO search_document_chunks (entity_id, model, chunk_index, chunk_count, chunk_anchor, chunk_kind, chunk_text, content_hash, dimensions, embedding_blob, indexed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
        ON CONFLICT(entity_id, model, chunk_index) DO UPDATE SET
          chunk_count=excluded.chunk_count, chunk_anchor=excluded.chunk_anchor, chunk_kind=excluded.chunk_kind,
          chunk_text=excluded.chunk_text, content_hash=excluded.content_hash, indexed_at=excluded.indexed_at
      `)
      const now = new Date().toISOString()
      for (const chunk of chunks) {
        insert.run(entityId, model, chunk.chunkIndex, chunk.chunkCount, chunk.chunkAnchor, chunk.chunkKind, chunk.chunkText, chunk.contentHash, now)
      }
      this.#database.prepare('DELETE FROM search_document_chunks WHERE entity_id = ? AND model = ? AND chunk_index >= ?')
        .run(entityId as SQLInputValue, model as SQLInputValue, chunkCount as SQLInputValue)
      this.#database.exec('COMMIT;')
      // vec0 旧块行清理（事务外 best effort，与既有 vec0 写入失败静默策略一致）
      if (staleRows.length > 0) {
        const table = this.#chunkVecTableFor(entityId, model)
        if (table !== undefined) {
          for (const row of staleRows) {
            try { this.#database.prepare(`DELETE FROM ${table} WHERE chunk_key = ?`).run(this.#chunkKey(entityId, Number(row.chunk_index))) } catch { /* best effort */ }
          }
        }
      }
    } catch (error: unknown) {
      this.#database.exec('ROLLBACK;')
      throw error
    }
  }

  /** HU-5 §10：chunk embedding 提交守卫 —— 文档已删/内容已变则丢弃派生向量；通过后补写 blob 与 vec0。 */
  commitSearchDocumentChunkEmbeddings(input: {
    readonly projectId: string
    readonly entityType: string
    readonly entityId: string
    readonly model: string
    readonly documentHash: string
    readonly chunks: ReadonlyArray<{
      readonly chunkIndex: number
      readonly dimensions: number
      readonly contentHash: string
      readonly embeddingBlob: Buffer
      readonly indexedAt: string
    }>
  }): DerivedWriteStatusV0 {
    const document = this.getSearchDocument(input.projectId, input.entityType, input.entityId)
    if (document === undefined) return 'skipped_deleted'
    if (String(document.contentHash) !== input.documentHash) return 'skipped_stale'
    const dimensions = input.chunks[0]?.dimensions ?? 0
    const table = this.#ensureSearchChunkVecTable(input.model, dimensions)
    this.#database.exec('BEGIN IMMEDIATE;')
    try {
      const update = this.#database.prepare(`
        UPDATE search_document_chunks
        SET dimensions = ?, embedding_blob = ?, indexed_at = ?
        WHERE entity_id = ? AND model = ? AND chunk_index = ? AND content_hash = ?
      `)
      for (const chunk of input.chunks) {
        update.run(chunk.dimensions, chunk.embeddingBlob, chunk.indexedAt, input.entityId, input.model, chunk.chunkIndex, chunk.contentHash)
      }
      this.#database.exec('COMMIT;')
    } catch (error: unknown) {
      this.#database.exec('ROLLBACK;')
      throw error
    }
    if (table !== undefined) {
      const projectId = this.#projectIdForSearchDocument(input.entityId)
      const anchorStatement = this.#database.prepare('SELECT chunk_anchor FROM search_document_chunks WHERE entity_id = ? AND model = ? AND chunk_index = ?')
      for (const chunk of input.chunks) {
        const anchorRow = anchorStatement.get(input.entityId as SQLInputValue, input.model as SQLInputValue, chunk.chunkIndex as SQLInputValue) as Row | undefined
        if (anchorRow === undefined) continue
        try {
          const floats = new Float32Array(chunk.embeddingBlob.buffer, chunk.embeddingBlob.byteOffset, chunk.embeddingBlob.byteLength / 4)
          const vector = [...floats]
          this.#database.prepare(`DELETE FROM ${table} WHERE chunk_key = ?`).run(this.#chunkKey(input.entityId, chunk.chunkIndex))
          this.#database.prepare(`INSERT INTO ${table}(chunk_key, entity_id, project_id, chunk_anchor, embedding) VALUES (?, ?, ?, ?, ?)`)
            .run(this.#chunkKey(input.entityId, chunk.chunkIndex), input.entityId, projectId, String(anchorRow.chunk_anchor), JSON.stringify(vector))
        } catch { /* vec0 写入失败不影响 blob 主索引 */ }
      }
    }
    return 'applied'
  }

  #ensureSearchChunkVecTable(model: string, dimensions: number): string | undefined {
    if (!this.#vectorLoaded || !Number.isInteger(dimensions) || dimensions <= 0 || dimensions > 4096) return undefined
    const key = createHash('sha256').update(`${model}:${dimensions}`).digest('hex').slice(0, 16)
    const table = `search_chunk_vec_${key}`
    try {
      this.#database.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS ${table} USING vec0(chunk_key TEXT, entity_id TEXT, project_id TEXT, chunk_anchor TEXT, embedding float[${dimensions}])`)
      return table
    } catch {
      this.#vectorLoadError = 'Failed to create search_chunk_vec table.'
      return undefined
    }
  }

  /** 查找实体在某 model 下已写入向量的 chunk vec0 表（用于旧块向量清理）。 */
  #chunkVecTableFor(entityId: string, model: string): string | undefined {
    const row = this.#database.prepare('SELECT dimensions FROM search_document_chunks WHERE entity_id = ? AND model = ? AND dimensions IS NOT NULL LIMIT 1')
      .get(entityId as SQLInputValue, model as SQLInputValue) as Row | undefined
    if (row === undefined) return undefined
    return this.#ensureSearchChunkVecTable(model, Number(row.dimensions))
  }

  /**
   * chunk 向量检索（核心能力 B）：标题块命中 = 文档级（无 chunkAnchor），
   * 正文块命中 = 块级（带 chunkAnchor，语义同 contracts 的 sourceAnchor）。
   * vec0 可用走 KNN；不可用/失败走 embedding_blob 线性扫描（与整文档 fallback 同模式）。
   */
  querySearchChunkVectors(model: string, vector: readonly number[], limit: number, projectId?: string): Array<{
    readonly entityId: string
    readonly distance: number
    readonly documentTitle?: string
    readonly chunkKind: 'title' | 'body'
    readonly chunkAnchor?: string
    readonly chunkIndex?: number
    readonly chunkCount?: number
    readonly chunkText: string
  }> {
    let candidates: Array<{ entityId: string; chunkIndex: number; distance: number }> = []
    const table = this.#ensureSearchChunkVecTable(model, vector.length)
    if (table !== undefined) {
      try {
        // F6 P0-A1：vec0 KNN 无 project 分区键——超采样后在 hydrate 阶段按
        // search_documents.project_id 过滤（跨项目候选被丢弃，不泄漏给调用方）。
        const k = projectId === undefined ? Math.max(limit, 1) : Math.max(limit * 8, 32)
        const rows = this.#database.prepare(`
          SELECT chunk_key, distance FROM ${table}
          WHERE embedding MATCH ? AND k = ?
          ORDER BY distance
        `).all(JSON.stringify(vector), k) as Row[]
        candidates = rows.flatMap((row) => {
          const chunkKey = String(row.chunk_key)
          const separator = chunkKey.lastIndexOf('#c')
          if (separator <= 0) return []
          const entityId = chunkKey.slice(0, separator)
          const chunkIndex = Number(chunkKey.slice(separator + 2))
          if (entityId === '' || !Number.isInteger(chunkIndex)) return []
          return [{ entityId, chunkIndex, distance: Number(row.distance) }]
        })
      } catch {
        // vec0 查询失败 → fallback 线性扫描
        candidates = []
      }
    }
    if (candidates.length === 0) {
      try {
        // F6 P0-A1：fallback 线性扫描直接在 SQL 层 join search_documents 过滤 project。
        const rows = projectId === undefined
          ? this.#database.prepare(`
              SELECT c.entity_id, c.chunk_index, c.embedding_blob FROM search_document_chunks c
              WHERE c.model = ? AND c.embedding_blob IS NOT NULL
            `).all(model as SQLInputValue) as Row[]
          : this.#database.prepare(`
              SELECT c.entity_id, c.chunk_index, c.embedding_blob FROM search_document_chunks c
              JOIN search_documents d ON d.entity_id = c.entity_id
              WHERE c.model = ? AND c.embedding_blob IS NOT NULL AND d.project_id = ?
            `).all(model as SQLInputValue, projectId as SQLInputValue) as Row[]
        const scores = rows.map((row) => {
          const raw = Buffer.isBuffer(row.embedding_blob) ? row.embedding_blob : Buffer.from(String(row.embedding_blob ?? ''), 'base64')
          const otherF = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
          let dot = 0
          const length = Math.min(otherF.length, vector.length)
          for (let index = 0; index < length; index += 1) dot += otherF[index]! * vector[index]!
          return { entityId: String(row.entity_id), chunkIndex: Number(row.chunk_index), distance: -dot }
        })
        candidates = scores.sort((left, right) => left.distance - right.distance).slice(0, limit)
      } catch {
        return []
      }
    }
    const hydrate = this.#database.prepare(`
      SELECT c.chunk_count, c.chunk_anchor, c.chunk_kind, c.chunk_text, d.title AS document_title, d.project_id AS document_project
      FROM search_document_chunks c LEFT JOIN search_documents d ON d.entity_id = c.entity_id
      WHERE c.entity_id = ? AND c.model = ? AND c.chunk_index = ?
    `)
    const hits: Array<{
      entityId: string
      distance: number
      documentTitle?: string
      chunkKind: 'title' | 'body'
      chunkAnchor?: string
      chunkIndex?: number
      chunkCount?: number
      chunkText: string
    }> = []
    for (const candidate of candidates) {
      const row = hydrate.get(candidate.entityId as SQLInputValue, model as SQLInputValue, candidate.chunkIndex as SQLInputValue) as Row | undefined
      if (row === undefined) continue // vec0 残留行（块已删除）静默过滤
      // F6 P0-A1：KNN 超采样候选在 hydrate 处按 project 过滤（fallback 路径已滤，此处幂等）。
      if (projectId !== undefined && String(row.document_project ?? '') !== projectId) continue
      const chunkKind: 'title' | 'body' = String(row.chunk_kind) === 'title' ? 'title' : 'body'
      hits.push({
        entityId: candidate.entityId,
        distance: candidate.distance,
        ...(row.document_title === undefined || row.document_title === null ? {} : { documentTitle: String(row.document_title) }),
        chunkKind,
        ...(chunkKind === 'body' ? {
          chunkAnchor: String(row.chunk_anchor),
          chunkIndex: candidate.chunkIndex,
          chunkCount: Number(row.chunk_count),
        } : {}),
        chunkText: String(row.chunk_text),
      })
      if (hits.length >= limit) break // 超采样 + project 过滤后截断
    }
    return hits
  }

  #projectIdForSearchDocument(entityId: string): string {
    const row = this.#database.prepare('SELECT project_id FROM search_documents WHERE entity_id = ?').get(entityId as SQLInputValue) as { project_id?: string } | undefined
    return row?.project_id !== undefined ? String(row.project_id) : ''
  }

  // ==================== OCR evidence（F6 P0-A3，20260828） ====================

  /** 读取 artifact 的 OCR 文本证据；未跑过 = undefined（诚实缺席，不猜文件名）。 */
  getOcrEvidenceText(projectId: string, artifactId: string): string | undefined {
    const row = this.#database.prepare('SELECT text FROM ocr_evidence WHERE project_id = ? AND artifact_id = ?')
      .get(projectId as SQLInputValue, artifactId as SQLInputValue) as { text?: string } | undefined
    return row === undefined ? undefined : String(row.text)
  }

  /** 写入/覆盖 OCR evidence（同一 artifact 重跑 = 覆盖；artifact 不存在时拒绝）。 */
  saveOcrEvidence(input: {
    readonly projectId: string
    readonly artifactId: string
    readonly text: string
    readonly engine: string
    readonly durationMs: number
  }): void {
    if (this.getArtifact(input.artifactId) === undefined) throw new Error('Artifact not found for OCR evidence.')
    this.#database.prepare(`
      INSERT INTO ocr_evidence (project_id, artifact_id, text, engine, duration_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, artifact_id) DO UPDATE SET
        text = excluded.text, engine = excluded.engine,
        duration_ms = excluded.duration_ms, created_at = excluded.created_at
    `).run(
      input.projectId as SQLInputValue,
      input.artifactId as SQLInputValue,
      input.text as SQLInputValue,
      input.engine as SQLInputValue,
      input.durationMs as SQLInputValue,
      new Date().toISOString() as SQLInputValue,
    )
  }

  // ==================== F6 P1（20260828）：ProjectVisualProfile CRUD + Project Summary 聚合 ====================

  getProjectVisualProfile(projectId: string): import('@local-creative-os/contracts').ProjectVisualProfileV0 | undefined {
    const row = this.#database.prepare('SELECT * FROM project_visual_profiles WHERE project_id = ?').get(projectId as SQLInputValue) as Row | undefined
    if (row === undefined) return undefined
    return {
      schemaVersion: 0,
      projectId: String(row.project_id),
      version: Number(row.version),
      tintToken: String(row.tint) as import('@local-creative-os/contracts').ProjectTintToken,
      glythMarkId: String(row.glyth_mark_id) as import('@local-creative-os/contracts').ProjectGlyphMarkId,
      ...(row.glyth_mark_color ? { glythMarkColor: String(row.glyth_mark_color) } : {}),
      ...(row.scale === null || row.scale === undefined ? {} : { scale: Number(row.scale) }),
      ...(row.orientation === null || row.orientation === undefined ? {} : { orientation: Number(row.orientation) }),
      updatedAt: String(row.updated_at),
    }
  }

  /** CAS upsert：expectedVersion 不匹配抛 StaleVisualProfileVersionError（路由层转 409）。 */
  upsertProjectVisualProfile(input: {
    readonly projectId: string
    readonly expectedVersion: number
    readonly tintToken: import('@local-creative-os/contracts').ProjectTintToken
    readonly glythMarkId: import('@local-creative-os/contracts').ProjectGlyphMarkId
    readonly glythMarkColor?: string
    readonly scale?: number
    readonly orientation?: number
  }): import('@local-creative-os/contracts').ProjectVisualProfileV0 {
    const current = this.getProjectVisualProfile(input.projectId)
    if (current !== undefined && current.version !== input.expectedVersion) {
      throw new StaleVisualProfileVersionError(current.version, input.expectedVersion)
    }
    if (current === undefined && input.expectedVersion !== 0) {
      throw new StaleVisualProfileVersionError(0, input.expectedVersion)
    }
    const now = new Date().toISOString()
    const nextVersion = input.expectedVersion + 1
    this.#database.prepare(`
      INSERT INTO project_visual_profiles (project_id, version, tint, glyth_mark_id, glyth_mark_color, scale, orientation, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        version = excluded.version, tint = excluded.tint, glyth_mark_id = excluded.glyth_mark_id,
        glyth_mark_color = excluded.glyth_mark_color, scale = excluded.scale, orientation = excluded.orientation,
        updated_at = excluded.updated_at
    `).run(
      input.projectId as SQLInputValue, nextVersion as SQLInputValue, input.tintToken as SQLInputValue,
      input.glythMarkId as SQLInputValue, (input.glythMarkColor ?? null) as SQLInputValue,
      (input.scale ?? null) as SQLInputValue, (input.orientation ?? null) as SQLInputValue, now as SQLInputValue,
    )
    return this.getProjectVisualProfile(input.projectId)!
  }

  /**
   * F6 P1-A1：lastMeaningfulEditedAt——Core mutation 活动（artifacts/runs/notes/project 的
   * max(updated_at)），与 last_opened_at 完全无关。无任何活动行 = undefined（诚实缺席）。
   */
  // 口径纪律：只算 mutation 活动（artifacts/runs/notes）。projects.updated_at 不参与——
  // touchProjectOpened 也会刷它（open 不是 mutation，混入会污染口径，测试已证）。
  lastMeaningfulEditedAt(projectId: string): string | undefined {
    const row = this.#database.prepare(`
      SELECT MAX(ts) AS latest FROM (
        SELECT MAX(updated_at) AS ts FROM artifacts WHERE project_id = ?
        UNION ALL SELECT MAX(updated_at) AS ts FROM runs WHERE project_id = ?
        UNION ALL SELECT MAX(updated_at) AS ts FROM notes WHERE project_id = ?
      )
    `).get(projectId as SQLInputValue, projectId as SQLInputValue, projectId as SQLInputValue) as { latest?: string | null } | undefined
    return row?.latest === undefined || row.latest === null || row.latest === '' ? undefined : String(row.latest)
  }
  // ==================== F6 P0-D：ResultSlot CRUD + Run Composer 列（20260828） ====================

  #resultSlotFromRow(row: Row): import('@local-creative-os/contracts').ResultSlotV0 {
    return {
      schemaVersion: 0,
      id: String(row.id),
      projectId: String(row.project_id),
      scopeId: String(row.scope_id),
      ...(row.workspace_id ? { workspaceId: String(row.workspace_id) } : {}),
      position: { x: Number(row.x), y: Number(row.y) },
      ...(row.width === null || row.width === undefined ? {} : { size: { width: Number(row.width), height: Number(row.height) } }),
      status: String(row.status) as import('@local-creative-os/contracts').ResultSlotV0['status'],
      ...(row.artifact_view_id ? { artifactViewId: String(row.artifact_view_id) } : {}),
      ...(row.artifact_id ? { artifactId: String(row.artifact_id) } : {}),
      ...(row.run_id ? { runId: String(row.run_id) } : {}),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }
  }

  createResultSlot(slot: import('@local-creative-os/contracts').ResultSlotV0): void {
    this.#database.prepare(`
      INSERT INTO result_slots (id, project_id, scope_id, workspace_id, x, y, width, height, status, artifact_view_id, artifact_id, run_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      slot.id as SQLInputValue, slot.projectId as SQLInputValue, slot.scopeId as SQLInputValue,
      (slot.workspaceId ?? null) as SQLInputValue, slot.position.x as SQLInputValue, slot.position.y as SQLInputValue,
      (slot.size?.width ?? null) as SQLInputValue, (slot.size?.height ?? null) as SQLInputValue,
      slot.status as SQLInputValue, (slot.artifactViewId ?? null) as SQLInputValue, (slot.artifactId ?? null) as SQLInputValue,
      (slot.runId ?? null) as SQLInputValue, slot.createdAt as SQLInputValue, slot.updatedAt as SQLInputValue,
    )
  }

  getResultSlot(slotId: string): import('@local-creative-os/contracts').ResultSlotV0 | undefined {
    const row = this.#database.prepare('SELECT * FROM result_slots WHERE id = ?').get(slotId as SQLInputValue) as Row | undefined
    return row === undefined ? undefined : this.#resultSlotFromRow(row)
  }

  listResultSlots(projectId: string): readonly import('@local-creative-os/contracts').ResultSlotV0[] {
    return (this.#database.prepare('SELECT * FROM result_slots WHERE project_id = ? ORDER BY created_at DESC').all(projectId as SQLInputValue) as Row[])
      .map((row) => this.#resultSlotFromRow(row))
  }

  getResultSlotByRun(runId: string): import('@local-creative-os/contracts').ResultSlotV0 | undefined {
    const row = this.#database.prepare('SELECT * FROM result_slots WHERE run_id = ? ORDER BY created_at DESC LIMIT 1').get(runId as SQLInputValue) as Row | undefined
    return row === undefined ? undefined : this.#resultSlotFromRow(row)
  }

  updateResultSlot(slotId: string, patch: {
    readonly status?: import('@local-creative-os/contracts').ResultSlotV0['status']
    readonly artifactId?: string | undefined
    readonly artifactViewId?: string | undefined
    readonly runId?: string | undefined
  }): import('@local-creative-os/contracts').ResultSlotV0 {
    const current = this.getResultSlot(slotId)
    if (current === undefined) throw new Error('Result slot not found.')
    // F6 B6：显式 undefined（'artifactId' in patch）= 清空该列；键缺失 = 保留现值。
    const next = {
      ...current,
      ...(patch.status === undefined ? {} : { status: patch.status }),
      ...('artifactId' in patch ? { artifactId: patch.artifactId } : {}),
      ...('artifactViewId' in patch ? { artifactViewId: patch.artifactViewId } : {}),
      ...('runId' in patch ? { runId: patch.runId } : {}),
      updatedAt: new Date().toISOString(),
    }
    this.#database.prepare(`
      UPDATE result_slots SET status = ?, artifact_view_id = ?, artifact_id = ?, run_id = ?, updated_at = ?
      WHERE id = ?
    `).run(
      next.status as SQLInputValue, (next.artifactViewId ?? null) as SQLInputValue, (next.artifactId ?? null) as SQLInputValue,
      (next.runId ?? null) as SQLInputValue, next.updatedAt as SQLInputValue, slotId as SQLInputValue,
    )
    return this.getResultSlot(slotId)!
  }

  deleteResultSlot(slotId: string): void {
    const result = this.#database.prepare('DELETE FROM result_slots WHERE id = ?').run(slotId as SQLInputValue)
    if (result.changes !== 1) throw new Error('Result slot not found.')
  }

  /** Run 的 Composer 三列（receiver / ordered refs / result slot）——domain Run 类型不扩，独立读面。 */
  getRunReceiverConversationId(runId: string): string | undefined {
    const row = this.#database.prepare('SELECT receiver_conversation_id FROM runs WHERE id = ?').get(runId as SQLInputValue) as { receiver_conversation_id?: string | null } | undefined
    return row?.receiver_conversation_id === undefined || row.receiver_conversation_id === null ? undefined : String(row.receiver_conversation_id)
  }

  getRunOrderedReferences(runId: string): readonly import('@local-creative-os/contracts').OrderedRunReferenceV2[] {
    const row = this.#database.prepare('SELECT ordered_references_json FROM runs WHERE id = ?').get(runId as SQLInputValue) as { ordered_references_json?: string | null } | undefined
    if (row?.ordered_references_json === undefined || row.ordered_references_json === null) return []
    try {
      const parsed = JSON.parse(row.ordered_references_json) as unknown
      return Array.isArray(parsed) ? parsed as import('@local-creative-os/contracts').OrderedRunReferenceV2[] : []
    } catch {
      return []
    }
  }

  getRunResultSlotId(runId: string): string | undefined {
    const row = this.#database.prepare('SELECT result_slot_id FROM runs WHERE id = ?').get(runId as SQLInputValue) as { result_slot_id?: string | null } | undefined
    return row?.result_slot_id === undefined || row.result_slot_id === null ? undefined : String(row.result_slot_id)
  }

  setRunComposerFields(runId: string, patch: {
    readonly receiverConversationId?: string
    readonly orderedReferencesJson?: string
    readonly resultSlotId?: string
  }): void {
    const result = this.#database.prepare(`
      UPDATE runs SET
        receiver_conversation_id = COALESCE(?, receiver_conversation_id),
        ordered_references_json = COALESCE(?, ordered_references_json),
        result_slot_id = COALESCE(?, result_slot_id),
        updated_at = ?
      WHERE id = ?
    `).run(
      (patch.receiverConversationId ?? null) as SQLInputValue,
      (patch.orderedReferencesJson ?? null) as SQLInputValue,
      (patch.resultSlotId ?? null) as SQLInputValue,
      new Date().toISOString() as SQLInputValue,
      runId as SQLInputValue,
    )
    if (result.changes !== 1) throw new Error('Run not found for composer fields.')
  }

  /** F6 P0-D3：conversation_file_references 读取（Reachability referenced 层数据源）。 */
  listArtifactIdsReferencedByConversation(conversationSessionId: string): readonly string[] {
    const rows = this.#database.prepare(`
      SELECT DISTINCT r.artifact_id FROM conversation_file_references r
      JOIN conversation_messages m ON m.id = r.message_id
      WHERE m.session_id = ?
    `).all(conversationSessionId as SQLInputValue) as Row[]
    return rows.map((row) => String(row.artifact_id))
  }
  searchDocumentsFts(projectId: string, query: string, limit: number): Array<{ readonly entityId: string; readonly title: string; readonly body: string }> {
    // FTS5 特殊语法字符全部剥离(含列过滤器的中括号):SKILL 指令等 markdown 文本含 [ ] 会触发 fts5 syntax error(2R 教工作流 E2E 实测修)
    const sanitized = query.replace(/["*^~():|&!\[\]-]/g, ' ').trim()
    if (sanitized === '') return []
    const rows = this.#database.prepare(`
      SELECT f.entity_id, f.title, f.body FROM search_documents_fts f
      WHERE f.project_id = ? AND search_documents_fts MATCH ?
      LIMIT ?
    `).all(projectId as SQLInputValue, sanitized, limit) as Row[]
    return rows.map((row) => ({ entityId: String(row.entity_id), title: String(row.title ?? ''), body: String(row.body) }))
  }

  loadVectorExtension(path: string): boolean {
    try {
      this.#database.loadExtension(path)
      this.#database.prepare('SELECT vec_version()').get()
      this.#vectorLoaded = true
      return true
    } catch {
      return false
    }
  }

  /** 启动时自动尝试加载 vec0（失败静默，query 走 fallback）。 */
  #tryLoadVectorExtension(): void {
    if (this.#vectorLoaded) return
    const repoRoot = process.env.LCOS_REPO_ROOT
    const candidate = process.env.LCOS_SQLITE_VEC_EXTENSION
      ?? (repoRoot === undefined ? undefined : join(resolve(repoRoot), '.runtime', 'sqlite-vec', process.platform === 'win32' ? 'vec0.dll' : process.platform === 'darwin' ? 'vec0.dylib' : 'vec0.so'))
    if (candidate === undefined) return
    if (!this.loadVectorExtension(candidate)) {
      this.#vectorLoadError = `sqlite-vec unavailable: ${candidate}`
    }
  }

  vectorStatus(): { readonly loaded: boolean; readonly error?: string } {
    return { loaded: this.#vectorLoaded, ...(this.#vectorLoadError === undefined ? {} : { error: this.#vectorLoadError }) }
  }

  #ensureSearchVecTable(model: string, dimensions: number): string | undefined {
    if (!this.#vectorLoaded || !Number.isInteger(dimensions) || dimensions <= 0 || dimensions > 4096) return undefined
    const key = createHash('sha256').update(`${model}:${dimensions}`).digest('hex').slice(0, 16)
    const table = `search_document_vec_${key}`
    try {
      this.#database.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS ${table} USING vec0(entity_id TEXT, project_id TEXT, embedding float[${dimensions}])`)
      return table
    } catch {
      this.#vectorLoadError = 'Failed to create search_document_vec table.'
      return undefined
    }
  }

  querySearchVectors(model: string, vector: readonly number[], limit: number): Array<{ readonly entityId: string; readonly distance: number }> {
    const table = this.#ensureSearchVecTable(model, vector.length)
    if (table !== undefined) {
      try {
        const rows = this.#database.prepare(`
          SELECT entity_id, distance FROM ${table}
          WHERE embedding MATCH ? AND k=?
          ORDER BY distance
        `).all(JSON.stringify(vector), Math.max(limit * 5, 50)) as Row[]
        return rows.slice(0, limit).map((row) => ({ entityId: String(row.entity_id), distance: Number(row.distance) }))
      } catch {
        // vec0 查询失败 → fallback 线性扫描
      }
    }
    try {
      const rows = this.#database.prepare(`
        SELECT e.entity_id, e.embedding_blob FROM search_document_embeddings e
        WHERE e.model = ?
      `).all(model) as Row[]
      const scores = rows.map((row) => {
        const raw = Buffer.isBuffer(row.embedding_blob) ? row.embedding_blob : Buffer.from(String(row.embedding_blob ?? ''), 'base64')
        const otherF = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
        let dot = 0
        const length = Math.min(otherF.length, vector.length)
        for (let index = 0; index < length; index += 1) dot += otherF[index]! * vector[index]!
        return { entityId: String(row.entity_id), distance: -dot }
      })
      return scores.sort((left, right) => left.distance - right.distance).slice(0, limit)
    } catch {
      return []
    }
  }

  getNotes(projectId: string): Note[] {
    return (this.#database.prepare('SELECT * FROM notes WHERE project_id = ?').all(projectId as SQLInputValue) as Row[]).map((r) => this.#note(r))
  }

  getNote(noteId: string): Note | undefined {
    const rows = this.#database.prepare('SELECT * FROM notes WHERE id = ?').all(noteId as SQLInputValue) as Row[]
    return rows.length ? this.#note(rows[0] as Row) : undefined
  }

  upsertNote(value: Note): void { this.#upsertNote(value) }
  deleteNote(noteId: string): void { this.#database.prepare('DELETE FROM notes WHERE id = ?').run(noteId as SQLInputValue) }

  getArtifactRevisions(artifactId: string): ArtifactRevision[] {
    return (this.#database.prepare('SELECT * FROM artifact_revisions WHERE artifact_id = ?').all(artifactId as SQLInputValue) as Row[]).map((r) => this.#artifactRevision(r))
  }

  getArtifactRevision(revisionId: string): ArtifactRevision | undefined {
    const rows = this.#database.prepare('SELECT * FROM artifact_revisions WHERE id = ?').all(revisionId as SQLInputValue) as Row[]
    return rows.length ? this.#artifactRevision(rows[0] as Row) : undefined
  }

  getCheckpoints(projectId: string): Checkpoint[] {
    return (this.#database.prepare('SELECT * FROM checkpoints WHERE project_id = ?').all(projectId as SQLInputValue) as Row[]).map((r) => this.#checkpoint(r))
  }

  getCheckpoint(checkpointId: string): Checkpoint | undefined {
    const rows = this.#database.prepare('SELECT * FROM checkpoints WHERE id = ?').all(checkpointId as SQLInputValue) as Row[]
    return rows.length ? this.#checkpoint(rows[0] as Row) : undefined
  }

  createCheckpoint(value: Checkpoint): void {
    if (this.getCheckpoint(String(value.id)) !== undefined) {
      throw new Error('Checkpoint is immutable and already exists.')
    }
    this.#upsertCheckpoint(value)
  }

  listWorkspaceStates(workspaceId: WorkspaceId): readonly Checkpoint[] {
    return (this.#database.prepare(
      'SELECT * FROM checkpoints WHERE workspace_id = ? ORDER BY created_at, id',
    ).all(workspaceId as SQLInputValue) as Row[]).map((row) => this.#checkpoint(row))
  }

  /** B6/C-early: session summary + handoff + optional session context update commit as one local transaction. */
  createContinuityReturnRecord(input: {
    readonly summary: SessionSummary
    readonly handoff: HandoffRecord
    readonly sessionContext?: {
      readonly sessionId: string
      readonly projectId: string
      readonly selectedViewIds: readonly string[]
      readonly retrievalEntityRefs: readonly string[]
      readonly sourceRefs: readonly { readonly sourceType: string; readonly sourceRef: string; readonly observedAt: string }[]
      readonly status: 'idle' | 'working' | 'blocked' | 'closed'
    }
  }): void {
    this.#database.exec('BEGIN IMMEDIATE;')
    try {
      this.createSessionSummary(input.summary)
      this.createHandoff(input.handoff)
      if (input.sessionContext !== undefined) this.upsertSessionContextRef(input.sessionContext)
      this.#database.exec('COMMIT;')
    } catch (error: unknown) {
      this.#database.exec('ROLLBACK;')
      throw error
    }
  }

  createSessionSummary(value: SessionSummary): SessionSummary {
    this.#database.prepare(`
      INSERT INTO session_summaries (id, project_id, title, summary, run_ids, handoff_ref, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      value.id,
      value.projectId as SQLInputValue,
      value.title,
      value.summary,
      JSON.stringify(value.runIds),
      value.handoffRef ?? null,
      value.createdAt,
      value.updatedAt,
    )
    return value
  }

  getSessionSummary(summaryId: string): SessionSummary | undefined {
    const row = this.#database.prepare('SELECT * FROM session_summaries WHERE id = ?').get(summaryId) as Row | undefined
    return row === undefined ? undefined : this.#sessionSummary(row)
  }

  listSessionSummaries(projectId: ProjectId): readonly SessionSummary[] {
    return (this.#database.prepare(
      'SELECT * FROM session_summaries WHERE project_id = ? ORDER BY created_at DESC, id DESC',
    ).all(projectId as SQLInputValue) as Row[]).map((row) => this.#sessionSummary(row))
  }

  createHandoff(value: HandoffRecord): HandoffRecord {
    this.#database.prepare(`
      INSERT INTO handoffs (id, project_id, title, resume_mode, from_provider, to_provider, session_summary_id, context_snapshot_id, decisions, open_questions, next_actions, artifact_refs, message_refs, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      value.id,
      value.projectId as SQLInputValue,
      value.title,
      value.resumeMode,
      value.fromProvider ?? null,
      value.toProvider ?? null,
      value.sessionSummaryId ?? null,
      value.contextSnapshotId ?? null,
      JSON.stringify(value.decisions),
      JSON.stringify(value.openQuestions),
      JSON.stringify(value.nextActions),
      JSON.stringify(value.artifactRefs),
      JSON.stringify(value.messageRefs),
      value.createdAt,
      value.updatedAt,
    )
    return value
  }

  getHandoff(handoffId: string): HandoffRecord | undefined {
    const row = this.#database.prepare('SELECT * FROM handoffs WHERE id = ?').get(handoffId) as Row | undefined
    return row === undefined ? undefined : this.#handoff(row)
  }

  listHandoffs(projectId: ProjectId): readonly HandoffRecord[] {
    return (this.#database.prepare(
      'SELECT * FROM handoffs WHERE project_id = ? ORDER BY created_at DESC, id DESC',
    ).all(projectId as SQLInputValue) as Row[]).map((row) => this.#handoff(row))
  }

  deleteHandoff(handoffId: string): boolean {
    const result = this.#database.prepare('DELETE FROM handoffs WHERE id = ?').run(handoffId)
    return Number(result.changes) > 0
  }

  // ==================== Curation Receipts (HU-1A) ====================

  saveCurationReceipt(receipt: CurationPatchReceiptV0, projectId: string): void {
    this.#database.prepare(`
      INSERT INTO curation_operation_receipts (operation_id, project_id, status, receipt_json, created_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(operation_id) DO UPDATE SET
        status = excluded.status,
        receipt_json = excluded.receipt_json,
        completed_at = excluded.completed_at
    `).run(
      receipt.operationId,
      projectId,
      receipt.applied ? 'applied' : receipt.failedStep !== undefined ? 'failed' : 'applied',
      JSON.stringify(receipt),
      receipt.createdAt,
      receipt.applied ? receipt.createdAt : null,
    )
  }

  getCurationReceipt(operationId: string): CurationPatchReceiptV0 | undefined {
    const row = this.#database.prepare('SELECT receipt_json FROM curation_operation_receipts WHERE operation_id = ?').get(operationId as SQLInputValue) as { receipt_json?: string } | undefined
    if (row === undefined || row.receipt_json === undefined) return undefined
    return JSON.parse(row.receipt_json) as CurationPatchReceiptV0
  }

  // ==================== Mutation Change Sets (HU-1B) ====================

  createMutationChangeSet(value: MutationChangeSetV1): void {
    this.#database.prepare(`
      INSERT INTO mutation_change_sets (id, project_id, operation_id, actor_kind, actor_id, changes_json, status, created_at, reverted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      value.id,
      value.projectId,
      value.operationId,
      value.actorKind,
      value.actorId ?? null,
      JSON.stringify(value.changes),
      value.status,
      value.createdAt,
      value.revertedAt ?? null,
    )
  }

  getMutationChangeSet(id: string): MutationChangeSetV1 | undefined {
    const row = this.#database.prepare('SELECT * FROM mutation_change_sets WHERE id = ?').get(id as SQLInputValue) as Row | undefined
    if (row === undefined) return undefined
    return {
      schemaVersion: 1,
      id: String(row.id),
      projectId: String(row.project_id),
      operationId: String(row.operation_id),
      actorKind: String(row.actor_kind) as MutationChangeSetV1['actorKind'],
      ...(row.actor_id ? { actorId: String(row.actor_id) } : {}),
      changes: JSON.parse(String(row.changes_json)) as MutationChangeItemV1[],
      status: String(row.status) as MutationChangeSetV1['status'],
      createdAt: String(row.created_at),
      ...(row.reverted_at ? { revertedAt: String(row.reverted_at) } : {}),
    }
  }

  markChangeSetReverted(id: string, revertedAt: string): boolean {
    const result = this.#database.prepare(
      'UPDATE mutation_change_sets SET status = ?, reverted_at = ? WHERE id = ? AND status = ?',
    ).run('reverted', revertedAt, id as SQLInputValue, 'applied')
    return result.changes === 1
  }

  markChangeSetApplied(id: string): boolean {
    const result = this.#database.prepare(
      'UPDATE mutation_change_sets SET status = ?, reverted_at = NULL WHERE id = ? AND status = ?',
    ).run('applied', id as SQLInputValue, 'reverted')
    return result.changes === 1
  }

  listMutationChangeSets(projectId: string, limit = 50): MutationChangeSetV1[] {
    const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit)))
    const rows = this.#database.prepare(
      'SELECT * FROM mutation_change_sets WHERE project_id = ? ORDER BY created_at DESC LIMIT ?',
    ).all(projectId as SQLInputValue, safeLimit) as Row[]
    return rows.map((row) => ({
      schemaVersion: 1,
      id: String(row.id),
      projectId: String(row.project_id),
      operationId: String(row.operation_id),
      actorKind: String(row.actor_kind) as MutationChangeSetV1['actorKind'],
      ...(row.actor_id ? { actorId: String(row.actor_id) } : {}),
      changes: JSON.parse(String(row.changes_json)) as MutationChangeItemV1[],
      status: String(row.status) as MutationChangeSetV1['status'],
      createdAt: String(row.created_at),
      ...(row.reverted_at ? { revertedAt: String(row.reverted_at) } : {}),
    }))
  }

  // ==================== Capture Space Presentation (0.1) ====================

  getCaptureSpacePresentation(): CaptureSpacePresentationV1 {
    const row = this.#database.prepare('SELECT version, presentation_json, updated_at FROM capture_space_presentation WHERE id = ?').get('global') as Row | undefined
    if (row === undefined) {
      return { schemaVersion: 1, version: 0, views: [], regions: [], updatedAt: new Date(0).toISOString() }
    }
    const parsed = JSON.parse(String(row.presentation_json)) as Omit<CaptureSpacePresentationV1, 'version' | 'updatedAt'>
    return { ...parsed, schemaVersion: 1, version: Number(row.version), updatedAt: String(row.updated_at) }
  }

  saveCaptureSpacePresentation(input: Omit<CaptureSpacePresentationV1, 'version' | 'updatedAt'>, expectedVersion?: number): CaptureSpacePresentationV1 {
    const current = this.getCaptureSpacePresentation()
    if (expectedVersion !== undefined && current.version !== expectedVersion) {
      throw new Error(`Capture Space presentation version conflict: expected ${expectedVersion}, got ${current.version}.`)
    }
    const next: CaptureSpacePresentationV1 = { ...input, schemaVersion: 1, version: current.version + 1, updatedAt: new Date().toISOString() }
    this.#database.prepare(`
      INSERT INTO capture_space_presentation (id, version, presentation_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET version = excluded.version, presentation_json = excluded.presentation_json, updated_at = excluded.updated_at
    `).run('global', next.version, JSON.stringify({ schemaVersion: 1, views: next.views, regions: next.regions }), next.updatedAt)
    return next
  }

  // ==================== Capture Staging Buffer (Phase B) ====================

  createCaptureStagingItem(item: CaptureStagingItemV0): void {
    this.#database.prepare(`
      INSERT INTO capture_staging_items (
        id, operation_id, kind, payload_ref, source_json, suggested_projects_json,
        semantic_hint_json, captured_at, resolved_project_id, resolved_at, resolved_artifact_id, resolved_view_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      item.id as SQLInputValue,
      item.operationId,
      item.kind,
      item.payloadRef,
      JSON.stringify(item.source),
      JSON.stringify(item.suggestedProjects),
      item.semanticHint === undefined ? null : JSON.stringify(item.semanticHint),
      item.capturedAt,
      item.resolvedProjectId ?? null,
      item.resolvedAt ?? null,
      item.resolvedArtifactId ?? null,
      item.resolvedViewId ?? null,
    )
  }

  listCaptureStagingItems(sinceIso: string, limit = 50): CaptureStagingItemV0[] {
    const rows = this.#database.prepare(
      'SELECT * FROM capture_staging_items WHERE captured_at >= ? ORDER BY captured_at DESC LIMIT ?',
    ).all(sinceIso as SQLInputValue, limit) as Row[]
    return rows.map((row) => this.#captureStagingItem(row as Row))
  }

  listPendingCaptureStagingItems(limit = 500): CaptureStagingItemV0[] {
    const safeLimit = Math.max(1, Math.min(2000, Math.trunc(limit)))
    const rows = this.#database.prepare(
      'SELECT * FROM capture_staging_items WHERE resolved_project_id IS NULL ORDER BY captured_at DESC LIMIT ?',
    ).all(safeLimit) as Row[]
    return rows.map((row) => this.#captureStagingItem(row as Row))
  }

  getCaptureStagingItem(id: string): CaptureStagingItemV0 | undefined {
    const row = this.#database.prepare('SELECT * FROM capture_staging_items WHERE id = ?').get(id as SQLInputValue) as Row | undefined
    return row === undefined ? undefined : this.#captureStagingItem(row)
  }

  /**
   * F6 B6（P0-D）：Capture staging 真分页——SQL 级 pendingOnly/search/kind/sourceDomain
   * + LIMIT/OFFSET（排序 captured_at DESC + id ASC 稳定序），不再"先截 50 再分页"。
   */
  queryCaptureStagingItems(input: {
    readonly pendingOnly?: boolean
    readonly search?: string
    readonly kind?: string
    readonly sourceDomain?: string
    readonly cursor?: number
    readonly limit?: number
  }): CaptureStagingItemV0[] {
    const conditions: string[] = []
    const params: SQLInputValue[] = []
    if (input.pendingOnly !== false) { conditions.push('resolved_project_id IS NULL') }
    if (input.kind !== undefined && input.kind !== '') { conditions.push('kind = ?'); params.push(input.kind) }
    const like = (needle: string): string => `%${needle}%`
    if (input.search !== undefined && input.search.trim() !== '') {
      const needle = input.search.trim()
      conditions.push('(operation_id LIKE ? OR payload_ref LIKE ? OR source_json LIKE ?)')
      params.push(like(needle), like(needle), like(needle))
    }
    if (input.sourceDomain !== undefined && input.sourceDomain.trim() !== '') {
      conditions.push('source_json LIKE ?')
      params.push(like(input.sourceDomain.trim()))
    }
    const limit = Math.max(1, Math.min(500, Math.trunc(input.limit ?? 50)))
    const offset = Math.max(0, Math.trunc(input.cursor ?? 0))
    const sql = `SELECT * FROM capture_staging_items ${conditions.length === 0 ? '' : 'WHERE ' + conditions.join(' AND ')} ORDER BY captured_at DESC, id ASC LIMIT ? OFFSET ?`
    const rows = this.#database.prepare(sql).all(...params, limit as SQLInputValue, offset as SQLInputValue) as Row[]
    return rows.map((row) => this.#captureStagingItem(row as Row))
  }

  countPendingCaptureStagingItems(): number {
    const row = this.#database.prepare(
      'SELECT COUNT(*) AS count FROM capture_staging_items WHERE resolved_project_id IS NULL',
    ).get() as { count: number }
    return Number(row.count)
  }

  resolveCaptureStagingItem(id: string, projectId: string, resolvedAt: string, resolvedArtifactId?: string, resolvedViewId?: string): boolean {
    const result = this.#database.prepare(
      'UPDATE capture_staging_items SET resolved_project_id = ?, resolved_at = ?, resolved_artifact_id = ?, resolved_view_id = ? WHERE id = ? AND resolved_project_id IS NULL',
    ).run(projectId, resolvedAt, resolvedArtifactId ?? null, resolvedViewId ?? null, id as SQLInputValue)
    return result.changes === 1
  }

  getCaptureReceipt(operationId: string): CaptureReceiptV0 | undefined {
    const row = this.#database.prepare('SELECT receipt_json FROM capture_receipts WHERE operation_id = ?').get(operationId as SQLInputValue) as { receipt_json?: string } | undefined
    if (row === undefined || row.receipt_json === undefined) return undefined
    return JSON.parse(row.receipt_json) as CaptureReceiptV0
  }

  saveCaptureReceipt(receipt: CaptureReceiptV0): void {
    this.#database.prepare(`
      INSERT INTO capture_receipts (operation_id, receipt_json, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(operation_id) DO UPDATE SET receipt_json = excluded.receipt_json
    `).run(receipt.operationId, JSON.stringify(receipt), new Date().toISOString())
  }

  listCaptureWatchRules(): CaptureWatchRuleV0[] {
    const rows = this.#database.prepare('SELECT * FROM capture_watch_rules ORDER BY created_at, id').all() as Row[]
    return rows.map((row) => ({
      id: String(row.id),
      path: String(row.path),
      patterns: JSON.parse(String(row.patterns_json)) as string[],
      ...(row.project_hint ? { projectHint: String(row.project_hint) } : {}),
      settleMs: Number(row.settle_ms ?? 750),
      enabled: Number(row.enabled) === 1,
    }))
  }

  upsertCaptureWatchRule(rule: CaptureWatchRuleV0): void {
    this.#database.prepare(`
      INSERT INTO capture_watch_rules (id, path, patterns_json, project_hint, settle_ms, enabled, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        path = excluded.path,
        patterns_json = excluded.patterns_json,
        project_hint = excluded.project_hint,
        settle_ms = excluded.settle_ms,
        enabled = excluded.enabled
    `).run(
      rule.id,
      rule.path,
      JSON.stringify(rule.patterns),
      rule.projectHint ?? null,
      rule.settleMs,
      rule.enabled ? 1 : 0,
      new Date().toISOString(),
    )
  }

  deleteCaptureWatchRule(id: string): boolean {
    const result = this.#database.prepare('DELETE FROM capture_watch_rules WHERE id = ?').run(id)
    return Number(result.changes) > 0
  }

  createReorganizeProposal(proposal: ReorganizeProposalV0, snapshotJson: string): void {
    this.#database.prepare(`
      INSERT INTO reorganize_proposals (id, project_id, proposal_json, snapshot_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      proposal.id,
      proposal.projectId,
      JSON.stringify(proposal),
      snapshotJson,
      proposal.status,
      proposal.createdAt,
      proposal.createdAt,
    )
  }

  getReorganizeProposal(id: string): { readonly proposal: ReorganizeProposalV0; readonly snapshotJson: string | undefined; readonly changeSetId: string | undefined } | undefined {
    const row = this.#database.prepare('SELECT proposal_json, snapshot_json, status, change_set_id FROM reorganize_proposals WHERE id = ?').get(id as SQLInputValue) as { proposal_json?: string; snapshot_json?: string; status?: string; change_set_id?: string | null } | undefined
    if (row === undefined || row.proposal_json === undefined) return undefined
    const parsed = JSON.parse(row.proposal_json) as ReorganizeProposalV0
    const proposal = row.status !== undefined && row.status !== parsed.status
      ? { ...parsed, status: row.status as ReorganizeProposalV0['status'] }
      : parsed
    return {
      proposal,
      snapshotJson: row.snapshot_json ?? undefined,
      changeSetId: row.change_set_id ?? undefined,
    }
  }

  updateReorganizeProposalStatus(id: string, status: ReorganizeProposalV0['status']): void {
    this.#database.prepare(
      'UPDATE reorganize_proposals SET status = ?, updated_at = ? WHERE id = ?',
    ).run(status, new Date().toISOString(), id as SQLInputValue)
  }

  updateReorganizeProposalChangeSet(id: string, changeSetId: string): void {
    this.#database.prepare(
      'UPDATE reorganize_proposals SET change_set_id = ?, updated_at = ? WHERE id = ?',
    ).run(changeSetId, new Date().toISOString(), id as SQLInputValue)
  }

  listReorganizeProposals(projectId: string): ReorganizeProposalV0[] {
    const rows = this.#database.prepare(
      'SELECT proposal_json, status FROM reorganize_proposals WHERE project_id = ? ORDER BY created_at DESC LIMIT 20',
    ).all(projectId as SQLInputValue) as Array<Row & { status?: string }>
    return rows.map((row) => {
      const parsed = JSON.parse(String(row.proposal_json)) as ReorganizeProposalV0
      return row.status !== undefined && row.status !== parsed.status
        ? { ...parsed, status: row.status as ReorganizeProposalV0['status'] }
        : parsed
    })
  }

  // ==================== Session Context Continuity (Phase G) ====================

  upsertSessionContextRef(value: {
    readonly sessionId: string
    readonly projectId: string
    readonly selectedViewIds: readonly string[]
    readonly retrievalEntityRefs: readonly string[]
    readonly sourceRefs: readonly { readonly sourceType: string; readonly sourceRef: string; readonly observedAt: string }[]
    readonly status: 'idle' | 'working' | 'blocked' | 'closed'
  }): void {
    const now = new Date().toISOString()
    this.#database.prepare(`
      INSERT INTO session_context_refs (session_id, project_id, selected_view_ids, retrieval_entity_refs, source_refs_json, status, created_at, updated_at, closed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        project_id = excluded.project_id,
        selected_view_ids = excluded.selected_view_ids,
        retrieval_entity_refs = excluded.retrieval_entity_refs,
        source_refs_json = excluded.source_refs_json,
        status = excluded.status,
        updated_at = excluded.updated_at,
        closed_at = excluded.closed_at
    `).run(
      value.sessionId,
      value.projectId,
      JSON.stringify(value.selectedViewIds),
      JSON.stringify(value.retrievalEntityRefs),
      JSON.stringify(value.sourceRefs),
      value.status,
      now,
      now,
      value.status === 'closed' ? now : null,
    )
  }

  getSessionContextRef(sessionId: string): {
    readonly sessionId: string
    readonly projectId: string
    readonly selectedViewIds: readonly string[]
    readonly retrievalEntityRefs: readonly string[]
    readonly sourceRefs: readonly { readonly sourceType: string; readonly sourceRef: string; readonly observedAt: string }[]
    readonly status: string
    readonly updatedAt: string
  } | undefined {
    const row = this.#database.prepare('SELECT * FROM session_context_refs WHERE session_id = ?').get(sessionId as SQLInputValue) as Row | undefined
    if (row === undefined) return undefined
    return {
      sessionId: String(row.session_id),
      projectId: String(row.project_id),
      selectedViewIds: JSON.parse(String(row.selected_view_ids)) as string[],
      retrievalEntityRefs: JSON.parse(String(row.retrieval_entity_refs)) as string[],
      sourceRefs: JSON.parse(String(row.source_refs_json)) as { readonly sourceType: string; readonly sourceRef: string; readonly observedAt: string }[],
      status: String(row.status),
      updatedAt: String(row.updated_at),
    }
  }

  listSessionContextRefs(projectId: string): Array<{ readonly sessionId: string; readonly status: string; readonly updatedAt: string }> {
    const rows = this.#database.prepare(
      'SELECT session_id, status, updated_at FROM session_context_refs WHERE project_id = ? ORDER BY updated_at DESC LIMIT 50',
    ).all(projectId as SQLInputValue) as Row[]
    return rows.map((row) => ({ sessionId: String(row.session_id), status: String(row.status), updatedAt: String(row.updated_at) }))
  }

  #captureStagingItem(row: Row): CaptureStagingItemV0 {
    return {
      id: String(row.id),
      operationId: String(row.operation_id),
      kind: String(row.kind),
      payloadRef: String(row.payload_ref),
      source: JSON.parse(String(row.source_json)) as Record<string, unknown>,
      suggestedProjects: JSON.parse(String(row.suggested_projects_json)) as CaptureStagingItemV0['suggestedProjects'],
      ...(row.semantic_hint_json === null || row.semantic_hint_json === undefined ? {} : { semanticHint: JSON.parse(String(row.semantic_hint_json)) as NonNullable<CaptureStagingItemV0['semanticHint']> }),
      capturedAt: String(row.captured_at),
      ...(row.resolved_project_id ? { resolvedProjectId: String(row.resolved_project_id) } : {}),
      ...(row.resolved_at ? { resolvedAt: String(row.resolved_at) } : {}),
      ...(row.resolved_artifact_id ? { resolvedArtifactId: String(row.resolved_artifact_id) } : {}),
      ...(row.resolved_view_id ? { resolvedViewId: String(row.resolved_view_id) } : {}),
    }
  }

  getFileRecords(projectId: string): FileRecord[] {
    return (this.#database.prepare('SELECT * FROM file_records WHERE project_id = ?').all(projectId as SQLInputValue) as Row[])
      .map((row) => this.#fileRecord(row))
  }

  getFileRecord(fileRecordId: string): FileRecord | undefined {
    const row = this.#database.prepare('SELECT * FROM file_records WHERE id = ?').get(fileRecordId as SQLInputValue) as Row | undefined
    return row === undefined ? undefined : this.#fileRecord(row)
  }

  upsertFileRecord(value: FileRecord): void { this.#upsertFileRecord(value) }

  getPreviewRecords(projectId: string): PreviewRecord[] {
    return (this.#database.prepare('SELECT * FROM preview_records WHERE project_id = ?').all(projectId as SQLInputValue) as Row[])
      .map((row) => this.#previewRecord(row))
  }

  getPreviewRecordByCacheKey(cacheKey: string): PreviewRecord | undefined {
    const row = this.#database.prepare('SELECT * FROM preview_records WHERE cache_key = ?').get(cacheKey) as Row | undefined
    return row === undefined ? undefined : this.#previewRecord(row)
  }

  getArtifactViewsByProject(projectId: string): ArtifactView[] {
    return (this.#database.prepare(`
      SELECT artifact_views.*
      FROM artifact_views
      JOIN artifacts ON artifacts.id = artifact_views.artifact_id
      WHERE artifacts.project_id = ?
      ORDER BY artifact_views.id
    `).all(projectId as SQLInputValue) as Row[]).map((r) => this.#artifactView(r))
  }

  getPreviewRecord(previewRecordId: string): PreviewRecord | undefined {
    const row = this.#database.prepare('SELECT * FROM preview_records WHERE id = ?').get(previewRecordId as SQLInputValue) as Row | undefined
    return row === undefined ? undefined : this.#previewRecord(row)
  }

  upsertPreviewRecord(value: PreviewRecord): void { this.#upsertPreviewRecord(value) }

  deletePreviewRecords(projectId: string): void {
    this.#database.prepare('DELETE FROM preview_records WHERE project_id = ?').run(projectId as SQLInputValue)
  }

  // ==================== Resource Descriptors (Universal Resource Import, v7) ====================

  createResourceDescriptorPending(descriptor: ResourceDescriptorV0): void {
    this.#insertResourceDescriptor(descriptor)
  }

  replaceResourceDescriptor(descriptor: ResourceDescriptorV0): void {
    this.#database.exec('BEGIN IMMEDIATE;')
    try {
      this.#database.prepare(
        'DELETE FROM resource_descriptors WHERE artifact_id = ? AND source_revision_id = ?',
      ).run(
        String(descriptor.artifactId) as SQLInputValue,
        String(descriptor.sourceRevisionId) as SQLInputValue,
      )
      this.#insertResourceDescriptor(descriptor)
      this.#database.exec('COMMIT;')
    } catch (error: unknown) {
      this.#database.exec('ROLLBACK;')
      throw error
    }
  }

  getResourceDescriptorForRevision(
    artifactId: string,
    sourceRevisionId: string,
    analyzerVersion?: string,
  ): ResourceDescriptorV0 | undefined {
    const rows = analyzerVersion === undefined
      ? this.#database.prepare(
        'SELECT * FROM resource_descriptors WHERE artifact_id = ? AND source_revision_id = ? ORDER BY updated_at DESC LIMIT 1',
      ).all(artifactId as SQLInputValue, sourceRevisionId as SQLInputValue) as Row[]
      : this.#database.prepare(
        'SELECT * FROM resource_descriptors WHERE artifact_id = ? AND source_revision_id = ? AND analyzer_version = ?',
      ).all(artifactId as SQLInputValue, sourceRevisionId as SQLInputValue, analyzerVersion as SQLInputValue) as Row[]
    return rows.length === 0 ? undefined : this.#resourceDescriptorRow(rows[0] as Row)
  }

  getResourceDescriptorByResourceId(projectId: string, resourceId: string): ResourceDescriptorV0 | undefined {
    const rows = this.#database.prepare(
      'SELECT * FROM resource_descriptors WHERE project_id = ? AND resource_id = ? ORDER BY updated_at DESC LIMIT 1',
    ).all(projectId as SQLInputValue, resourceId as SQLInputValue) as Row[]
    return rows.length === 0 ? undefined : this.#resourceDescriptorRow(rows[0] as Row)
  }

  listResourceDescriptors(projectId: string): ResourceDescriptorV0[] {
    return (this.#database.prepare(
      'SELECT * FROM resource_descriptors WHERE project_id = ? ORDER BY updated_at DESC',
    ).all(projectId as SQLInputValue) as Row[]).map((row) => this.#resourceDescriptorRow(row))
  }

  markResourceDescriptorFailed(id: string, warnings: readonly string[], analyzerVersion: string): void {
    const row = this.#database.prepare('SELECT * FROM resource_descriptors WHERE id = ?').get(id as SQLInputValue) as Row | undefined
    if (row === undefined) return
    const parsed = this.#resourceDescriptorRow(row)
    this.#database.prepare(
      'UPDATE resource_descriptors SET status = ?, analyzer_version = ?, descriptor_json = ?, updated_at = ? WHERE id = ?',
    ).run(
      'failed' as SQLInputValue,
      analyzerVersion as SQLInputValue,
      JSON.stringify({ ...parsed, understanding: { ...parsed.understanding, status: 'failed', warnings: [...warnings] } }) as SQLInputValue,
      new Date().toISOString() as SQLInputValue,
      id as SQLInputValue,
    )
  }

  enqueueResourceAnalysis(input: {
    readonly id: string
    readonly projectId: string
    readonly resourceId: string
    readonly sourceRevisionId: string
    readonly analyzerVersion: string
  }): void {
    const now = new Date().toISOString()
    this.#database.prepare(`
      INSERT INTO resource_analysis_jobs (
        id, project_id, resource_id, source_revision_id, analyzer_version,
        status, attempt_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)
      ON CONFLICT(resource_id, source_revision_id, analyzer_version) DO UPDATE SET
        status = CASE WHEN status = 'completed' THEN status ELSE 'pending' END,
        updated_at = excluded.updated_at
    `).run(input.id, input.projectId, input.resourceId, input.sourceRevisionId, input.analyzerVersion, now, now)
  }

  claimResourceAnalysis(workerId: string, leaseMs = 60_000): { readonly id: string; readonly projectId: string; readonly resourceId: string; readonly sourceRevisionId: string } | undefined {
    const now = new Date()
    const nowIso = now.toISOString()
    const row = this.#database.prepare(`
      SELECT id, project_id, resource_id, source_revision_id FROM resource_analysis_jobs
      WHERE (status IN ('pending','retryable') AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
         OR (status = 'running' AND lease_expires_at < ?)
      ORDER BY created_at, id LIMIT 1
    `).get(nowIso, nowIso) as Row | undefined
    if (row === undefined) return undefined
    const expiresAt = new Date(now.getTime() + leaseMs).toISOString()
    this.#database.prepare(`
      UPDATE resource_analysis_jobs SET status = 'running', attempt_count = attempt_count + 1,
        lease_owner = ?, lease_expires_at = ?, updated_at = ? WHERE id = ?
    `).run(workerId, expiresAt, nowIso, row.id as SQLInputValue)
    return { id: String(row.id), projectId: String(row.project_id), resourceId: String(row.resource_id), sourceRevisionId: String(row.source_revision_id) }
  }

  completeResourceAnalysis(id: string): void {
    const now = new Date().toISOString()
    this.#database.prepare(`UPDATE resource_analysis_jobs SET status = 'completed', lease_owner = NULL,
      lease_expires_at = NULL, last_error = NULL, updated_at = ? WHERE id = ?`).run(now, id)
  }

  failResourceAnalysis(id: string, message: string, retryable = true): void {
    const now = new Date()
    this.#database.prepare(`UPDATE resource_analysis_jobs SET status = ?, last_error = ?,
      next_attempt_at = ?, lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ?`)
      .run(retryable ? 'retryable' : 'failed', message, retryable ? new Date(now.getTime() + 5_000).toISOString() : null, now.toISOString(), id)
  }

  upsertResourcePolicy(input: {
    readonly projectId: string
    readonly resourceId: string
    readonly trustLevel: 'untrusted' | 'reviewed' | 'trusted'
    readonly approvedContext: boolean
    readonly executable: boolean
    readonly annotation?: Readonly<Record<string, unknown>>
  }): void {
    this.#database.prepare(`INSERT INTO resource_policies VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, resource_id) DO UPDATE SET trust_level=excluded.trust_level,
      approved_context=excluded.approved_context, executable=excluded.executable,
      annotation_json=excluded.annotation_json, updated_at=excluded.updated_at`)
      .run(input.projectId, input.resourceId, input.trustLevel, input.approvedContext ? 1 : 0,
        input.executable ? 1 : 0, JSON.stringify(input.annotation ?? {}), new Date().toISOString())
  }

  getResourcePolicy(projectId: string, resourceId: string): {
    readonly trustLevel: 'untrusted' | 'reviewed' | 'trusted'
    readonly approvedContext: boolean
    readonly executable: boolean
    readonly annotation: Readonly<Record<string, unknown>>
  } | undefined {
    const row = this.#database.prepare('SELECT * FROM resource_policies WHERE project_id = ? AND resource_id = ?')
      .get(projectId, resourceId) as Row | undefined
    return row === undefined ? undefined : {
      trustLevel: String(row.trust_level) as 'untrusted' | 'reviewed' | 'trusted',
      approvedContext: Number(row.approved_context) === 1,
      executable: Number(row.executable) === 1,
      annotation: json<Readonly<Record<string, unknown>>>(row.annotation_json as SQLInputValue),
    }
  }

  #insertResourceDescriptor(descriptor: ResourceDescriptorV0): void {
    const now = new Date().toISOString()
    this.#database.prepare(
      'INSERT INTO resource_descriptors VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      descriptor.id as SQLInputValue,
      descriptor.projectId as SQLInputValue,
      descriptor.resourceId as SQLInputValue,
      descriptor.artifactId as SQLInputValue,
      descriptor.sourceRevisionId as SQLInputValue,
      descriptor.schemaVersion as SQLInputValue,
      descriptor.understanding.analyzerVersion as SQLInputValue,
      descriptor.understanding.status as SQLInputValue,
      descriptor.source.contentHash ?? null,
      resourceDescriptorHash(descriptor) as SQLInputValue,
      JSON.stringify(descriptor) as SQLInputValue,
      now as SQLInputValue,
      now as SQLInputValue,
    )
  }

  #resourceDescriptorRow(row: Row): ResourceDescriptorV0 {
    return JSON.parse(String(row.descriptor_json)) as ResourceDescriptorV0
  }

  updateFileObservation(fileRecord: FileRecord, artifact?: Artifact): void {
    this.#database.exec('BEGIN IMMEDIATE;')
    try {
      this.#upsertFileRecord(fileRecord)
      if (artifact !== undefined) this.#upsertArtifact(artifact)
      this.#database.exec('COMMIT;')
    } catch (error: unknown) {
      this.#database.exec('ROLLBACK;')
      throw error
    }
  }

  registerSource(
    fileRecord: FileRecord,
    artifact: Artifact,
    revision: ArtifactRevision,
  ): void {
    if (String(fileRecord.projectId) !== String(artifact.projectId)
      || String(revision.artifactId) !== String(artifact.id)
      || String(revision.fileRecordId) !== String(fileRecord.id)
      || String(artifact.currentRevisionId) !== String(revision.id)
      || String(revision.contentHash) !== String(fileRecord.observedHash)
      || revision.source !== 'import'
      || revision.status !== 'current') {
      throw new Error('Initial source registration invariants are invalid.')
    }
    if (this.getProject(String(artifact.projectId)) === undefined) {
      throw new Error('Project not found.')
    }
    this.#database.exec('BEGIN IMMEDIATE;')
    try {
      this.#upsertFileRecord(fileRecord)
      this.#upsertArtifact(artifact)
      this.#upsertArtifactRevision(revision)
      this.#database.prepare('UPDATE projects SET graph_version = graph_version + 1, updated_at = ? WHERE id = ?')
        .run(artifact.updatedAt, artifact.projectId as SQLInputValue)
      this.#database.exec('COMMIT;')
    } catch (error: unknown) {
      this.#database.exec('ROLLBACK;')
      throw error
    }
  }

  /**
   * HU-1C: Text Artifact 复合事务（fileRecord + artifact + revision + view 一个 tx）。
   * 调用方负责先写 staged 文件，成功后再 rename；失败时由调用方清理 staged。
   */
  registerTextArtifactComposite(
    fileRecord: FileRecord,
    artifact: Artifact,
    revision: ArtifactRevision,
    view: ArtifactView,
    workspaceId?: WorkspaceId,
  ): void {
    if (String(fileRecord.projectId) !== String(artifact.projectId)
      || String(revision.artifactId) !== String(artifact.id)
      || String(revision.fileRecordId) !== String(fileRecord.id)
      || String(artifact.currentRevisionId) !== String(revision.id)
      || String(revision.contentHash) !== String(fileRecord.observedHash)
      || revision.source !== 'import'
      || revision.status !== 'current') {
      throw new Error('Initial source registration invariants are invalid.')
    }
    if (this.getProject(String(artifact.projectId)) === undefined) {
      throw new Error('Project not found.')
    }
    this.#database.exec('BEGIN IMMEDIATE;')
    try {
      this.#upsertFileRecord(fileRecord)
      this.#upsertArtifact(artifact)
      this.#upsertArtifactRevision(revision)
      this.#upsertArtifactView(view)
      if (workspaceId !== undefined) {
        const row = this.#database.prepare(
          'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM workspace_memberships WHERE workspace_id = ?',
        ).get(workspaceId as SQLInputValue) as Row
        this.#database.prepare(`
          INSERT OR IGNORE INTO workspace_memberships (workspace_id, artifact_view_id, added_at, added_by, sort_order)
          VALUES (?, ?, ?, ?, ?)
        `).run(workspaceId as SQLInputValue, view.id as SQLInputValue, new Date().toISOString(), 'user', Number(row.next_order))
      }
      this.#database.exec('COMMIT;')
    } catch (error: unknown) {
      this.#database.exec('ROLLBACK;')
      throw error
    }
  }

  /** HU-1C: late writer / tombstone guard —— derived worker 提交前确认 entity 仍存在且（可选）hash 匹配。 */
  assertEntityAlive(projectId: string, entityType: string, entityId: string, contentHash?: string): boolean {
    if (entityType === 'artifact') {
      const artifact = this.getArtifact(entityId)
      if (artifact === undefined || String(artifact.projectId) !== projectId) return false
      if (contentHash !== undefined) {
        const current = artifact.currentRevisionId === undefined ? undefined : this.getArtifactRevision(String(artifact.currentRevisionId))
        if (current === undefined || String(current.contentHash) !== contentHash) return false
      }
      return true
    }
    if (entityType === 'note') {
      const note = this.getNote(entityId)
      if (note === undefined || String(note.projectId) !== projectId) return false
      return true
    }
    if (entityType === 'conversation') {
      const row = this.#database.prepare('SELECT id FROM conversation_sessions WHERE id = ? AND project_id = ?').get(entityId as SQLInputValue, projectId as SQLInputValue)
      return row !== undefined
    }
    return false
  }

  /**
   * HU-5 §10：状态化派生写入守卫。entity 缺失 → skipped_deleted；
   * revision/hash 已变 → skipped_stale；全部通过才执行 commit → applied。
   */
  commitDerivedResult(
    guard: DerivedWriteGuardV0,
    commit: () => void,
  ): DerivedWriteStatusV0 {
    if (guard.entityType === 'artifact') {
      const artifact = this.getArtifact(guard.entityId)
      if (artifact === undefined) return 'skipped_deleted'
      if (guard.expectedRevisionId !== undefined) {
        const revision = this.getArtifactRevision(guard.expectedRevisionId)
        if (revision === undefined || String(revision.artifactId) !== String(artifact.id)) return 'skipped_deleted'
        if (guard.expectedContentHash !== undefined && String(revision.contentHash) !== guard.expectedContentHash) return 'skipped_stale'
      }
      commit()
      return 'applied'
    }
    if (guard.entityType === 'resource') {
      const descriptor = this.getResourceDescriptorByResourceId(String(guard.projectId ?? ''), guard.entityId)
      if (descriptor === undefined) return 'skipped_deleted'
      commit()
      return 'applied'
    }
    if (guard.entityType === 'conversation') {
      if (!this.assertEntityAlive(String(guard.projectId ?? ''), 'conversation', guard.entityId)) return 'skipped_deleted'
      commit()
      return 'applied'
    }
    return 'skipped_deleted'
  }

  /** HU-5 §10：search-document embedding 提交守卫 —— 文档已删/内容已变则丢弃派生向量。 */
  commitSearchDocumentEmbedding(
    input: {
      readonly projectId: string
      readonly entityType: string
      readonly entityId: string
      readonly model: string
      readonly dimensions: number
      readonly contentHash: string
      readonly embeddingBlob: Buffer
      readonly indexedAt: string
    },
  ): DerivedWriteStatusV0 {
    const document = this.getSearchDocument(input.projectId, input.entityType, input.entityId)
    if (document === undefined) return 'skipped_deleted'
    if (String(document.contentHash) !== input.contentHash) return 'skipped_stale'
    this.upsertSearchDocumentEmbedding({
      entityId: input.entityId,
      model: input.model,
      dimensions: input.dimensions,
      contentHash: input.contentHash,
      embeddingBlob: input.embeddingBlob,
      indexedAt: input.indexedAt,
    })
    return 'applied'
  }

  /** HU-1C: 启动 orphan sweep —— 只清 LCOS 自己 staging 命名空间下无 DB reference 的 staged 文件。 */
  sweepStagedTextFiles(projectRoot: string): { readonly swept: number; readonly kept: number } {
    const stagingDir = join(resolve(projectRoot), '.creative-os', 'staging')
    if (!existsSync(stagingDir)) return { swept: 0, kept: 0 }
    let swept = 0
    let kept = 0
    for (const entry of readdirSync(stagingDir)) {
      if (!entry.endsWith('.md')) continue
      const path = join(stagingDir, entry)
      const id = entry.replace(/\.md$/, '')
      const finalPath = join(resolve(projectRoot), '.creative-os', 'notes', entry)
      // DB 已提交但 rename 未完成：按 notes/<id>.md 归位
      const committed = this.#database.prepare(
        'SELECT 1 FROM file_records WHERE observed_path IN (?, ?)',
      ).get(finalPath.replaceAll('\\', '/') as SQLInputValue, finalPath as SQLInputValue) !== undefined
      if (committed) {
        try {
          mkdirSync(dirname(finalPath), { recursive: true })
          renameSync(path, finalPath)
          kept += 1
          continue
        } catch { kept += 1; continue }
      }
      try { rmSync(path, { force: true }); swept += 1 } catch { kept += 1 }
    }
    return { swept, kept }
  }

  adoptExternalChange(
    previousRevision: ArtifactRevision,
    nextFileRecord: FileRecord,
    nextRevision: ArtifactRevision,
    artifact: Artifact,
    views: readonly ArtifactView[],
  ): void {
    if (String(previousRevision.artifactId) !== String(artifact.id)
      || String(nextRevision.artifactId) !== String(artifact.id)
      || String(nextRevision.fileRecordId) !== String(nextFileRecord.id)
      || String(nextFileRecord.projectId) !== String(artifact.projectId)
      || String(nextRevision.parentRevisionId) !== String(previousRevision.id)
      || String(nextRevision.contentHash) !== String(nextFileRecord.observedHash)
      || nextRevision.source !== 'external'
      || nextRevision.status !== 'current'
      || previousRevision.status !== 'superseded'
      || String(artifact.currentRevisionId) !== String(nextRevision.id)) {
      throw new Error('External change adoption invariants are invalid.')
    }
    this.#database.exec('BEGIN IMMEDIATE;')
    try {
      this.#upsertFileRecord(nextFileRecord)
      this.#upsertArtifactRevision(previousRevision)
      this.#upsertArtifactRevision(nextRevision)
      this.#upsertArtifact(artifact)
      for (const view of views) this.#upsertArtifactView(view)
      this.#database.prepare('UPDATE projects SET graph_version = graph_version + 1, updated_at = ? WHERE id = ?')
        .run(artifact.updatedAt, artifact.projectId as SQLInputValue)
      this.#database.exec('COMMIT;')
    } catch (error: unknown) {
      this.#database.exec('ROLLBACK;')
      throw error
    }
  }

  registerImportedSource(
    fileRecord: FileRecord,
    artifact: Artifact,
    revision: ArtifactRevision,
    view: ArtifactView,
  ): void {
    if (String(fileRecord.projectId) !== String(artifact.projectId)
      || String(revision.artifactId) !== String(artifact.id)
      || String(revision.fileRecordId) !== String(fileRecord.id)
      || String(view.artifactId) !== String(artifact.id)
      || String(view.revisionId) !== String(revision.id)
      || String(artifact.currentRevisionId) !== String(revision.id)
      || String(revision.contentHash) !== String(fileRecord.observedHash)
      || revision.source !== 'import'
      || revision.status !== 'current') {
      throw new Error('Import Copy invariants are invalid.')
    }
    if (this.getProject(String(artifact.projectId)) === undefined) {
      throw new Error('Project not found.')
    }
    this.#database.exec('BEGIN IMMEDIATE;')
    try {
      this.#upsertFileRecord(fileRecord)
      this.#upsertArtifact(artifact)
      this.#upsertArtifactRevision(revision)
      this.#upsertArtifactView(view)
      this.#database.prepare('UPDATE projects SET graph_version = graph_version + 1, updated_at = ? WHERE id = ?')
        .run(artifact.updatedAt, artifact.projectId as SQLInputValue)
      this.#database.exec('COMMIT;')
    } catch (error: unknown) {
      this.#database.exec('ROLLBACK;')
      throw error
    }
  }

  createContextManifest(value: PersistedContextManifestV0): PersistedContextManifestV0 {
    assertCanonicalManifest(value)
    const existing = this.getContextManifest(value.id)
    if (existing !== undefined) {
      if (existing.canonicalJson !== value.canonicalJson
        || existing.manifestHash !== value.manifestHash
        || String(existing.projectId) !== String(value.projectId)) {
        throw new Error('ContextManifest is immutable and conflicts with the stored value.')
      }
      return existing
    }
    this.#database.prepare(`
      INSERT INTO context_manifests (
        id, project_id, schema_version, target_artifact_id, target_revision_id,
        canonical_json, manifest_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      value.id as SQLInputValue,
      value.projectId as SQLInputValue,
      value.schemaVersion,
      value.targetArtifactId as SQLInputValue ?? null,
      value.targetRevisionId as SQLInputValue ?? null,
      value.canonicalJson,
      value.manifestHash,
      value.createdAt,
    )
    return value
  }

  getContextManifest(manifestId: PersistedContextManifestV0['id']): PersistedContextManifestV0 | undefined {
    const row = this.#database.prepare('SELECT * FROM context_manifests WHERE id = ?').get(manifestId as SQLInputValue) as Row | undefined
    if (row === undefined) return undefined
    return {
      id: String(row.id) as PersistedContextManifestV0['id'],
      projectId: String(row.project_id) as PersistedContextManifestV0['projectId'],
      schemaVersion: Number(row.schema_version) as 0,
      ...(row.target_artifact_id ? { targetArtifactId: String(row.target_artifact_id) as ArtifactId } : {}),
      ...(row.target_revision_id ? { targetRevisionId: String(row.target_revision_id) as ArtifactRevisionId } : {}),
      canonicalJson: String(row.canonical_json),
      manifestHash: String(row.manifest_hash),
      createdAt: String(row.created_at),
    }
  }

  createRunWithDispatch(run: Run, dispatch: RuntimeDispatch): void {
    if (String(dispatch.runId) !== String(run.id)) throw new Error('RuntimeDispatch must belong to the Run.')
    if (dispatch.idempotencyKey !== String(run.id)) throw new Error('RuntimeDispatch idempotencyKey must equal runId.')
    this.#database.exec('BEGIN IMMEDIATE;')
    try {
      this.#database.prepare(`
        INSERT INTO runs (
          id, project_id, workspace_id, target_artifact_id, target_revision_id,
          context_manifest_id, retry_of_run_id, provider, requested_provider, output_intent, return_group_id, status, instruction,
          result_policy, result_summary, short_summary, error_code, error_message,
          created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        run.id as SQLInputValue,
        run.projectId as SQLInputValue,
        run.workspaceId as SQLInputValue ?? null,
        run.targetArtifactId as SQLInputValue ?? null,
        run.targetRevisionId as SQLInputValue ?? null,
        run.contextManifestId as SQLInputValue,
        run.retryOfRunId as SQLInputValue ?? null,
        run.provider,
        run.requestedProvider ?? run.provider,
        run.outputIntent ?? 'revise',
        run.returnGroupId ?? `return-group-${String(run.id)}`,
        run.status,
        run.instruction,
        run.resultPolicy === undefined ? null : JSON.stringify(run.resultPolicy),
        run.resultSummary ?? null,
        run.shortSummary ?? null,
        run.errorCode ?? null,
        run.errorMessage ?? null,
        run.createdAt,
        run.updatedAt,
        run.completedAt ?? null,
      )
      this.#database.prepare(`
        INSERT INTO runtime_dispatches (
          id, run_id, provider, idempotency_key, status, attempt_count,
          last_error_code, last_error_message, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        dispatch.id as SQLInputValue,
        dispatch.runId as SQLInputValue,
        dispatch.provider,
        dispatch.idempotencyKey,
        dispatch.status,
        dispatch.attemptCount,
        dispatch.lastErrorCode ?? null,
        dispatch.lastErrorMessage ?? null,
        dispatch.createdAt,
        dispatch.updatedAt,
      )
      this.#database.exec('COMMIT;')
    } catch (error: unknown) {
      this.#database.exec('ROLLBACK;')
      throw error
    }
  }

  getRun(runId: RunId): Run | undefined {
    const row = this.#database.prepare('SELECT * FROM runs WHERE id = ?').get(runId as SQLInputValue) as Row | undefined
    return row === undefined ? undefined : this.#runFromRow(row)
  }

  getProjectRuns(projectId: ProjectId, limit = 20): readonly Run[] {
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)))
    const rows = this.#database.prepare(
      'SELECT * FROM runs WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
    ).all(projectId as SQLInputValue, safeLimit) as Row[]
    return rows.map((row) => this.#runFromRow(row))
  }

  listRunsNeedingSync(): readonly Run[] {
    return (this.#database.prepare(`
      SELECT r.* FROM runs r
      JOIN runtime_bindings b ON b.run_id = r.id
      WHERE r.status IN ('created','queued','running','waiting_input')
      ORDER BY r.created_at
    `).all() as Row[]).map((row) => this.#runFromRow(row))
  }

  #runFromRow(row: Row): Run {
    return {
      id: String(row.id) as Run['id'],
      projectId: String(row.project_id) as Run['projectId'],
      ...(row.workspace_id ? { workspaceId: String(row.workspace_id) as WorkspaceId } : {}),
      ...(row.target_artifact_id ? { targetArtifactId: String(row.target_artifact_id) as NonNullable<Run['targetArtifactId']> } : {}),
      ...(row.target_revision_id ? { targetRevisionId: String(row.target_revision_id) as NonNullable<Run['targetRevisionId']> } : {}),
      contextManifestId: String(row.context_manifest_id) as Run['contextManifestId'],
      ...(row.retry_of_run_id ? { retryOfRunId: String(row.retry_of_run_id) as RunId } : {}),
      provider: String(row.provider) as Run['provider'],
      requestedProvider: String(row.requested_provider) as Run['requestedProvider'],
      outputIntent: String(row.output_intent) as Run['outputIntent'],
      returnGroupId: String(row.return_group_id),
      ...(row.result_policy ? { resultPolicy: JSON.parse(String(row.result_policy)) as NonNullable<Run['resultPolicy']> } : {}),
      status: String(row.status) as Run['status'],
      instruction: String(row.instruction),
      ...(row.result_summary ? { resultSummary: String(row.result_summary) } : {}),
      ...(row.short_summary ? { shortSummary: String(row.short_summary) } : {}),
      ...(row.error_code ? { errorCode: String(row.error_code) } : {}),
      ...(row.error_message ? { errorMessage: String(row.error_message) } : {}),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      ...(row.completed_at ? { completedAt: String(row.completed_at) } : {}),
    }
  }

  // ==================== Workspace Memberships (Phase 0/1 canonical truth) ====================

  addWorkspaceMembers(
    workspaceId: WorkspaceId,
    viewIds: readonly ArtifactViewId[],
    addedBy: WorkspaceMembershipSource,
    addedAt: string,
  ): readonly WorkspaceMembership[] {
    this.#database.exec('BEGIN IMMEDIATE;')
    try {
      for (const viewId of viewIds) {
        const row = this.#database.prepare(
          'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM workspace_memberships WHERE workspace_id = ?',
        ).get(workspaceId as SQLInputValue) as Row
        this.#database.prepare(`
          INSERT OR IGNORE INTO workspace_memberships (workspace_id, artifact_view_id, added_at, added_by, sort_order)
          VALUES (?, ?, ?, ?, ?)
        `).run(workspaceId as SQLInputValue, viewId as SQLInputValue, addedAt, addedBy, Number(row.next_order))
      }
      this.#database.exec('COMMIT;')
    } catch (error: unknown) {
      this.#database.exec('ROLLBACK;')
      throw error
    }
    return this.listWorkspaceMembers(workspaceId)
  }

  removeWorkspaceMembers(
    workspaceId: WorkspaceId,
    viewIds: readonly ArtifactViewId[],
  ): readonly WorkspaceMembership[] {
    this.#database.exec('BEGIN IMMEDIATE;')
    try {
      for (const viewId of viewIds) {
        this.#database.prepare(
          'DELETE FROM workspace_memberships WHERE workspace_id = ? AND artifact_view_id = ?',
        ).run(workspaceId as SQLInputValue, viewId as SQLInputValue)
      }
      this.#database.exec('COMMIT;')
    } catch (error: unknown) {
      this.#database.exec('ROLLBACK;')
      throw error
    }
    return this.listWorkspaceMembers(workspaceId)
  }

  // ==================== 裁决 1（20260828）：Scene working-set entity 成员 ====================

  addWorkspaceEntityMembers(
    workspaceId: WorkspaceId,
    refs: readonly { readonly entityType: WorkspaceEntityMembership['entityType']; readonly entityId: string }[],
    addedBy: WorkspaceMembershipSource,
    addedAt: string,
  ): readonly WorkspaceEntityMembership[] {
    this.#database.exec('BEGIN IMMEDIATE;')
    try {
      for (const ref of refs) {
        this.#database.prepare(`
          INSERT OR IGNORE INTO workspace_entity_memberships (workspace_id, entity_type, entity_id, added_at, added_by)
          VALUES (?, ?, ?, ?, ?)
        `).run(workspaceId as SQLInputValue, ref.entityType, ref.entityId, addedAt, addedBy)
      }
      this.#database.exec('COMMIT;')
    } catch (error: unknown) {
      this.#database.exec('ROLLBACK;')
      throw error
    }
    return this.listWorkspaceEntityMembers(workspaceId)
  }

  removeWorkspaceEntityMembers(
    workspaceId: WorkspaceId,
    refs: readonly { readonly entityType: WorkspaceEntityMembership['entityType']; readonly entityId: string }[],
  ): void {
    this.#database.exec('BEGIN IMMEDIATE;')
    try {
      for (const ref of refs) {
        this.#database.prepare('DELETE FROM workspace_entity_memberships WHERE workspace_id = ? AND entity_type = ? AND entity_id = ?')
          .run(workspaceId as SQLInputValue, ref.entityType, ref.entityId)
      }
      this.#database.exec('COMMIT;')
    } catch (error: unknown) {
      this.#database.exec('ROLLBACK;')
      throw error
    }
  }

  listWorkspaceEntityMembers(workspaceId: WorkspaceId): readonly WorkspaceEntityMembership[] {
    const rows = this.#database.prepare('SELECT * FROM workspace_entity_memberships WHERE workspace_id = ? ORDER BY added_at, entity_type, entity_id')
      .all(workspaceId as SQLInputValue) as Row[]
    return rows.map((row) => this.#workspaceEntityMembership(row))
  }

  listProjectWorkspaceEntityMemberships(projectId: ProjectId): readonly WorkspaceEntityMembership[] {
    const rows = this.#database.prepare(`
      SELECT m.* FROM workspace_entity_memberships m
      JOIN workspaces w ON w.id = m.workspace_id
      WHERE w.project_id = ?
      ORDER BY m.added_at, m.entity_type, m.entity_id
    `).all(projectId as SQLInputValue) as Row[]
    return rows.map((row) => this.#workspaceEntityMembership(row))
  }

  // ==================== F6A2（20260829）：Spatial Marker Intents（schema 48） ====================

  listSpatialMarkerIntents(projectId: ProjectId): readonly SpatialMarkerIntentV0[] {
    const rows = this.#database.prepare('SELECT * FROM spatial_marker_intents WHERE project_id = ? ORDER BY created_at, id')
      .all(projectId as SQLInputValue) as Row[]
    return rows.map((row) => this.#spatialMarkerIntent(row))
  }

  getSpatialMarkerIntent(markerId: string): SpatialMarkerIntentV0 | undefined {
    const rows = this.#database.prepare('SELECT * FROM spatial_marker_intents WHERE id = ?').all(markerId as SQLInputValue) as Row[]
    return rows.length ? this.#spatialMarkerIntent(rows[0] as Row) : undefined
  }

  #insertSpatialMarkerIntent(value: SpatialMarkerIntentV0): void {
    this.#database.prepare(`
      INSERT INTO spatial_marker_intents (id, project_id, target_kind, target_id, scope, source_surface_ref, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      value.id as SQLInputValue, value.projectId as SQLInputValue,
      value.targetRef.kind, value.targetRef.id, value.scope,
      (value.sourceSurfaceRef ?? null) as SQLInputValue,
      value.createdAt, value.updatedAt,
    )
  }

  /** 直接写面（不经 runCurationMutation）：仅快照恢复/测试用；常规路径走 MutationSafety。 */
  upsertSpatialMarkerIntent(value: SpatialMarkerIntentV0): void {
    this.#database.exec('BEGIN IMMEDIATE;')
    try {
      this.#database.prepare('DELETE FROM spatial_marker_intents WHERE id = ?').run(value.id as SQLInputValue)
      this.#insertSpatialMarkerIntent(value)
      this.#database.exec('COMMIT;')
    } catch (error) {
      this.#database.exec('ROLLBACK;')
      throw error
    }
  }

  deleteSpatialMarkerIntent(markerId: string): boolean {
    const result = this.#database.prepare('DELETE FROM spatial_marker_intents WHERE id = ?').run(markerId as SQLInputValue)
    return Number(result.changes) > 0
  }

  #spatialMarkerIntent(row: Row): SpatialMarkerIntentV0 {
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      targetRef: { projectId: String(row.project_id), kind: String(row.target_kind) as SpatialMarkerIntentV0['targetRef']['kind'], id: String(row.target_id) },
      scope: String(row.scope) as SpatialMarkerIntentV0['scope'],
      ...(row.source_surface_ref === null || row.source_surface_ref === undefined ? {} : { sourceSurfaceRef: String(row.source_surface_ref) as NonNullable<SpatialMarkerIntentV0['sourceSurfaceRef']> }),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }
  }

  // ==================== A25-6: Color Pin truth (schema 51) ====================

  listColorPinDefinitions(projectId: ProjectId): readonly ColorPinDefinitionV0[] {
    const rows = this.#database.prepare('SELECT * FROM color_pin_definitions WHERE project_id = ? ORDER BY created_at, id')
      .all(projectId as SQLInputValue) as Row[]
    return rows.map((row) => this.#colorPinDefinition(row))
  }

  listColorPinMemberships(projectId: ProjectId): readonly ColorPinMembershipV0[] {
    const rows = this.#database.prepare('SELECT * FROM color_pin_memberships WHERE project_id = ? ORDER BY created_at, id')
      .all(projectId as SQLInputValue) as Row[]
    return rows.map((row) => this.#colorPinMembership(row))
  }

  getColorPinDefinition(colorPinId: string): ColorPinDefinitionV0 | undefined {
    const row = this.#database.prepare('SELECT * FROM color_pin_definitions WHERE id = ?').get(colorPinId as SQLInputValue) as Row | undefined
    return row === undefined ? undefined : this.#colorPinDefinition(row)
  }

  getColorPinDefinitionByColor(projectId: ProjectId, color: string): ColorPinDefinitionV0 | undefined {
    const row = this.#database.prepare('SELECT * FROM color_pin_definitions WHERE project_id = ? AND color_value = ?')
      .get(projectId as SQLInputValue, color) as Row | undefined
    return row === undefined ? undefined : this.#colorPinDefinition(row)
  }

  getColorPinMembership(membershipId: string): ColorPinMembershipV0 | undefined {
    const row = this.#database.prepare('SELECT * FROM color_pin_memberships WHERE id = ?').get(membershipId as SQLInputValue) as Row | undefined
    return row === undefined ? undefined : this.#colorPinMembership(row)
  }

  findColorPinMembership(projectId: ProjectId, colorPinId: string, targetRef: ColorPinMembershipV0['targetRef']): ColorPinMembershipV0 | undefined {
    const row = this.#database.prepare('SELECT * FROM color_pin_memberships WHERE project_id = ? AND color_pin_id = ? AND target_kind = ? AND target_id = ?')
      .get(projectId as SQLInputValue, colorPinId, targetRef.kind, targetRef.id) as Row | undefined
    return row === undefined ? undefined : this.#colorPinMembership(row)
  }

  #insertColorPinDefinition(value: ColorPinDefinitionV0): void {
    this.#database.prepare(`
      INSERT INTO color_pin_definitions (id, project_id, color_value, label, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(value.id, value.projectId, value.color, value.label ?? null, value.createdAt, value.updatedAt)
  }

  #insertColorPinMembership(value: ColorPinMembershipV0): void {
    this.#database.prepare(`
      INSERT INTO color_pin_memberships (id, project_id, color_pin_id, target_kind, target_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(value.id, value.projectId, value.colorPinId, value.targetRef.kind, value.targetRef.id, value.createdAt, value.updatedAt)
  }

  #colorPinDefinition(row: Row): ColorPinDefinitionV0 {
    return {
      id: String(row.id), projectId: String(row.project_id), color: String(row.color_value),
      ...(row.label === null || row.label === undefined ? {} : { label: String(row.label) }),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    }
  }

  #colorPinMembership(row: Row): ColorPinMembershipV0 {
    return {
      id: String(row.id), projectId: String(row.project_id), colorPinId: String(row.color_pin_id),
      targetRef: { projectId: String(row.project_id), kind: String(row.target_kind) as ColorPinMembershipV0['targetRef']['kind'], id: String(row.target_id) },
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    }
  }

  #workspaceEntityMembership(row: Row): WorkspaceEntityMembership {
    return {
      workspaceId: row.workspace_id as WorkspaceId,
      entityType: String(row.entity_type) as WorkspaceEntityMembership['entityType'],
      entityId: String(row.entity_id),
      addedAt: String(row.added_at),
      addedBy: String(row.added_by) as WorkspaceEntityMembership['addedBy'],
    }
  }
  moveWorkspaceMembers(
    fromWorkspaceId: WorkspaceId,
    toWorkspaceId: WorkspaceId,
    viewIds: readonly ArtifactViewId[],
    addedBy: WorkspaceMembershipSource,
    addedAt: string,
  ): readonly WorkspaceMembership[] {
    this.#database.exec('BEGIN IMMEDIATE;')
    try {
      const fromExists = this.#database.prepare('SELECT id FROM workspaces WHERE id = ?').get(fromWorkspaceId as SQLInputValue)
      const toExists = this.#database.prepare('SELECT id FROM workspaces WHERE id = ?').get(toWorkspaceId as SQLInputValue)
      if (fromExists === undefined || toExists === undefined) {
        throw new Error('Workspace not found for membership move.')
      }
      for (const viewId of viewIds) {
        this.#database.prepare(
          'DELETE FROM workspace_memberships WHERE workspace_id = ? AND artifact_view_id = ?',
        ).run(fromWorkspaceId as SQLInputValue, viewId as SQLInputValue)
        const row = this.#database.prepare(
          'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM workspace_memberships WHERE workspace_id = ?',
        ).get(toWorkspaceId as SQLInputValue) as Row
        this.#database.prepare(`
          INSERT OR IGNORE INTO workspace_memberships (workspace_id, artifact_view_id, added_at, added_by, sort_order)
          VALUES (?, ?, ?, ?, ?)
        `).run(toWorkspaceId as SQLInputValue, viewId as SQLInputValue, addedAt, addedBy, Number(row.next_order))
      }
      this.#database.exec('COMMIT;')
    } catch (error: unknown) {
      this.#database.exec('ROLLBACK;')
      throw error
    }
    return this.listWorkspaceMembers(toWorkspaceId)
  }

  listWorkspaceMembers(workspaceId: WorkspaceId): readonly WorkspaceMembership[] {
    return (this.#database.prepare(
      'SELECT * FROM workspace_memberships WHERE workspace_id = ? ORDER BY sort_order, added_at, artifact_view_id',
    ).all(workspaceId as SQLInputValue) as Row[]).map((row) => this.#membershipFromRow(row))
  }

  listProjectWorkspaceMemberships(projectId: ProjectId): readonly WorkspaceMembership[] {
    return (this.#database.prepare(`
      SELECT m.* FROM workspace_memberships m
      JOIN workspaces w ON w.id = m.workspace_id
      WHERE w.project_id = ?
      ORDER BY w.id, m.sort_order, m.artifact_view_id
    `).all(projectId as SQLInputValue) as Row[]).map((row) => this.#membershipFromRow(row))
  }

  #membershipFromRow(row: Row): WorkspaceMembership {
    return {
      workspaceId: String(row.workspace_id) as WorkspaceId,
      artifactViewId: String(row.artifact_view_id) as ArtifactViewId,
      addedAt: String(row.added_at),
      addedBy: String(row.added_by) as WorkspaceMembershipSource,
      ...(row.sort_order === null || row.sort_order === undefined ? {} : { sortOrder: Number(row.sort_order) }),
    }
  }

  getRuntimeDispatch(runId: RunId): RuntimeDispatch | undefined {
    const row = this.#database.prepare('SELECT * FROM runtime_dispatches WHERE run_id = ?').get(runId as SQLInputValue) as Row | undefined
    if (row === undefined) return undefined
    return {
      id: String(row.id) as RuntimeDispatch['id'],
      runId: String(row.run_id) as RuntimeDispatch['runId'],
      provider: String(row.provider) as RuntimeDispatch['provider'],
      idempotencyKey: String(row.idempotency_key),
      status: String(row.status) as RuntimeDispatch['status'],
      attemptCount: Number(row.attempt_count),
      ...(row.last_error_code ? { lastErrorCode: String(row.last_error_code) } : {}),
      ...(row.last_error_message ? { lastErrorMessage: String(row.last_error_message) } : {}),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }
  }

  updateRuntimeDispatch(value: RuntimeDispatch): RuntimeDispatch {
    const result = this.#database.prepare(`
      UPDATE runtime_dispatches SET
        status = ?, attempt_count = ?, last_error_code = ?,
        last_error_message = ?, updated_at = ?
      WHERE id = ? AND run_id = ? AND provider = ? AND idempotency_key = ?
    `).run(
      value.status,
      value.attemptCount,
      value.lastErrorCode ?? null,
      value.lastErrorMessage ?? null,
      value.updatedAt,
      value.id as SQLInputValue,
      value.runId as SQLInputValue,
      value.provider,
      value.idempotencyKey,
    )
    if (result.changes !== 1) throw new Error('RuntimeDispatch identity cannot be changed.')
    return value
  }

  createRuntimeBinding(value: RuntimeBinding): RuntimeBinding {
    this.#database.prepare(`
      INSERT INTO runtime_bindings (
        id, run_id, provider, external_task_id, external_session_id,
        provider_status, last_synced_at, finalize_pending, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      value.id as SQLInputValue,
      value.runId as SQLInputValue,
      value.provider,
      value.externalTaskId ?? null,
      value.externalSessionId ?? null,
      value.providerStatus ?? null,
      value.lastSyncedAt ?? null,
      value.finalizePending ? 1 : 0,
      value.createdAt,
      value.updatedAt,
    )
    return value
  }

  getRuntimeBinding(runId: RunId): RuntimeBinding | undefined {
    const row = this.#database.prepare('SELECT * FROM runtime_bindings WHERE run_id = ?').get(runId as SQLInputValue) as Row | undefined
    if (row === undefined) return undefined
    return {
      id: String(row.id) as RuntimeBinding['id'],
      runId: String(row.run_id) as RuntimeBinding['runId'],
      provider: String(row.provider) as RuntimeBinding['provider'],
      ...(row.external_task_id ? { externalTaskId: String(row.external_task_id) } : {}),
      ...(row.external_session_id ? { externalSessionId: String(row.external_session_id) } : {}),
      ...(row.provider_status ? { providerStatus: String(row.provider_status) } : {}),
      ...(row.last_synced_at ? { lastSyncedAt: String(row.last_synced_at) } : {}),
      finalizePending: Number(row.finalize_pending) === 1,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }
  }

  updateRuntimeBinding(value: RuntimeBinding): RuntimeBinding {
    const result = this.#database.prepare(`
      UPDATE runtime_bindings SET
        external_session_id = ?, provider_status = ?, last_synced_at = ?,
        finalize_pending = ?, updated_at = ?
      WHERE id = ? AND run_id = ? AND provider = ? AND external_task_id = ?
    `).run(
      value.externalSessionId ?? null,
      value.providerStatus ?? null,
      value.lastSyncedAt ?? null,
      value.finalizePending ? 1 : 0,
      value.updatedAt,
      value.id as SQLInputValue,
      value.runId as SQLInputValue,
      value.provider,
      value.externalTaskId ?? null,
    )
    if (result.changes !== 1) throw new Error('RuntimeBinding identity cannot be changed.')
    return value
  }

  updateRunStatus(runId: RunId, status: Run['status'], updatedAt: string): Run {
    const result = this.#database.prepare(
      'UPDATE runs SET status = ?, updated_at = ? WHERE id = ?',
    ).run(status, updatedAt, runId as SQLInputValue)
    if (result.changes !== 1) throw new Error('Run not found.')
    const run = this.getRun(runId)
    if (run === undefined) throw new Error('Run not found after update.')
    return run
  }

  updateRunOutcome(
    runId: RunId,
    input: {
      readonly status: Run['status']
      readonly resultSummary?: string
      readonly shortSummary?: string
      readonly errorCode?: string
      readonly errorMessage?: string
      readonly completedAt?: string
    },
    updatedAt: string,
  ): Run {
    const result = this.#database.prepare(`
      UPDATE runs SET
        status = ?, result_summary = ?, short_summary = ?, error_code = ?, error_message = ?,
        completed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.status,
      input.resultSummary ?? null,
      input.shortSummary ?? null,
      input.errorCode ?? null,
      input.errorMessage ?? null,
      input.completedAt ?? null,
      updatedAt,
      runId as SQLInputValue,
    )
    if (result.changes !== 1) throw new Error('Run not found.')
    const run = this.getRun(runId)
    if (run === undefined) throw new Error('Run not found after outcome update.')
    return run
  }

  createRunEvent(
    input: Pick<RunEvent, 'id' | 'runId' | 'type' | 'payload' | 'occurredAt'>,
  ): RunEvent {
    const existing = this.#database.prepare(
      'SELECT * FROM run_events WHERE id = ?',
    ).get(input.id as SQLInputValue) as Row | undefined
    if (existing !== undefined) {
      return this.#mapRunEvent(existing)
    }
    this.#database.exec('BEGIN IMMEDIATE;')
    try {
      const row = this.#database.prepare(
        'SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM run_events WHERE run_id = ?',
      ).get(input.runId as SQLInputValue) as Row
      const sequence = Number(row.next_sequence)
      this.#database.prepare(`
        INSERT INTO run_events (id, run_id, sequence, type, payload_json, occurred_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        input.id as SQLInputValue,
        input.runId as SQLInputValue,
        sequence,
        input.type,
        JSON.stringify(input.payload),
        input.occurredAt,
      )
      this.#database.exec('COMMIT;')
      const created = this.#database.prepare(
        'SELECT * FROM run_events WHERE id = ?',
      ).get(input.id as SQLInputValue) as Row
      const event = this.#mapRunEvent(created)
      this.#runEventSink?.(event)
      return event
    } catch (error: unknown) {
      this.#database.exec('ROLLBACK;')
      const replay = this.#database.prepare(
        'SELECT * FROM run_events WHERE id = ?',
      ).get(input.id as SQLInputValue) as Row | undefined
      if (replay !== undefined) return this.#mapRunEvent(replay)
      throw error
    }
  }

  #runEventSink?: (event: RunEvent) => void

  /** 注册 Run 事件落库通知（SSE 推送等实时面使用；同一时刻只保留一个订阅者）。 */
  setRunEventSink(sink: (event: RunEvent) => void): void {
    this.#runEventSink = sink
  }

  getRunEvents(runId: RunId, afterSequence?: number): readonly RunEvent[] {
    if (afterSequence === undefined) {
      return (this.#database.prepare(
        'SELECT * FROM run_events WHERE run_id = ? ORDER BY sequence',
      ).all(runId as SQLInputValue) as Row[]).map((row) => this.#mapRunEvent(row))
    }
    return (this.#database.prepare(
      'SELECT * FROM run_events WHERE run_id = ? AND sequence > ? ORDER BY sequence',
    ).all(runId as SQLInputValue, afterSequence) as Row[]).map((row) => this.#mapRunEvent(row))
  }

  #mapRunEvent(row: Row): RunEvent {
    return {
      id: String(row.id) as RunEventId,
      runId: String(row.run_id) as RunId,
      sequence: Number(row.sequence),
      type: String(row.type) as RunEvent['type'],
      payload: JSON.parse(String(row.payload_json)) as RunEvent['payload'],
      occurredAt: String(row.occurred_at),
    }
  }

  createArtifactReturn(value: ArtifactReturn): ArtifactReturn {
    this.#database.prepare(`
      INSERT INTO artifact_returns (
        id, run_id, target_artifact_id, base_revision_id, returned_file_id,
        content_hash, canonical_path, action, status, draft_revision_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      value.id as SQLInputValue,
      value.runId as SQLInputValue,
      value.targetArtifactId as SQLInputValue,
      value.baseRevisionId as SQLInputValue,
      value.returnedFileId as SQLInputValue,
      value.contentHash as SQLInputValue,
      value.canonicalPath,
      value.action,
      value.status,
      value.draftRevisionId as SQLInputValue ?? null,
      value.createdAt,
      value.updatedAt,
    )
    return value
  }

  createRuntimeDraft(
    fileRecord: FileRecord,
    revision: ArtifactRevision,
    artifactReturn: ArtifactReturn,
  ): ArtifactReturn {
    if (
      String(fileRecord.id) !== String(artifactReturn.returnedFileId)
      || String(revision.id) !== String(artifactReturn.draftRevisionId)
      || String(revision.fileRecordId) !== String(fileRecord.id)
      || String(revision.artifactId) !== String(artifactReturn.targetArtifactId)
      || String(revision.parentRevisionId) !== String(artifactReturn.baseRevisionId)
      || String(revision.runId) !== String(artifactReturn.runId)
      || String(revision.contentHash) !== String(artifactReturn.contentHash)
      || String(fileRecord.observedHash) !== String(artifactReturn.contentHash)
      || revision.source !== 'run'
      || revision.status !== 'draft'
      || artifactReturn.status !== 'pending_review'
    ) {
      throw new Error('Runtime Draft invariants are invalid.')
    }
    const existing = this.getArtifactReturnByIdentity(
      artifactReturn.runId,
      artifactReturn.canonicalPath,
      String(artifactReturn.contentHash),
      artifactReturn.action,
    )
    if (existing !== undefined) return existing
    this.#database.exec('BEGIN IMMEDIATE;')
    try {
      this.#upsertFileRecord(fileRecord)
      this.#upsertArtifactRevision(revision)
      this.createArtifactReturn(artifactReturn)
      this.#database.exec('COMMIT;')
      return artifactReturn
    } catch (error: unknown) {
      this.#database.exec('ROLLBACK;')
      const replay = this.getArtifactReturnByIdentity(
        artifactReturn.runId,
        artifactReturn.canonicalPath,
        String(artifactReturn.contentHash),
        artifactReturn.action,
      )
      if (replay !== undefined) return replay
      throw error
    }
  }

  createRuntimeCreatedArtifact(
    fileRecord: FileRecord,
    artifact: Artifact,
    revision: ArtifactRevision,
    artifactReturn: ArtifactReturn,
  ): ArtifactReturn {
    if (
      String(fileRecord.id) !== String(artifactReturn.returnedFileId)
      || String(revision.id) !== String(artifactReturn.draftRevisionId)
      || String(revision.fileRecordId) !== String(fileRecord.id)
      || String(revision.artifactId) !== String(artifactReturn.targetArtifactId)
      || String(revision.artifactId) !== String(artifact.id)
      || revision.parentRevisionId !== undefined
      || artifact.currentRevisionId !== undefined
      || String(revision.runId) !== String(artifactReturn.runId)
      || String(revision.contentHash) !== String(artifactReturn.contentHash)
      || String(fileRecord.observedHash) !== String(artifactReturn.contentHash)
      || String(artifactReturn.baseRevisionId) !== String(revision.id)
      || revision.source !== 'run'
      || revision.status !== 'draft'
      || artifactReturn.status !== 'pending_review'
      || artifactReturn.action !== 'created'
    ) {
      throw new Error('Runtime Created Artifact invariants are invalid.')
    }
    const existing = this.getArtifactReturnByIdentity(
      artifactReturn.runId,
      artifactReturn.canonicalPath,
      String(artifactReturn.contentHash),
      artifactReturn.action,
    )
    if (existing !== undefined) return existing
    this.#database.exec('BEGIN IMMEDIATE;')
    try {
      this.#upsertFileRecord(fileRecord)
      this.#upsertArtifact(artifact)
      this.#upsertArtifactRevision(revision)
      this.createArtifactReturn(artifactReturn)
      this.#database.exec('COMMIT;')
      return artifactReturn
    } catch (error: unknown) {
      this.#database.exec('ROLLBACK;')
      const replay = this.getArtifactReturnByIdentity(
        artifactReturn.runId,
        artifactReturn.canonicalPath,
        String(artifactReturn.contentHash),
        artifactReturn.action,
      )
      if (replay !== undefined) return replay
      throw error
    }
  }

  getArtifactReturn(returnId: ArtifactReturnId): ArtifactReturn | undefined {
    const row = this.#database.prepare('SELECT * FROM artifact_returns WHERE id = ?').get(returnId as SQLInputValue) as Row | undefined
    if (row === undefined) return undefined
    return {
      id: String(row.id) as ArtifactReturn['id'],
      runId: String(row.run_id) as ArtifactReturn['runId'],
      targetArtifactId: String(row.target_artifact_id) as ArtifactReturn['targetArtifactId'],
      baseRevisionId: String(row.base_revision_id) as ArtifactReturn['baseRevisionId'],
      returnedFileId: String(row.returned_file_id) as ArtifactReturn['returnedFileId'],
      contentHash: String(row.content_hash) as ArtifactReturn['contentHash'],
      canonicalPath: String(row.canonical_path),
      action: String(row.action) as ArtifactReturn['action'],
      status: String(row.status) as ArtifactReturn['status'],
      ...(row.draft_revision_id ? { draftRevisionId: String(row.draft_revision_id) as ArtifactRevisionId } : {}),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }
  }

  getArtifactReturnByIdentity(
    runId: RunId,
    canonicalPath: string,
    contentHash: string,
    action: ArtifactReturn['action'],
  ): ArtifactReturn | undefined {
    const row = this.#database.prepare(`
      SELECT id FROM artifact_returns
      WHERE run_id = ? AND canonical_path = ? AND content_hash = ? AND action = ?
    `).get(runId as SQLInputValue, canonicalPath, contentHash, action) as Row | undefined
    return row === undefined ? undefined : this.getArtifactReturn(String(row.id) as ArtifactReturnId)
  }

  getArtifactReturns(runId: RunId): readonly ArtifactReturn[] {
    return (this.#database.prepare(
      'SELECT id FROM artifact_returns WHERE run_id = ? ORDER BY created_at, id',
    ).all(runId as SQLInputValue) as Row[])
      .map((row) => this.getArtifactReturn(String(row.id) as ArtifactReturnId))
      .filter((value): value is ArtifactReturn => value !== undefined)
  }

  acceptArtifactReturn(
    returnId: ArtifactReturnId,
    expectedBaseRevisionId: ArtifactRevisionId,
    updatedAt: string,
  ): AcceptArtifactReturnResult {
    this.#database.exec('BEGIN IMMEDIATE;')
    try {
      const artifactReturn = this.getArtifactReturn(returnId)
      if (artifactReturn === undefined) throw new RuntimeLifecycleConflictError('ArtifactReturn not found.')
      if (artifactReturn.status !== 'pending_review') throw new RuntimeLifecycleConflictError('ArtifactReturn is no longer pending review.')
      const artifact = this.getArtifact(String(artifactReturn.targetArtifactId))
      const draftRevision = artifactReturn.draftRevisionId === undefined
        ? undefined
        : this.getArtifactRevision(String(artifactReturn.draftRevisionId))
      if (
        artifact !== undefined
        && draftRevision !== undefined
        && artifact.currentRevisionId === undefined
        && String(artifactReturn.baseRevisionId) === String(artifactReturn.draftRevisionId)
        && draftRevision.parentRevisionId === undefined
      ) {
        if (String(artifactReturn.baseRevisionId) !== String(expectedBaseRevisionId)) {
          throw new RuntimeLifecycleConflictError('Accept base revision does not match the Return base revision.')
        }
        const run = this.getRun(artifactReturn.runId)
        if (run === undefined || draftRevision.status !== 'draft') {
          throw new RuntimeLifecycleConflictError('Accept lifecycle evidence is incomplete.')
        }
        this.#database.prepare('UPDATE artifact_revisions SET status = ? WHERE id = ? AND status = ?')
          .run('current', draftRevision.id as SQLInputValue, 'draft')
        this.#database.prepare(
          'UPDATE artifacts SET current_revision_id = ?, updated_at = ? WHERE id = ? AND current_revision_id IS NULL',
        ).run(draftRevision.id as SQLInputValue, updatedAt, artifact.id as SQLInputValue)
        // Birth Provenance 盖戳（huabu canvas-write 注入点同构——写入时定，读取只投影）：
        // 该分支 = artifact 由本 return 诞生（首 current revision 无父）；首诞生后不被后续 run 覆盖。
        this.#database.prepare(
          'UPDATE artifacts SET birth_run_id = ? WHERE id = ? AND birth_run_id IS NULL',
        ).run(artifactReturn.runId as SQLInputValue, artifact.id as SQLInputValue)
        this.#database.prepare('UPDATE artifact_returns SET status = ?, updated_at = ? WHERE id = ? AND status = ?')
          .run('adopted', updatedAt, returnId as SQLInputValue, 'pending_review')
        this.#database.prepare(
          'UPDATE runs SET status = ?, updated_at = ?, completed_at = ? WHERE id = ?',
        ).run('completed', updatedAt, updatedAt, run.id as SQLInputValue)
        this.#database.prepare(
          'UPDATE runtime_bindings SET finalize_pending = 1, updated_at = ? WHERE run_id = ?',
        ).run(updatedAt, run.id as SQLInputValue)
        this.#database.prepare(
          'UPDATE projects SET graph_version = graph_version + 1, updated_at = ? WHERE id = ?',
        ).run(updatedAt, run.projectId as SQLInputValue)
        const result = {
          artifactReturn: this.getArtifactReturn(returnId)!,
          currentRevision: this.getArtifactRevision(String(draftRevision.id))!,
          run: this.getRun(run.id)!,
        }
        this.#database.exec('COMMIT;')
        return result
      }
      if (String(artifactReturn.baseRevisionId) !== String(expectedBaseRevisionId)) {
        throw new RuntimeLifecycleConflictError('Accept base revision does not match the Return base revision.')
      }
      if (artifactReturn.draftRevisionId === undefined) throw new RuntimeLifecycleConflictError('ArtifactReturn has no Draft Revision.')
      const previousRevision = this.getArtifactRevision(String(artifactReturn.baseRevisionId))
      const run = this.getRun(artifactReturn.runId)
      if (artifact === undefined || previousRevision === undefined || draftRevision === undefined || run === undefined) {
        throw new RuntimeLifecycleConflictError('Accept lifecycle evidence is incomplete.')
      }
      if (String(artifact.currentRevisionId) !== String(expectedBaseRevisionId)) {
        throw new RuntimeLifecycleConflictError('Artifact Current changed after this Run started.')
      }
      if (previousRevision.status !== 'current' || draftRevision.status !== 'draft'
        || String(draftRevision.parentRevisionId) !== String(expectedBaseRevisionId)
        || String(draftRevision.runId) !== String(run.id)) {
        throw new RuntimeLifecycleConflictError('Accept lifecycle invariants are invalid.')
      }
      this.#database.prepare('UPDATE artifact_revisions SET status = ? WHERE id = ? AND status = ?')
        .run('superseded', previousRevision.id as SQLInputValue, 'current')
      this.#database.prepare('UPDATE artifact_revisions SET status = ? WHERE id = ? AND status = ?')
        .run('current', draftRevision.id as SQLInputValue, 'draft')
      this.#database.prepare(
        'UPDATE artifacts SET current_revision_id = ?, updated_at = ? WHERE id = ? AND current_revision_id = ?',
      ).run(draftRevision.id as SQLInputValue, updatedAt, artifact.id as SQLInputValue, expectedBaseRevisionId as SQLInputValue)
      this.#database.prepare('UPDATE artifact_returns SET status = ?, updated_at = ? WHERE id = ? AND status = ?')
        .run('adopted', updatedAt, returnId as SQLInputValue, 'pending_review')
      this.#database.prepare(
        'UPDATE runs SET status = ?, updated_at = ?, completed_at = ? WHERE id = ?',
      ).run('completed', updatedAt, updatedAt, run.id as SQLInputValue)
      this.#database.prepare(
        'UPDATE runtime_bindings SET finalize_pending = 1, updated_at = ? WHERE run_id = ?',
      ).run(updatedAt, run.id as SQLInputValue)
      this.#database.prepare(
        'UPDATE projects SET graph_version = graph_version + 1, updated_at = ? WHERE id = ?',
      ).run(updatedAt, run.projectId as SQLInputValue)
      const result = {
        artifactReturn: this.getArtifactReturn(returnId)!,
        currentRevision: this.getArtifactRevision(String(draftRevision.id))!,
        previousRevision: this.getArtifactRevision(String(previousRevision.id))!,
        run: this.getRun(run.id)!,
      }
      this.#database.exec('COMMIT;')
      return result
    } catch (error: unknown) {
      this.#database.exec('ROLLBACK;')
      throw error
    }
  }

  rejectArtifactReturn(returnId: ArtifactReturnId, updatedAt: string): RejectArtifactReturnResult {
    this.#database.exec('BEGIN IMMEDIATE;')
    try {
      const artifactReturn = this.getArtifactReturn(returnId)
      if (artifactReturn === undefined) throw new RuntimeLifecycleConflictError('ArtifactReturn not found.')
      if (artifactReturn.status !== 'pending_review') throw new RuntimeLifecycleConflictError('ArtifactReturn is no longer pending review.')
      if (artifactReturn.draftRevisionId === undefined) throw new RuntimeLifecycleConflictError('ArtifactReturn has no Draft Revision.')
      const draftRevision = this.getArtifactRevision(String(artifactReturn.draftRevisionId))
      const run = this.getRun(artifactReturn.runId)
      if (draftRevision === undefined || run === undefined || draftRevision.status !== 'draft') {
        throw new RuntimeLifecycleConflictError('Reject lifecycle evidence is incomplete.')
      }
      this.#database.prepare('UPDATE artifact_returns SET status = ?, updated_at = ? WHERE id = ? AND status = ?')
        .run('rejected', updatedAt, returnId as SQLInputValue, 'pending_review')
      this.#database.prepare(
        'UPDATE runs SET status = ?, updated_at = ?, completed_at = ? WHERE id = ?',
      ).run('completed', updatedAt, updatedAt, run.id as SQLInputValue)
      this.#database.prepare(
        'UPDATE runtime_bindings SET finalize_pending = 1, updated_at = ? WHERE run_id = ?',
      ).run(updatedAt, run.id as SQLInputValue)
      const result = {
        artifactReturn: this.getArtifactReturn(returnId)!,
        draftRevision,
        run: this.getRun(run.id)!,
      }
      this.#database.exec('COMMIT;')
      return result
    } catch (error: unknown) {
      this.#database.exec('ROLLBACK;')
      throw error
    }
  }

  retryArtifactReturn(
    returnId: ArtifactReturnId,
    run: Run,
    dispatch: RuntimeDispatch,
    updatedAt: string,
  ): RetryRunResult {
    this.#database.exec('BEGIN IMMEDIATE;')
    try {
      const artifactReturn = this.getArtifactReturn(returnId)
      const previousRun = artifactReturn === undefined ? undefined : this.getRun(artifactReturn.runId)
      if (artifactReturn === undefined || previousRun === undefined) throw new RuntimeLifecycleConflictError('Retry lifecycle evidence is incomplete.')
      if (artifactReturn.status !== 'pending_review') throw new RuntimeLifecycleConflictError('ArtifactReturn is no longer pending review.')
      if (String(run.retryOfRunId) !== String(previousRun.id)
        || String(run.projectId) !== String(previousRun.projectId)
        || String(run.targetArtifactId) !== String(previousRun.targetArtifactId)
        || String(run.targetRevisionId) !== String(previousRun.targetRevisionId)
        || String(run.contextManifestId) !== String(previousRun.contextManifestId)
        || String(dispatch.runId) !== String(run.id)
        || dispatch.idempotencyKey !== String(run.id)) {
        throw new RuntimeLifecycleConflictError('Retry Run identity is invalid.')
      }
      this.#database.prepare('UPDATE artifact_returns SET status = ?, updated_at = ? WHERE id = ? AND status = ?')
        .run('rejected', updatedAt, returnId as SQLInputValue, 'pending_review')
      this.#database.prepare(
        'UPDATE runs SET status = ?, updated_at = ?, completed_at = ? WHERE id = ?',
      ).run('completed', updatedAt, updatedAt, previousRun.id as SQLInputValue)
      this.#database.prepare(
        'UPDATE runtime_bindings SET finalize_pending = 1, updated_at = ? WHERE run_id = ?',
      ).run(updatedAt, previousRun.id as SQLInputValue)
      this.#insertRun(run)
      this.#insertRuntimeDispatch(dispatch)
      const result = {
        previousRun: this.getRun(previousRun.id)!,
        previousReturn: this.getArtifactReturn(returnId)!,
        run: this.getRun(run.id)!,
        dispatch: this.getRuntimeDispatch(run.id)!,
      }
      this.#database.exec('COMMIT;')
      return result
    } catch (error: unknown) {
      this.#database.exec('ROLLBACK;')
      throw error
    }
  }

  get schemaVersion(): number {
    return Number((this.#database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
  }

  // ==================== Private helpers ====================

  #removePresentationEntityRefs(projectId: string, type: 'scope' | 'workspace', id: string): void {
    const rows = this.#database.prepare('SELECT id, state_json FROM presentation_views WHERE project_id = ?')
      .all(projectId as SQLInputValue) as Row[]
    const update = this.#database.prepare('UPDATE presentation_views SET state_json = ?, updated_at = ? WHERE id = ? AND project_id = ?')
    const now = new Date().toISOString()
    for (const row of rows) {
      if (typeof row.state_json !== 'string' || typeof row.id !== 'string') continue
      let state: Record<string, unknown>
      try { state = JSON.parse(row.state_json) as Record<string, unknown> } catch { continue }
      const refs = Array.isArray(state.memberEntityRefs) ? state.memberEntityRefs : []
      const filtered = refs.filter((value) => {
        if (value === null || typeof value !== 'object') return true
        const ref = value as { type?: unknown; id?: unknown }
        return !(ref.type === type && ref.id === id)
      })
      if (filtered.length === refs.length) continue
      update.run(JSON.stringify({ ...state, memberEntityRefs: filtered }), now, row.id as SQLInputValue, projectId as SQLInputValue)
    }
  }

  #upsertProject(value: Project): void {
    this.#database.prepare(`
      INSERT INTO projects (id, name, root_path, graph_version, created_at, updated_at, last_opened_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, root_path=excluded.root_path, graph_version=excluded.graph_version, last_opened_at=excluded.last_opened_at, updated_at=excluded.updated_at
    `).run(value.id as SQLInputValue, value.name, value.rootPath, value.graphVersion as unknown as number, value.createdAt, value.updatedAt, value.lastOpenedAt ?? null)
  }

  #upsertScope(value: Scope, projectId: ProjectId): void {
    this.#assertOwnership(String(value.id), 'Scope', String(projectId), (id) => this.#ownerProjectOf('scopes', id))
    this.#database.prepare(`
      INSERT INTO scopes (id, project_id, parent_scope_id, container_view_id, kind, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET parent_scope_id=excluded.parent_scope_id, container_view_id=excluded.container_view_id, kind=excluded.kind, name=excluded.name, updated_at=excluded.updated_at
    `).run(value.id as SQLInputValue, projectId as SQLInputValue, value.parentScopeId as SQLInputValue ?? null, value.containerViewId as SQLInputValue ?? null, value.kind, value.name, value.createdAt, value.updatedAt)
  }

  #upsertWorkspace(value: Workspace): void {
    this.#assertOwnership(String(value.id), 'Workspace', String(value.projectId), (id) => this.#ownerProjectOf('workspaces', id))
    this.#runStatement({
      operationType: 'upsert_workspace',
      entityId: String(value.id),
      table: 'workspaces',
      statement: 'INSERT INTO workspaces',
      foreignKeyColumn: 'project_id',
      referencedTable: 'projects',
      referencedId: String(value.projectId),
    }, `
      INSERT INTO workspaces (id, project_id, scope_id, name, intent, viewport, focused_node_ids, visible_layers, context_policy, frame_bounds, preferred_surface, version, updated_at, sort_index)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_index), -1) + 1 FROM workspaces WHERE project_id = ?))
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, intent=excluded.intent, scope_id=excluded.scope_id, viewport=excluded.viewport, focused_node_ids=excluded.focused_node_ids, visible_layers=excluded.visible_layers, context_policy=excluded.context_policy, frame_bounds=excluded.frame_bounds, preferred_surface=excluded.preferred_surface, version=excluded.version, updated_at=excluded.updated_at
    `, [
      value.id as SQLInputValue, value.projectId as SQLInputValue, value.scopeId as SQLInputValue,
      value.name, value.intent, JSON.stringify(value.viewport),
      JSON.stringify(value.focusedViewIds), JSON.stringify(value.visibleLayers),
      value.contextPolicy,
      value.frameBounds === undefined ? null : JSON.stringify(value.frameBounds),
      value.preferredSurface ?? null,
      value.version ?? 0,
      value.updatedAt,
      value.projectId as SQLInputValue,
    ])
  }

  #upsertArtifact(value: Artifact): void {
    this.#assertOwnership(String(value.id), 'Artifact', String(value.projectId), (id) => this.#ownerProjectOf('artifacts', id))
    const managed = value.managed === false || value.title.toLocaleLowerCase('en-US').endsWith('.link.md') ? 0 : 1
    this.#runStatement({
      operationType: 'upsert_artifact',
      entityId: String(value.id),
      table: 'artifacts',
      statement: 'INSERT INTO artifacts',
      foreignKeyColumn: 'project_id',
      referencedTable: 'projects',
      referencedId: String(value.projectId),
    }, `
      INSERT INTO artifacts (id, project_id, title, kind, local_path, availability, current_revision_id, created_at, updated_at, managed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title, kind=excluded.kind, local_path=excluded.local_path, availability=excluded.availability, current_revision_id=excluded.current_revision_id, managed=excluded.managed, updated_at=excluded.updated_at
    `, [value.id as SQLInputValue, value.projectId as SQLInputValue, value.title, value.kind, '', value.availability, value.currentRevisionId as SQLInputValue ?? null, value.createdAt, value.updatedAt, managed])
  }

  #presentationView(row: Row): PresentationViewV0 {
    const parsed = JSON.parse(String(row.state_json ?? '{}')) as unknown
    const state = (parsed !== null && typeof parsed === 'object' ? parsed : {}) as PresentationViewV0['state']
    return {
      schemaVersion: 0,
      id: String(row.id),
      projectId: String(row.project_id),
      scopeId: String(row.scope_id),
      capability: String(row.capability) as PresentationViewV0['capability'],
      renderer: String(row.renderer),
      state,
      version: Number(row.version ?? 0),
      updatedBy: String(row.updated_by) as PresentationViewV0['updatedBy'],
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }
  }

  #assertArtifactCurrentRevisionUnchanged(value: Artifact): void {
    const existing = this.getArtifact(String(value.id))
    if (existing !== undefined
      && String(existing.currentRevisionId ?? '') !== String(value.currentRevisionId ?? '')) {
      throw new RuntimeLifecycleConflictError('currentRevisionId may only change through an explicit Revision lifecycle.')
    }
  }

  #insertRun(run: Run): void {
    this.#database.prepare(`
      INSERT INTO runs (
        id, project_id, workspace_id, target_artifact_id, target_revision_id,
        context_manifest_id, retry_of_run_id, provider, requested_provider, output_intent, return_group_id, status, instruction,
        result_policy, result_summary, short_summary, error_code, error_message,
        created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      run.id as SQLInputValue, run.projectId as SQLInputValue, run.workspaceId as SQLInputValue ?? null,
      run.targetArtifactId as SQLInputValue, run.targetRevisionId as SQLInputValue,
      run.contextManifestId as SQLInputValue, run.retryOfRunId as SQLInputValue ?? null,
      run.provider, run.requestedProvider ?? run.provider, run.outputIntent ?? 'revise', run.returnGroupId ?? `return-group-${String(run.id)}`,
      run.status, run.instruction, run.resultPolicy === undefined ? null : JSON.stringify(run.resultPolicy),
      run.resultSummary ?? null, run.shortSummary ?? null,
      run.errorCode ?? null, run.errorMessage ?? null, run.createdAt, run.updatedAt, run.completedAt ?? null,
    )
  }

  #insertRuntimeDispatch(dispatch: RuntimeDispatch): void {
    this.#database.prepare(`
      INSERT INTO runtime_dispatches (
        id, run_id, provider, idempotency_key, status, attempt_count,
        last_error_code, last_error_message, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      dispatch.id as SQLInputValue, dispatch.runId as SQLInputValue, dispatch.provider,
      dispatch.idempotencyKey, dispatch.status, dispatch.attemptCount,
      dispatch.lastErrorCode ?? null, dispatch.lastErrorMessage ?? null,
      dispatch.createdAt, dispatch.updatedAt,
    )
  }

  #upsertArtifactView(value: ArtifactView): void {
    const viewArtifact = this.getArtifact(String(value.artifactId))
    if (viewArtifact !== undefined) {
      this.#assertOwnership(
        String(value.id),
        'ArtifactView',
        String(viewArtifact.projectId),
        (id) => {
          const view = this.#database.prepare('SELECT artifact_id FROM artifact_views WHERE id = ?').get(id as SQLInputValue) as { artifact_id?: unknown } | undefined
          if (view === undefined) return undefined
          const artifact = this.getArtifact(String(view.artifact_id))
          return artifact === undefined ? undefined : String(artifact.projectId)
        },
      )
    }
    this.#runStatement({
      operationType: 'upsert_artifact_view',
      entityId: String(value.id),
      table: 'artifact_views',
      statement: 'INSERT INTO artifact_views',
      foreignKeyColumn: 'artifact_id',
      referencedTable: 'artifacts',
      referencedId: String(value.artifactId),
    }, `
      INSERT INTO artifact_views VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET artifact_id=excluded.artifact_id, scope_id=excluded.scope_id, revision_id=excluded.revision_id, reference_kind=excluded.reference_kind, position=excluded.position, size=excluded.size, display_mode=excluded.display_mode, collapsed=excluded.collapsed
    `, [value.id as SQLInputValue, value.artifactId as SQLInputValue, value.scopeId as SQLInputValue, value.revisionId as SQLInputValue ?? null,
      value.referenceKind, JSON.stringify(value.position), JSON.stringify(value.size),
      value.displayMode, value.collapsed ? 1 : 0])
  }

  #upsertRelation(value: Relation): void {
    this.#assertOwnership(String(value.id), 'Relation', String(value.projectId), (id) => this.#ownerProjectOf('relations', id))
    this.#database.prepare(`
      INSERT INTO relations (id, project_id, source_entity_type, source_entity_id, target_entity_type, target_entity_id, kind, created_at, updated_at, origin, created_by, evidence_json, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET source_entity_type=excluded.source_entity_type, source_entity_id=excluded.source_entity_id, target_entity_type=excluded.target_entity_type, target_entity_id=excluded.target_entity_id, kind=excluded.kind, updated_at=excluded.updated_at, origin=excluded.origin, created_by=excluded.created_by, evidence_json=excluded.evidence_json, confidence=excluded.confidence
    `).run(
      value.id as SQLInputValue, value.projectId as SQLInputValue, value.sourceEntityType, value.sourceEntityId,
      value.targetEntityType, value.targetEntityId, value.kind, value.createdAt, value.updatedAt,
      value.origin ?? null, value.createdBy ?? null,
      value.evidenceRefs === undefined ? null : JSON.stringify(value.evidenceRefs),
      value.confidence ?? null,
    )
  }

  #upsertArtifactRevision(value: ArtifactRevision): void {
    const revisionArtifact = this.getArtifact(String(value.artifactId))
    if (revisionArtifact !== undefined) {
      this.#assertOwnership(
        String(value.id),
        'ArtifactRevision',
        String(revisionArtifact.projectId),
        (id) => {
          const revision = this.#database.prepare('SELECT artifact_id FROM artifact_revisions WHERE id = ?').get(id as SQLInputValue) as { artifact_id?: unknown } | undefined
          if (revision === undefined) return undefined
          const artifact = this.getArtifact(String(revision.artifact_id))
          return artifact === undefined ? undefined : String(artifact.projectId)
        },
      )
    }
    const fileRecord = this.getFileRecord(String(value.fileRecordId))
    if (fileRecord === undefined) {
      throw new MetadataForeignKeyConstraintError({
        operationType: 'upsert_artifact_revision',
        entityId: String(value.id),
        table: 'artifact_revisions',
        statement: 'INSERT INTO artifact_revisions',
        foreignKeyColumn: 'file_record_id',
        referencedTable: 'file_records',
        referencedId: String(value.fileRecordId),
        foreignKeyCheck: this.foreignKeyCheck(),
      })
    }
    this.#runStatement({
      operationType: 'upsert_artifact_revision',
      entityId: String(value.id),
      table: 'artifact_revisions',
      statement: 'INSERT INTO artifact_revisions',
      foreignKeyColumn: 'artifact_id',
      referencedTable: 'artifacts',
      referencedId: String(value.artifactId),
    }, `
      INSERT INTO artifact_revisions (
        id, artifact_id, parent_revision_id, local_path, content_hash,
        source, run_id, status, created_at, file_record_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status
    `, [value.id as SQLInputValue, value.artifactId as SQLInputValue, value.parentRevisionId as SQLInputValue ?? null, fileRecord.observedPath, value.contentHash as SQLInputValue, value.source, value.runId as SQLInputValue ?? null, value.status, value.createdAt, value.fileRecordId as SQLInputValue])
  }

  #upsertFileRecord(value: FileRecord): void {
    this.#assertOwnership(String(value.id), 'FileRecord', String(value.projectId), (id) => this.#ownerProjectOf('file_records', id))
    this.#runStatement({
      operationType: 'upsert_file_record',
      entityId: String(value.id),
      table: 'file_records',
      statement: 'INSERT INTO file_records',
      foreignKeyColumn: 'project_id',
      referencedTable: 'projects',
      referencedId: String(value.projectId),
    }, `
      INSERT INTO file_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        observed_path=excluded.observed_path,
        observed_hash=excluded.observed_hash,
        size=excluded.size,
        modified_at=excluded.modified_at,
        mime_type=excluded.mime_type,
        availability=excluded.availability,
        observed_at=excluded.observed_at
    `, [
      value.id as SQLInputValue,
      value.projectId as SQLInputValue,
      value.observedPath,
      value.observedHash as SQLInputValue,
      value.size,
      value.modifiedAt,
      value.mimeType,
      value.availability,
      value.observedAt,
    ])
  }

  #upsertPreviewRecord(value: PreviewRecord): void {
    this.#runStatement({
      operationType: 'upsert_preview_record',
      entityId: String(value.id),
      table: 'preview_records',
      statement: 'INSERT INTO preview_records',
      foreignKeyColumn: 'revision_id',
      referencedTable: 'artifact_revisions',
      referencedId: String(value.revisionId),
    }, `
      INSERT INTO preview_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source_content_hash=excluded.source_content_hash,
        renderer_id=excluded.renderer_id,
        renderer_version=excluded.renderer_version,
        preview_profile=excluded.preview_profile,
        cache_key=excluded.cache_key,
        cache_path=excluded.cache_path,
        mime_type=excluded.mime_type,
        size=excluded.size,
        status=excluded.status,
        error_message=excluded.error_message,
        updated_at=excluded.updated_at
    `, [
      value.id as SQLInputValue,
      value.projectId as SQLInputValue,
      value.revisionId as SQLInputValue,
      value.sourceContentHash as SQLInputValue,
      value.rendererId,
      value.rendererVersion,
      value.previewProfile,
      value.cacheKey,
      value.cachePath,
      value.mimeType,
      value.size,
      value.status,
      value.errorMessage ?? null,
      value.createdAt,
      value.updatedAt,
    ])
  }

  #upsertNote(value: Note): void {
    this.#assertOwnership(String(value.id), 'Note', String(value.projectId), (id) => this.#ownerProjectOf('notes', id))
    this.#database.prepare(`
      INSERT INTO notes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET anchor_scope=excluded.anchor_scope, artifact_id=excluded.artifact_id, artifact_view_id=excluded.artifact_view_id, page_index=excluded.page_index, body=excluded.body, updated_at=excluded.updated_at
    `).run(value.id as SQLInputValue, value.projectId as SQLInputValue, JSON.stringify(value.anchor),
      (value.anchor.type === 'artifact' ? value.anchor.artifactId : value.anchor.type === 'page' ? value.anchor.revisionId : null) ?? null,
      (value.anchor.type === 'artifact_view' ? value.anchor.viewId : null) ?? null,
      (value.anchor.type === 'page' ? value.anchor.pageIndex : null) ?? null,
      value.body, value.createdAt, value.updatedAt)
  }

  #upsertCheckpoint(value: Checkpoint): void {
    this.#assertOwnership(String(value.id), 'Checkpoint', String(value.projectId), (id) => this.#ownerProjectOf('checkpoints', id))
    this.#database.prepare(`
      INSERT INTO checkpoints VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(value.id as SQLInputValue, value.projectId as SQLInputValue, value.scopeId as SQLInputValue, value.label, JSON.stringify(value.snapshotJson), value.createdAt, value.workspaceId as SQLInputValue ?? null)
  }

  #runStatement(
    context: Omit<MetadataForeignKeyContext, 'foreignKeyCheck'>,
    sql: string,
    values: readonly SQLInputValue[],
  ): void {
    try {
      this.#database.prepare(sql).run(...values)
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('FOREIGN KEY constraint failed')) {
        throw new MetadataForeignKeyConstraintError({
          ...context,
          foreignKeyCheck: this.foreignKeyCheck(),
        }, error)
      }
      throw error
    }
  }

  #assertOwnership(id: string, label: string, projectId: string, ownerProjectOf: (id: string) => string | undefined): void {
    const ownerProjectId = ownerProjectOf(id)
    if (ownerProjectId !== undefined && String(ownerProjectId) !== String(projectId)) {
      throw new Error(`${label} ${id} already belongs to project ${ownerProjectId}; refusing cross-project upsert.`)
    }
  }

  #ownerProjectOf(table: 'scopes' | 'workspaces' | 'artifacts' | 'relations' | 'file_records' | 'notes' | 'checkpoints', id: string): string | undefined {
    const row = this.#database.prepare(`SELECT project_id FROM ${table} WHERE id = ?`).get(id as SQLInputValue) as { project_id?: unknown } | undefined
    return row === undefined || row.project_id === undefined || row.project_id === null ? undefined : String(row.project_id)
  }

  // ==================== Row → Entity ====================

  #project(row: Row): Project {
    return { id: row.id as ProjectId, name: String(row.name), rootPath: String(row.root_path), graphVersion: (row.graph_version as number) as GraphVersion, ...(row.last_opened_at ? { lastOpenedAt: String(row.last_opened_at) } : {}), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }
  }

  #scope(row: Row): Scope {
    return { id: row.id as ScopeId, projectId: row.project_id as ProjectId, parentScopeId: (row.parent_scope_id ?? null) as ScopeId | null, containerViewId: (row.container_view_id ?? null) as ArtifactViewId | null, kind: String(row.kind) as Scope['kind'], name: String(row.name), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }
  }

  #workspace(row: Row): Workspace {
    const id = row.id as WorkspaceId
    const projectId = row.project_id as ProjectId
    const scopeId = (row.scope_id as SQLInputValue) as unknown as ScopeId
    const name = String(row.name)
    const intent = row.intent ? String(row.intent) as Workspace['intent'] : null
    const viewport = json<Workspace['viewport']>(row.viewport as SQLInputValue)
    const focusedViewIds = json<Workspace['focusedViewIds']>((row.focused_node_ids ?? '[]') as SQLInputValue)
    const visibleLayers = json<string[]>((row.visible_layers ?? '["core","process"]') as SQLInputValue)
    const contextPolicy = (String(row.context_policy ?? 'selection-only')) as Workspace['contextPolicy']
    const updatedAt = String(row.updated_at)
    const frameBounds = row.frame_bounds === null || row.frame_bounds === undefined ? undefined : json<Workspace['frameBounds']>(row.frame_bounds as SQLInputValue)
    const preferredSurface = row.preferred_surface === null || row.preferred_surface === undefined ? undefined : String(row.preferred_surface)
    const version = row.version as number | undefined
    return {
      id, projectId, scopeId, name, intent, viewport, focusedViewIds, visibleLayers, contextPolicy,
      ...(frameBounds === undefined ? {} : { frameBounds }),
      ...(preferredSurface === undefined ? {} : { preferredSurface }),
      ...(version === undefined ? {} : { version }),
      updatedAt,
    }
  }

  #artifact(row: Row): Artifact {
    return { id: row.id as ArtifactId, projectId: row.project_id as ProjectId, title: String(row.title), kind: String(row.kind) as Artifact['kind'], managed: row.managed === 0 ? false : true, availability: String(row.availability) as Artifact['availability'], ...(row.current_revision_id === null || row.current_revision_id === undefined ? {} : { currentRevisionId: row.current_revision_id as ArtifactRevisionId }), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }
  }

  #artifactView(row: Row): ArtifactView {
    return { id: row.id as ArtifactViewId, artifactId: row.artifact_id as ArtifactId, scopeId: (row.scope_id ?? '') as unknown as ScopeId, ...(row.revision_id ? { revisionId: row.revision_id as ArtifactRevisionId } : {}), referenceKind: String(row.reference_kind) as ArtifactView['referenceKind'], position: json<ArtifactView['position']>(row.position as SQLInputValue), size: json<ArtifactView['size']>(row.size as SQLInputValue), displayMode: String(row.display_mode) as ArtifactView['displayMode'], collapsed: (row.collapsed as number) === 1 } as ArtifactView
  }

  #relation(row: Row): Relation {
    return {
      id: row.id as RelationId,
      projectId: row.project_id as ProjectId,
      sourceEntityType: String(row.source_entity_type) as Relation['sourceEntityType'],
      sourceEntityId: String(row.source_entity_id),
      targetEntityType: String(row.target_entity_type) as Relation['targetEntityType'],
      targetEntityId: String(row.target_entity_id),
      kind: String(row.kind),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      ...(row.origin ? { origin: String(row.origin) as Relation['origin'] } : {}),
      ...(row.created_by ? { createdBy: String(row.created_by) } : {}),
      ...(row.evidence_json ? { evidenceRefs: JSON.parse(String(row.evidence_json)) as Relation['evidenceRefs'] } : {}),
      ...(row.confidence !== undefined && row.confidence !== null ? { confidence: Number(row.confidence) } : {}),
    } as Relation
  }

  #artifactRevision(row: Row): ArtifactRevision {
    return { id: row.id as ArtifactRevisionId, artifactId: row.artifact_id as ArtifactId, fileRecordId: row.file_record_id as FileRecordId, contentHash: String(row.content_hash) as ArtifactRevision['contentHash'], source: String(row.source) as ArtifactRevision['source'], status: String(row.status) as ArtifactRevision['status'], createdAt: String(row.created_at), ...(row.parent_revision_id ? { parentRevisionId: row.parent_revision_id as ArtifactRevisionId } : {}), ...(row.run_id ? { runId: row.run_id as ArtifactRevision['runId'] } : {}) } as ArtifactRevision
  }

  #fileRecord(row: Row): FileRecord {
    return {
      id: row.id as FileRecordId,
      projectId: row.project_id as ProjectId,
      observedPath: String(row.observed_path),
      observedHash: String(row.observed_hash) as FileRecord['observedHash'],
      size: Number(row.size),
      modifiedAt: String(row.modified_at),
      mimeType: String(row.mime_type),
      availability: String(row.availability) as FileRecord['availability'],
      observedAt: String(row.observed_at),
    }
  }

  #previewRecord(row: Row): PreviewRecord {
    return {
      id: row.id as PreviewRecordId,
      projectId: row.project_id as ProjectId,
      revisionId: row.revision_id as ArtifactRevisionId,
      sourceContentHash: String(row.source_content_hash) as PreviewRecord['sourceContentHash'],
      rendererId: String(row.renderer_id),
      rendererVersion: String(row.renderer_version),
      previewProfile: String(row.preview_profile),
      cacheKey: String(row.cache_key),
      cachePath: String(row.cache_path),
      mimeType: String(row.mime_type),
      size: Number(row.size),
      status: String(row.status) as PreviewRecord['status'],
      ...(row.error_message ? { errorMessage: String(row.error_message) } : {}),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }
  }

  #note(row: Row): Note {
    const anchor = json<Note['anchor']>(row.anchor_scope as SQLInputValue)
    return { id: row.id as NoteId, projectId: row.project_id as ProjectId, anchor, body: String(row.body), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }
  }

  #checkpoint(row: Row): Checkpoint {
    return { id: row.id as CheckpointId, projectId: row.project_id as ProjectId, scopeId: (row.scope_id ?? '') as unknown as ScopeId, ...(row.workspace_id ? { workspaceId: row.workspace_id as WorkspaceId } : {}), label: String(row.label ?? ''), snapshotJson: json<Checkpoint['snapshotJson']>(row.snapshot_json as SQLInputValue), createdAt: String(row.created_at) }
  }

  #sessionSummary(row: Row): SessionSummary {
    return {
      id: String(row.id),
      projectId: String(row.project_id) as ProjectId,
      title: String(row.title),
      summary: String(row.summary),
      runIds: JSON.parse(String(row.run_ids)) as readonly RunId[],
      ...(row.handoff_ref ? { handoffRef: String(row.handoff_ref) } : {}),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }
  }

  #handoff(row: Row): HandoffRecord {
    const decisions = json<string[]>((row.decisions ?? '[]') as SQLInputValue)
    const openQuestions = json<string[]>((row.open_questions ?? '[]') as SQLInputValue)
    const nextActions = json<string[]>((row.next_actions ?? '[]') as SQLInputValue)
    const artifactRefs = json<HandoffRecord['artifactRefs']>((row.artifact_refs ?? '[]') as SQLInputValue)
    const messageRefs = json<string[]>((row.message_refs ?? '[]') as SQLInputValue)
    return {
      id: String(row.id),
      projectId: String(row.project_id) as ProjectId,
      title: String(row.title),
      resumeMode: (String(row.resume_mode ?? 'standard-handoff')) as HandoffRecord['resumeMode'],
      ...(row.from_provider ? { fromProvider: String(row.from_provider) } : {}),
      ...(row.to_provider ? { toProvider: String(row.to_provider) } : {}),
      ...(row.session_summary_id ? { sessionSummaryId: String(row.session_summary_id) } : {}),
      ...(row.context_snapshot_id ? { contextSnapshotId: String(row.context_snapshot_id) } : {}),
      decisions,
      openQuestions,
      nextActions,
      artifactRefs,
      messageRefs,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }
  }

  getActiveContext(projectId: string, workspaceId: string | null): ActiveContextV2 | undefined {
    const row = this.#database.prepare(`SELECT projection_json FROM active_contexts WHERE project_id = ? AND workspace_key = ?`).get(projectId, metadataWorkspaceKey(workspaceId)) as Row | undefined
    return row === undefined ? undefined : json<ActiveContextV2>(row.projection_json as SQLInputValue)
  }

  saveActiveContext(value: ActiveContextV2): void {
    this.#database.prepare(`
      INSERT INTO active_contexts(project_id, workspace_key, version, projection_json, updated_at)
      VALUES(?, ?, ?, ?, ?)
      ON CONFLICT(project_id, workspace_key) DO UPDATE SET
        version = excluded.version,
        projection_json = excluded.projection_json,
        updated_at = excluded.updated_at
    `).run(value.projectId, metadataWorkspaceKey(value.workspaceId), value.version, JSON.stringify(value), value.updatedAt)
  }

  getCommandDraft(projectId: string, workspaceId: string | null, composerAnchor: string): CommandDraftV1 | undefined {
    const row = this.#database.prepare(`SELECT * FROM command_drafts WHERE project_id = ? AND workspace_key = ? AND composer_anchor = ?`).get(projectId, metadataWorkspaceKey(workspaceId), composerAnchor) as Row | undefined
    if (row === undefined) return undefined
    return {
      schemaVersion: 1,
      projectId,
      workspaceId,
      composerAnchor,
      surfaceKind: String(row.surface_kind) as CommandDraftV1['surfaceKind'],
      surfaceId: row.surface_id === null ? null : String(row.surface_id),
      prompt: String(row.prompt),
      contextViewIds: json<readonly string[]>(row.context_view_ids_json as SQLInputValue),
      selectionViewIds: json<readonly string[]>(row.selection_view_ids_json as SQLInputValue),
      receiverId: row.receiver_id === null ? null : String(row.receiver_id),
      provider: String(row.provider),
      createAsNewNode: Number(row.create_as_new_node) === 1,
      intent: String(row.intent) as CommandDraftV1['intent'],
      resultPolicy: String(row.result_policy) as CommandDraftV1['resultPolicy'],
      updatedAt: String(row.updated_at),
    }
  }

  saveCommandDraft(value: CommandDraftV1): void {
    this.#database.prepare(`
      INSERT INTO command_drafts(project_id, workspace_key, composer_anchor, surface_kind, surface_id, prompt, context_view_ids_json, selection_view_ids_json, receiver_id, provider, create_as_new_node, intent, result_policy, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, workspace_key, composer_anchor) DO UPDATE SET
        surface_kind = excluded.surface_kind,
        surface_id = excluded.surface_id,
        prompt = excluded.prompt,
        context_view_ids_json = excluded.context_view_ids_json,
        selection_view_ids_json = excluded.selection_view_ids_json,
        receiver_id = excluded.receiver_id,
        provider = excluded.provider,
        create_as_new_node = excluded.create_as_new_node,
        intent = excluded.intent,
        result_policy = excluded.result_policy,
        updated_at = excluded.updated_at
    `).run(value.projectId, metadataWorkspaceKey(value.workspaceId), value.composerAnchor, value.surfaceKind, value.surfaceId, value.prompt, JSON.stringify(value.contextViewIds), JSON.stringify(value.selectionViewIds), value.receiverId, value.provider, value.createAsNewNode ? 1 : 0, value.intent, value.resultPolicy, value.updatedAt)
  }

  deleteCommandDraft(projectId: string, workspaceId: string | null, composerAnchor: string): void {
    this.#database.prepare(`DELETE FROM command_drafts WHERE project_id = ? AND workspace_key = ? AND composer_anchor = ?`).run(projectId, metadataWorkspaceKey(workspaceId), composerAnchor)
  }

  saveContextProposal(value: ContextChangeProposalV1): void {
    const now = new Date().toISOString()
    this.#database.prepare(`
      INSERT INTO context_proposals(proposal_id, project_id, workspace_key, status, proposal_json, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(proposal_id) DO UPDATE SET status = excluded.status, proposal_json = excluded.proposal_json, updated_at = excluded.updated_at
    `).run(value.proposalId, value.projectId, metadataWorkspaceKey(value.workspaceId), value.status, JSON.stringify(value), now, now)
  }

  getContextProposal(projectId: string, proposalId: string): ContextChangeProposalV1 | undefined {
    const row = this.#database.prepare(`SELECT proposal_json FROM context_proposals WHERE project_id = ? AND proposal_id = ?`).get(projectId, proposalId) as Row | undefined
    return row === undefined ? undefined : json<ContextChangeProposalV1>(row.proposal_json as SQLInputValue)
  }

  listContextProposals(projectId: string, workspaceId?: string | null): readonly ContextChangeProposalV1[] {
    const rows = workspaceId === undefined
      ? this.#database.prepare(`SELECT proposal_json FROM context_proposals WHERE project_id = ? ORDER BY created_at DESC`).all(projectId) as Row[]
      : this.#database.prepare(`SELECT proposal_json FROM context_proposals WHERE project_id = ? AND workspace_key = ? ORDER BY created_at DESC`).all(projectId, metadataWorkspaceKey(workspaceId)) as Row[]
    return rows.map((row) => json<ContextChangeProposalV1>(row.proposal_json as SQLInputValue))
  }

  // S3：RunRecipe → Skill Proposal seam（skill_proposals 表，v50）
  saveSkillProposal(value: SkillProposalV1): void {
    const now = new Date().toISOString()
    this.#database.prepare(`
      INSERT INTO skill_proposals(proposal_id, project_id, status, proposal_json, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?)
      ON CONFLICT(proposal_id) DO UPDATE SET status = excluded.status, proposal_json = excluded.proposal_json, updated_at = excluded.updated_at
    `).run(value.proposalId, value.projectId, value.status, JSON.stringify(value), value.createdAt, now)
  }

  getSkillProposal(projectId: string, proposalId: string): SkillProposalV1 | undefined {
    const row = this.#database.prepare(`SELECT proposal_json FROM skill_proposals WHERE project_id = ? AND proposal_id = ?`).get(projectId, proposalId) as Row | undefined
    return row === undefined ? undefined : json<SkillProposalV1>(row.proposal_json as SQLInputValue)
  }

  listSkillProposals(projectId: string): readonly SkillProposalV1[] {
    const rows = this.#database.prepare(`SELECT proposal_json FROM skill_proposals WHERE project_id = ? ORDER BY created_at DESC`).all(projectId) as Row[]
    return rows.map((row) => json<SkillProposalV1>(row.proposal_json as SQLInputValue))
  }

  saveImportBatch(value: ImportBatchRefV1): void {
    if (value.schemaVersion !== 1) throw new Error('ImportBatchRef schemaVersion must be 1.')
    if (this.getProject(value.projectId) === undefined) throw new Error('Project not found.')
    const existing = this.getImportBatch(value.projectId, value.id)
    if (existing !== undefined) {
      const stable = (batch: ImportBatchRefV1) => JSON.stringify({
        schemaVersion: batch.schemaVersion, projectId: batch.projectId, sourceKind: batch.sourceKind, status: batch.status,
        scopeId: batch.scopeId ?? null, importRequestIds: batch.importRequestIds, artifactIds: batch.artifactIds,
        revisionIds: batch.revisionIds, viewIds: batch.viewIds, createdAt: batch.createdAt,
      })
      if (stable(existing) !== stable(value)) throw new Error('IMPORT_BATCH_IDEMPOTENCY_CONFLICT')
      // A retried HTTP POST gets a fresh server completedAt. Preserve the first durable receipt.
      return
    }
    this.#database.prepare(`
      INSERT INTO import_batches(id, project_id, source_kind, status, scope_id, payload_json, created_at, completed_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        payload_json = excluded.payload_json,
        completed_at = excluded.completed_at
    `).run(value.id, value.projectId, value.sourceKind, value.status, value.scopeId ?? null, JSON.stringify(value), value.createdAt, value.completedAt)
  }

  getImportBatch(projectId: string, batchId: string): ImportBatchRefV1 | undefined {
    const row = this.#database.prepare(`SELECT payload_json FROM import_batches WHERE project_id = ? AND id = ?`).get(projectId, batchId) as Row | undefined
    return row === undefined ? undefined : json<ImportBatchRefV1>(row.payload_json as SQLInputValue)
  }

  getLatestImportBatch(projectId: string): ImportBatchRefV1 | undefined {
    const row = this.#database.prepare(`SELECT payload_json FROM import_batches WHERE project_id = ? ORDER BY completed_at DESC, rowid DESC LIMIT 1`).get(projectId) as Row | undefined
    return row === undefined ? undefined : json<ImportBatchRefV1>(row.payload_json as SQLInputValue)
  }

  listImportBatches(projectId: string, limit = 20): readonly ImportBatchRefV1[] {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)))
    const rows = this.#database.prepare(`SELECT payload_json FROM import_batches WHERE project_id = ? ORDER BY completed_at DESC, rowid DESC LIMIT ?`).all(projectId, safeLimit) as Row[]
    return rows.map((row) => json<ImportBatchRefV1>(row.payload_json as SQLInputValue))
  }

  saveRunInputRequest(value: RunInputRequestV1): void {
    const existing = this.getRunInputRequest(value.requestId)
    if (existing !== undefined) {
      const sameIdentity = existing.runId === value.runId
        && existing.question === value.question
        && JSON.stringify(existing.options) === JSON.stringify(value.options)
        && existing.allowFreeText === value.allowFreeText
        && existing.contextVersion === value.contextVersion
      if (!sameIdentity) throw new Error('INPUT_REQUEST_IDEMPOTENCY_CONFLICT')
      // A delayed provider sync must never reopen a question the user already answered or cancelled.
      if (existing.status !== 'pending' && value.status === 'pending') return
    }
    this.#database.prepare(`
      INSERT INTO run_input_requests(
        request_id, run_id, question, options_json, allow_free_text, context_version, status,
        answer_text, selected_options_json, created_at, answered_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(request_id) DO UPDATE SET
        status = excluded.status,
        answer_text = excluded.answer_text,
        selected_options_json = excluded.selected_options_json,
        answered_at = excluded.answered_at,
        updated_at = excluded.updated_at
    `).run(
      value.requestId, value.runId, value.question, JSON.stringify(value.options), value.allowFreeText ? 1 : 0,
      value.contextVersion ?? null, value.status, value.answerText ?? null, JSON.stringify(value.selectedOptions),
      value.createdAt, value.answeredAt ?? null, value.answeredAt ?? value.createdAt,
    )
  }

  getRunInputRequest(requestId: string): RunInputRequestV1 | undefined {
    const row = this.#database.prepare(`SELECT * FROM run_input_requests WHERE request_id = ?`).get(requestId) as Row | undefined
    return row === undefined ? undefined : this.#runInputRequest(row)
  }

  getPendingRunInputRequest(runId: string): RunInputRequestV1 | undefined {
    const row = this.#database.prepare(`
      SELECT * FROM run_input_requests WHERE run_id = ? AND status = 'pending'
      ORDER BY created_at DESC LIMIT 1
    `).get(runId) as Row | undefined
    return row === undefined ? undefined : this.#runInputRequest(row)
  }

  listRunInputRequests(runId: string): readonly RunInputRequestV1[] {
    return (this.#database.prepare(`SELECT * FROM run_input_requests WHERE run_id = ? ORDER BY created_at`).all(runId) as Row[])
      .map((row) => this.#runInputRequest(row))
  }

  answerRunInputRequest(runId: string, input: AnswerRunInputRequestV1, answeredAt: string): RunInputRequestV1 {
    const current = this.getRunInputRequest(input.requestId)
    if (current === undefined || current.runId !== runId) throw new Error('INPUT_REQUEST_NOT_FOUND')
    if (current.status === 'answered') return current
    if (current.status !== 'pending') throw new Error('INPUT_REQUEST_NOT_PENDING')
    const selectedOptions = [...new Set(input.selectedOptions ?? [])]
    if (selectedOptions.some((option) => !current.options.includes(option))) throw new Error('INPUT_OPTION_INVALID')
    const answerText = input.text?.trim()
    if (answerText && !current.allowFreeText) throw new Error('FREE_TEXT_NOT_ALLOWED')
    if (!answerText && selectedOptions.length === 0) throw new Error('INPUT_RESPONSE_EMPTY')
    const answered: RunInputRequestV1 = {
      ...current,
      status: 'answered',
      ...(answerText ? { answerText } : {}),
      selectedOptions,
      answeredAt,
    }
    this.saveRunInputRequest(answered)
    return answered
  }

  #runInputRequest(row: Row): RunInputRequestV1 {
    return {
      schemaVersion: 1,
      requestId: String(row.request_id),
      runId: String(row.run_id),
      question: String(row.question),
      options: json<readonly string[]>(row.options_json as SQLInputValue),
      allowFreeText: Number(row.allow_free_text) === 1,
      ...(row.context_version === null || row.context_version === undefined ? {} : { contextVersion: Number(row.context_version) }),
      status: String(row.status) as RunInputRequestV1['status'],
      ...(row.answer_text ? { answerText: String(row.answer_text) } : {}),
      selectedOptions: json<readonly string[]>(row.selected_options_json as SQLInputValue),
      createdAt: String(row.created_at),
      ...(row.answered_at ? { answeredAt: String(row.answered_at) } : {}),
    }
  }

  getProviderSessionBinding(projectId: string, provider: 'codex' | 'workbuddy'): ProviderSessionBindingV1 | undefined {
    const row = this.#database.prepare(`SELECT * FROM provider_session_bindings WHERE project_id = ? AND provider = ?`).get(projectId, provider) as Row | undefined
    if (row === undefined) return undefined
    return {
      projectId,
      provider,
      externalSessionId: String(row.external_session_id),
      origin: String(row.origin) as ProviderSessionBindingV1['origin'],
      status: String(row.status) as ProviderSessionBindingV1['status'],
      lastSeenAt: String(row.last_seen_at),
      ...(row.last_run_id ? { lastRunId: String(row.last_run_id) } : {}),
      ...(row.lease_owner ? { leaseOwner: String(row.lease_owner) } : {}),
      ...(row.lease_expires_at ? { leaseExpiresAt: String(row.lease_expires_at) } : {}),
      failureCount: Number(row.failure_count),
      updatedAt: String(row.updated_at),
    }
  }

  saveProviderSessionBinding(value: ProviderSessionBindingV1): void {
    this.#database.prepare(`
      INSERT INTO provider_session_bindings(project_id, provider, external_session_id, origin, status, last_seen_at, last_run_id, lease_owner, lease_expires_at, failure_count, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, provider) DO UPDATE SET
        external_session_id = excluded.external_session_id,
        origin = excluded.origin,
        status = excluded.status,
        last_seen_at = excluded.last_seen_at,
        last_run_id = excluded.last_run_id,
        lease_owner = excluded.lease_owner,
        lease_expires_at = excluded.lease_expires_at,
        failure_count = excluded.failure_count,
        updated_at = excluded.updated_at
    `).run(value.projectId, value.provider, value.externalSessionId, value.origin, value.status, value.lastSeenAt, value.lastRunId ?? null, value.leaseOwner ?? null, value.leaseExpiresAt ?? null, value.failureCount, value.updatedAt)
  }

  deleteProviderSessionBinding(projectId: string, provider: 'codex' | 'workbuddy'): void {
    this.#database.prepare(`DELETE FROM provider_session_bindings WHERE project_id = ? AND provider = ?`).run(projectId, provider)
  }

  // ==================== Phase 5 Live Session Binding：会话七态持久化 ====================

  getSessionLifecycleState(projectId: string, provider: string): SessionLifecycleRecordV1 | undefined {
    const row = this.#database.prepare('SELECT * FROM session_lifecycle_states WHERE project_id = ? AND provider = ?')
      .get(projectId, provider) as Row | undefined
    if (row === undefined) return undefined
    return {
      projectId: String(row.project_id),
      provider: String(row.provider),
      phase: String(row.phase),
      ...(row.stale_from ? { staleFrom: String(row.stale_from) } : {}),
      ...(row.last_transition_reason ? { lastTransitionReason: String(row.last_transition_reason) } : {}),
      updatedAt: String(row.updated_at),
    }
  }

  saveSessionLifecycleState(value: SessionLifecycleRecordV1): void {
    this.#database.prepare(`
      INSERT INTO session_lifecycle_states (project_id, provider, phase, stale_from, last_transition_reason, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, provider) DO UPDATE SET
        phase = excluded.phase, stale_from = excluded.stale_from,
        last_transition_reason = excluded.last_transition_reason, updated_at = excluded.updated_at
    `).run(
      value.projectId as SQLInputValue,
      value.provider as SQLInputValue,
      value.phase as SQLInputValue,
      value.staleFrom ?? null,
      value.lastTransitionReason ?? null,
      value.updatedAt as SQLInputValue,
    )
  }

  listSessionLifecycleStates(projectId: string): SessionLifecycleRecordV1[] {
    const rows = this.#database.prepare('SELECT * FROM session_lifecycle_states WHERE project_id = ? ORDER BY provider')
      .all(projectId) as Row[]
    return rows.map((row) => ({
      projectId: String(row.project_id),
      provider: String(row.provider),
      phase: String(row.phase),
      ...(row.stale_from ? { staleFrom: String(row.stale_from) } : {}),
      ...(row.last_transition_reason ? { lastTransitionReason: String(row.last_transition_reason) } : {}),
      updatedAt: String(row.updated_at),
    }))
  }

  /** 会话「还有活跃工作吗」判定素材：created/queued/running/waiting_input 的 run 数。 */
  countActiveRuns(projectId: string): number {
    const row = this.#database.prepare(
      "SELECT COUNT(*) AS count FROM runs WHERE project_id = ? AND status IN ('created','queued','running','waiting_input')",
    ).get(projectId as SQLInputValue) as Row
    return Number(row.count)
  }

  // ==================== RECEIVER-0：会话承接关系层（与 provider_session_bindings 并存） ====================

  listConnectedConversations(projectId: string): readonly ConnectedConversationV1[] {
    const rows = this.#database.prepare(`SELECT * FROM connected_conversations WHERE project_id = ? ORDER BY last_active_at DESC`).all(projectId) as Row[]
    return rows.map((row) => connectedConversationFromRow(row))
  }

  getConnectedConversation(projectId: string, id: string): ConnectedConversationV1 | undefined {
    const row = this.#database.prepare(`SELECT * FROM connected_conversations WHERE project_id = ? AND id = ?`).get(projectId, id) as Row | undefined
    return row === undefined ? undefined : connectedConversationFromRow(row)
  }

  getConnectedConversationByRef(projectId: string, conversationRef: string): ConnectedConversationV1 | undefined {
    const row = this.#database.prepare(`SELECT * FROM connected_conversations WHERE project_id = ? AND conversation_ref = ?`).get(projectId, conversationRef) as Row | undefined
    return row === undefined ? undefined : connectedConversationFromRow(row)
  }

  /**
   * Upsert by (project_id, conversation_ref)：同 ref 重复 connect 保持稳定 id 与 created_at。
   * conversation_session_id 不在 upsert 写面——canonical 链接只由 linkConnectedConversationSession
   * 唯一写路径维护，幂等 connect 刷新不得清掉已建立的链接。
   */
  linkConnectedConversationSession(projectId: string, connectedConversationId: string, conversationSessionId: string | null): ConnectedConversationV1 | undefined {
    const result = this.#database.prepare(
      'UPDATE connected_conversations SET conversation_session_id = ?, updated_at = ? WHERE project_id = ? AND id = ?',
    ).run(conversationSessionId as SQLInputValue, new Date().toISOString(), projectId as SQLInputValue, connectedConversationId as SQLInputValue)
    if (Number(result.changes) !== 1) return undefined
    return this.getConnectedConversation(projectId, connectedConversationId)
  }

  /** 出生 Run 读取：列值优先；迁移前存量按最早 adopted return 兜底（仍是结构事实，非启发式）。 */
  getArtifactBirthRunId(artifactId: string): string | undefined {
    const row = this.#database.prepare('SELECT birth_run_id FROM artifacts WHERE id = ?').get(artifactId as SQLInputValue) as Row | undefined
    if (row === undefined) return undefined
    if (row.birth_run_id !== null && row.birth_run_id !== undefined) return String(row.birth_run_id)
    const fallback = this.#database.prepare(
      "SELECT run_id FROM artifact_returns WHERE target_artifact_id = ? AND status = 'adopted' ORDER BY created_at, id LIMIT 1",
    ).get(artifactId as SQLInputValue) as Row | undefined
    return fallback === undefined ? undefined : String(fallback.run_id)
  }

  /** Upsert by (project_id, conversation_ref)：同 ref 重复 connect 保持稳定 id 与 created_at。 */
  upsertConnectedConversation(value: ConnectedConversationV1): ConnectedConversationV1 {
    this.#database.prepare(`
      INSERT INTO connected_conversations(id, project_id, provider, executor_id, conversation_ref, label, is_running, waiting_reason, last_active_at, workspace_ref, branch_ref, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, conversation_ref) DO UPDATE SET
        executor_id = excluded.executor_id,
        label = excluded.label,
        is_running = excluded.is_running,
        waiting_reason = excluded.waiting_reason,
        last_active_at = excluded.last_active_at,
        workspace_ref = excluded.workspace_ref,
        branch_ref = excluded.branch_ref,
        updated_at = excluded.updated_at
    `).run(value.id, value.projectId, value.provider, value.executorId, value.conversationRef, value.label, value.isRunning ? 1 : 0, value.waitingReason, value.lastActiveAt, value.workspaceRef, value.branchRef, value.createdAt, value.updatedAt)
    const persisted = this.getConnectedConversationByRef(value.projectId, value.conversationRef)
    if (persisted === undefined) throw new Error('Connected conversation upsert failed.')
    return persisted
  }

  deleteConnectedConversation(projectId: string, id: string): boolean {
    const result = this.#database.prepare(`DELETE FROM connected_conversations WHERE project_id = ? AND id = ?`).run(projectId, id)
    return Number(result.changes) > 0
  }

  /** 投影：connectedConversationIds 由 connected_conversations 实时投影；无行时返回空 binding（revision 0）。 */
  getProjectReceiverBinding(projectId: string): ProjectReceiverBindingV1 {
    const ids = this.#database.prepare(`SELECT id FROM connected_conversations WHERE project_id = ? ORDER BY last_active_at DESC`).all(projectId) as Row[]
    const row = this.#database.prepare(`SELECT * FROM project_receiver_bindings WHERE project_id = ?`).get(projectId) as Row | undefined
    return {
      schemaVersion: 1,
      projectId,
      connectedConversationIds: ids.map((item) => String(item.id)),
      activeReceiverId: row === undefined || row.active_receiver_id === null || row.active_receiver_id === undefined ? null : String(row.active_receiver_id),
      revision: row === undefined ? 0 : Number(row.revision),
    }
  }

  saveProjectReceiverBinding(input: { readonly projectId: string; readonly activeReceiverId: string | null; readonly revision: number; readonly updatedAt: string }): void {
    this.#database.prepare(`
      INSERT INTO project_receiver_bindings(project_id, active_receiver_id, revision, updated_at)
      VALUES(?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        active_receiver_id = excluded.active_receiver_id,
        revision = excluded.revision,
        updated_at = excluded.updated_at
    `).run(input.projectId, input.activeReceiverId, input.revision, input.updatedAt)
  }

  // ==================== RECEIVER-3：Handoff 快照（切换承接的现场冻结） ====================

  /** 存 pending handoff：同一 (project, to_conversation) 只保留最新一行（旧未消费行删除）。 */
  savePendingProjectHandoffPack(value: ProjectHandoffPackV1): void {
    this.#database.prepare('DELETE FROM project_handoff_packs WHERE project_id = ? AND to_conversation_id = ? AND consumed_at IS NULL')
      .run(value.projectId, value.toConversationId)
    this.#database.prepare(`
      INSERT INTO project_handoff_packs(id, project_id, from_conversation_id, to_conversation_id, surface_kind, surface_id, selection_entity_ids_json, created_at, consumed_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(`handoff-${randomUUID()}`,
      value.projectId, value.fromConversationId, value.toConversationId, value.surface.kind, value.surface.surfaceId,
      JSON.stringify(value.selectionEntityIds), value.createdAt, value.consumedAt)
  }

  /** 读 pending（最新未消费行）；无 pending 返回 null。 */
  getPendingProjectHandoffPack(projectId: string, toConversationId: string): ProjectHandoffPackV1 | null {
    const row = this.#database.prepare(`
      SELECT * FROM project_handoff_packs
      WHERE project_id = ? AND to_conversation_id = ? AND consumed_at IS NULL
      ORDER BY created_at DESC, rowid DESC LIMIT 1
    `).get(projectId, toConversationId) as Row | undefined
    return row === undefined ? null : projectHandoffPackFromRow(row)
  }

  /** 标记消费（幂等：无 pending 返回 null，不报错）。 */
  markProjectHandoffPackConsumed(projectId: string, toConversationId: string, consumedAt: string): ProjectHandoffPackV1 | null {
    const pending = this.getPendingProjectHandoffPack(projectId, toConversationId)
    if (pending === null) return null
    this.#database.prepare('UPDATE project_handoff_packs SET consumed_at = ? WHERE id = (SELECT id FROM project_handoff_packs WHERE project_id = ? AND to_conversation_id = ? AND consumed_at IS NULL ORDER BY created_at DESC, rowid DESC LIMIT 1)')
      .run(consumedAt, projectId, toConversationId)
    return { ...pending, consumedAt }
  }
}

// ==================== Module helpers ====================


function metadataWorkspaceKey(workspaceId: string | null | undefined): string {
  return workspaceId ?? '__project_overview__'
}


/** RECEIVER-0：connected_conversations 行 → 契约投影（原料字段原样，status 不落库）。 */
function connectedConversationFromRow(row: Row): ConnectedConversationV1 {
  return {
    schemaVersion: 1,
    id: String(row.id),
    projectId: String(row.project_id),
    provider: String(row.provider) as ConnectedConversationV1['provider'],
    executorId: String(row.executor_id),
    conversationRef: String(row.conversation_ref),
    ...(row.conversation_session_id === null || row.conversation_session_id === undefined ? {} : { conversationSessionId: String(row.conversation_session_id) }),
    label: String(row.label),
    isRunning: Number(row.is_running) === 1,
    waitingReason: row.waiting_reason === null || row.waiting_reason === undefined ? null : String(row.waiting_reason),
    lastActiveAt: String(row.last_active_at),
    workspaceRef: row.workspace_ref === null || row.workspace_ref === undefined ? null : String(row.workspace_ref),
    branchRef: row.branch_ref === null || row.branch_ref === undefined ? null : String(row.branch_ref),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}


/** RECEIVER-3：project_handoff_packs 行 → 契约投影（selectionEntityIds 存 JSON 数组）。 */
function projectHandoffPackFromRow(row: Row): ProjectHandoffPackV1 {
  const selectionRaw = row.selection_entity_ids_json === null || row.selection_entity_ids_json === undefined ? '[]' : String(row.selection_entity_ids_json)
  let selectionEntityIds: readonly string[] = []
  try {
    const parsed: unknown = JSON.parse(selectionRaw)
    if (Array.isArray(parsed)) selectionEntityIds = parsed.map((item) => String(item))
  } catch { /* 损坏行按空选中处理，不让投影层抛错 */ }
  return {
    schemaVersion: 1,
    projectId: String(row.project_id),
    fromConversationId: row.from_conversation_id === null || row.from_conversation_id === undefined ? null : String(row.from_conversation_id),
    toConversationId: String(row.to_conversation_id),
    surface: { kind: String(row.surface_kind) as ProjectHandoffPackV1['surface']['kind'], surfaceId: String(row.surface_id) },
    selectionEntityIds,
    createdAt: String(row.created_at),
    consumedAt: row.consumed_at === null || row.consumed_at === undefined ? null : String(row.consumed_at),
  }
}


/** Presentation-only ops — do NOT advance graphVersion. */
const PRESENTATION_OPS = new Set([
  'move_artifact_view',
  'resize_artifact_view',
  'update_workspace_viewport',
  'update_workspace_presentation',
  'update_workspace_frame',
  'update_artifact_view_presentation',
  'delete_artifact_view',
])

/**
 * .lcosproj 工程文件拷贝清单（父表在前；WHERE 统一接受 projectId 参数）。
 */
const PROJECT_TRUTH_TABLES: readonly { readonly table: string; readonly where: string }[] = [
  { table: 'projects', where: 'id = ?' },
  { table: 'active_contexts', where: 'project_id = ?' },
  { table: 'context_proposals', where: 'project_id = ?' },
  { table: 'import_batches', where: 'project_id = ?' },
  { table: 'command_drafts', where: 'project_id = ?' },
  { table: 'provider_session_bindings', where: 'project_id = ?' },
  { table: 'connected_conversations', where: 'project_id = ?' },
  { table: 'project_receiver_bindings', where: 'project_id = ?' },
  { table: 'project_handoff_packs', where: 'project_id = ?' },
  { table: 'scopes', where: 'project_id = ?' },
  { table: 'workspaces', where: 'project_id = ?' },
  { table: 'artifacts', where: 'project_id = ?' },
  { table: 'file_records', where: 'project_id = ?' },
  { table: 'artifact_revisions', where: 'artifact_id IN (SELECT id FROM artifacts WHERE project_id = ?)' },
  { table: 'artifact_views', where: 'artifact_id IN (SELECT id FROM artifacts WHERE project_id = ?)' },
  { table: 'relations', where: 'project_id = ?' },
  { table: 'conversation_sessions', where: 'project_id = ?' },
  { table: 'conversation_messages', where: 'session_id IN (SELECT id FROM conversation_sessions WHERE project_id = ?) AND pinned_as_decision = 1' },
  { table: 'conversation_file_references', where: 'message_id IN (SELECT m.id FROM conversation_messages m JOIN conversation_sessions s ON s.id = m.session_id WHERE s.project_id = ? AND m.pinned_as_decision = 1)' },
  { table: 'conversation_sections', where: 'session_id IN (SELECT id FROM conversation_sessions WHERE project_id = ?)' },
  { table: 'conversation_section_annotations', where: 'section_id IN (SELECT cs.id FROM conversation_sections cs JOIN conversation_sessions s ON s.id = cs.session_id WHERE s.project_id = ?)' },
  { table: 'conversation_messages_fts', where: 'message_id IN (SELECT m.id FROM conversation_messages m JOIN conversation_sessions s ON s.id = m.session_id WHERE s.project_id = ? AND m.pinned_as_decision = 1)' },
  { table: 'notes', where: 'project_id = ?' },
  { table: 'checkpoints', where: 'project_id = ?' },
  { table: 'handoffs', where: 'project_id = ?' },
  { table: 'context_manifests', where: 'project_id = ?' },
  { table: 'runs', where: 'project_id = ?' },
  { table: 'session_summaries', where: 'project_id = ?' },
  { table: 'preview_records', where: 'project_id = ?' },
  { table: 'runtime_dispatches', where: 'run_id IN (SELECT id FROM runs WHERE project_id = ?)' },
  { table: 'runtime_bindings', where: 'run_id IN (SELECT id FROM runs WHERE project_id = ?)' },
  { table: 'artifact_returns', where: 'run_id IN (SELECT id FROM runs WHERE project_id = ?)' },
  { table: 'run_events', where: 'run_id IN (SELECT id FROM runs WHERE project_id = ?)' },
  { table: 'run_input_requests', where: 'run_id IN (SELECT id FROM runs WHERE project_id = ?)' },
  { table: 'workspace_memberships', where: 'workspace_id IN (SELECT id FROM workspaces WHERE project_id = ?)' },
]

/**
 * 导入前按反向 FK 顺序清空目标库中该项目的旧行。
 */
const PROJECT_TRUTH_DELETE_SQL: readonly string[] = [
  'DELETE FROM conversation_file_references WHERE message_id IN (SELECT m.id FROM conversation_messages m JOIN conversation_sessions s ON s.id = m.session_id WHERE s.project_id = ?)',
  'DELETE FROM conversation_messages_fts WHERE message_id IN (SELECT m.id FROM conversation_messages m JOIN conversation_sessions s ON s.id = m.session_id WHERE s.project_id = ?)',
  'DELETE FROM conversation_section_annotations WHERE section_id IN (SELECT cs.id FROM conversation_sections cs JOIN conversation_sessions s ON s.id = cs.session_id WHERE s.project_id = ?)',
  'DELETE FROM conversation_sections WHERE session_id IN (SELECT id FROM conversation_sessions WHERE project_id = ?)',
  'DELETE FROM conversation_messages WHERE session_id IN (SELECT id FROM conversation_sessions WHERE project_id = ?)',
  'DELETE FROM conversation_sessions WHERE project_id = ?',
  'DELETE FROM workspace_memberships WHERE workspace_id IN (SELECT id FROM workspaces WHERE project_id = ?)',
  'DELETE FROM run_input_requests WHERE run_id IN (SELECT id FROM runs WHERE project_id = ?)',
  'DELETE FROM run_events WHERE run_id IN (SELECT id FROM runs WHERE project_id = ?)',
  'DELETE FROM artifact_returns WHERE run_id IN (SELECT id FROM runs WHERE project_id = ?)',
  'DELETE FROM runtime_bindings WHERE run_id IN (SELECT id FROM runs WHERE project_id = ?)',
  'DELETE FROM runtime_dispatches WHERE run_id IN (SELECT id FROM runs WHERE project_id = ?)',
  // runs/context_manifests 必须删在 artifact_revisions 之前：runs.target_revision_id、
  // context_manifests.target_revision_id 都是 RESTRICT 外键，跑过真实 Run 的项目
  // 先删 revision 会 FOREIGN KEY constraint failed（曾导致 DELETE /projects/:id 500）。
  'DELETE FROM runs WHERE project_id = ?',
  'DELETE FROM context_manifests WHERE project_id = ?',
  'DELETE FROM preview_records WHERE project_id = ?',
  'DELETE FROM session_summaries WHERE project_id = ?',
  'DELETE FROM checkpoints WHERE project_id = ?',
  'DELETE FROM handoffs WHERE project_id = ?',
  'DELETE FROM notes WHERE project_id = ?',
  'DELETE FROM relations WHERE project_id = ?',
  'DELETE FROM artifact_views WHERE artifact_id IN (SELECT id FROM artifacts WHERE project_id = ?)',
  // resource_descriptors.source_revision_id / artifact_id 是 NO ACTION 外键，
  // 必须先于 artifact_revisions/artifacts 清理（resource_analysis_jobs 是 CASCADE 会自动删）。
  'DELETE FROM resource_descriptors WHERE artifact_id IN (SELECT id FROM artifacts WHERE project_id = ?)',
  'DELETE FROM artifact_revisions WHERE artifact_id IN (SELECT id FROM artifacts WHERE project_id = ?)',
  'DELETE FROM file_records WHERE project_id = ?',
  'DELETE FROM artifacts WHERE project_id = ?',
  'DELETE FROM workspaces WHERE project_id = ?',
  'DELETE FROM scopes WHERE project_id = ?',
  'DELETE FROM project_receiver_bindings WHERE project_id = ?',
  'DELETE FROM project_handoff_packs WHERE project_id = ?',
  'DELETE FROM connected_conversations WHERE project_id = ?',
  'DELETE FROM provider_session_bindings WHERE project_id = ?',
  'DELETE FROM command_drafts WHERE project_id = ?',
  'DELETE FROM context_proposals WHERE project_id = ?',
  'DELETE FROM import_batches WHERE project_id = ?',
  'DELETE FROM active_contexts WHERE project_id = ?',
  // 以下表无 ON DELETE CASCADE，需显式清理避免孤儿行（schema v25/v30/v31/v34）。
  'DELETE FROM mutation_change_sets WHERE project_id = ?',
  'DELETE FROM curation_operation_receipts WHERE project_id = ?',
  'DELETE FROM project_view_rail_order WHERE project_id = ?',
  'DELETE FROM capture_staging_items WHERE resolved_project_id = ?',
  'DELETE FROM projects WHERE id = ?',
]

function isSemanticOp(op: { type: string }): boolean {
  return !PRESENTATION_OPS.has(op.type) && op.type !== 'bootstrap'
}

function resolveProjectId(ops: readonly { type: string; [key: string]: unknown }[]): string | null {
  for (const op of ops) {
    if (op.type === 'bootstrap' && op.snapshot) return String((op.snapshot as { project?: { id?: string } })?.project?.id ?? '')
    // Direct projectId on operation-level payload
    if (op.projectId) return String(op.projectId)
    // Nested entity payloads
    for (const key of ['artifact', 'workspace', 'scope', 'view', 'relation', 'note'] as const) {
      const entity = (op as Record<string, Record<string, unknown> | undefined>)[key]
      if (entity?.projectId) return String(entity.projectId)
    }
  }
  return null
}

function entityIdForOperation(op: MutationBatch['ops'][number] | undefined): string {
  if (op === undefined) return 'unknown'
  if ('artifact' in op) return String(op.artifact.id)
  if ('view' in op) return String(op.view.id)
  if ('workspace' in op) return String(op.workspace.id)
  if ('scope' in op) return String(op.scope.id)
  if ('relation' in op) return String(op.relation.id)
  if ('note' in op) return String(op.note.id)
  if ('viewId' in op) return String(op.viewId)
  if ('workspaceId' in op) return String(op.workspaceId)
  if ('workspaceIds' in op) return String((op.workspaceIds as readonly unknown[])[0] ?? 'project')
  if ('relationId' in op) return String(op.relationId)
  return op.type
}

function tableForOperation(op: MutationBatch['ops'][number] | undefined): string {
  if (op === undefined) return 'unknown'
  if (op.type.includes('workspace')) return 'workspaces'
  if (op.type.includes('scope')) return 'scopes'
  if (op.type.includes('artifact_view')) return 'artifact_views'
  if (op.type.includes('artifact')) return 'artifacts'
  if (op.type.includes('relation')) return 'relations'
  if (op.type.includes('note')) return 'notes'
  return 'unknown'
}

function statementForOperation(op: MutationBatch['ops'][number] | undefined): string {
  if (op === undefined) return 'mutation'
  if (op.type.startsWith('upsert_')) return `INSERT INTO ${tableForOperation(op)}`
  if (op.type.startsWith('delete_')) return `DELETE FROM ${tableForOperation(op)}`
  if (op.type.startsWith('update_') || op.type.startsWith('move_') || op.type.startsWith('resize_')) return `UPDATE ${tableForOperation(op)}`
  return op.type
}
