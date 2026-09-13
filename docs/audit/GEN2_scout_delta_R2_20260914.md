# GEN2 Scout 增量 — R2 期间的只读发现（2026-09-14）

用途：R2 施工时暴露/证实的事实，供 **R3（Professional/Assembly/Reader）/ R4（Context/Portal/Atlas/Temporal）/ R5（Workflow/Hand/Cards）** 的 Work Packet 引用。
性质：只读审计结论 + 精确 file/symbol 定位；**不含任何生产源码改动**（R3/R4/R5 的源码写入要等 R2 验收通过）。
三份完整 Work Packet 在 `E:\Codex 项目\OS开发\deliverables\GEN2_新前端重新总装正本_20260913\parallel-prep\`（仓库外，本文件只做增量）。

---

## 1. Portal 族生产不可达（推翻 R1 的一处记录）

- 事实：`resolveNodeBody`（host extension 的 `CanvasNodeBodySeam`）在 Huabu 侧只有**一个**消费方 —— `huabu/apps/web/src/components/Nodes/note/NoteNode.tsx`（`useResolvedNodeBody`，`nodeType` 恒为 `note`）。
- 原生 Portal 是 `canvasRef` 节点（`components/Nodes/canvasRef/CanvasRefNode.tsx`，`data.targetCanvasId`），它**不会**向该 junction 请求 body。
- 因此 `createLcosNodePresentationSeam` 里的 `canvasRef → portal` 分支、`lcos/nodes/PortalNodeBody.tsx`、`lcos/professional/PortalPreviewBody.tsx`、`LcosPortalPreview` 族目前**只有 gallery + 机制**，生产不可达。
- R4 待办：Portal 机械改为 Huabu `canvasRef` + `SpacePreviewViewport`（禁用 `navigate('/canvas/:id')`），并决定"哪个 junction 消费方渲染 portal body"。
- 证据：`docs/construction/FIGMA_SOURCE_LEDGER.md` §一 FIG-FAM-PORTAL、§四.6；`huabu/apps/web/src/lcos/nodes/createLcosNodePresentationSeam.ts`。

## 2. junction 消费面 = 只有 note 家族（决定所有 body 的可见范围）

- `huabu/apps/web/src/components/Panels/Canvas/Canvas.tsx:1532` 用 `NodeBodyResolverContext.Provider` 把 seam 下发；
- 消费方只有 `NoteNode.tsx:103`。`TextNode.tsx` 不消费（R0 已按 16 号要求撤掉那 21 行试探性补丁）。
- 机械投影结果：markdown/text → Huabu `text`（TextNode）；pdf/presentation/file/conversation/skill/run → `note`（NoteNode）。
- 结论：**凡是希望被 LCOS 物种 body 呈现的 Core 实体，其 Huabu 节点类型必须是 `note`，或者新增 junction 消费方**。R3/R4/R5 定物种呈现方案时先过这一条。

## 3. 文本族投影没有真实内容位（R2 未达成项，需产品裁定）

- 现象：新投影的 text artifact 是 Huabu TextNode，其 `data.content` 为空 → 界面显示 "Type..." 空编辑器占位，artifact 标题与次级行都看不到。
- 两条路（R2 handoff §6 已请用户裁定）：
  - (A) 允许画布就地编辑 Core 投影 → 需要把 artifact 内容接进节点，并定义"编辑 vs Core revision"语义；
  - (B) 只读投影 → 走 LCOS 物种 body（`projectedNodeDescriptor` 的真实标题/次级行），不可编辑。
- 相关：`apps/web-gen2/src/presentation/visualFamily.ts::huabuNodeTypeForFamily`（`text` 家族 → `text`）。

## 4. 落位与 HUD 的屏幕/世界空间冲突

- 落位在西世界空间（`gen1Placement`），Composer/Dock/Camera 岛在屏幕空间，二者今天不互相避让；实测新节点会落在 Composer 背后。
- R2 的处置：e2e 用 `elementFromPoint` 显式跳过被遮挡节点；未做避让。
- R3 待办：窗口 `safeRect` / `occupiedRect` 与落位/首屏视野联动（`apps/web-gen2/src/windows/professionalWindowLayout.ts` 已有 `overlap` 判定可复用）。

## 5. 物种 producer 现状（R4/R5 的输入）

| 物种 | 今天的 producer | 缺口 |
|---|---|---|
| source / glyth / run | Core 绑定（artifact/conversation/run） | 无 |
| draft | 需要 `sourceRunId + managed` 事实 | reconcile 不产出 `sourceRunId` |
| working | 需要 Run 关联事实 | 无 producer |
| collection / workflow-collection | Warehouse 的 `collection` / `workflow` 条目 | 投影图只含 artifact/conversation/skill/run |
| decision / prompt-frame / context-reference | Core 侧相应实体 | 无 producer |
| portal | 原生 `canvasRef` | junction 消费面（见 §1） |
| unknown | entityType 不识 | 诚实回退 native |

- 解析入口：`apps/web-gen2/src/presentation/projectedNodeDescriptor.ts::resolveNodeSpeciesFromFacts`（新增，含"未绑定用户节点绝不兜底"红线）。

## 6. 命令面现状（R3/R5 接手前必读）

- 新增 `huabu/apps/web/src/lcos/navigation/LcosActionArc.tsx`（右键节点）+ 纯函数 `lcosNodeCommands.ts`。
- 真实可用命令：打开（conversation→工作台 / artifact→阅读器 / canvasRef→入口预览）、引用/取消引用、文本↔笔记、删除（仅未绑定）、适合画面。
- **未接线（菜单里显式标 GAP 并禁用）**：强调色、尺寸档、文本格式、AI 运行/取消 —— 这些今天仍由旧 `NodeFloatingToolbar` 承担。
- 旧 `EdgeStyleToolbar`（边线型/线色）也没有 LCOS 替代。
- 因此 R2 没有退役旧工具条（退役=删能力，触"换呈现不删逻辑"红线）。**R3/R5 的退役前置**：把上述 4 类命令 + 边样式命令接进 Action Arc 或对应 Work View，再在 `chromeMode=lcos` 下停挂载。

## 7. 已具备的可复用基建（避免重复造）

- 落位：`apps/web-gen2/src/spatial/gen1Placement.ts`（`placeNewNodesIncrementally`、`placementOriginFor`、`PLACEMENT_GAP`）。
- 节点卡片注册表：`apps/web-gen2/src/presentation/rendererRegistry.ts::createNodeCardRegistry`（重复注册抛错）+ 宿主注册点 `huabu/apps/web/src/lcos/nodes/lcosNodeCardRegistry.ts`。
- 呈现描述：`apps/web-gen2/src/presentation/projectedNodeDescriptor.ts`（`describeProjectedEntity` / `buildNodeSecondaryLine`）。
- 族组件：`huabu/apps/web/src/lcos/ui/families/`（WindowChrome 的 停靠/分组、Collection 的主画布/装配、TaskCard 的 预览/已选目标、Portal 六态 都在 gallery 里待接线）。
- 验收基建：`scripts/e2e/_harness.mjs`（fail-fast）、`scripts/e2e/r0-e2e-env.ps1`（隔离环境）、`scripts/e2e/r2-main-vertical-slice.mjs`（可复制成 R3/R4/R5 的场景骨架）。
- 报告读包：`scripts/figma/describe-structure.mjs`、`scripts/figma/gen-lcos-tokens.mjs`。

## 8. 状态

R3/R4/R5 仍 `blockedBy: R2_ACCEPTED_COMMIT`（见 `docs/audit/GEN2_parallel_status.json`）。R2 已 `ready_for_review` 并停在用户视觉验收点。
