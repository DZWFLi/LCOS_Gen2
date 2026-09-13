# R0 稳定化交付（2026-09-14）

分支：`frontend-reconstruction-v2`　上游基线：`685e02a`　不 push、不合并 main。
依据：`16_R0_Readback复核与下一步指令_20260914.md`（R0 顺序：R0-5 → R0-6 → R0-3）。

## 1. 用户可见结果

无新用户可见功能——本轮只让"证据可信"和"运行环境确定"：

1. **e2e 会真实失败**：关键 selector 缺失、关键值为 false、console/pageerror、非白名单 HTTP 一律非零退出（此前 10 个脚本 0 命中 `process.exit|throw`，跑到末尾即退出 0）。
2. **隔离 e2e 环境**：Core/Huabu/web 三服务跑在自己的端口与数据目录上（`.e2e-data/`），可从空目录重复建立，不再依赖不可复现的历史 dev 数据，也不触碰用户 dev 数据。
3. **stale canvas 恢复真正可用**：workspace 里的 canvasId 失效时，点「重新建立现场画布」会真实创建新画布、回写 Core、reload 后继续使用新 canvasId，且再次进入不重复创建。

## 2. Exact binding（本轮改动 → 真实 caller/owner）

| 能力 | donor / 来源 | target file/symbol | production caller | owner | fallback |
|---|---|---|---|---|---|
| 失败即非零退出 | 本仓自建（无 donor） | `scripts/e2e/_harness.mjs::runScenario` | `scripts/e2e/r0-harness-selftest.mjs`、`scripts/e2e/r0-stale-canvas.mjs` | 施工侧测试脚手架 | 无断言旧脚本保持原样，未迁移前不具备失败能力（已登记） |
| 隔离 e2e profile | Core 既有 env 旋钮 `LOCAL_CORE_DB_PATH` / `LOCAL_CORE_TEST_PORT` / `LOCAL_CORE_DEV_WORKSPACE_ROOT`；Huabu `HUABU_DATA_DIR` / `HUABU_WORKSPACE`；dev.mjs 既有 `SERVER_PORT` / `WEB_PORT` | `scripts/e2e/r0-e2e-env.ps1` | 施工者手工调用（up/down/status/ids/reset） | 施工侧 | 端口被占用时复用现有实例并告警 |
| Core 写请求 Origin 白名单可配 | Core `server.ts::allowedOrigins`（默认仅 5173） | `apps/local-core/src/index.ts`（`LOCAL_CORE_ALLOWED_ORIGINS`） | Core 启动入口 | Local Core | 不设该 env 时行为与原来完全一致 |
| Vite → Core 代理目标可配 | `vite.config.ts` 原为硬编码 `127.0.0.1:43121` | `huabu/apps/web/vite.config.ts`（`VITE_LCOS_CORE_TARGET`） | dev server proxy | Huabu web | 不设时默认仍是 43121 |
| 恢复入口可被测试稳定定位 | 无 donor | `lcos/shell/LcosWorksiteStage.tsx`（`data-lcos-recover-canvas`） | 恢复按钮本体 | LCOS shell | 无 |
| `ensureCanvas(recreate)` 透传 | `MainWorksiteProps.ensureCanvas(recreate?)` 既有签名 | `lcos/shell/LcosProjectShell.tsx` | `MainWorksite → LcosWorksiteStage → useLcosWorksite.ensureSurfaceCanvas` | LCOS shell + Huabu createCanvas | 解析不到 workspace 时不创建 |

## 3. 真实状态（fixture 来源与可复现方法）

```text
# 起隔离环境（端口 43131 / 3011 / 5273，数据全部在 <repo>\.e2e-data\）
powershell -ExecutionPolicy Bypass -File scripts/e2e/r0-e2e-env.ps1 up
powershell -ExecutionPolicy Bypass -File scripts/e2e/r0-e2e-env.ps1 ids     # project/workspace/canvasId
powershell -ExecutionPolicy Bypass -File scripts/e2e/r0-e2e-env.ps1 reset   # 严格校验绝对路径后删 .e2e-data
powershell -ExecutionPolicy Bypass -File scripts/e2e/r0-e2e-env.ps1 down    # 只停隔离端口
```

- fixture 由 Core 自身的 `ensureRealDevProject()` 在**空 DB** 上种入（project `lcos-gen2-dev` + 3 个真实 markdown artifact + warehouse），因此可重复建立；重复 `up` 复用同一 DB（幂等）。
- workspace 的 `canvasId` 是 Core 预置的 `canvas-lcos-main / canvas-lcos-context / canvas-lcos-workflow`，在全新的 Huabu 画布库里**不存在** → 首次进入必然 404，正是 stale-canvas 恢复场景。
- 隔离环境实测 ID 记录（本次）：project `lcos-gen2-dev`；workspace `workspace-real-main / -context / -workflow`；初始 canvasId `canvas-lcos-*`。
- 已知限制：Huabu 画布持久化的具体文件未精确定位（`huabu/apps/server/data/storage/disk` 只见 `workspaces.json`，但画布在 server 重启后存活）；这一条保留为 R0 的未完成项，不影响本轮验收结论。
- 隔离环境必需 `HUABU_WORKSPACE`（否则空 `HUABU_DATA_DIR` 会把 app 重定向到 `/setup` 首启向导，项目路由打不开）——这是本轮实测发现的必需项。

## 4. Fail-fast 测试与真实退出码

| 场景 | 命令 | 期望 | 实测 |
|---|---|---|---|
| harness 正向 | `node scripts/e2e/r0-harness-selftest.mjs ok` | exit 0 | **exit 0**（failures/consoleErrors/pageErrors/http 全空） |
| harness 反证：选择器缺失 | `node scripts/e2e/r0-harness-selftest.mjs missing` | exit 1 | **exit 1**（`requireSelector 失败：未出现 [data-lcos-selftest-missing-selector]（1500ms）`） |
| harness 反证：console error | `node scripts/e2e/r0-harness-selftest.mjs error` | exit 1 | **exit 1**（`出现 console error：[e2e-selftest] injected console error`） |
| R0-3 验收（stale → recreate → persist → reload） | `node scripts/e2e/r0-stale-canvas.mjs` | exit 0 | **exit 0**：`ok:true, failures:[]`，唯一 console error 与唯一 HTTP 是**被白名单的** `404 /api/canvas/canvas-lcos-main`（场景前提本身） |

其余断言（脚本内）：恢复入口出现 → 点击后 `.react-flow` 挂载 → Core `workspace.canvasId` 改变且非空 → reload 后 canvasId 不漂移且恢复入口消失 → 第三次进入不再新建画布。

## 5. 边界与诚实剩余项

- **R0-5 只迁移了 R0 使用的脚本**；`wave1..wave10` 旧脚本仍是"跑到末尾即退出 0"，迁移安排在各自 Recovery Wave 前（16 号文档允许）。
- **junction / placement / Figma source binding 均未在本轮触碰**：`NodePresentationSeam` 仍是单点未落地状态（TextNode 临时特例已按 16 号 §A 撤除，`TextNode.tsx` 回到 HEAD），新投影仍是 `index*40` 级联；这些属于 R1/R2，不计入 R0 完成。
- `reset` 在刚 `down` 后可能因日志文件句柄占用失败（实测一次）；当前需重试一次，尚未改成自动重试。
- 隔离环境的 Origin 白名单必须显式配置；本轮通过新增 `LOCAL_CORE_ALLOWED_ORIGINS` 解决，未改动 Core 默认行为。
- 记录在案的前置发现（来自三路 Scout，属 R3/R4/R5 范围，本轮未修）：Assembly 对所有来源写死 `artifactView`（投放必然 "Artifact view not found."）；Workflow 卡「取用」写 `entityType:item.kind` 导致引用被静默剔除；前端无 presentation 持久化 client；`nodeSpecies` 仅映射 4 类 entityType。

## 6. 回滚点

- `d249395`：harness（本文件之前的提交）。
- 本提交组（fixture/profile → ensureCanvas → docs）各自独立；`ensureCanvas` 提交只含 `LcosProjectShell.tsx` 参数透传，回滚它即恢复"恢复按钮点了没反应"的旧行为，不影响 harness 与隔离环境。
