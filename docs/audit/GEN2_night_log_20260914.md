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

---

## 02:05 条目 2 — R0 全部退出条件达成（R0 = reviewed），准备进入 R1

**HEAD / Git**：`685e02a` → `d249395` → `c93bce6` → `88f6838` → `323094a` → `3b06e7f`；工作区**干净**（`git status --porcelain` 为空）。

**本轮完成**
1. **R0-A**：撤掉 TextNode 临时特例（回到 HEAD），冻结证据保留。
2. **R0-5**：harness 三例反证成立（ok=0 / missing=1 / console-error=1），并支持"场景前提型 console error 白名单"（摘要仍全量打印）。
3. **R0-6**：隔离 e2e profile 落地（Core 43131 / Huabu server 3011 / web 5273，数据全在 `.e2e-data/`）。**空目录可重建已实测**：`reset` 删除目录后 `up` 重新种入同一 fixture（`lcos-gen2-dev` + `canvas-lcos-main/context/workflow`）。
4. **R0-3**：`ensureCanvas(recreate)` 独立提交；stale → recreate → persist → reload → 再进不重复创建 **全链 exit 0**。

**过程中发现并修掉的真实缺陷/坑（都留了证据）**
- `LcosProjectShell` 零参闭包吞掉 `recreate` → Main 恢复按钮点了没反应（真缺陷，已修）；
- Core 写请求 Origin 白名单默认只含 5173 → 隔离端口写入 403（新增 `LOCAL_CORE_ALLOWED_ORIGINS`，默认行为不变）；
- Vite `/lcos-core` 目标硬编码 43121 → 隔离环境会打到用户 dev Core（改为 `VITE_LCOS_CORE_TARGET`）；
- 空 `HUABU_DATA_DIR` 必须配 `HUABU_WORKSPACE`，否则 app 被重定向到 `/setup` 首启向导；
- PowerShell 5.1 按 ANSI 解析 `.ps1` → 脚本内含中文会解析失败（改为 ASCII-only）；
- `.ps1` 用 `Select-Object -Last` 会缓冲输出，导致"看起来卡住"（改用文件重定向读取）。

**测试与退出码**
```text
node scripts/e2e/r0-harness-selftest.mjs ok      → 0
node scripts/e2e/r0-harness-selftest.mjs missing → 1
node scripts/e2e/r0-harness-selftest.mjs error   → 1
node scripts/e2e/r0-stale-canvas.mjs             → 0（空目录重建后再次 0）
huabu typecheck / local-core tsc                  → 0 / 0
```

**R0 退出条件**：8 项全绿（明细见 `GEN2_parallel_status.json` 的 `R0.exitConditions`）。
**状态**：R0 = `reviewed`（依 16 号文档预授权自动进入 R1）。三路 Scout = `scouting`（packet 已落盘，未 reviewed）。

**R1 计划（接下来做）**
1. 读 `token-style-component-manifest.json` 全量，建立"现有 token/CSS 变量 ↔ Figma alias"对照表；
2. CSS custom properties 作为渲染入口，TS token 只导语义引用（禁止复制同值常量）；
3. 先做共享组件族：ProjectShell / NavigatorIsland / Railway / ProfessionalWindowChrome / SurfaceFeedback / Collection / TaskCard / Portal；
4. dev-only component gallery（覆盖 variant 与 disabled/loading/error/degraded/selected/focus/reduced-motion）；
5. 回填 `FIGMA_SOURCE_LEDGER.md`（node/component/variant/token/asset → code target → production caller）。

**硬阻塞**：无。隔离环境保持运行（43131/3011/5273），用户 dev 栈（43121/3001/5173）未受影响。
