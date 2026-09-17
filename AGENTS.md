# AGENTS.md — LCOS Gen2 施工代理纪律（最高优先级）

> 本文件对在本仓库上干活的所有 agent（GLM/GPT/Codex/Trae/人类协作者）生效。
> **施工宿主 = 本仓库 `huabu/`（Huabu vendor 树，见 `HUABU_UPSTREAM.md`）**；`E:\OS开发\Huabu` 独立 clone 已退役为只读上游参照，不得在其上施工。
> 钦定日期：2026-09-02（用户原文）。与 TRAE 项目记忆中的「Gen2 施工纪律 SOP」为同一份内容。

## 施工纪律 SOP（每个任务开始前必须重新过一遍，"继续"≠跳过检查）

1. **push 纪律**：阶段性成果只做本地 commit；**必须等用户验收后才允许 push 到 GitHub**，绝不擅自 push。
2. **语义纪律**：施工中遇到语义模糊、功能不明确的，**立即停下来问用户**，不得自行猜测或按惯例推断。
3. **GUI 纪律**：遇到 GUI 表现形式冲突/模糊的，**先联网搜成熟形态，再拿调研结果问用户定夺**，不得直接开干。
4. **开工纪律**：每个任务/阶段开始前必须重复这套 SOP 检查；进入新大阶段（Phase A/B/C/D 切换）动工前必重过；同阶段小对话、已明确断点、仅改测试/回归的续做不重读（读取时机见下节）。用户只说"继续"但已切换大阶段时，依旧需重过。
5. **回传纪律**：每任务按 GLM 施工正本 00 的回传模板回传；"完成"用词规则照守——只有代码接真实入口、自动测试、人工剧本与恢复证据齐全才能写"完成"；只有 interface/mock/Storybook/static test 时分别写"契约已建/模拟验证/视觉样例"。

## 读取时机策略（省 token，2026-09-03 用户裁定）

> 覆盖前述"每张任务卡开工前都要重读"——那是 token 滥用根源，现按任务类别分级。

- **必读**：进入新大阶段（Phase A/B/C/D 切换）动工前 + 主动提示收尾检测时（commit 前自检 / 验收回执 / QA 阶梯收尾）——此时读 AGENTS.md + 项目记忆 + 当前阶段任务卡正本。
- **免读**：同阶段内小对话、已明确断点的续做、仅修改测试/回归验证——一律不重读上述文档，延续当前上下文。
- 红线：见"继续/续做/改个测试"就整包重读 = 消耗滥用，禁止。

## 每阶段开工必读清单（顺序固定，缺一不得动工）

> **每个阶段（Phase A/B/C/D 的每张任务卡）开工前都要重读一遍**，不是读过一次就永久生效。

1. **`README_Gen2_整合施工_20260902.md`（动工入口，必读首件）** —— 位于 `C:\Users\1\Desktop\Gen2开发\`（副本亦在 `...\Gen2开发\审计交付_20260902\`）。一页结论六条 / 五类分工 / Owner 架构 / 施工 SOP（M0–M3）/ 引用原文路径 / 施工前信息搜集流程 / GUI 最终效果 / H0-H6 动工顺序 / 红线。
2. **GLM 施工正本 00 总索引**（`LCOS_Gen2_GLM施工正本_00_总索引_源证据_执行顺序_20260902.md`，同目录）—— 裁决优先级 / U-F-GH Source ID 表 / GitHub 固定读取入口 / 全功能→阶段路由 / 回传 SOP / "完成"用词。
3. **当前阶段的任务卡**（`LCOS_Gen2_GLM施工正本_Phase_A/B/C/D_...md` 对应文件）—— 只精读当前阶段全文；后续阶段建概认知即可，轮到时再精读。
4. **需求正本**（`LCOS_Gen2_8月21日后需求正本_源码遗漏审计与Donor转化总计划_20260902.md`，L0 上位证据）—— §2 需求正本表按当前任务对应功能域重查；§8 必改句；§10 一句话施工钉子。
5. **节点呈现宪法**（`审计交付_20260902\LCOS_Gen2_节点呈现宪法_完整版_20260902.md`）—— 涉及节点/GUI/交互的任务必读；规范冲突以此为准（去节点化 / 11 态 / 圣诞树禁令 / 共享物理语法 / renderer 契约）。
6. **GUI 实现 SOP**（`审计交付_20260902\LCOS_Gen2_GUI实现SOP_20260902.md`）—— 每个 GUI 决策过一遍 M0 先问 Huabu → M1 再问轮子 → M2 才允许自研（填 Rejection Record）→ M3 LCOS 语义层；QA 阶梯；Handoff 模板。
7. **三方对比审计·代码级**（`审计交付_20260902\LCOS_Gen2_三方对比审计_代码级_20260902.md`）—— 落码前查组件映射：import 路径 + 真实 props + Gen1 替换对象（16 个 Common 实读）。
8. **施工时即时读取的源码**（GLM 正本 00 §4 固定入口）：Gen2 `host/*` + `spatial/*`；Huabu `Canvas.tsx` / `useCanvasPointerRouter.ts` / `NodeWrapper.tsx` / `useTextAutoSize.ts` / `semanticZoom.ts` / PreviewWorkspace；旧 LCOS 只读要迁的纯函数签名。**必须读取远端最新 main 并与审计 ref 比对**；路径/contract 变化时更新任务卡落点，不回退旧 ref。

## 两条全局动工指令（覆盖所有阶段）

1. **默认不新增安全门 / 不删既有安全措施**：新增 hash/冻结 contract/baseline/gate 是例外，默认不加。要加必须先写清一个具体失败场景 + 论证 Git/版本号/主键/事务/唯一约束/类型/普通测试为何挡不住。只准加在不可逆/跨系统/安全/正式发布四类边界。门禁不得挤掉真正的执行、模拟或测量。已有安全措施一律保留。
2. **先调研、后动手**：每个细分阶段施工前，先联网搜 GitHub/全网，搞清成熟项目这一步的 GUI 形态和 UX 交互，再施工。反模式 = 不查就照自家脑补开工（Gen1 呈现灾难的根源）。动工前在 Handoff 里写明「本阶段调研到的成熟形态/UX」，再进入 M0/M1/M2。

## 权威链（冲突裁决序）

1. 用户当前原文（尤其纠偏句）
2. 需求正本（L0 上位证据，路径见必读清单 #4）
3. GLM 施工正本（00 + Phase A-D，施工主本）
4. GitHub 当前真实源码（`DZWFLi/LCOS_Gen2`、`microsoft/Huabu`、旧库 `DZWFLi/LCOS-local-creativeOS@3e99769` 仅作 donor）
5. 审计交付包（`Desktop\Gen2开发\审计交付_20260902\`）与旧计划

## 永久红线（摘要，全文见需求正本）

- Huabu = 唯一空间运行时（Spatial Truth）；Local Core = 唯一域真值（Domain Truth）；不建第二 canvas/selection/geometry owner。
- 一个 Project Truth → 三个独立 worksite（Main/Context/Workflow 各自 canvasId/camera/selection/layout/history），共享的是 Kernel 实现不是 runtime state。
- 通用机械不自绘；LCOS 只写物种 morphology、Action Arc、Semantic Drop 反馈、Navigation presentation、Glyth 与 instrument 组合。通用控件用 Huabu `components/Common/*`，不引 shadcn 当主调。
- 通用控件绝不自写 class（Gen1 `ui-primitives.css` 是病灶）；换呈现绝不删逻辑（纯函数整体迁）；donor 不成为第二套画布/truth；donor 复制必须带 provenance（owner/repo/path@commit + license）。
- React Bits = MIT + Commons Clause（默认 reference-only）；grok-icon-study 仅学习禁商用；n8n 只看不抄；Amicro 是候选资产（Huabu 本地装过 motion@13.1.1 但未提交验证前不算已接入）。
- 不新增产品语义：能从现有 Entity/Relation/Surface/Run 推导的 GUI 状态只做 presentation state；施工 PR 必须引用至少一个 U/F/GH Source ID。
- 禁多个 agent 同时改 `Canvas.tsx`、`NodeWrapper.tsx`、composition root、shared tokens；这些文件单 owner 串行。

## 施工落点纪律

- LCOS 新代码收进 `huabu/apps/web/src/lcos/` 与 `huabu/apps/web/src/lcos-seam/`（中立 seam 契约；不散进 Huabu 原目录）；Huabu 原文件只做 6 处薄接缝（Canvas.tsx / NodeWrapper.tsx / previewWorkspace model+renderer / MainLayout.tsx / CanvasPage|CenterArea.tsx / pointerRouter 透传）。
- Gen2 侧：`apps/web-gen2/src/{host,interaction,presentation,integration}/`；`packages/shared/canvas-engine` 不得出现 LCOS 领域语义。
- 旧 LCOS 只迁纯逻辑（dropIntentMachine / pointerInteractionLanguage / commandDraft / presentationHierarchy / mindMapLayout / layoutQuality / spatialOverlayPlacement 等），旧 Canvas/相机/selection/overlay host 全部退休。
- QA 阶梯（禁"static gate PASS = 完成"）：source conformance → type/lint/unit → browser interaction smoke → screenshot/visual smoke → canonical persistence/reload → cross-surface parity。

## GEN2 前端重新总装硬规则

1. 前端施工前必须先读取 `docs/construction/GEN2_FRONTEND_UX_RUNTIME_CONTRACT.md`，再读 `docs/construction/PROJECT_READBACK.md`、设计负责人导出的 `LCOS_Figma_前端施工完整采用清单_20260913.md`、`SOURCE_ADOPTION_LEDGER.md`、`FIGMA_SOURCE_LEDGER.md`、`HUABU_RETIREMENT_LEDGER.md`。
2. 新增用户可见组件前先从设计负责人母表导入对应 page/node/component/variant/status，再登记 donor 的 exact repo/commit/file/symbol、采用等级、target file/symbol、production caller、Figma token/asset、real producer/action owner、fallback 和浏览器证据。`NEEDS_FIGMA`、`CONCEPT_ONLY`、`RETIRED`、`GAP` 不得被施工者自行改写为完成态。
3. 现成 donor 分 A 纯逻辑直接复用、B 机制换壳、C 编排重写、X 禁止迁移。没有核对 donor 不得重造近似组件；无法采用时记录具体依赖冲突。
4. production route 只有一棵 LCOS App Shell；Huabu Canvas 只有一份。禁止用 overlay、z-index、透明遮罩保留两套产品壳。
5. Global HUD、Railway、Professional Stage、Atlas、Workflow Hand、Reader/Work View 不得作为任意 Canvas overlay 总装。Composer 只允许经唯一 `LcosHostOverlay`/`CanvasFloatingPopover` 以对象近场形式挂载；不得成为 route-level 常驻底栏，也不得写入 Canvas truth。
6. 旧 Huabu UI 退出 production tree 时保留其命令/机械 adapter；不得为同一动作重写第二套 store、fetch、session、camera 或 history。
7. stock/native fallback 只用于明确失败。已绑定主流实体长期 fallback 视为未完成。
8. 每个前端 Wave 必须给真实 production caller、整页浏览器 before/after、真实鼠标/键盘/拖放/reload 证据。isolated component test、typecheck、token/hex 清理不能单独证明前端完成。
9. T7、Recovery、WaitingInput 等局部能力必须挂到正确 Work View/section；不得在 Shell/节点/三现场未完成时提前把局部 body 当完整前端。
10. HTML Demo 只解释关系；Figma 决定视觉呈现但不创造 Core 状态；GEN1/Huabu/Rhine/video 是 donor，必须通过 adoption ledger 进入生产 caller。

当前授权下，可逆且在获批 Wave 内的实现连续推进，不需要每步请求确认。仅在产品真相冲突、未知用户改动、不可逆数据/跨系统 outcome、安全或正式发布边界暂停。不得自动 push。
