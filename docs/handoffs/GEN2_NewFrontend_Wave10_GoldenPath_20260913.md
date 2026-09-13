# Wave 10 施工交付 — 整机 Golden Path / 失败路径 / 重启恢复

日期：2026-09-13　分支：frontend-reconstruction-v2
对应卡：`04_逐Wave施工卡与验收.md` Wave 10（第 346–388 行）

## 0. 已读清单

| 项 | 状态 |
|---|---|
| Wave 10 施工卡原文（主路径 / 失败路径 / 最终交付 / 连续施工纪律） | 已读 |
| Wave 9 handoff（上一波断点） | 已读 |
| 本仓 `docs/construction/` 三本账 | 已读并更新 |
| 真实源码：`lcos/{shell,professional,composer,surfaces,navigation,nodes}/**`、`apps/web-gen2/src/backend/{runs,coreTypes,client}.ts`、`apps/local-core/src/{routes/runtime-reviews.ts,conversation-work-view-projection-service.ts,context-manifest-service.ts}`、`packages/contracts/src/index.ts::RunReview`、`packages/domain/src/index.ts::ArtifactReturn` | 已读 |
| 真实 Core 数据（`lcos-gen2-dev`，HTTP 直查 + 浏览器实测） | 已读 |
| 本波**未**重读 | 早期 HTML 交互样机 / donor 动效库（本波为整机贯通与真实缺陷修复，未新增视觉形态） |

## 1. 用户现在真实能做什么（一条主路径走到底）

1366×768 真实浏览器、真实 Core 数据，一次完整串行（脚本 `scripts/e2e/wave10-golden-path.mjs`，console 0 error）：

```text
打开 Project（/projects/lcos-gen2-dev/main）
→ 恢复 Main（5 个 Glyth 物种节点 + 17 条真实关系）✓
→ Assembly：真实仓库 11 项（现场/材料/会话…），可阅读、可投放、可加入草稿 ✓
   · 阅读「当前里程碑」→ Reader 显示真实 markdown · 受管 Artifact ✓
   · 投放 Main → 真实回执「失败 · error · Artifact view not found. 部分失败 · 未全部投放（fail-close 语义）」✓
→ Context：现场壳 + Temporal Rail 常驻 ✓
   · Atlas 打开 → 8 张真实卡片（scene / conversation）→ 点卡进入后 Atlas 关闭、现场保留 ✓
→ Workflow：现场壳 + 手牌呼出 → 卡池 8 张卡 → 取用 → Composer 草稿出现引用 ✓
→ Composer 提交：Cmd/Ctrl+Enter → **真实 Run 已创建**，草稿清空（2 条引用：artifact + conversation）✓
→ 回 Main → 双击 Glyth → 会话工作台（5 个会话逐个打开）✓
   · Run 段：真实 run（queued）×2 ✓
   · **复核段（本波新增）**：真实 capability 门控 —— 采纳/拒绝/重试 均显示「不可用（no_pending_artifact_return）」✓
   · 续工/恢复段：真实 op-2 `recovering`、`external_create failed`，并给出真实原因「No matching external session…」✓
→ 重启恢复：reload 后回到同一现场（Main），画布与 5 个物种节点恢复 ✓
```

## 2. 本波修掉的三个真实缺陷（都是主路径上会撞到的）

| # | 缺陷 | 真实证据 | 修复 |
|---|---|---|---|
| 1 | Composer 写死 `workspaceId: 'main'` → Core 外键拒绝 | HTTP 直查：`POST /projects/lcos-gen2-dev/runs` + `workspaceId:'main'` → **409 FOREIGN KEY constraint failed**；换成真实 `workspace-real-main` → 201 | `LcosProjectShell` 从 Core workspaces 反查当前现场的真实 workspaceId 传给 `LcosComposerHost`；解析不到时禁用提交并显示「现场未就绪（未解析到 workspace）」 |
| 2 | Composer 把 conversation 引用当 context Artifact | 浏览器真实回执：「提交失败 · CoreApiError: **Context Artifact not found: connected-conversation-933e5b0e-…**（草稿已保留）」 | `contextArtifactIds` 只收 `entityType === 'artifact'`；会话引用只走 `orderedReferences`（Core `context-manifest-service.ts:154` 校验语义） |
| 3 | 有草稿时**同时出现两个 Composer**（画布级 A04 shell + route-level Host） | e2e 定位到的是 A04 shell 的 textarea，提交按钮恒 disabled（React 未受控更新），看起来像"快捷键没反应" | 退役 A04 `LcosComposerShell`（删除文件 + 其测试）；`LcosHostOverlay` 不再产出 composer；`data-lcos-composer-input` 移到生产 Composer；overlay 测试改为固定"画布级不产出第二输入面"不变量 |

## 3. 新增能力：Run 结果复核（Review / Artifact Return）

此前 Review → Accept / Reject / Retry 在主路径上**完全没有入口**（Core 侧能力早已存在）。

- 读：`GET /projects/:pid/runs` 的 `returns` / `draftRevisions` / `capabilities` / `presentationPhase`（contracts `RunReview` 已定义）。
- 写：`POST /artifact-returns/:id/accept`（必带 `expectedBaseRevisionId`，防覆盖他人已推进的 Current）/ `reject` / `retry`（可选新指令）——`apps/local-core/src/routes/runtime-reviews.ts` 既有 route。
- UI：`ArtifactReturnSection` 挂在 Conversation Work View 的「复核」段；capability 关闭时按钮禁用并**原样显示真实 reason**（不美化、不假装可用）。
- web-gen2 `CoreRunClient` 扩四个方法，全部 typed + 单测。

## 4. Production caller

```text
LcosProjectShell（surfaceByWorkspace 逆映射）
  └─ LcosComposerHost projectId, workspaceId(真实)
       └─ CoreRunClient.createRun(workspaceId, contextArtifactIds=[真 artifact], orderedReferences=全部引用)

ProfessionalWindowStage → ConversationWorkViewBody
  ├─ Run 段 → WaitingInputSection（GET/POST /runs/:id/input-request）
  ├─ 复核段 → ArtifactReturnSection
  │    ├─ CoreRunClient.listRunReviews(projectId) → 过滤本会话 runIds
  │    └─ CoreRunClient.{accept,reject,retry}ArtifactReturn → POST /artifact-returns/:id/*
  └─ 续工/恢复段 → RecoverySection（T6 投影 + POST recovery-actions）
```

## 5. Donor / Figma 采用

| 来源 | 采用方式 |
|---|---|
| Core 既有 `runtime-reviews.ts` + contracts `RunReview` / `AcceptArtifactReturnInput` | A：直接消费，不建第二 review truth（`RunReview` 是既有 canonical 读模型） |
| Core `context-manifest-service.ts` 的 `contextArtifactIds` 语义 | 事实校正：只接受真 Artifact id（本波据此修掉 conversation 冒充） |
| Figma `unification/specs/hud.json`（主稿 `5388:27696`）：`Esc 逐级关闭`、`zoom 只走 camera` | 沿用 Wave 9 落点，本波继续作为 e2e 行为依据 |
| Huabu `useCloseOnEscape` | 沿用 Wave 9 复用（Esc 关窗 → 本波 e2e 用作窗口回退手段） |
| GEN1 / Rhine / 视频 donor | 本波未新增视觉形态 → 未采用新 donor |

## 6. 浏览器操作与证据（`scripts/e2e/wave10-golden-path.mjs`，headless Chromium 1366×768）

| 步骤 | 结果 |
|---|---|
| 打开 Project / Main | `mainWorksite=true`、canvas=true、5 个物种 body、17 条 edge |
| Assembly | `items=11`、artifact 卡 3 张、有「投放 Main」/「草稿」/「阅读」 |
| Reader | `open=true`，标题「当前里程碑」，`markdown · 受管 Artifact` |
| 投放 Main 回执 | 真实失败回执 + fail-close 文案（真实 Core 返回，不是伪造） |
| Context / Rail / Atlas | worksite+canvas+rail 齐；Atlas 8 卡（scene/conversation）；点卡后 Atlas 关闭且现场保留 |
| Workflow 手牌 / 卡池 | `hand=true`、8 张卡、8 个取用按钮；取用后 Composer 引用 1→2（含 Assembly 草稿那条） |
| Composer 提交 | `禁用=false`、`Run 已创建（回执未带 id…）`、`inputCleared=true` |
| 会话工作台 ×5 | 5 个会话全开；「受控-主会话」有 2 个真实 Run（queued）+ 复核段 + 续工段；其余如实显示「该会话暂无关联 Run」/「没有待恢复的续工操作」 |
| 复核 capability | 采纳/拒绝/重试 = 不可用（`no_pending_artifact_return`）×3 |
| 续工真实原因 | `op-2 recovering · continue_existing · codex` + `external_create failed` + `No matching external session…` |
| 重启恢复 | reload 后 URL/现场/画布/5 物种 body 全部恢复 |
| Core 断开（网络级 abort） | 离线文案「Local Core 未连接」+ 重试按钮（真实降级 UI） |
| Console | **0 error** |

截图：`wave10_01_main / 02_assembly / 03_reader / 04_apply_receipt / 05_context_atlas / 06_workflow_hand / 07_composer_run / 08_work_view / 08b_work_view_review / 09_waiting_answer / 10_after_reload / 11_core_offline`（`C:/Users/1/AppData/Local/Temp/trae/screenshots/`）。

## 7. 测试命令与结果

| 验证 | 命令 | 结果 |
|---|---|---|
| web-gen2 类型 + 单测 | `apps/web-gen2`: `npm run typecheck` / `npm test` | PASS / 233 tests PASS（+3） |
| huabu 类型 | `huabu/apps/web`: `npm run typecheck` | PASS |
| Lint（触及面） | `npx eslint src/lcos --max-warnings 0` | PASS |
| LCOS 单测 | `npx vitest run src/lcos src/lcos-seam` | PASS 13 文件 / 67 tests（新增 `ArtifactReturnSection.test.tsx` 3 tests） |
| 浏览器整机 | `node scripts/e2e/wave10-golden-path.mjs` | PASS（§6 全部断言，console 0 error） |
| 仓级 `npm run lint` | — | 仍为红（Wave 1–2 接缝文件 9 个 `import/order` error + 56 预存 warning），按纪律登记不主动修 |

## 8. 未完成 / FIXTURE / UNAVAILABLE（不声称完成）

- **waiting_input 回答步骤本波无法复现**：dev 库的 `run-2d8dc8eb` 已由前一波回答尝试 + 本波新建 Run 触发 reconcile，从 `waiting_input` 推进为 `queued`；Core 对 `GET /runs/run-2d8dc8eb/input-request` 返回 404「This task is not waiting for more information」，UI 如实显示「该 Run 当前没有待回答问题」。真实 409 诚实失败 + 输入保留已有 Wave 8 实测记录（`wave8-answer-recovery.mjs`）。
- **Accept / Reject / Retry 的启用路径无真实数据**：真实库没有任何 pending artifact return，capability 由 Core 判定为 `no_pending_artifact_return` → 本波只能验证"门控与禁用原因如实呈现"（真实）+ 客户端/组件接线（契约级 6 个测试）。端到端触发需要真实 provider 跑出一次带 artifact 的返回（`RuntimeResultIngestionService` 无 HTTP 入口，桥不可注入）。
- **Artifact Return → review → Accept → Artifact Return 全链**同样卡在上述 provider 缺位。
- **stale canvas 404 恢复入口本波未复现**：当前 workspace 的三个 canvasId 全部有效，未出现「重新建立现场画布」按钮（Wave 7 曾以真实 404 验证过该路径）。
- **Assembly 投放失败原因**：真实回执为 `Artifact view not found.`（用户可见、fail-close 如实展示），根因在 Core apply 通道与 warehouse 条目的 `artifactView` 语义，属后端待核，非本波前端缺陷。
- **Reader 正文预览**未接入（只显示元数据 + 真实 revision 状态），文案已改为「正文预览尚未接入」。
- **Huabu 节点浮动工具条（W/H/强调色/打开大视图/移动到 Space）仍在 LCOS 下出现**（Wave 9 已登记 GAP）：T3 Action Arc 未落地前它是唯一节点命令入口，本波未摘除。
- 本波 e2e 会在 dev 库创建真实 Run（Golden Path 的应有行为），dev 数据会累积；如影响后续验收需单独清理。

## 9. 用户可见文案清理（本波一并修）

内部路线图术语泄漏到产品界面，已改为用户语言：`+N 个长期现场（重排 Wave 9）`→`+N 个长期现场`；`时间分组 producer / Wave 8 接入`→`时间分组尚未接入`；`打开 · Wave 8`→`打开（尚未接入）`；`正文通道 Wave 9 深化`→`正文预览尚未接入`；`{bodyKey} body（后续 Wave 接入）`→`{bodyKey}（尚未接入）`；`Navigator（Wave 4 接入）`→`Navigator（未启用）`；Main 空态「…从 Assembly 取用（Wave 5 接入）」→「…从 Assembly 取用材料」。

## 10. 下一波直接输入（剩余真实缺口）

1. **T3 Action Arc**：落地后摘除 Huabu 节点浮动工具条，消除双产品壳（本波与 Wave 9 两次登记）。
2. **provider 真链**：配置真实 provider（或给 `RuntimeResultIngestionService` 开受控 HTTP 入口）→ 打通"Run → Artifact Return → 复核 Accept/Retry"。
3. **T7 四类续工发起入口** + **RuntimeDoctor/CaptureInbox/ConnectorSource body**。
4. **Reader 正文通道**（revision 正文读取 + 摘取）。
5. **Railway reorder/Receive**、**Temporal Rail 真实时间分组 producer**、**Atlas approach/restore 动效可中断/反向**（Wave 9 卡内列出但未逐条实现）。
6. **仓级 lint 预存红**清理（9 个 import/order + 56 warning）。

## 11. 回滚点

Wave 9 commit `65814f9` 之后。回滚方式：`ArtifactReturnSection` 从 `ConversationWorkViewBody` 摘除 + `CoreRunClient` 四方法回退；Composer 恢复 `workspaceId:'main'` 与 conversation 混入 `contextArtifactIds`（不建议，属缺陷）；`LcosComposerShell` 从 git 历史恢复并重新挂回 `LcosHostOverlay`。三处互不耦合。
