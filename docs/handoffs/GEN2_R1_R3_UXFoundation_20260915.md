# GEN2 R1–R3 UX 地基施工交接｜2026-09-15

```text
ROUTE: R1 → R2 → R3
BRANCH: codex/r1-semantic-drop-foundation
BASE: frontend-reconstruction-v2 @ 97841d6
STATUS: FOUNDATION PARTIAL / SOURCE LANDED / BROWSER ACCEPTANCE PENDING
NO PUSH
```

## 1. 这轮实际落地

这轮按 `LCOS_Gen2_R1-R3_UX地基源码级施工总指引_20260915.md` 的严格顺序施工，未把 Figma 视觉稿反推成新的业务语义，也没有在根目录脏工作树上写文件。

### R1｜Semantic Drop Foundation

已落地：

- `DropTargetRegistry`：只保存当前 DOM 的短生命周期命中矩形和语义描述，不保存 Core truth。
- `DropIntentResolver`：payload + live target 只解析一次，preview 与 commit 复用同一 intent。
- `DropCommitRouter`：按既有 owner 路由 Assembly apply、Composer reference；交易 id 去重；没有 owner 时 fail-close。
- Canvas、Railway destination、Composer textarea 已注册真实 target。
- Assembly source mapping 已抽成共享 helper，Assembly 与拖放共用稳定 `AssemblySourceRefV1`。
- 原生 `dragover` 与 Huabu pointer observer 走同一解析路径。
- Canvas / Railway receive 都走 `CoreAssemblyClient.apply()`；没有把 Railway receive 误写成 Railway order mutation。
- target 消失、target 变化、unsupported payload 会失效或拒绝，不弹第二个 destination/taxonomy picker。

对应提交：

```text
a6acb1a feat(gen2): establish semantic drop target foundation
8a251d0 feat(gen2): connect semantic drop sources and owners
```

尚未关闭：

- 当前 branch 没有真实浏览器拖动/停留/释放的截图或 trace；
- external file/text/url 没有接入真实 capture/import owner，因此仍按 ineligible/fail-close 处理；
- drop preview 的最终 Figma token/motion 仍属于后续视觉轮。

### R2｜Professional Window Geometry + safeRect

已落地：

- `ProfessionalWindowInstance` 与 `ProfessionalWindowRegion` 分离；不再把所有窗口天然当成一个全局 tab 列表。
- 新增纯几何函数：environment、safe insets、floating clamp、resize。
- `ProfessionalWindowStage` 成为唯一 occupied/safe environment producer，并发布到 shell ephemeral store。
- HUD、Railway、SurfaceDock、Navigator、FocusWhere 统一读取同一 window environment；没有各写一套 `windowOpen ? right + n : right`。
- open/resize/dock 的 environment publish 没有调用 camera/fitView；窗口生命周期不会隐式移动画布。
- docked-right 与 floating 的 region layout 已真实反映到 Stage/Chrome 的布局属性。

对应提交：

```text
e58c278 refactor(gen2): separate professional window topology from instances
5256083 feat(gen2): publish professional window environment
b78480b feat(gen2): make hud consume window safe edges
```

尚未关闭：

- Stage 的 titlebar 拖动、8 方向 resize、真实 viewport clamp 尚未接入 pointer interaction；
- explicit Focus/Locate 读取 safeRect 的浏览器证据尚未补；
- ProfessionalWindowStage React 测试在当前共享 junction 的重复 React 环境下不能作为有效浏览器证据，未把它写成通过。

### R3｜Railway Manipulation Foundation

已落地：

- `RailwayUiSnapshot` 同时保留完整 Core raw order、version、projection；不再只保存可见目的地。
- 每个 projection 保留精确 `sourceRef` 和 raw `sourceIndex`。
- 新增纯 reorder helper：移动 exact ref，隐藏 legacy/root ref 保留，不根据 label/index 重建身份。
- Railway 自身 drag 是 reorder；外部 object drag 到 Railway 是 receive；click 仍是 navigate，三种语义分开。
- reorder 使用 `CoreRailwayClient.write({ expectedVersion })`，成功接受 server order；409 只回读，不自动拿新 version 重放旧动作。
- Railway receive target 继续走 R1 Assembly apply，不改变 Railway order。

对应提交：

```text
63994e5 feat(gen2): add CAS-backed railway reorder foundation
```

尚未关闭：

- receive/eligible/hot/ineligible 的最终 Railway presentation state 还未接到 Figma body；
- peek、overflow、manage/remove 的最终交互还未接；
- reorder → reload → durable order 以及并发 stale 的真实浏览器证据还未补。

## 2. 验证结果

### 通过

```text
npm run test --workspace @local-creative-os/web-gen2
→ 290/290 passed

npm run typecheck --workspace @local-creative-os/web-gen2
→ passed

npx tsc -p huabu/apps/web/tsconfig.json --noEmit --pretty false
→ passed

Huabu focused Vitest（7 files）
→ 60/60 passed

pnpm build（huabu/apps/web）
→ tsc + vite production build passed
```

`git diff --check` 通过，当前 worktree 干净。

### 未声称通过

```text
真实浏览器 pointer drag / dwell / release
window open / resize / dock 的 camera 不动证据
Railway reorder reload / stale conflict 浏览器证据
最终 Figma visual state review
```

这些不是“接口存在”或“单测通过”可以替代的项目。

## 3. 当前 owner 边界

```text
Core / Huabu
  canonical Project / Canvas / Assembly / Railway / geometry truth

R1 drop layer
  gesture / live target hit / frozen resolved intent / commit lifecycle

R2 ProfessionalWindowStage
  window instances / regions / occupiedRects / safeRect publication

R3 Railway container
  navigate / receive presentation / reorder request

CoreRailwayClient
  only durable Railway orderedRefs + expectedVersion write
```

本轮没有新增第二 Canvas、第二 Railway、第二 Project、第二 camera 或第二 persistence store。

## 4. 下一轮施工顺序

继续沿原指引，不跳去做外观大修：

```text
R1.3 真实浏览器 semantic drop acceptance
  pointer / native dragover / target disappearance / failure / narrow viewport

R2.4 Window interaction
  titlebar drag / 8-direction resize / dock-left resize / clamp

R2.5 Window lifecycle evidence
  open / resize / dock / close 前后 camera 与 HUD 证据

R3.3 Railway receive presentation
  reuse R1 resolver，统一 receive / hot / ineligible state

R3.4 Railway peek / overflow / manage
  不制造假 thumbnail、+N 或第二 chooser

R3.5 Railway browser persistence
  reorder → reload，409 stale 回读，不自动 replay
```

只有这三条真实浏览器路径补齐，并完成 Figma state review，才可以把 R1–R3 写成 `UX Foundation complete`。

## 5. 回滚点

每个提交都可独立 revert：

```text
R3: 63994e5
R2.3: b78480b
R2.2: 5256083
R2.1: e58c278
R1.2: 8a251d0
R1.1: a6acb1a
```

没有使用 `reset --hard`，没有覆盖根目录 Trae 未提交内容，没有 push。
