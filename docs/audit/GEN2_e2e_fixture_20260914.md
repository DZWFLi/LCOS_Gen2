# GEN2 e2e 隔离 fixture 说明（2026-09-14）

## 目的

隔离 e2e profile（`.e2e-data/`，端口 43131/3011/5273）此前只有 dev 种子（3 个 markdown + 1 条 relation），
首屏无法到达可见验收要求的 source/material、conversation/Glyth、decision/checkpoint、context/reference。
本 fixture 在**显式环境变量**打开时补齐这些事实，且全部是 Core/Huabu 能真实读到的实体，不写只进 UI 的假数据。

## 如何生成（命令）

fixture 由 Local Core 启动时的 `ensureRealDevProject()` 种入，开关是环境变量 `LOCAL_CORE_E2E_FIXTURE=1`：

```powershell
# 仓库根目录；脚本已在启动隔离 Core 时注入 LOCAL_CORE_E2E_FIXTURE=1（仅此一处透传）
powershell -ExecutionPolicy Bypass -File scripts/e2e/r0-e2e-env.ps1 up
```

- 新增实现：`apps/local-core/src/real-dev-project.ts`（`ensureRealDevProject` 内按 env 分支 + 同文件 helper
  `seedE2eConnectedConversation` / `createGradientPng`）。
- 环境变量透传：`scripts/e2e/r0-e2e-env.ps1` 启动 Core 的 `$coreCmd` 里加 `$env:LOCAL_CORE_E2E_FIXTURE='1';`。
- 隔离 DB 是空的（`reset` 后重建），首次启动即种入；`up` 复用同一个 DB 时不再重复。

不启动服务器、纯函数级验证（临时脚本，已删除）：

```powershell
# 在 apps/local-core 下，临时 vitest 用例在临时目录建 sqlite，断言开关行为
npx vitest run tests/<临时用例>.test.ts --maxWorkers=1
npx tsc -p tsconfig.json --noEmit
```

## 种了什么

项目 id 仍是 `lcos-gen2-dev`；e2e 模式下项目名加后缀 **`LCOS Gen2 开发工作台（e2e fixture）`**，可辨识为 fixture。

保留（未设置 env 时也完全一致）：
- 3 个 markdown artifact：`artifact-positioning` / `artifact-rules` / `artifact-milestone`
- 1 条 relation：`relation-rules-milestone`（`references`）

e2e 额外种入（真实文件 + 真实 Core 行）：

| 实体 | id | kind / mimeType | displayMode | 尺寸 (w×h) | position (x,y) |
|---|---|---|---|---|---|
| 参考图 A（512×320 渐变 PNG） | `artifact-reference` / `file-reference` | `image` / `image/png` | card | 360×260 | 880,0 |
| 参考图 B（512×320 渐变 PNG） | `artifact-reference2` / `file-reference2` | `image` / `image/png` | thumbnail | 240×160 | 280,300 |
| 决策记录（markdown） | `artifact-decision` | `markdown` / `text/markdown` | compact | 220×96 | 560,300 |
| 项目定位 | `artifact-positioning` | `markdown` | card | 360×260 | 0,0 |
| 施工纪律 | `artifact-rules` | `markdown` | card | 360×260 | 440,0 |
| 当前里程碑 | `artifact-milestone` | `markdown` | thumbnail | 240×160 | 0,300 |

- **image 真实性**：在工作区根写 `reference.e2e-fixture.png`（深蓝→紫）与 `reference-b.e2e-fixture.png`（深青→墨绿），
  均为 **512×320、8-bit truecolor（color type 2）、filter type 0** 的合法 PNG（Node `zlib` 自行拼 IHDR/IDAT/IEND；
  画面 = 竖直渐变 + 柔和斜向亮带 + 轻微水平明暗变化，不是纯色块），实际字节数 54136 / 41729。
  `FileRecord.mimeType = 'image/png'`，`Artifact.kind = 'image'`，并写对应 `ArtifactRevision`（`source: 'import'`）。
- **relation（e2e 共 5 条）**：在 `relation-rules-milestone` 基础上加
  `relation-decision-milestone`（`decision`）、`relation-milestone-decision`（`governs`）、
  `relation-reference-positioning`（`references`）、`relation-reference2-reference`（`references`）。
  > 说明：`packages/domain/src/index.ts` **没有** `RelationKind` 枚举，`Relation.kind` 是自由字符串
  > （`routes/relations.ts` 只校验非空且 ≤80）。这里沿用仓库既有取值约定（`references` 来自现有种子，
  > `decision` / `governs` 来自 `feedback-revision-service.ts`）。
- **ArtifactView**：6 个，`displayMode` 决定 `size` 档位（card 360×260、thumbnail 240×160、compact 220×96），
  网格摆放两两不重叠且最小间距 ≥40。position 只保证初始 box 不打架，**不是空间真值**（真实落位由 Huabu Canvas runtime 决定）。
- **conversation**：`conversation-e2e-fixture`（label `承接会话（e2e fixture）`），见下。
- **可辨识性**：项目名带 `（e2e fixture）` 后缀；`决策记录.e2e-fixture.md` 正文首行即为
  `# 决策记录（e2e fixture）` 并注明「不是 provider 生产结果」。图片文件名与决策文件名也带 `e2e-fixture`。

## conversation / run / decision 可达性结论

- **conversation/Glyth —— 可直接种入（已种）**。
  真实路径是 `SqliteMetadataRepository.upsertConnectedConversation(ConnectedConversationV1)`，写 `connected_conversations` 表，
  经 `getProjectReceiverBinding` / `listConnectedConversations` 投影（`receiver-runtime-service.ts`、`warehouse-service.ts` 读取）。
  它不需要 provider/bridge 即可成为真实 Core 实体，因此种入 1 个（`provider: 'codex'`，`isRunning: false`，`waitingReason: null`）。
- **run/process —— GAP: needs provider（未种入）**。
  真实创建路径 `RuntimeApplicationService.create()` 需要 (a) 查询 provider 能力（`providers()` → Bridge `providersStatus()`）、
  (b) 构建 `ContextManifest`，(c) 生成 `RuntimeDispatch` 并交给 Bridge。仅凭 `repository.createRunWithDispatch` 直写 `runs`
  会造出一个没有 provider 会推进的「进程」，属于伪造 provider 结果，故按纪律不种入。
- **decision/checkpoint —— 可达（作为真实 markdown artifact + relation）**。
  `feedback-revision-service.ts` 的既有约定就是用 markdown artifact + `decision` / `governs` relation 表示决策，
  e2e fixture 的 `artifact-decision` + `relation-decision-milestone` / `relation-milestone-decision` 即此形态。
  另有独立 `Checkpoint` 实体（`repository.createCheckpoint` 可直接写，MVP sample 已在用），本 fixture 未种。
  真正「会话里 pin 的 decision」（`conversation_messages.pinned_as_decision`）需要 conversation session / provider 导入，
  属 GAP: needs provider（未种入）。

## 幂等性

- `ensureRealDevProject()` 首行 `if (repository.getProject(REAL_DEV_PROJECT_ID) !== undefined) return false`，
  项目已存在时直接 return，不重复写 snapshot、不重复写 conversation。
- 因此 e2e fixture 只在**项目首次创建**时种入；`up` 复用同一 DB、或 DB 里已有 `lcos-gen2-dev` 时不会再补齐 e2e 额外实体
  （需要干净 fixture 用 `scripts/e2e/r0-e2e-env.ps1 reset` 后重新 `up`）。
- 未设置 `LOCAL_CORE_E2E_FIXTURE` 时，产出与历史完全一致（3 markdown + 1 relation + 3 个 card 280×110 view + 0 conversation），
  仓库既有 `tests/real-dev-project.test.ts` 原样通过。

## 验证记录（实际输出）

- `apps/local-core` 下 `npm run typecheck`（`tsc -p tsconfig.json --noEmit`）→ 退出码 **0**。
- `npx vitest run tests/real-dev-project.test.ts --maxWorkers=1` → `1 passed (1)`，退出码 **0**（未设置 env 的向后兼容）。
- 纯函数级 Node 校验（`dist` 构建产物 + 临时脚本，已删除）：`LOCAL_CORE_E2E_FIXTURE=1` 下得到
  6 artifact / **5 relation** / 6 view，视图两两不重叠、最小间距 **40**；两张 PNG 经 `zlib.inflateSync` 解 IDAT 后
  长度 491840 = 320×(1+512×3)，IHDR = 512×320 / bitDepth 8 / **colorType 2**，全部行 filter byte = 0，
  CRC 校验通过，字节数 **54136**（reference）/ **41729**（reference2），且非纯色（distinct colors 5981 / 2701）。
  未设置 env 时为 3 artifact / 1 relation / 3 view（card 280×110），项目名不含 `（e2e fixture）`。
