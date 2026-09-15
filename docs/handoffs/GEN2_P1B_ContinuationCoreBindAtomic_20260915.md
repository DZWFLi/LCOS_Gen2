# GEN2 P1-B｜Continuation `core_bind` 原子事务

```text
ROUTE: local-core / T6 continuation
STATUS: LOCAL COMMIT READY
BASE: frontend-reconstruction-v2@e8579bb
SCOPE: P1-B only
PUSH: not performed
```

## 目标

把“外部 session 已恢复”到 Core canonical receiver 的绑定做成一个 SQLite 事务：

```text
BEGIN IMMEDIATE
  读取 journal + CAS revision
  校验 core_bind=pending / provider / ref 唯一性
  解析或创建 ConnectedConversation
  回写 journal.connectedConversationId
  core_bind = confirmed，revision + 1
COMMIT
```

任一校验或 CAS 失败都整体 rollback。这样不会出现 ConnectedConversation 已换绑、journal 却仍停在 pending 的半状态。

## 变更文件

- `apps/local-core/src/metadata-repository.ts`
  - 新增 `confirmContinuationCoreBind()`，事务 owner 保持在 repository。
  - 新增 `ConfirmContinuationCoreBindInput/Result`。
  - 新增 `ContinuationCoreBindStaleRevisionError`，让 service 把 CAS 冲突映射为公开 stale error。
  - 新建 continuation 时把真实 canonical conversation id 回写 journal；已有 id 保留稳定身份，外部 ref 可安全换绑；同 project/provider ref 复用，跨 project、provider 冲突 fail-close。
- `apps/local-core/src/conversation-continuation-service.ts`
  - `#recoverBind()` 改为调用单事务 repository 方法。
  - `resumed` 成功后发布新的 continuity 事实并返回 fresh journal projection。
  - `ContinuationCoreBindStaleRevisionError` 不转写为 failed，直接抛 `ContinuationStaleRevisionError`；普通绑定失败才记 `core_bind=failed`。
- `apps/local-core/tests/continuation-recovery-action.test.ts`
  - blank/new continuation 的 canonical id 回写验证。
  - stale CAS 时插入与 journal 更新整体回滚验证。

## 关键语义

```text
provider continueExisting(resumed)
  → repository.confirmContinuationCoreBind()
     → canonical ConnectedConversation
     → journal core_bind=confirmed
  → fresh recovery projection
```

`connectedConversationId` 为空的 blank/new continuation 不再留下空引用；`conversation_ref` 的唯一约束仍由现有表约束负责，repository 在事务内先检查并给出结构化失败。Service 不再执行 `rebind + advanceStep` 两次独立持久化。

## 验证

```text
npx vitest run tests/continuation-recovery-action.test.ts tests/conversation-continuation-service.test.ts --maxWorkers=1  PASS (32 tests)
npm run typecheck --workspace @local-creative-os/local-core                     PASS
npm run build --workspace @local-creative-os/local-core                          PASS
```

仓级 local-core 全量仍有 31 个既有失败，未归因给本批：主要是仓库缺失 `tools/lcos-agent`、旧 schemaVersion=50 断言、sqlite-vec/skill/资源 CLI 等环境或基线问题；本批目标文件测试 32/32 全绿。

## 未包含

- T7 Huabu Gateway / Agentlet transport（P1-C）；
- P2 文档与 `pnpm-workspace.yaml` 清理；
- 未归入 continuation 的 local-core 脏改动；
- 自动 push。

## 回滚

使用审查过的 `git revert <commit>` 回退本小提交。不要 reset 或覆盖工作区其它未提交改动。
