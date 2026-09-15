# GEN2 R1 Semantic Drop Foundation · R1.1 handoff · 2026-09-15

```text
ROUTE: R1
SLICE: R1.1 target identity + resolver + owner bridge
BASE: frontend-reconstruction-v2 @ 97841d6
WORKTREE: E:/OS开发/LCOS_Gen2_R1_Work
BRANCH: codex/r1-semantic-drop-foundation
STATUS: IMPLEMENTED LOCALLY / NOT PUSHED
```

## 这轮解决了什么

旧路径把 left/bottom edge band 直接当成 `surface:*` 目的地。这样界面可以显示“预览”，release 却没有真实业务 owner，而且 target 变化时可能看见 A、实际提交 B。

现在路径固定为：

```text
真实 payload
→ live target registry（稳定 targetId + DOM rect）
→ 单一 DropIntentResolver
→ preview 保存同一个 resolution
→ pointer-up 冻结 transaction + intent
→ DropCommitRouter 调现有 Core Assembly / Composer owner
```

Registry 只存本次 host 的瞬时命中几何，不落 Core、不建第二 Canvas/Railway/Assembly/Composer truth。

## 修改文件

### web-gen2 pure model

- `apps/web-gen2/src/interaction/semanticDropMachine.ts`
  - `DropPayload.assembly` 必须携带 `AssemblySourceRefV1`；
  - destination 收敛为 `targetId + previewPoint`；
  - preview 带 carry anchor；
  - target 改变会使旧 preview 回到 tracking；
  - commit 必须携带匹配的 intent snapshot。
- `apps/web-gen2/src/index.ts` 导出 `DropIntentSnapshot`。
- `apps/web-gen2/test/semanticDropMachine.test.ts` 增加 target-change 与新 commit 断言。

### Huabu host adapter

- `huabu/apps/web/src/lcos/drop/dropTypes.ts`
- `huabu/apps/web/src/lcos/drop/dropTargetRegistry.ts`
- `huabu/apps/web/src/lcos/drop/dropIntentResolver.ts`
- `huabu/apps/web/src/lcos/drop/dropCommitRouter.ts`
- `huabu/apps/web/src/lcos/drop/dropFoundation.test.ts`
- `huabu/apps/web/src/lcos/lcosDropState.ts`
- `huabu/apps/web/src/lcos/lcosRecognizers.ts`
- `huabu/apps/web/src/lcos/LcosHostOverlay.tsx`
- `huabu/apps/web/src/lcos/LcosDropPreview.tsx`
- `huabu/apps/web/src/lcos/composer/LcosComposerHost.tsx`
- `huabu/apps/web/src/lcos/shell/LcosRailway.tsx`
- `huabu/apps/web/src/lcos/ui/families/LcosRailwayView.tsx`

Canvas target 由 `projectId/canvasId/activeSurface/activeWorkspaceId` 派生；Railway item 由真实 `kind/viewId/workspaceId` 派生；Composer 只注册真实 textarea。Canvas placement 使用 Huabu `screenToFlowPosition`，写入仍走既有 `CoreAssemblyClient.apply`。

### Assembly identity reuse

- `huabu/apps/web/src/lcos/professional/assemblySourceRef.ts`
- `AssemblyBody.tsx` 改为复用该 helper，并继续 re-export 兼容既有测试/调用者。

## 验证

- `npm run typecheck:web-gen2`：PASS。
- `npm run test --workspace @local-creative-os/web-gen2`：PASS，282/282。
- Huabu R1 focused tests（drop foundation / store / recognizer）：PASS，30/30。
- `npx --no-install tsc -p huabu/apps/web/tsconfig.json --noEmit`：新增 R1 文件无错误；仍有基线错误：`useAgentStream.ts` 的 agent tool event 字段，以及 `@agenetes/protocol` 未解析/Zod schema 不一致。
- `git diff --check`：PASS。
- `LcosDropPreview.test.tsx` / `LcosHostOverlay.test.tsx` 未作为通过证据：当前隔离 worktree 的 junction 依赖导致 React 多副本 invalid hook call，HostOverlay 还受既有 `@agenetes/protocol` 解析缺口影响。

## 尚未宣称完成

R1.1 还没有完成 R1 的全部浏览器闭环。以下仍是下一片：

- Assembly 卡的真实 drag source acquisition 与 drag-end 适配；
- live pointer drag/dwell/release 的真实浏览器证据；
- Railway receive 的浏览器路径（目前 target registration 已就位）；
- 真实 Capture/import owner 接入（无 owner 时 resolver fail-close）；
- commit success/failure 的视觉 receipt 与 reload 证据；
- R1.2 独立提交、R1.3 浏览器验收。

## 回滚

本 slice 是独立 worktree/分支；回滚只需不合并该分支，或对本 slice 做审查后的 revert。没有修改主工作区，也没有触碰 Huabu upstream。
