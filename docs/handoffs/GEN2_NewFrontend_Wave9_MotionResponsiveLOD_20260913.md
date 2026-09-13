# Wave 9 施工交付 — 视觉 / Motion / LOD / 响应式 / 无障碍收口

日期：2026-09-13　分支：frontend-reconstruction-v2
对应卡：`04_逐Wave施工卡与验收.md` Wave 9（第 327–344 行）

## 0. 已读清单（本波实际读到的东西，未读的不冒充）

| 项 | 状态 |
|---|---|
| Wave 9 施工卡原文（327–344 行） | 已读 |
| 本仓 `docs/construction/{SOURCE_ADOPTION_LEDGER,FIGMA_SOURCE_LEDGER,HUABU_RETIREMENT_LEDGER}.md` | 已读（本波更新） |
| Wave 8 handoff（上一波断点与"Wave 9 就绪"输入） | 已读 |
| Figma 本地全设计包 `E:\Codex 项目\OS开发\exports\LCOS_Figma_全设计包_20260913`：`README.md`、`unification/specs/hud.json`（主稿 `5388:27696`、响应式文本 `5392:7804`）、`unification/nine-surface-status.json`（HUD 面 responsive/motion/actions） | 已读（摘录见 §5） |
| 真实源码：`apps/web-gen2/src/presentation/nodePresentation.ts`、`huabu/apps/web/src/components/Nodes/NodeWrapper.tsx`、`components/Nodes/note/NoteNode.tsx`、`lcos-seam/{nodePresentation,nodeBodySlot,types}`、`hooks/{useNodeLOD,useCloseOnEscape}`、`config/semanticZoom.ts`、`lcos/{nodes,shell,navigation,composer,professional,host,ui}/**`、`components/Panels/Canvas/Canvas.tsx` | 已读 |
| 本波**未**重读 | 早期 HTML 交互样机（T2/T3 HTML、S01–S04/B03/B04）与 donor 动效库源码——本波范围是既有实现的 motion/a11y/响应式收口，未新增视觉形态；若下一波要新增视觉形态，需按 SOP 补读 |
| Figma 明示缺口 | 设计包 `README.md` 原文："真实关键动效录屏、跨页原型、部分组合状态和响应式浏览器验证未完成" → 本波动效按 reduced-motion 标准 + 卡内要求收口，不假装 Figma 已定动效 |

## 1. 用户现在真实能做什么（可感知变化）

1. **键盘焦点可见**：Tab 走到 LCOS HUD 任意控件（身份胶囊 / 相机岛 / SurfaceDock / 专业窗口关闭按钮 / Composer 输入）都有 `2px` 高对比轮廓（`--info`，深浅色主题各自成立）；鼠标点击不显示轮廓，不产生噪声。此前 LCOS 层完全没有焦点样式（只有浏览器默认）。
2. **Esc 逐级关闭**：打开专业窗口后按 Esc 关闭最上层窗口，且不会连带清掉画布选中（Esc 被窗口消费，`.stopPropagation()`）。Figma `specs/hud.json` 的 actions 原文即"Esc 逐级关闭"。
3. **相机移动更稳**：滚动/缩放画布时呼吸动画与节点投影暂停（相机落定 140ms 后自动恢复），整屏 transform 期间不再叠加动画/阴影开销。
4. **窄屏不再裁切**：390×844 下 SurfaceDock 不再越界（此前 x=-25、宽 439 被壳裁掉左侧），1024/1366/1440/390 四档实测 8 类浮岛全部落在视口内。
5. **相机岛热区达标**：相机按钮 36×36 → 44×44，浮岛高 52——与 Figma "camera 左下 52" 的规格数值一致。
6. **密度来源归一 + 高密度降级**：节点信息档位改为屏幕像素判定（不再是"按 zoom 拍脑袋"），并新增 80/150/300 节点数封顶（>150 封到 working，>300 封到 summary），高密度画布自动减重。
7. **reduced motion 不丢状态**：`prefers-reduced-motion` 下呼吸动画取消、过渡瞬时（0.01ms）、位移取消，但状态文字/颜色/轮廓全部保留（Figma HUD motion 原文："reduced-motion 瞬时改宽/淡入，不沿路径飞行"）。

## 2. Before → After

| 项 | Before（Wave 8） | After（Wave 9） |
|---|---|---|
| 密度判定 | 各 body 各自维护 `zoom < 0.25/0.55/0.9` 阶梯；`useLcosNodePresentation()` 的 provider **在生产 tree 里从未挂载**，消费端永远拿到 `undefined` | `NodeWrapper` 薄接缝发布真实呈现输入（world×zoom / DPR / phase）；`useLcosDensity()` 为唯一入口，走 web-gen2 `resolvePresentationDensity`（屏幕像素），zoom 阶梯只作无上下文退化 |
| 焦点可见 | 无 LCOS 焦点样式 | `lcos.css` 统一 `:focus-visible` 轮廓，覆盖 6 类元素 |
| Esc | 只能点关闭按钮 | Esc 逐级关闭（复用 Huabu `useCloseOnEscape`） |
| 相机移动 | 动画/投影全程运行 | `data-lcos-camera-moving` 期间暂停，落定恢复 |
| 390 宽 | SurfaceDock 左侧越界被裁 | 最大宽度约束 + 窄屏内边距收缩 + 占位 Navigator 隐藏 |
| 相机岛 | 36×36 按钮，岛高 44 | 44×44，岛高 52（= Figma 规格） |

## 3. Production caller（真实入口链）

```text
NodeWrapper（每节点，Huabu 薄接缝，第 7 处）
  └─ LcosNodePresentationProvider value={world/zoom/dpr/screen/phase}
       └─ <children> = NoteNode body slot（useResolvedNodeBody）
            └─ createLcosNodePresentationSeam().resolve → NODE_SPECIES_BODY[species]
                 └─ LcosSpeciesBody / GlythNodeBody → useLcosDensity()
                      ├─ useLcosNodePresentation()（活的呈现输入）
                      ├─ resolvePresentationDensity()（web-gen2，屏幕像素）
                      └─ densityCapForNodeCount(useCanvasStore.nodes.length)

useLcosCanvasProps（canvas runtime 单例）
  └─ overlays += { key: 'lcos/camera-motion', node: <LcosCameraMotionPolicy /> }
       └─ useViewport() 变换 → 写 [data-lcos-project-shell][data-lcos-camera-moving]
            └─ lcos.css：暂停 .lcos-static-pulse / 去 [data-lcos-species-body] 投影

LcosProjectShell → ProfessionalWindowStage
  └─ useCloseOnEscape(windows.length > 0, closeActive)  ← Huabu 既有 hook 直接复用
```

## 4. 修改文件

新增：
- `huabu/apps/web/src/lcos/ui/lcos.css`（静态脉冲 / 焦点轮廓 / 相机移动暂停 / 密度降级 / 玻璃降级 / reduced-motion）
- `huabu/apps/web/src/lcos/nodes/useLcosDensity.ts`（+ `useLcosDensity.test.ts`，4 tests）
- `huabu/apps/web/src/lcos/host/LcosCameraMotionPolicy.tsx`
- `scripts/e2e/wave9-responsive-a11y.mjs`

修改：
- `huabu/apps/web/src/index.css`（`@import './lcos/ui/lcos.css'`）
- `huabu/apps/web/src/components/Nodes/NodeWrapper.tsx`（发布呈现输入 + `resizing` phase 信号；Huabu 允许的薄接缝）
- `huabu/apps/web/src/lcos/nodes/{LcosSpeciesBodies,GlythNodeBody}.tsx`（改用 `useLcosDensity`，输出 `data-lcos-density`）
- `huabu/apps/web/src/lcos/shell/LcosSurfaceDock.tsx`（窄屏约束/内边距/占位隐藏）
- `huabu/apps/web/src/lcos/navigation/LcosCameraControls.tsx`（44px 热区 → 岛高 52）
- `huabu/apps/web/src/lcos/composer/LcosComposerHost.tsx`（`calc(100vw-240px)` → `calc(100vw-24px)`，窄屏可用）
- `huabu/apps/web/src/lcos/professional/ProfessionalWindowStage.tsx`（Esc 栈）
- `huabu/apps/web/src/lcos/useLcosCanvasProps.tsx`（注册 camera-motion overlay）
- `docs/construction/SOURCE_ADOPTION_LEDGER.md`（T1-A01/A02 状态 + 3 条 Wave 9 承接行）

## 5. Donor / Figma 采用

| 来源 | 采用方式 | 落点 |
|---|---|---|
| Figma 全设计包 `unification/specs/hud.json` 主稿 `5388:27696` + 响应式文本 `5392:7804`（父 `5392:7799`） | 规格直采：`camera 左下 52`、`SurfaceDock 底24 常驻`、`Esc 逐级关闭`、`zoom 只走 camera`、`reduced-motion 瞬时改宽/淡入，不沿路径飞行` | 相机岛高 52（44 按钮 + 8 内边距）、Esc 栈、e2e 只用相机岛缩放、reduced-motion 规则 |
| Figma `unification/nine-surface-status.json` HUD 面 `responsive` | 设计声明宽度为 1440/1280/1152/1024（**不含 390**）；卡内要求 390×844 → 按"约束重排、不缩放字体"原则做了最大宽度 + 内边距收缩（未缩字号） | SurfaceDock / Composer |
| Huabu（本仓）`hooks/useCloseOnEscape.ts` | A：直接 import 复用，不新写第二套 Esc 监听 | ProfessionalWindowStage |
| Huabu（本仓）`@xyflow/react::useViewport` | B：机制复用（变换流 → DOM 属性），不建第二相机、不做逐帧 setState | LcosCameraMotionPolicy |
| Huabu `config/semanticZoom.ts`（screenThresholds.minimal=150 + hysteresis 10） | 参考：确认本仓既有 LOD 也以屏幕像素为准 → LCOS 侧统一到屏幕像素，阈值用 web-gen2 `SCREEN_DENSITY_THRESHOLDS`（44/84/180/84/480/260）单一来源 | useLcosDensity |
| Figma `SurfaceFeedback`（loading 用静态符号，不用无限旋转） | 沿用 Wave 3 的 `.lcos-static-pulse` 低幅呼吸，本波补 reduced-motion 覆盖 | lcos.css |
| GEN1 motion 纯函数（`canvasGeometry.ts` 等） | **未采用**（本波未新增相机纯函数；GEN1 相机纯函数承接仍是 `T1-A03 PLANNED`，留给后续波） | — |

Huabu 原文件只增加第 7 处薄接缝（`NodeWrapper.tsx` 发布呈现输入，仅透传、无领域语义），未新建 store/fetch/session/camera/history。

## 6. 真实数据路径

`lcos-gen2-dev` 真实 Core 数据：Main 画布 5 个 Conversation Glyth body（`data-lcos-glyth-body` / `data-lcos-species-body`），zoom 由相机岛走 Huabu 唯一 camera。密度观测不依赖任何 fixture。

## 7. 浏览器操作与证据（`scripts/e2e/wave9-responsive-a11y.mjs`，headless Chromium）

布局（8 类浮岛：Railway / SurfaceDock / Navigator / FocusWhere / camera / canvas-commands / Composer / ProfessionalWindow）：

| 视口 | shell scrollWidth | 越界浮岛 | species bodies |
|---|---|---|---|
| 1440×900 | 1440 | 无 | 5 |
| 1366×768 | 1366 | 无 | 5 |
| 1024×768 | 1024 | 无 | 5 |
| 390×844 | 390 | 无（修复前 SurfaceDock x=-25 / w=439） | 5 |

密度（同一组 5 个 Glyth，屏幕像素判定 vs 旧 zoom 阶梯）：

| 相机状态 | 屏幕尺寸 | 实得密度 | 旧 zoom 阶梯会判 |
|---|---|---|---|
| fit（zoom 0.29） | 75×58 | **mark** | summary ← **分歧，证明来源已换成屏幕像素** |
| 放大 ×5（71%） | 187×144 | working | working |
| 缩小 ×9（zoom 0.14） | 36×28 | mark | mark |
| 适合画面 | 75×58 | mark | summary |

相机移动：滚轮期间 `data-lcos-camera-moving` 出现 = true；落定后清除 = true（140ms 去抖）。

键盘焦点（`:focus-visible`，等 `transition-colors` 的 outline-color 过渡结束后读值）：

| 控件 | 尺寸 | 轮廓 |
|---|---|---|
| 身份胶囊 `a[title="返回项目列表"]` | 234×44 | `solid 2px rgb(46,144,255)` |
| 相机「放大」 | 44×44 | `solid 2px rgb(46,144,255)` |
| SurfaceDock「Context」 | 80×44 | `solid 2px rgb(46,144,255)` |
| 专业窗口关闭按钮 | 28×28 | `solid 2px rgb(46,144,255)` |
| 画布内 note 编辑器（Tab 走查中） | — | `solid 2px rgb(46,144,255)` |

reduced motion（`emulateMedia({ reducedMotion: 'reduce' })`）：`.lcos-static-pulse` → `animationName: none`、`opacity: 0.85`；浮岛 `transitionDuration: 1e-05s`（瞬时改宽/淡入，不沿路径飞行）。

Esc 栈：Glyth 双击开窗 = true → 按 Esc → 窗口关 = true、画布存活 = true。
Console 错误：0（本波全部脚本）。

截图：`C:/Users/1/AppData/Local/Temp/trae/screenshots/wave9_{1440x900,1366x768,1024x768,390x844}_main.png`、`wave9_density_zoomin_1366.png`、`wave9_density_zoomout_1366.png`、`wave9_esc_stack_1366.png`、`wave9_reduced_motion_1366.png`。

## 8. 测试命令与结果

| 验证 | 命令 | 结果 |
|---|---|---|
| 类型 | `huabu/apps/web`: `npm run typecheck` | PASS |
| Lint（本波触及面） | `npx eslint src/lcos src/lcos-seam src/components/Nodes/NodeWrapper.tsx --max-warnings 0` | PASS（0 error / 0 warning） |
| 单测 | `npx vitest run src/lcos src/lcos-seam` | PASS 13 文件 / 67 tests（Wave 8 为 63，+4） |
| 浏览器 | `node scripts/e2e/wave9-responsive-a11y.mjs` | PASS（§7 全部断言，console 0 error） |
| 仓级 `npm run lint` | — | **FAIL（预存，非本波引入）**：9 个 `import/order` error 在 Wave 1–2 的接缝文件（App.tsx / NoteNode.tsx / Canvas.tsx）+ 56 个 warning（多为测试文件 `no-non-null-assertion`、`useSketchStrokeMove` exhaustive-deps）。`--max-warnings 0` 使仓级 lint 一直为红；本波按"未触及文件只登记不主动修"纪律未动 |

## 9. 未完成 / FALLBACK / GAP（不声称完成）

- **GAP（产品壳冲突，需用户定夺）**：LCOS 下选中/悬停节点仍出现 Huabu 的节点浮动工具条（W/H、强调色、打开大视图、移动到 Space）。`chromeMode='lcos'` 只摘掉 NodeToolbar/Controls/MiniMap，`NodeWrapper` 内的 `NodeFloatingToolbar` 未纳入。因 LCOS 的 Action Arc（T3）尚未实现，**现在摘掉会删除唯一可用的节点命令入口**，故本波保留并在下方列出，等 T3 Action Arc 落地后一并替换（换呈现不删逻辑）。
- **390×844 不在 Figma 响应式声明范围内**（设计只声明 1440/1280/1152/1024）。本波只保证"不溢出、不裁切"，未按手机形态重排信息层级。
- **动效规格来源**：Figma 未提供关键动效录屏（设计包自述），本波动效只按卡内要求 + reduced-motion 收口；岛 hug 形变、Locator 抵达回落、Rail fisheye、Glyth shape、Hand summon、Portal enter/exit 的**逐项可中断/反向**尚未逐条实现（卡内列出，本波只做了"暂停/降级"层面）。
- **玻璃降级**：`@supports not (backdrop-filter)` 分支已写，但本波浏览器（Chromium 1234）均支持 backdrop-filter，未能在真实降级环境取证 → 只能算"规则已备，未经实测"。
- **gen1 相机纯函数承接（T1-A03）仍 PLANNED**。
- 8 类浮岛的越界探测是**矩形级**（外框），未逐个断言子元素不互相遮挡；Composer 与 SurfaceDock 的 z 序在 1024 下未做重叠几何断言。

## 10. 下一 Wave 的直接输入

- **Wave 10（Golden Path）** 可直接用本波的三视口 + reduced-motion + Esc 断言作为回归基线；主路径需覆盖：打开项目 → Main → Assembly → Reader → Context/Atlas/Rail → Workflow Card → Glyth Work View → Run/waiting → review/return → Accept/Retry → 回 Main → 重启恢复。
- 本波暴露的两个收尾项应并入 Wave 10 之后：① T3 Action Arc 落地后摘除 Huabu `NodeFloatingToolbar`（消除双产品壳）；② provider capability 门控 UI + capture-inbox / connector-source / runtime-doctor body（Wave 5/8 遗留）。
- 若下一波要新增视觉形态（例如 Atlas approach、Hand summon），须先按 SOP 补读早期 HTML 样机与 donor 动效库，再动工。

## 11. 回滚点

Wave 8 commit `8e90e09` 之后。回滚方式：`index.css` 去掉 `@import './lcos/ui/lcos.css'`；`NodeWrapper.tsx` 去掉 `LcosNodePresentationProvider` 包裹与 `lcosPresentation`/`resizing`（回到"密度退化为 zoom 阶梯"）；`useLcosCanvasProps` 去掉 `lcos/camera-motion` overlay；`ProfessionalWindowStage` 去掉 `useCloseOnEscape` 调用。以上四处均为独立小改，互不耦合。
