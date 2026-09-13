# PROJECT_READBACK — 我的产品认知回传

日期：2026-09-13
分支：`frontend-reconstruction-v2`（基线 `main@63188c2`）
依据：`00_START_HERE.md` / `01_真实产品概念与不可误解项.md` / `02_基线与选择性救援清单.md` / `03_...源码蓝图` / `04_逐Wave施工卡与验收` / `05_证据账本与失败样本` / `08_T1-T7规划信息损失责任矩阵` / `09_T1-T7现成轮子承接补丁卡` / `12_Figma九面视觉统一与前端协作合同` / appendices A/B/C / unification 九面 status + token-style-component-manifest / 真实仓库源码（App.tsx / CanvasPage / lcos-seam / web-gen2）。

> 这是让误解尽早暴露的回传，不是验收 gate。若与本文件冲突，先改认知再动代码。

## 一、12 问逐答

### 1. Huabu 留下哪七类机械，退役哪五类产品 GUI？

**保留七类机械**（KEEP KERNEL）：
1. ReactFlow 拓扑：nodes/edges、native node registry、edge geometry
2. geometry：坐标、尺寸、position/size commit、snap、frame child cascade
3. interaction：drag、resize、select、marquee、pan/zoom、connect gesture、pointer lifecycle
4. viewport / camera：唯一 RF instance、focusNodesOnCanvas、persist
5. selection：唯一 selection owner（canvasStore）
6. spatial history：undo/redo、autosave、drain pending saves
7. 通用机械：Preview/Editor 文件加载、Agentlet stream/session/retry/waiting_input、命令路径

**退役五类产品 GUI**（production 不再 mount，命令走 adapter）：
1. `MainLayout` 旧三栏壳
2. `CanvasHeader` / `CanvasLayerPanel` / `PreviewWorkspacePanel` 左右伴侣栏
3. `CenterArea` 浮动按钮组（Handbook/Settings/Chat）
4. `NodeToolbar` / `Controls` / `MiniMap`（LCOS mode 隐藏）
5. native node body 作为长期主路径（降为 fallback）

### 2. Core truth、Huabu spatial truth、LCOS UI intent 分别是什么？

- **Core truth（Local Core）**：Project / Artifact / Revision / Conversation / Run / Result / Review / Relation / Context / Continuity journal / receipt。唯一域真值。
- **Huabu spatial truth**：node/edge 空间拓扑、geometry、viewport、selection、drag/resize 结果、spatial history。唯一空间真值。
- **LCOS UI intent**：active surface、open window/region、draft、focus/hover、临时 overlay 状态。可丢失、只放 local UI store（Zustand/localStorage 只允许这类）。

### 3. Main / Context / Workflow 各自回答什么问题？

- **Main**：我有什么、它们是什么关系、现在正在发生什么（项目主桌面，自由摆放优先）。
- **Context**：这次要一起理解什么、按概念或时间怎么组织（研究现场；Atlas 是其强表征）。
- **Workflow**：接下来怎么做、材料给哪一步、哪步在等人、哪里要 Review（行动现场和任务牌桌）。

### 4. 同一 Artifact 被 Drop 到 Context 后有没有复制？位置由谁拥有？

**没有复制**。Drop 是 projection membership / "把它用于这里"，identity、revision、业务状态共享同一 canonical object。**位置由 Huabu spatial owner**（该 worksite 的 canvasId 下的 geometry）拥有；Core 只存 identity/binding，UI 只存临时 intent。

### 5. Context child canvas 为什么不能另起 ReactFlow？

因为 spatial truth 只能有一份。另起 ReactFlow = 第二 canvas/selection/camera/geometry owner，会撕裂 selection、拖拽、退出手势与恢复；共享 kernel 实现（Portal/Surface）+ 独立 canvasId/viewport 已足够表达"独立工作现场"。

### 6. Collection 在 Atlas、Main、Assembly 分别怎样呈现，identity 是否变化？

- Atlas（Context 现场）：3D/2.5D 体块、事情/时间两类组织、强表征。
- Main：压缩 2.5D/平面同身份投影（内容概览 + 事件/时间图标）。
- Assembly：小条目/缩略，仓库视角。
**identity 不变**——动作永远指向同一 canonical entity；不同 surface 只换投影密度与形态。

### 7. Workflow Card 和普通 Artifact node 的区别是什么？

任务/装备卡语言：3:4 竖卡、约 70% 封面 + 30% 标题/元数据、状态（静息/悬停/预览/已选目标/草稿中/不可用/键盘焦点）、取用/打开/续接三动作分离。它不是普通节点平铺，也不自动 Run、不复制进 Main。

### 8. Glyth 为什么不是 chat badge？四类续工语义是什么？

Glyth 是 Conversation/Agent 在项目空间的活身份：随活跃/等待/失败/恢复/远近 LOD 改变形态，双击/Enter 打开同一会话的 Conversation Work View；不是右下角常驻机器人按钮。四类续工：
1. continue existing；
2. native full-history fork；
3. selected-context new session；
4. blank new session。
Adapter 必须诚实——外部产品不支持原生 fork 时只允许 create + ContinuityAttachBundle 或可见历史，不得谎称完整 fork。

### 9. WaitingInput 和 Recovery 应挂在哪个宿主？

- WaitingInput → Conversation Work View 的 run/attention section（原 runId + 真实 input-request 路由）。
- Recovery → 对应 continuation operation/conversation 的 section（T6 allowedActions → T3 intent → T7 adapter）。
禁止做无入口孤立 body；can 有诊断 deep link，但正式 UX 不依赖用户知道 runId/operationId。

### 10. stock fallback 只允许在哪些失败状态出现？

只允许：node 无 ProjectionBinding；binding stale 且 reconcile 未完成；Core/Bridge unavailable；entity species 尚未支持；provider 不支持 requested capability；Figma 有状态但业务 producer 尚不存在。已绑定主流实体长期 native = 漏做。Fallback 必须显示原因 + 重试/诊断入口。

### 11. Figma、GEN1、视频、Rhine、HTML 各自能决定什么？

- **Figma**：视觉/尺寸/材质/状态/响应式（component/variant/node ID、variables/styles、SVG、specs）。不创造 Core enum。
- **GEN1**：donor——canvas geometry/layout/LOD、CanvasNodeVisual 内容分流、node registry、Glyth engine、Portal/Surface、Composer/Reader/Search 数据流。接法分 A/B/C/X。
- **视频**：motion 手感（Shelf/Avenue、Temporal Rail、seed→body 形变）。不决定业务模型。
- **Rhine**：motion 代码参考（value+velocity、damp、camera、reverse）。不是第二数据模型。
- **HTML 概念 Demo**：只解释产品关系。不是像素目标/验收基线。
权威顺序：用户原文 → README/AGENTS → 本包总装方案 → T1–T7 领域施工卡 → Figma 采用母表 → Figma 真实节点/资产 → donor → 当前源码 → HTML。

### 12. 第一波代码为什么必须先换 route composition root，而不是先做 T7 body？

因为失败样本证明：在 `CanvasPage → MainLayout → CenterArea → Canvas` 上继续接任何 overlay/body，即使全绿也是"旧 Huabu 车壳 + LCOS 按钮"。先换 composition root 才能让产品长成 LCOS（HUD/Railway/三现场/Shell 成为唯一可见组合根），T7/Recovery/WaitingInput 才有正确宿主；否则又是孤岛。

## 二、架构图

### 总链路

```text
Local Core truth（Project/Artifact/Conversation/Run/Review/Relation/Revision/continuation journal）
      │ typed client（apps/web-gen2/src/backend/* + web-gen2 ports：presenter/controller/state machine/geometry）
      ▼
LCOS React host（huabu/apps/web/src/lcos/* = route-level Shell 唯一组合根）
   └─ LcosProjectShell
        ├─ LcosGlobalHud / LcosRailway / LcosSurfaceDock        （route-level chrome）
        ├─ LcosWorksiteStage                                     （Main/Context/Workflow 现场）
        │    └─ CanvasHostBoundary ──> Huabu Canvas Kernel
        │         （ReactFlow/nodes/edges/geometry/viewport/selection/drag/resize/connect/history）
        │         ├─ LCOS node-body seam（binding-aware species body）
        │         └─ canvas-local overlay 仅 drop hint/reference badge
        ├─ ProfessionalWindowStage（route-level sibling：窗口/Reader/Work View/body registry）
        ├─ LcosComposerHost
        └─ local UI store（仅 active surface/open window/focus/draft 等可丢失 intent）
      │
      ▼
Bridge / T7 Adapter（真实 provider transport → external session receipt → Core journal/reconcile）
```

### 三现场如何共享 identity、拥有不同 projection、复用同一 Canvas mechanics

```text
Core Entity ID（唯一）
   ├─ Main worksite      canvasId=M   projection: 自由摆放、物种内容优先、Reader 从节点长出
   ├─ Context worksite   canvasId=C   projection: Atlas 强表征/child canvas/Temporal Rail
   └─ Workflow worksite  canvasId=W   projection: 任务牌/Step/Card Pool/Hand
        └─ 三者共享 identity/binding；各自独立 camera/selection/layout/history
           ├─ 复用同一 Huabu kernel 实现（ProjectionBinding → RFS → 同一 ReactFlow runtime）
           └─ Portal/Surface 只做进入/返回/camera restore，不造近似接口、不建第二 graph
```

## 三、本次施工铁律（浓缩）

1. production route 只挂一棵 LCOS Shell；Huabu Canvas 只有一份。
2. 旧 Huabu 可见壳不进 production tree（不是 z-index 遮住）。
3. 每个可见组件先查 donor/FigMA ledger 再编码；未绑定 caller 不算完成。
4. stock fallback 只用于明确失败；已绑定实体长期 native = 漏做。
5. T7/Recovery/WaitingInput 一律在 Shell/节点/三现场/Work View 到位后接入正确宿主。
6. Local UI store 不放 Project/Run/Relation truth。
7. 每 Wave 真实浏览器动作 + 整页 before/after；build/test 全绿不算前端完成。