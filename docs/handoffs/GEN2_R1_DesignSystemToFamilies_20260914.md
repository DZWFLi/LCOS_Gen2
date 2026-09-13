# GEN2 R1 交接 — 设计系统 → 代码组件族（2026-09-14）

分支 `frontend-reconstruction-v2`（不 push、不合并 main）。R0 已 reviewed；本文件是 R1 的交付与证据。
状态：**ready_for_review**（施工 Agent 不自标 reviewed；R2 前由用户总装裁定）。

---

## 0. 已读清单（SOP 前置阅读，逐项确认已读）

| # | 材料 | 位置 | 读到的关键结论 |
|---|---|---|---|
| 1 | `14_685e02a保留重写矩阵与Recovery_Waves.md` | `deliverables/GEN2_新前端重新总装正本_20260913/` | R1 目标 / 施工 5 条 / 退出条件 3 条 |
| 2 | `16_R0_Readback复核与下一步指令_20260914.md` | 同上 | R0 校准两点 + R0 后三件顺序（R0-5→R0-6→R0-3） |
| 3 | `12_Figma九面视觉统一与前端协作合同.md` | 同上 | 「Figma 给的 CSS alias 只是命名建议；先核现有 token，再选择映射/别名/新增；不得复制一套同值变量」 |
| 4 | `17_多Agent施工一致性方案` / `18_多Agent并行总装启动Prompt` | 同上 | 单写者 / 独立 worktree / 独立验收；状态机 |
| 5 | `AGENTS.md`（工作区规则） | 仓库根 | 施工落点纪律、两条全局动工指令、永久红线 |
| 6 | `PROJECT_READBACK.md` / `SOURCE_ADOPTION_LEDGER.md` / `HUABU_RETIREMENT_LEDGER.md` | `docs/construction/` | 前端重装硬规则 1 条 |
| 7 | Figma 本地设计包（本轮实际读取的文件） | `E:\Codex 项目\OS开发\exports\LCOS_Figma_全设计包_20260913\unification\` | `token-style-component-manifest.json`（components 9 / variables 32 / collections 3 / styles 2 / svgAssets 3 / limitations 4 / semanticCorrections 2 / familyBindings 9）、`structures/navigator·railway·window-chrome·feedback`（实测几何） |
| 8 | 联网调研（先调研后动手） | — | 「设计 token → CSS custom properties 单一入口、组件按 variant 轴建模、dev gallery 覆盖全部 variant」是成熟做法（设计系统 3 层：primitive → semantic(alias) → component token；codeSyntax/Code Connect 就是 Figma 侧的 alias 契约）。本 Wave 采用 `var()` 语义引用 + 生成式产物，未自研新机制 |

未做（明确登记）：page 13 四组组件（5333:96 / 5334:46 / 5335:110 / 5348:1151）的 Figma 在线页未再单独打开，本地导出包中它们**只有变体轴与变体框尺寸**、无 `structures/` 细分几何 → 见 §5 缺口 1。深色模式未做人工走查（只有 e2e 计算样式断言），见 §5 缺口 3。

---

## 1. 交付内容

### 1.1 token 层（R1 施工第 1–2 条）

| 产物 | 路径 | 说明 |
|---|---|---|
| 生成器 | `scripts/figma/gen-lcos-tokens.mjs` | 唯一输入 = Figma `token-style-component-manifest.json`；`--check` 只校验不写盘 |
| 渲染入口 | `huabu/apps/web/src/lcos/ui/lcos-tokens.css` | 32 variable（17 双主题 + 15 与主题无关）+ 3 个 EFFECT 派生变量 |
| 映射证据 | `docs/audit/GEN2_R1_token_map_20260914.json` | 每行：Figma id / 名称 / collection / **变量名出处** / 双主题值 / 原始 RGBA |
| TS 语义层 | `huabu/apps/web/src/lcos/ui/lcosTokens.ts` | 只导出 `var(...)`；出现 hex/rgb 即测试失败 |
| 结构读包工具 | `scripts/figma/describe-structure.mjs` | 打印 `structures/<name>` 的 pad/gap/尺寸/圆角/fill/boundVariables |

关键决定：
- **变量名不手编**：优先 Figma `codeSyntax.WEB`（`--gen2-*`、`--lcos-pin-*`，作者手写），其次 manifest `suggestedCssAlias`；两者皆缺 → 生成器报错退出。
- **取值取 `resolvedValuesByMode`**：alias 链在浅/深两个 mode 常指向同一 VariableID（例：`界面/canvas` 两 mode 都指向 `5037:50`），只有 resolved 才是主题真实值（`#FAFAFA` / `#0A0A0A`）。
- **TS 侧去掉了 `.light`/`.dark` 分叉**：颜色交由 CSS 变量按主题解析，25 个文件 232 处 `lcosTokens.color.X.light|.dark` → `lcosTokens.color.X`（一次性 codemod，已删除脚本）。
- **LCOS 本地 token 显式登记**（Figma 无对应 variable）：`--lcos-status-danger`、`--lcos-glass-bg`、`--lcos-window-shadow/-border`、字号阶梯。

### 1.2 共享组件族（R1 施工第 3 条）

新增 `huabu/apps/web/src/lcos/ui/families/`（barrel `index.ts`）：`LcosNavigatorIslandView`、`LcosRailwayView`、`LcosWindowChrome`、`LcosCollectionSurface`、`LcosTaskCard`、`LcosPortalPreview`；`LcosSurfaceFeedback`（`ui/`）与 `LcosProjectShell`（`shell/`）**原地升级为族**，不建副本。
变体样式集中在 `families/lcos-families.css`，只引用 token 变量（测试断言该文件不含 hex/rgb）。

生产 caller 原地改造（不新增第二套壳）：

| 族 | 生产 caller（文件） | 改了什么 |
|---|---|---|
| ProjectShell | `lcos/shell/LcosProjectShell.tsx` | 根加 `data-lcos-family` + `data-lcos-variant={现场}`；身份胶囊改用 `lcosGlassStyle`（删掉 3 处内联 rgba） |
| NavigatorIsland | `lcos/navigation/LcosNavigatorIsland.tsx` | 视图抽到族；状态词与 Figma 同名（静息/搜索/loading/error）；搜索键改为可收起（等价 Esc 恢复，去掉额外关闭按钮以守住 402 宽度公式）；hover 不再自动展开（Figma 的 hover 是视觉态） |
| Railway | `lcos/shell/LcosRailway.tsx` | 用 `LcosRailwayView`；脚注移出岛（原实现把 `+N` 塞进岛内 → 高度超出 Figma） |
| WindowChrome | `lcos/professional/ProfessionalWindowStage.tsx` | 顶栏改用 `LcosWindowChrome`；窗口边框/投影改用本地 token；保留 `data-lcos-window-tab=<bodyKey>`（旧脚本选择器兼容） |
| SurfaceFeedback | `lcos/ui/LcosSurfaceFeedback.tsx` | 根加族属性；删掉内联颜色（内联会压过 CSS 变体） |
| Collection | `lcos/surfaces/context/ContextAtlasStage.tsx` | 体块改用族：**248×244、列间 32**（原为 minHeight 150 + gap 16，与 Figma 不符） |
| TaskCard | `lcos/surfaces/workflow/WorkflowCardPool.tsx` | 卡改用族：**224×324**；状态由真实事实推导（草稿中 = 该实体已在 Composer 草稿；不可用 = 无可引用身份） |
| Portal | `lcos/professional/PortalPreviewBody.tsx`（新）+ `lcos/nodes/PortalNodeBody.tsx`（新）+ seam | Portal 族生产入口打通：原生 `canvasRef` 节点（`data.targetCanvasId`）双击 → `openWindow('portal-preview')`；`LcosProfessionalBodyKey` 增 `portal-preview` |

### 1.3 dev-only gallery（R1 施工第 4 条）

`huabu/apps/web/src/lcos/dev/LcosFamiliesGalleryPage.tsx`，路由 `/playground/lcos-families`，挂在 `App.tsx` 的 `import.meta.env.DEV` 分支（同 `/playground/components`，**不进生产包**）。
覆盖：NavigatorIsland 11 态、Railway 1/4、WindowChrome 3 布局 + 标题 + tab、SurfaceFeedback 7 呈现、Collection 9 体块（6 + 3）、TaskCard 7 状态、Portal 6 状态、ProjectShell 3 现场（loading 壳），外加浅/深主题切换按钮。

### 1.4 账本回填（R1 施工第 5 条）

`docs/construction/FIGMA_SOURCE_LEDGER.md` 重写：新增 §一 R1 族表（Figma node/变体轴/取值/实测几何 → 代码 target → production caller → gallery → 生产可达变体 → 未达变体归属）、§二 token 映射、§四 遗留缺口。**本 Wave 的表内不再出现 `NEEDS_SOURCE_BINDING`**（familyBindings 9 条已全部落到真实 target/caller）。

---

## 2. 五项完成凭证

1. **Exact binding**：族表逐行给出 Figma nodeId + 变体轴 + 实测几何（`structures/navigator|railway|window-chrome|feedback`），token 行给出 Figma VariableID + 变量名出处。硬证据：`docs/audit/GEN2_R1_token_map_20260914.json`。
2. **Real state**：没有为「让状态看起来存在」造数据。生产可达状态都由真实事实推导 —— 搜索 loading/error 来自真实 `CoreSearchClient`；卡「草稿中」来自 `useLcosReferenceStore.draft`；Portal「目标缺失/可预览」来自真实 `data.targetCanvasId`；Railway disabled 来自 `busySurface`。不可达变体一律标注归属 Wave（R3/R4/R5），未在此伪造。
3. **Fail-fast test**：
   - `src/lcos/ui/lcosTokens.test.ts`（4）：TS 层不含颜色字面量；引用的每个 CSS 变量都有定义；双主题值不同；**已提交的 CSS 与 token map JSON 逐条一致**（防只改一份的漂移）。
   - `src/lcos/ui/families/lcosFamilies.test.tsx`（8）：八族逐变体渲染断言（11/7/7/6/3/9/2/3）；原生 `canvasRef` → portal body；非 portal 原生节点仍诚实回退。
   - `src/lcos/ui/families/lcosFamilyWiring.test.ts`（11）：每族**同时**被 gallery 与生产文件 import；族 CSS 含全部 8 个族选择器；族 CSS 无颜色字面量。
   - 结果：`npx vitest run src/lcos` → **16 files / 90 tests 全绿**。
4. **Full viewport evidence**：`scripts/e2e/r1-families-gallery.mjs`（复用 R0 fail-fast harness，1440×900）两场景 `ok:true`——
   - gallery：8 分区；变体计数（含 `data-lcos-variant` 唯一取值数 = 11）；**精确几何** 静息 52×48 / 彩色标 184×48 / 搜索 402×48、Railway 52×52 与 52×178、Collection 248×244、TaskCard 224×324、Portal 440×360；切主题后 `getComputedStyle` 底色真的变化且 `html.dark` 生效；`emulateMedia(reducedMotion:'reduce')` 后 loading 变体与 `lcos-static-pulse` 的 `animation-name === 'none'`。
   - 生产 Main（`/projects/lcos-gen2-dev/main`）：`data-lcos-family="project-shell"` 且 `data-lcos-variant="main"`、navigator island 存在、railway `data-lcos-variant-count="3"`。
   - 截图：`.e2e-data/shots/r1-gallery-light.png`、`r1-gallery-dark.png`、`r1-production-main-1440.png`。
5. **Honest remainder**：见 §5；另外全量 `vitest run`（177 files）中有 **1 个与本 Wave 无关的既有失败**：`src/components/Milkdown/__tests__/blockFingerprintParity.test.ts > simple.md: raw and round-tripped markdown fingerprint identically`（`git status` 证明该文件未被本 Wave 改动，单独跑亦确定性失败）→ 按纪律只登记、不顺手改。

---

## 3. 验证命令与退出码（可复跑）

```
# 生成器（drift 自检）
node scripts/figma/gen-lcos-tokens.mjs --check                      # exit 0
# 结构读包
node scripts/figma/describe-structure.mjs railway --depth 2          # exit 0
# 静态
cd huabu/apps/web && npx tsc -p tsconfig.json --noEmit               # exit 0
cd huabu/apps/web && npx eslint src/lcos src/App.tsx --max-warnings 0 # exit 0
# 单测
cd huabu/apps/web && npx vitest run src/lcos                         # 16 files / 90 tests
# 浏览器（隔离环境先 up：scripts/e2e/r0-e2e-env.ps1 up）
node scripts/e2e/r1-families-gallery.mjs                             # 两场景 ok:true
```

---

## 4. R1 退出条件对照

| 退出条件 | 结果 | 依据 |
|---|---|---|
| 每个共享组件在 gallery 与 production 各有真实 caller | **达成** | `lcosFamilyWiring.test.ts` 11 条断言 + gallery e2e 计数 + 生产 Main e2e |
| 1440 主稿使用同一组件族，不复制页面专属近似件 | **达成（Main/Atlas/Workflow 范围内）** | 九面级生产文件均已改为族；Atlas 体块、Workflow 卡、窗口顶栏、导航岛、铁路、反馈原语无第二套近似件。Context/Workflow 主稿与 Reader/Portal 深化的族复用由 R3/R4 继续 |
| ledger 对本 Wave 不再保留 `NEEDS_SOURCE_BINDING` | **达成** | 族表 9 行全部落到真实 target/caller |

---

## 5. 诚实缺口（PARTIAL，不得改写为完成）

1. **page 13 四组组件无 `structures/`**：Collection `5333:96`/`5334:46`、TaskCard `5335:110`、Portal `5348:1151` 只有变体轴 + 变体框尺寸 → 族只采用「轴 + 体块 + 身份」，**内层细分几何未采用 Figma**。R4/R5 深化前需先拿到这部分结构导出。
2. **Pin/颜色组无 Core producer**（无 pin/color-group 客户端）→ 导航岛「彩色标」生产不可达，只有 gallery 覆盖。
3. **深色模式未人工走查**：只有 e2e 计算样式断言（底色变化 + `html.dark`），没有人眼确认深色下的对比与时序。manifest.limitations 原文即声明「深色值是导出的，但 handoff 只人工看过浅色」。
4. **Figma 原生 SVG 未采用**：`svg/5385-212/215/218.svg`（Pin 角标）当前用 lucide `Pin` + 22×22 圆角底近似。
5. **未达变体归属**：WindowChrome 停靠/分组 → R3；Collection 主画布/装配/工作流跨视图、Portal 加载中/旧缓存/部分预览/预览失败 → R4；TaskCard 预览/已选目标 → R5。
6. **`lcos/ui/presets.ts` 为空文件**（Wave 0 遗留，0 字节），本 Wave 未使用。
7. **R0 既有 gap 未动**：wave1..wave10 旧 e2e 脚本仍未迁移 harness（R2 新 harness e2e 上线后统一处理，`data-lcos-atlas-card`/`data-lcos-workflow-card`/`data-lcos-window-tab` 兼容属性已暂时保留）。

---

## 6. 断点与下一步

- 断点：R1 代码与证据已就绪，未提交（提交由总装者决定）；**R2 未开始**。
- 下一步（按 16 号文档）：进入 **R2 Main 垂直切片** —— Launcher + ProjectShell + HUD 基础构图 → **单一 NodePresentation Junction** → renderer registry 成为 production caller → 可达物种 → 真实内容位 → GEN1 placement → T3 Action Arc → 退役旧可见壳 → Composer 接 receiver。
- **R2 完成后必须停下等用户第一次视觉验收**（保存 1440 截图 + Figma 对照 + 测试结果 + commit + handoff，不把验收默认视为通过；R3/R4/R5 的源码写入在验收前不启动）。
