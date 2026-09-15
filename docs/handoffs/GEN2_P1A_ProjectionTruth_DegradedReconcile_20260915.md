# GEN2 P1-A｜Projection / Presentation Truth 与 Degraded Reconcile

```text
ROUTE: web-gen2
STATUS: LOCAL COMMIT READY
BASE: frontend-reconstruction-v2@1c6a80f
COMMIT: pending
SCOPE: P1-A only
PUSH: not performed
```

## 目标

把投影链路的三个事实闭合：

```text
Core ArtifactView（当前 canvas / scope）
  → deterministic view selection
  → selected revision
  → ArtifactRevision.fileRecordId
  → FileRecord.mimeType
  → visual family / Huabu host type
```

新投影使用 Figma 初始 footprint；已有 Huabu binding 只复用持久化 geometry。单个节点或关系失败时保留已成功结果，返回可检查的 degraded 回执，并由宿主最多补跑一次。

## 变更前后

```text
旧：array first view → 可能取错 revision/MIME
  → item failure 只 console.warn / batch 语义不明
  → lifecycle 看不到 degraded

新：scope → focusedViewIds → primary → stable viewId
  → selected revision → FileRecord MIME
  → ProjectionBatchReport / ReconciliationFailureSummary
  → 一次 bounded retry（retry 自身不递归）
```

## 已实施文件

- `apps/web-gen2/src/presentation/visualFamily.ts`
  - MIME 参数标准化；selected revision MIME 优先于 kind；audio 保持 presentation family，Huabu create host 映射为 note。
- `apps/web-gen2/src/spatial/reconciliationRunner.ts`
  - `viewPresentationByArtifact()`：scope、focused、primary、稳定 viewId 选择。
  - `mimeTypeByArtifact()`：revision → FileRecord MIME 链接。
  - `entityType:entityId` 作为 relation lookup key，避免 artifact/conversation 同 ID 串线。
  - `ReconciliationResult.failures` 与 `degraded`；单项 relation/orphan 错误继续处理。
- `apps/web-gen2/src/spatial/projectToSpaceProjection.ts`
  - 新增 `ProjectionItemFailure`、`ProjectionBatchReport`。
  - 保留 `projectBatch()` / `projectArtifacts()` 返回数组的兼容 API。
  - `projectBatchWithReport()` / `projectArtifactsWithReport()` 返回部分成功与失败明细。
  - `readPlacementSpace()` 等基础设施失败仍抛出；单项 CREATE_NODES 失败进入 failures。
  - 新投影采用 Figma preset → explicit Core size → mechanical fallback；已有 binding 不改 geometry。
- `apps/web-gen2/src/host/projectionFacade.ts`
  - `readEntityFacts()` 复用同一个 view selector，按 selected revision 读取 MIME/preview。
- `apps/web-gen2/src/host/lifecycleReconciler.ts`
  - Runner 返回 `degraded`；新增单实例 `retry` timer；一次补跑后不递归。
- `apps/web-gen2/src/index.ts`
  - 导出 projection/reconciliation 回执类型。

## 测试与证据

新增或调整：

- `apps/web-gen2/test/visualFamily.test.ts`
- `apps/web-gen2/test/figma-projection-geometry.test.ts`
- `apps/web-gen2/test/binding-projection.test.ts`
- `apps/web-gen2/test/g08-closure.test.ts`
- `apps/web-gen2/test/g09-host.test.ts`

已执行：

```text
npm run typecheck:web-gen2                         PASS
npm run build --workspace @local-creative-os/web-gen2 PASS
npm run test:web-gen2                             PASS (281 tests)
npx tsx --test apps/web-gen2/test/g09-host.test.ts PASS (11 tests)
```

覆盖重点：

- view/revision 数组反转不改变 species；
- MIME 只从选中的 revision/FileRecord 得出；
- Figma geometry 只用于新节点；
- partial projection 可重试且不重复成功 binding；
- artifact/conversation 同 ID 不串 relation；
- degraded 首次运行只产生一次 retry，retry degraded 也不会无限递归。

## 未包含

- local-core continuation 原子 `core_bind`（P1-B）；
- Huabu Gateway/Agentlet transport（P1-C）；
- `pnpm-workspace.yaml` 清理（P2）；
- Trae 及其他未归入本批的工作区文件、文档与依赖变更；
- 自动 push。

## 回滚

本提交只包含上述 web-gen2 投影/呈现文件与测试。需要回滚时使用审查过的 `git revert <commit>`，不 reset、不覆盖工作区其他未提交文件。
