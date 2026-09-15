# GEN2 Frontend UX Runtime Contract

> 2026-09-15 总装补充：本文件是职责摘要，不是功能齐全或迁移完成的证据。施工同时读取 `../audit/GEN2_UX框架总图与全旅程补漏_20260915.md` 及其分项核对。尤其原命令可复用不等于新入口已接通；窗口/阅读/导航须有真实往返链。下文“UI状态可丢失”不能覆盖Figma已明确的窗口目标、阅读位置与草稿恢复要求，需逐项核原案；Atlas的3D/2.5D描述也不要求另建3D runtime。

> 目的：把已经确认的产品交互固定成可执行的源码边界。后续 Agent 可以继续填组件、动效和真实数据，但不得重搭产品壳、复制 owner，或把局部功能当成整机完成。

## 1. 权威顺序

1. 用户当前裁决；
2. Figma 的组件、变体、尺寸、状态与 token；
3. 本合同规定的宿主、动作与数据 owner；
4. 当前 Gen2 / Huabu / Gen1 donor 源码；
5. 历史 HTML 只用于解释关系和手感，不是生产视觉正本。

Figma 决定“长什么样”；本合同决定“挂在哪里、谁提供状态、点击后交给谁”。两者缺一都不能写完成。

## 2. 唯一生产挂载树

```text
App route
└─ LcosProjectRoute
   └─ LcosProjectShell                         route-level 唯一产品壳
      ├─ LcosWorksiteStage                     当前只挂一张 Huabu Canvas
      │  ├─ CanvasHostBoundary                 Huabu 唯一空间内核
      │  ├─ CanvasNodePresentationSeam         Core binding → LCOS 物种 body
      │  └─ Canvas-local portals               Action Arc / 显式 Composer / Drop feedback
      ├─ LcosGlobalHud                         项目级屏幕空间控制
      │  ├─ Navigator                          搜索、Pin、Locate
      │  ├─ Railway                            具体、可持续返回的目的地
      │  ├─ SurfaceDock                        Main / Context / Workflow 唯一一级入口
      │  ├─ Assembly entry                     项目共享仓库的独立入口
      │  └─ Camera controls                    驱动同一个 Huabu viewport
      └─ ProfessionalWindowStage               Reader / Assembly / Work View / Portal
```

生产路由必须始终只有一棵 `LcosProjectShell` 和一份 React Flow。旧 Huabu `MainLayout`、`CanvasHeader`、`PreviewWorkspacePanel`、`CanvasLayerPanel` 与固定 Chat sidebar 不得和新壳叠加挂载。

## 3. 三个容易混淆的入口

| 组件 | 用户问题 | 真实数据 | 动作 owner |
|---|---|---|---|
| SurfaceDock | 去 Main、Context 还是 Workflow？ | 固定三 Surface + Core workspace/canvas 映射 | `useLcosWorksiteNav` |
| Railway | 项目里有哪些可持续返回的具体目的地？ | Core Railway destination projection | Worksite / Portal / Locate adapter，按目的地种类分派 |
| Navigator | 某个对象在哪里？ | Core search + binding/occurrence projection | Locate / Focus |
| Assembly entry | 从共享仓库取什么、投到当前哪里？ | Core warehouse + caller 提供的 canonical target | `openAssembly` → `AssemblyBody` |
| Professional body entry | 围绕当前对象阅读、对话或预览什么？ | 当前对象的 canonical identity | Action Arc / 双击 → 对应 body |

Railway 不得用 `LCOS_SURFACES.map()` 生成第二套三现场按钮；Railway 数据为空就保持为空。`kind=context|workflow` 只描述某个具体目的地，不能直接降格成根 Surface 点击。

Assembly 与 Professional Window 不是同一个层级：Assembly 是可独立进入的项目工具，Professional Window 是承载 Assembly、Reader、Conversation Work View、Portal Preview 的窗口机械。界面必须保留 Assembly 的项目级入口，也必须保留各对象进入对应 Professional body 的入口；不能用一个含糊的“打开面板”按钮代替两者。

## 4. 节点与 Huabu 的分工

```text
Huabu NodeWrapper
  owns geometry / selection / drag / resize / connect / pointer arbitration

CanvasNodePresentationSeam
  reads Core binding + descriptor + presentation input
  chooses exactly one LCOS species body

LCOS species body
  owns morphology / content hierarchy / semantic state presentation
```

已绑定主流实体不得长期落回 native 白卡。native body 只用于 unbound、unsupported、stale 或 runtime unavailable，并必须能解释 fallback 原因。LCOS route 不显示 Huabu `AI` badge。

## 5. 操作面只有一个

- 节点选中后的常用动作进入 `LcosActionArc`：最多 3 个常用动作 + 1 个“更多”。
- 命令定义来自 `apps/web-gen2/src/interaction/nodeCommandModel.ts`；Action Arc 只做呈现和 dispatch。
- Huabu 原节点工具条的 resize、accent、large view、delete、move 等机械先映射进命令，再停止旧 UI 挂载；不能先藏能力。
- Edge、多选、笔迹等未覆盖类型继续明确登记，补齐替代入口后再退役对应旧壳。

## 6. Composer 不是常驻底栏

- Composer 只由明确的对象级“工作/编写”动作打开。
- 它是 Worksite 所有的 selection-local UI，通过统一 canvas portal 靠近当前对象呈现；不写入 React Flow node/edge，也不是 Huabu ChatPanel。
- 关闭只关闭 UI，草稿可保留；提交调用 Core Run/Receiver 合约，失败保留草稿并显示真实原因。
- 首屏、无目标、只选中但未点“工作”时，DOM 中不得出现 Composer。

## 7. Agent 对话的融合位置

右侧固定 Huabu Chat sidebar 退役，机械能力进入 `ConversationWorkView`：

```text
Glyth / Conversation node
→ Open Conversation Work View
→ ProfessionalWindowStage
   ├─ identity / reach
   ├─ conversation stream + message history + input
   ├─ waiting_input
   ├─ run / review / artifact return
   └─ continuation / recovery
```

`ChatPanel` 只能作为 donor 拆出 transport/session/history/input 机械，不能把 `SidebarPanel` 旧壳整块塞回。`connectedConversationId` 不能直接猜成 Huabu `threadId`；必须由 T7/Core binding 给出已确认 session address。没有绑定时不显示可发送的假输入框。

## 8. 集合、Portal 与三个现场

- Context 子画布本身是 Worksite，Atlas 是同一 Context 内容的 3D/2.5D 组织视图；拖到 Main 后使用 Main 的紧凑/2.5D 集合节点呈现。
- Workflow 卡保留“任务/装备卡”语法；Main 上放集合入口或 Portal，不把整套卡牌 UI 永久摊在主画布。
- Assembly 是 Professional Window 内的共享材料与集合工作区，但有独立的项目级入口；它不是第四 Surface，也不是 SurfaceDock 固定按钮。入口按当前 Surface 传入 Main 或当前 workspace target。
- Portal 复用 Huabu 跨画布预览、进入和返回机械；Context、Workflow、Conversation 的入口不能各自再造一套近似导航协议。

## 9. 状态 owner

| 状态 | 唯一 owner |
|---|---|
| Project / Artifact / Conversation / Relation / Run / Review / Revision | Local Core |
| Canvas / node geometry / selection / viewport / spatial history | Huabu |
| provider capability / external session adapter | T7 |
| run lifecycle / waiting / recovery receipt | T6 + Core journal |
| 当前打开窗口、临时草稿、HUD 展开态 | LCOS UI store，可丢失 |
| 颜色、间距、圆角、组件 variant | Figma tokens/components |

UI 不得用本地 mock、文案或 Zustand 复制前四行真值。

## 10. 每个前端任务的最小施工格式

施工前写清：

```text
Figma source → component / variant / state
existing donor → repo / file / symbol / license
target → exact file / symbol / production caller
producer → real API/store/event
action → real command/client/adapter
fallback → exact reason
verification → interaction + persistence/reload + screenshot
```

只有截图相似、组件测试通过或 body 已注册，不能写“完成”。必须在 production route 可达，并经过真实鼠标/键盘路径和 reload。

## 11. 运行时不变量

1. `data-lcos-project-shell` 恰好 1 个，`.react-flow` 恰好 1 个。
2. `data-lcos-surface-dock` 恰好 1 个，且只有 Main / Context / Workflow 三个按钮。
3. Railway 空数据不生成静态 Surface；每个 item 必须来自 Core destination ref。
4. `data-lcos-assembly-entry` 恰好 1 个且位于 SurfaceDock 之外；点击后由唯一 Professional Window Stage 承载 `AssemblyBody`。
5. 初次进入、未发显式 Composer intent 时，`data-lcos-composer` 数量为 0。
6. LCOS route 的 NodeToolbar、Controls、MiniMap、旧固定 Chat sidebar 数量为 0。
7. Core-bound 节点经唯一 presentation seam 呈现；同一节点不同时挂 LCOS body 和 native editor。
8. Conversation Work View 若显示可发送输入，必须同时具有已确认 session address 与真实 transport。
9. E2E selector、console error、pageerror、意外 HTTP 状态任一失败，进程必须非零退出。

## 12. 当前诚实状态（2026-09-14）

- Shell、三现场、SurfaceDock、节点 seam、部分 Action Arc、Professional Window 已有生产 caller。
- Figma S2 节点形态正在与真实投影、媒体 staging、首屏相机一起收口。
- Railway 已停止静态生成三 Surface，但具体 destination activation/reorder/Receive 尚未全接。
- Conversation Work View 已有 identity/run/review/recovery；Huabu chat stream/session/input 的薄适配仍需真实 session address 后接入。
- Context Atlas、Temporal Rail、Workflow Hand、Portal 的完整动效与跨现场路径仍按各自 Wave 深化，不能用当前概念 Demo 视觉当完成稿。
