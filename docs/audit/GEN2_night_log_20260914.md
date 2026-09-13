# GEN2 夜间施工日志（2026-09-14）

规则：每 60–90 分钟追加一条；不含普通确认问题；硬阻塞单独标注。允许的提交都在本分支本地，不 push。

---

## 01:20 条目 1 — R0-A/R0-5 完成，R0-6/R0-3 待做

**HEAD / Git**
- `685e02a` → 新增 `d249395`（R0-5 harness）
- 工作区：`M huabu/apps/web/src/lcos/shell/LcosProjectShell.tsx`（ensureCanvas 候选修复，按 16 号要求保持独立、暂不提交）+ `?? docs/audit/`

**已完成**
1. **R0-A 撤掉 TextNode 临时特例**：反向撤销 21 行（import / BodyOverride 声明 / JSX 分支），`TextNode.tsx` 回到 HEAD 内容（`git diff --quiet` 通过）。冻结证据与 SHA256 保留在 `GEN2_R0_未提交Diff冻结证据_20260914.md`。
2. **R0-5 fail-fast harness**：
   - `scripts/e2e/_harness.mjs`：`requireSelector` / `requireTrue` / `requireEqual` / `requireNonEmpty` / console+pageerror 收集 / HTTP 白名单 / 顶层 catch 置 `process.exitCode = 1`。
   - `scripts/e2e/r0-harness-selftest.mjs` 反证三例：

     | 模式 | 预期 | 实测 |
     |---|---|---|
     | `ok`（真实页面 + 真实选择器） | exit 0 | **exit 0**，`failures/consoleErrors/pageErrors/http` 全空 |
     | `missing`（不存在的选择器） | exit 1 | **exit 1**，`requireSelector 失败：未出现 [data-lcos-selftest-missing-selector]（1500ms）` |
     | `error`（注入 console error） | exit 1 | **exit 1**，`出现 console error：[e2e-selftest] injected console error` |

   - 发现并修掉 harness 自身一个缺陷：`requireNonEmpty` 对 number 取 `.length` 恒 0，导致 ok 场景误报失败——已改为按 number/string/array 分派（这条也是"自检真会失败"的正向证明）。

**三路只读 Scout（已完成第一轮，状态 scouting / 未 reviewed）**

| Scout | 输出 | 关键硬发现（详见 packet） |
|---|---|---|
| R3-professional-scout | `parallel-prep/R3_Professional_WorkPacket.md`（55,864 B） | `AssemblyBody.tsx:88` 对所有 item 写死 `{kind:'artifactView'}` → 投放必然 "Artifact view not found."，而后端 `assembly-apply-service.ts:92-186` 早已按 kind 支持（纯前端接错）；Reader 缺 file-record content client；Window 是静态单窗且与 Dock/Composer `z-40` 重叠 |
| R4-context-scout | `parallel-prep/R4_Context_Portal_Atlas_Temporal_WorkPacket.md`（65,678 B） | 前端无 presentation 持久化 client → "各现场各存 presentation + reload 恢复"不可达；Collection/Portal 物种永不可达（seam 只映射 4 类 entityType）；**Rhine motion donor 源码不存在**（仅合同文本）→ 不得写"采用 Rhine donor" |
| R5-workflow-scout | `parallel-prep/R5_Workflow_Hand_Cards_WorkPacket.md`（51,141 B） | 「打开（尚未接入）」是 `<span>` 非按钮；取用写 `entityType: item.kind`('workflow') 被 `composerController.ts:240` 与 Core `runs.ts:182` 双重静默剔除 → **引用 100% 丢失**；Workflow scope 无 producer |

三路均核验未改动仓库（`git status` 与本条目开始时一致），未启动服务，未提交。

**R0 剩余（下一步顺序，按 16 号 §2）**
1. **R0-6 隔离 fixture/profile**：需先确认 Core 的 DB/端口 env 旋钮与 Huabu `HUABU_DATA_DIR`；Vite 侧 `/lcos-core` 目标 `http://127.0.0.1:43121` 目前**硬编码**（`huabu/apps/web/vite.config.ts`），需改为可配（`VITE_API_PROXY_TARGET` 已支持 Huabu server，Core 侧需新增）。禁止触碰 `apps/local-core/.data/phase2.sqlite` 与 `huabu/apps/server/data/`。
2. **R0-3 ensureCanvas(recreate)**：在可信 harness+fixture 上跑 8 步验收（stale → recreate → persist → reload → 再进不重复创建），单独提交，只含参数透传 + 聚焦测试 + handoff。
3. R0 文档切片提交（audit/handoff），然后确认 R0 退出条件全绿。

**未开始**：R1（设计系统 → 组件族）、R2（Main 垂直切片）。R2 完成后停止写源码并等用户第一次视觉验收。

**硬阻塞**：无。
