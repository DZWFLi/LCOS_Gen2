# GEN2 R2 交接 — Main 垂直切片（2026-09-14，第二次送审）

分支 `frontend-reconstruction-v2`（不 push、不合并 main）。
状态：**ready_for_review** —— 按用户 2026-09-14「R2 首次视觉验收不通过与返工指令」完成返工，**在此停下等第二次视觉复核**。
R3/R4/R5 的源码写入在本轮全程未启动（不创建 worktree、不改其生产源码；三路 Scout 仍为只读准备成果）。

---

## 0. 已读清单（SOP 前置阅读，本轮返工重过）

| # | 材料 | 读到的关键结论 |
|---|---|---|
| 1 | 用户本轮指令《R2 首次视觉验收不通过与返工指令》 | 6 条否决理由 + 文本节点方向裁决 **B（Core 投影默认只读）** + 5 项返工 + 9 条新退出条件 |
| 2 | `deliverables/GEN2_新前端重新总装正本_20260913/20_R2首次视觉验收不通过与返工指令_20260914.md` | 同上的正本落点 |
| 3 | `14_685e02a保留重写矩阵与Recovery_Waves.md` | R2 九条施工顺序 + 退出条件 |
| 4 | `references/original_route_cards/V6/03_T3_LocalInteraction_ActionArc_Composer_30KB_Planning_Guide.md` | T3-A02 Action Arc：**selection/node near-field overlay**、3 normal / 最多 4、菜单不得固定右侧 |
| 5 | Figma 本地导出 `exports/LCOS_Figma_全设计包_20260913/unification/main-final.png` | Main 主稿的内容密度（真实图片 / 大标题文字 / 小卡片 / 波形 / 容器胶囊 / Glyth 图腾）与远中近层级 |
| 6 | `AGENTS.md` / `docs/construction/{PROJECT_READBACK,FIGMA_SOURCE_LEDGER,SOURCE_ADOPTION_LEDGER}.md` | 施工落点纪律；donor A/B/C/X；GEN2 前端重装硬规则 |
| 7 | 旧 Huabu 节点/边工具条源码（实读） | `NodeFloatingToolbar` 四组控件的逐类真实清单；`pdf/office` 有「下载」、`web` 有「打开外链」—— 不能先退役 |
| 8 | 实测：隔离环境浏览器（reset 后） | 见 §3 证据 |

---

## 1. 对照用户 5 项返工

| # | 返工项 | 本轮结果 |
|---|---|---|
| 1 | 完成文本族与真实内容 routing | **完成**：文本族 Core 投影一律进统一 junction（`visualFamily.ts` 的 `text → note`，因为 junction 唯一消费方是 `NoteNode`）；descriptor 消费真实 `entityType / artifactKind / mimeType / managed / availability / revision / **fileRecordId** / **preview**`；native body 仅作无 binding fallback；**首屏已无空 `Type…` 占位**（e2e 断 `textNodes === 0`） |
| 2 | 重做 Main 相机与空间构图 | **完成**：GEN1 placement 保留；整批共用 GEN1 格点（不再逐节点各算步长）；取景走 `fitBoundsWithInsets` + HUD/Composer/Dock 安全矩形，并且**跟随内容补齐**直到用户动过相机；1440 首屏 zoom 落在可读区（e2e 断 `0.5 ≤ scale ≤ 1.3`），全部已投影节点都在画面上 |
| 3 | Action Arc 回到正确形态 | **完成**：`LcosActionArc` 锚在选中节点上（`CanvasFloatingPopover`），近场 3 常规动作 + 「更多」；**不适用动作不出现**；暂不可用动作给真实 reason（Core 投影的删除给「这是 Core 投影…请在 Core 侧移除」）；**面板里已无任何「尚未接线（GAP）」**；旧工具条在覆盖后停挂载 |
| 4 | 补齐可见验收 fixture | **部分**：source/material（2 张真实渐变 PNG）、conversation/Glyth（承接会话）、decision（决策记录 markdown）**可达**；context/reference 用真实 relation 表达；**run/process 记为 GAP（needs provider，不伪造）**；全部素材标题/文件名带 `e2e fixture` 标识 |
| 5 | 重新提交验收证据 | **完成**：见 §3；截图 `r2-main-1440-v2.png` / `r2-action-arc-1440-v2.png`；fixture 生成命令、e2e 输出与退出码、ledger 回填、旧壳 DOM 证据齐备 |

### 关键实现落点（本 Wave 新增/改动）

| 关注点 | 落点 |
|---|---|
| 文本族路由 | `apps/web-gen2/src/presentation/visualFamily.ts`（`case 'text': return 'note'`） |
| descriptor 真实内容位 | `apps/web-gen2/src/presentation/projectedNodeDescriptor.ts`（`fileRecordId` / `preview` / `buildContentPreview` / 会话 `provider·运行态` 次级行） |
| 正文预览读取 | `apps/web-gen2/src/backend/artifacts.ts`（`getFileRecordContent` / `getFileRecordText`）+ `host/projectionFacade.ts`（`readEntityFacts`，按 fileRecordId 缓存、体积有界） |
| 图片真实内容 | `huabu/apps/web/src/lcos/nodes/stageProjectedSources.ts`（Core 字节 → `uploadImage` → 裸 artifact key → 节点 `data.src`） |
| 会话/Glyth 投影 | `apps/web-gen2/src/spatial/reconciliationRunner.ts`（承接会话走同一 `projectBatch`/binding/落位；孤儿清理只在真读到列表时执行） |
| 落位 | `apps/web-gen2/src/spatial/projectToSpaceProjection.ts`（GEN1 批格点 + 真实尺寸障碍 + 实体级建节点互斥 + stale 双检） |
| 相机 | `apps/web-gen2/src/spatial/fitWithInsets.ts` + `lcos/navigation/LcosCanvasCommands.tsx` |
| 命令模型 | `apps/web-gen2/src/interaction/nodeCommandModel.ts`（按节点类型收敛；无 GAP 组） |
| 命令面 | `lcos/navigation/LcosActionArc.tsx`、`lcos/navigation/LcosEdgeArc.tsx` |
| 旧壳退役名单 | `lcos-seam/chromeModeSlot.tsx`（`LCOS_STANDDOWN_TOOLBAR_TYPES`） |

---

## 2. 五项完成凭证

1. **Exact binding**：GEN1 落位/注册表两条 donor 有 provenance（owner/repo/path@commit + license 实况）；T3 形态对照 V6 原卡「near-field overlay / 3 normal / 4 max」；Figma 对照 `main-final.png` 与本地设计包。
2. **Real state**：物种/次级行/正文预览/图片字节/命令可用性全部来自真实事实（Core 图快照 + Core FileRecord 内容 + Huabu 回执尺寸 + Core 绑定）；不可达项（run/process、pdf·office·web 的下载/外链）**显式登记为 GAP，不静默降级、不伪造**。
3. **Fail-fast test**：
   - `apps/web-gen2 npm test` → **267/267 通过**，含本轮新增/改写：命令模型（去掉 GAP 组后按类型收敛）、`fitBoundsWithInsets`、`buildContentPreview`/会话次级行、落位与绑定幂等（含"边已不存在时不发 DISCONNECT"）。
   - `huabu/apps/web`：`tsc --noEmit` exit 0；`eslint src/lcos src/lcos-seam` exit 0；`vitest run src/lcos src/lcos-seam` → **17 files / 93 tests 通过**（含 `chromeModeSlot.test.ts` 锁住"未覆盖类型继续挂旧壳"）。
4. **Full viewport evidence**：`scripts/e2e/r2-main-vertical-slice.mjs`（fail-fast harness，1440×900，隔离环境 **reset 后**的全新数据）四场景 `ok:true`，退出码 0：
   - bootstrap（stale canvas 恢复）；
   - framing/projection/content：`textNodes=0`、物种含 `source` + `glyth`、`scale` 在 0.5–1.3、**图片节点有真实 src 且 `naturalWidth > 0`**、无「无图片来源」、有真实正文预览、节点两两不重叠、全部已登录节点都在首屏；
   - Action Arc：近场几何（Arc 与节点水平相交、垂直 gap ≤ 80）、`primary=3`、`more=1`、`legacyToolbars=0`、面板分组含外观/空间、尺寸与强调色控件在、**无「尚未接线（GAP）」**、禁用动作数 == 真实 reason 数；
   - 旧壳探测：`minimap=0 / controls=0 / legacyToolbars=0 / railway=1`。
5. **Honest remainder**：见 §5。

---

## 3. 复跑命令与退出码

```
# 隔离环境（必须 reset 后再 run：fixture 只在空库种入，画布也需要干净基线）
powershell -ExecutionPolicy Bypass -File scripts/e2e/r0-e2e-env.ps1 down
powershell -ExecutionPolicy Bypass -File scripts/e2e/r0-e2e-env.ps1 reset
powershell -ExecutionPolicy Bypass -File scripts/e2e/r0-e2e-env.ps1 up
node scripts/e2e/r2-main-vertical-slice.mjs          # 四场景 ok:true，exit 0

cd apps/web-gen2 && npm run typecheck && npm test     # exit 0 / 267 pass
cd huabu/apps/web && npx tsc --noEmit -p tsconfig.json
cd huabu/apps/web && npx eslint src/lcos src/lcos-seam
cd huabu/apps/web && npx vitest run src/lcos src/lcos-seam
```

证据文件：
- `.e2e-data/shots/r2-main-1440-v2.png`（Main 首屏，1440×900）
- `.e2e-data/shots/r2-action-arc-1440-v2.png`（节点选中后的 Action Arc）
- 对照稿：`E:\Codex 项目\OS开发\exports\LCOS_Figma_全设计包_20260913\unification\main-final.png`

---

## 4. R2 新退出条件对照（诚实版）

| 退出条件 | 结果 | 依据 |
|---|---|---|
| 首屏没有空 `Type…` Core 投影 | **达成** | e2e `textNodes === 0`；文本族按裁决 B 走 `note` 家族进 junction |
| 真实物种节点在 1440 下可辨、不依赖 200% 以上放大 | **达成** | e2e `scale` 在 0.5–1.3；首屏物种含 `source`（材料）与 `glyth`（会话），标题/次级行/正文预览可见 |
| Main 构图与 Figma 主稿属于同一产品 | **待用户视觉复核** | 机器只能证明"不重叠 / 全部节点在画面内 / 真实图片与真实正文在位 / 密度来自真实内容"；"是否同一产品"必须人眼看并排图 |
| Action Arc 是正确节点近场交互并覆盖待退役命令 | **达成（覆盖范围内）** | e2e 近场几何 + 3+1 + 面板分组；停挂名单只含每个旧控件都有替代入口的类型 |
| LCOS mode 下旧 Huabu 产品 toolbar 不挂载 | **达成（名单范围内）** | e2e `legacyToolbars=0`（note/image 选中态）；`pdf/office/web/sketch/question/frame/text` **故意仍在挂旧壳**（见 §5 缺口 4，不删能力） |
| console/page error 为零 | **达成** | harness 对 pageerror 与 console error 零容忍，四场景均无 |
| fail-fast e2e 真失败时非零 | **达成** | `_harness.mjs` 在断言失败/console error/非白名单 HTTP 时 `process.exitCode = 1`（本轮开发过程中已实际以非零退出暴露多个真实缺陷） |
| 工作区 clean | **达成** | 本轮改动已 commit；`git status` clean（不含未跟踪临时文件） |
| handoff 只写 `ready_for_review` | **达成** | 本文件标题即此状态 |

> 明确：`56d97b0` **不是** `R2_ACCEPTED_COMMIT`，本轮返工后的新 commit 同样**不是** —— 等第二次视觉复核通过后由用户指定。

---

## 5. 诚实缺口（PARTIAL，不得改写为完成）

1. **run / process 无生产来源**：真实创建 Run 需要 provider 能力查询 + Bridge dispatch，仅凭 repository 直写会伪造 provider 进程 —— 隔离 fixture 里**不种入**，首屏没有 run 物种。这是 `GAP: needs provider`，不是"忘了做"。
2. **portal / collection / workflow-collection / prompt-frame / working / draft 仍无 producer**：投影图今天只有 artifact / conversation，物种可达性受 Core 图限制（Warehouse 侧才有 collection/workflow 事实）→ R4/R5。`canvasRef → portal` 的 junction 分支仍无消费方（junction 唯一消费方是 `NoteNode`）。
3. **`pdf` / `office` / `web` 的旧工具条未退役**：旧 actions 有「下载」「打开外链」，LCOS 尚未接替代入口。按用户"不能先删能力"，这三个类型**继续挂旧 Huabu 工具条**，LCOS Arc 也不在它们上面出现（避免两套入口并存）。
4. **图像以外的字节型节点未落成**：`stageProjectedSources` 目前只处理 `image`；pdf / video / audio 的同类落成依赖各自节点形态，**未接线即不可用**。
5. **Core 没有 audio/视频的 ArtifactKind**（`ArtifactKind = markdown|image|presentation|pdf|other`），所以 Figma 主稿里的音频波形节点在当前 Core 契约下不可达 —— 需要 Core 侧新增 kind 才能进入呈现。
6. **落位不避让 HUD 占用矩形**：Composer/Dock 是屏幕空间浮层，落位在世界空间算；避让需要 R3 的 `safeRect`/`occupiedRect` 话题。当前由**取景**（HUD 安全边距）保证内容不被压住。
7. **画布 store 同步滞后**：RFS 服务端写不会立刻进入浏览器画布 store（实测 reconcile 结束时 store 可能只有 1 / 8 个节点）。本轮用"取景跟随内容补齐 + 落成前事件驱动等待"绕开；根治需要 Huabu 侧的增量同步或一次受控基线重载，属 Huabu 内核问题（未改）。
8. **reconcile 幂等性本轮修了三处但仍非零风险**：修掉了 (a) 断开不存在的边导致整批失败、(b) 同批重复输入、(c) 刚建的节点被误判 stale 而解绑重建；观察到的孤儿节点（`项目定位 1`，绑定点被覆盖）在本轮 reset 后需继续观察，若复现按同一路径继续收敛，**不在本轮当作已解决**。
9. **全量 web vitest 有 1 个与本波无关的既有失败**（Milkdown `blockFingerprintParity`），只登记不改；R0 既有 gap（wave1..wave10 旧 e2e 脚本未迁移 harness 等）未动。

---

## 6. 请用户复核

打开隔离环境 `http://localhost:5273/projects/lcos-gen2-dev/main`，对照 `main-final.png` 看 **Main 的构图/密度/物种层级** 与 **选中节点后的 Action Arc 形态**，并给出：

- 是否接受 R2 作为"同一产品"的第一屏；
- 若仍不接受，请指出是**内容位**（还缺哪一类真实内容）、**构图**（分组/留白/远中近）还是**命令面**（哪个动作缺入口）—— 这三类会走向不同的返工路径。
