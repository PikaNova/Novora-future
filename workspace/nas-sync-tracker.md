# Novora 工作区同步追踪

用途：NAS 同步任务进度。记录本工作区所有改动、时间和产物，供跨设备查看。

基线：Novora v2.7.3（`novora-remote-audit`，`main`，`0850b00`）。老仓库只读，不在本仓库范围内。

## 会话记录

### 会话 1：架构审查与代码质量评估（2026-08-30 上午）

**时间**：约 2026-08-30 09:00 – 10:15

**改动内容**：

- 读取 `architect-review` 和 `architecture` 技能及参考文档。
- 检查关键源文件：`api/_auth.ts`（1128 行）、`api/_exams/db.ts`、`examDataRoutes.ts`、`deviceAdminRoutes.ts`、`deviceSelfRoutes.ts`、`examService.ts`（683 行）、`examOutbox.ts`、`useMajorScheduleActions.ts`、`useWeeklyScheduleSync.ts`、`AdminPage.tsx`（986 行）等。
- 量化 lint 警告：130 条（`any` 73、unused 28、Hook 依赖 25、控制字符正则 2、无效 catch 1、无效转义 1）。
- 运行验证：`npm ci`（335 包）、`npm test`（427/427 通过）、`npm run typecheck:api`（通过）、`npm run serve:build`（通过）、`npm run build`（通过，2243 模块）。
- `npm run format:check` 失败：4 个文件未格式化（`InlineSelect.tsx`、`SchedulePrintPreview.tsx`、`LocalSettingsPage.tsx`、`typographySettings.ts`）。
- 生产依赖审计：2 moderate（`react-router`/`react-router-dom`，升级 Router 7 属破坏性变更）。

**关键发现**：

| ID | 级别 | 结论 |
|---|---|---|
| A1 | 高 | `exam_data` 单例 JSONB 承载多域，考试历史/分页前需关系化 |
| A2 | 高 | `temporary_command` 覆盖式单命令，不是可靠队列 |
| A3 | 高 | 浏览器 `localStorage` UUID 不是可信设备身份 |
| A4 | 中高 | 请求期 DDL 耦合迁移与 API 可用性 |
| A5 | 中 | `/api/exams` action 过载入口 |
| A6 | 中 | 遥测默认含完整校名，需明确同意和数据治理 |

**产物**：

- `novora-architecture-review.md`（架构结论与风险评估）
- `novora-code-quality-report.md`（质量基线与优先级）

**更新**：`task_plan.md`、`findings.md`、`progress.md`

### 会话 2：问题修复方案设计（2026-08-30 上午）

**时间**：约 2026-08-30 10:15 – 10:20

**改动内容**：

- 按风险分阶段制定修复顺序：Hook/同步正确性（P0）→ API 契约 → 集成/迁移门禁 → 设备命令队列 → 考试元数据 → 维护性清理。
- 明确每阶段范围、出口条件、回滚点和不做事项。

**产物**：

- `novora-remediation-plan.md`（分阶段修复方案）

**更新**：`task_plan.md`、`findings.md`、`progress.md`

### 会话 3：P0 同步/Hook 批次实施（2026-08-30，由并行会话完成）

**时间**：约 2026-08-30（具体时刻见 `task_plan.md` 顶部记录）

**改动内容**（在 `novora-remote-audit` 业务代码中，不在本仓库范围内）：

- 修复 `useExamNotify` 改名后旧 fired key 吞掉新提醒的真实缺陷。
- 修复 `useWeeklyScheduleSync` 合并重试失败后未回写 outbox 的时序缺口。
- 抽离 `deviceCommandReceipt` 纯函数。
- 新增 4 个测试文件、6 项时序测试。

**状态**：已在 `novora-remote-audit` 中完成，本仓库仅记录进度。

### 会话 4：完整版本任务规划（2026-08-30 下午）

**时间**：约 2026-08-30 17:00 – 17:25

**改动内容**：

- 合并未来路线和修复方案，生成逐版本任务清单（v2.7.x → v3.2+）。
- 每项任务带编号（T-XXX-XX）、前置依赖、验收条件和优先级。
- 版本依赖链：v2.7.4 → v2.7.5 → v2.8.0 → v2.8.x → v2.9.0 → v2.9.x → v3.0.x → v3.1.0 → v3.2+。
- v2.7.5（schema 版本 + 集成门禁 + 类型契约）是所有数据库改造的硬前置。

**产物**：

- `novora-version-tasks.md`（268 行，67 项任务/方向）

**更新**：`task_plan.md`、`findings.md`、`progress.md`

### 会话 5：NAS 同步准备（2026-08-30）

**时间**：当前会话

**改动内容**：

- 创建本跟踪文件 `nas-sync-tracker.md`。
- 创建 `.gitignore`，排除 `novora-remote-audit/`（老仓库）、`work/`（其他项目）、`node_modules/`、`deliveries/`/`outputs/`/`notion-audit/`（约 367 MB 构建产物）、系统目录（`.agents`/`.appdata`/`.codex*`/`.dotnet-home`/`.nuget-packages`/`.tmp*`）。
- 在工作区根目录初始化 Git 仓库，纳入所有根级文件（规划/报告/跟踪 MD、聊天导出 share*.{html,json,txt}、解析脚本 *.cjs、测试 JSON、源码压缩包、NuGet.Config）。
- 提交到 `main` 分支。

**产物**：

- `nas-sync-tracker.md`（本文件）
- `.gitignore`
- Git 仓库初始化和首次提交

**更新**：无（本文件即记录）

## 工作区文件清单

### 规划与报告（本仓库核心）

| 文件 | 说明 | 最后修改 |
|---|---|---|
| `novora-future-plan.md` | 未来项目路线（三端边界、版本阶段、技术决策） | 2026-08-30 10:03 |
| `novora-architecture-review.md` | v2.7.3 架构审查（模块化单体、6 项风险） | 2026-08-30 10:13 |
| `novora-code-quality-report.md` | 代码质量报告（lint/构建/依赖审计） | 2026-08-30 10:13 |
| `novora-remediation-plan.md` | 分阶段修复方案（P0→P2，6 阶段） | 2026-08-30 10:16 |
| `novora-version-tasks.md` | 完整版本任务（67 项，v2.7.x→v3.2+） | 2026-08-30 17:23 |
| `nas-sync-tracker.md` | 本跟踪文件 | 当前会话 |

### 持久化计划

| 文件 | 说明 |
|---|---|
| `task_plan.md` | 任务阶段与决策记录 |
| `findings.md` | 发现与证据记录 |
| `progress.md` | 会话进度日志 |

### 聊天导出与解析工具

| 文件 | 说明 |
|---|---|
| `share1/2/3.html` + `.messages.json` + `.router.txt` | 三个分享对话的抓取内容 |
| `decode.cjs`、`decode2.cjs`、`extract.cjs`、`extract2.cjs` | 聊天导出解析脚本 |
| `inspect*.cjs`、`trydecode.cjs` | 调试探针脚本 |

### 其他

| 文件 | 说明 |
|---|---|
| `exam-board-major-daily-test.json` | 大型考试每日测试数据 |
| `exam-board-weekly-daily-test.json` | 周测每日测试数据 |
| `exam-board-v2.0.0.zip` | 历史版本源码压缩包 |
| `novora-v2.7.1-dev-4b2d65b-source.zip` | v2.7.1 dev 源码压缩包 |
| `NuGet.Config` | NuGet 镜像配置 |

### 排除项（不入本仓库）

| 目录/文件 | 原因 |
|---|---|
| `novora-remote-audit/` | Novora 老仓库（main/0850b00），用户明确不动 |
| `work/` | 其他项目（ClassIsland、mariadb、历史 stage 等） |
| `node_modules/` | 依赖缓存 |
| `deliveries/`、`outputs/`、`notion-audit/` | 约 367 MB 构建产物，不适合 Git |
| `.agents/`、`.appdata/`、`.codex/`、`.codex-migration/`、`.dotnet-home/`、`.nuget-packages/`、`.tmp*` | 系统运行时目录 |
| `.git/`（根目录原有空目录） | 已被新仓库初始化覆盖 |

## NAS 同步说明

- 本仓库推送到远程 `main` 后，NAS 侧可通过 `git clone` / `git pull` 获取最新进度。
- 跟踪文件 `nas-sync-tracker.md` 是单一进度入口；每次会话结束追加新记录。
- `task_plan.md` / `findings.md` / `progress.md` 保留完整历史，适合审计。
- 老仓库 `novora-remote-audit` 不在本仓库内，需单独管理。

## 2026-08-30 17:35 增补：统一上传与最新进度

> 本节是最新权威说明。前文提到的“工作区根目录单独建仓”方案已被本次统一上传方案取代。

### 目标仓库与安全边界

| 项目 | 值 |
|---|---|
| 目标仓库 | `https://github.com/PikaNova/Novora-future.git` |
| 目标分支 | `main` |
| 远程基线提交 | `0850b00`（与本地上传起点一致） |
| 本地源码目录 | `novora-remote-audit/` |
| 旧 Novora remote | `https://github.com/PikaNova/Novora.git`，只保留为 `legacy` remote，本次绝不推送 |
| 本次上传时间 | 2026-08-30 17:35 +08:00 |

本次不使用 force push；`main` 的上传提交会以远程 `main` 当前提交 `0850b00` 为父提交。

### 新仓库布局

```text
/                            # Novora 源码，来自 Novora-future main + 本地 P0/P1 源码改动
/workspace/                  # 工作区规划、报告、聊天导出、解析脚本、测试数据和说明
/workspace/nas-sync-tracker.md
/workspace/source-snapshot/  # 源码目录中的本地说明文件
```

`.gitignore` 只排除依赖缓存、构建产物、运行数据、历史工作目录和系统目录；不排除源码和任务追踪文档。

### 完整时间线

| 时间（+08:00） | 阶段 | 内容与结果 |
|---|---|---|
| 2026-08-30 上午 | 项目熟悉 | 确认 `novora-remote-audit` 为 Novora v2.7.3 有效基线，提交 `0850b00`；`work/Novora` 是旧副本。读取架构、质量、修复方案和未来路线文档。 |
| 2026-08-30 上午 | 验证基线 | `npm ci`、`npm test` 427/427、API 类型检查、前端构建、本地服务构建均通过；lint 0 errors / 130 warnings；4 个文件未格式化；真实数据库集成测试未运行。 |
| 2026-08-30 上午 | 方案落盘 | 生成 `novora-architecture-review.md`、`novora-code-quality-report.md`、`novora-remediation-plan.md`、`novora-future-plan.md`。 |
| 2026-08-30 下午 | 标准复验 | 未提交原型改动共 15 个文件；标准验证通过后格式化 8 个文件；测试 444/444，lint 0 errors / 100 warnings。 |
| 2026-08-30 17:00–17:25 | 版本任务规划 | 生成 `novora-version-tasks.md`，细化为 v2.7.x 至 v3.2+ 共 67 项任务/方向。 |
| 2026-08-30 17:35 前 | P0 批次 | 清零阶段 1 目标 Hook 警告；修复 `useExamNotify` 改名提醒被旧 key 吞掉；修复周测合并重试失败未回写 outbox；抽离 `deviceCommandReceipt`；新增时序测试；验证 450/450。 |
| 2026-08-30 17:35 前 | P1 API/客户端契约 | 新增共享考试/设备契约和运行时解析；核心路径移除 `any` / `as never`；设备绑定、命令、冲突、考试 payload 均校验；新增契约测试；验证 453/453。 |
| 2026-08-30 17:35 | 上传准备 | 建立统一上传说明；准备以 `origin/main` 为父提交生成新提交。 |

### 源码改动清单

#### 修改

```text
api/_exams/db.ts
api/_exams/diff.ts
api/_exams/payload.ts
api/_exams/permissions.ts
api/_exams/plugin.ts
api/_exams/routes/deviceAdminRoutes.ts
api/_exams/routes/deviceSelfRoutes.ts
api/_exams/routes/examDataRoutes.ts
api/_exams/routes/settingsRoutes.ts
api/_exams/types.ts
scripts/run-integration-tests.cjs
src/components/DeviceHeartbeat.tsx
src/components/DeviceStatusPanel.tsx
src/components/InlineSelect.tsx
src/components/SchedulePrintPreview.tsx
src/components/TimeRangePickerModal.tsx
src/components/touch-datetime-picker/DateTimePicker.tsx
src/hooks/admin/useMajorScheduleActions.ts
src/hooks/admin/useWeeklyScheduleSync.ts
src/hooks/useAlertOverlay.ts
src/hooks/useExamNotify.ts
src/hooks/useExamSync.ts
src/pages/AdminPage.tsx
src/pages/LocalSettingsPage.tsx
src/services/classBinding.ts
src/services/examService.ts
src/utils/typographySettings.ts
tests/exams.payload.test.ts
tests/exams.permissions.test.ts
tests/integration/examData.integration.test.ts
tsconfig.test.json
```

#### 新增

```text
PROJECT_MIGRATION.md
src/shared/deviceContracts.ts
src/shared/examContracts.ts
src/shared/typeGuards.ts
src/utils/deviceCommandReceipt.ts
tests/apiContracts.test.ts
tests/deviceCommandReceipt.test.ts
tests/examOutbox.pipeline.test.ts
tests/useAlertOverlay.test.ts
tests/useExamNotify.test.ts
```

### 最新验证结果

| 检查 | 结果 |
|---|---|
| `npm test` | 通过，453/453 |
| `npm run typecheck:api` | 通过 |
| `npm run build` | 通过，2247 modules |
| `npm run serve:build` | 通过 |
| `npm run lint` | 通过，0 errors / 82 warnings |
| `npm run format:check` | 通过 |
| `git diff --check` | 通过 |
| `npm run test:integration` | 未运行；缺少独立 `INTEGRATION_DATABASE_URL`，且本机没有 Docker |

### P0 交付点

- `useMajorScheduleActions`、`useWeeklyScheduleSync`、通知 Hook、设备面板、时间选择器目标 Hook 警告清零。
- 修复同一考试同一时段改名后，`useExamNotify` 旧 fired key 吞掉新提醒的问题。
- 修复 `useWeeklyScheduleSync` 在 409 合并重试失败后未把合并结果写回 outbox，导致网络恢复时可能重放旧数据的问题。
- 抽出 `src/utils/deviceCommandReceipt.ts`，保证命令只消费一次，畸形命令不回执。
- 新增连续编辑、网络恢复、409 合并重试、通知替换和命令回执测试。

### P1 交付点

- 新增 `src/shared/examContracts.ts`：`ExamPayload`、`ExamSavePayload`、`parseExamPayload`。
- 新增 `src/shared/deviceContracts.ts`：设备绑定、绑定信息、插件绑定、命令、冲突、DB 行类型和解析器。
- API 和前端共用同一契约，避免前后端字段漂移。
- 考试 payload 会过滤畸形记录并复用现有归一化器；设备响应会过滤畸形行。
- 核心保存链 `useMajorScheduleActions`、`useWeeklyScheduleSync` 不再使用 `as never`。
- `api/_exams/payload.ts`、设备管理路由、设置路由移除目标 `any`。

### 工作区根级文件上传清单

以下文件会复制到新仓库 `workspace/`：

```text
.gitignore
NuGet.Config
nas-sync-tracker.md
novora-architecture-review.md
novora-code-quality-report.md
novora-future-plan.md
novora-remediation-plan.md
novora-version-tasks.md
task_plan.md
findings.md
progress.md
share1.html
share1.messages.json
share1.router.txt
share2.html
share2.messages.json
share2.router.txt
share3.html
share3.messages.json
share3.router.txt
decode.cjs
decode2.cjs
extract.cjs
extract2.cjs
inspect.cjs
inspect2.cjs
inspect3.cjs
inspect4.cjs
inspect5.cjs
inspect6.cjs
inspect7.cjs
inspect8.cjs
trydecode.cjs
exam-board-major-daily-test.json
exam-board-weekly-daily-test.json
exam-board-v2.0.0.zip
novora-v2.7.1-dev-4b2d65b-source.zip
```

`novora-remote-audit/PROJECT_MIGRATION.md` 会复制到 `workspace/source-snapshot/PROJECT_MIGRATION.md`。

### 不上传项

```text
work/
node_modules/
novora-remote-audit/node_modules/
novora-remote-audit/dist/
novora-remote-audit/server-build/
novora-remote-audit/.api-check/
novora-remote-audit/.test-check/
.nuget-packages/
.dotnet-home/
deliveries/
outputs/
notion-audit/
.agents/
.appdata/
.codex/
.codex-migration/
.tmp/
.tmp-log-analysis/
.tmp-novora-remote-audit/
nas-repo/
```

### 老仓库保护声明

本次只推送 `https://github.com/PikaNova/Novora-future.git` 的 `main`。不会推送、覆盖、删除或重置 `https://github.com/PikaNova/Novora.git` 的任何分支或 tag。

### NAS 使用方式

```bash
git clone https://github.com/PikaNova/Novora-future.git
cd Novora-future
cat workspace/nas-sync-tracker.md
```

后续同步：

```bash
git pull origin main
```

## 2026-08-30 17:40 上传结果

### 完成

| 项目 | 结果 |
|---|---|
| 首次统一上传提交 | `347f3ba feat: consolidate P0/P1 and workspace tracker` |
| 远程分支 | `https://github.com/PikaNova/Novora-future.git` `main` |
| 推送方式 | fast-forward：`0850b00..347f3ba`，未使用 force push |
| 提交规模 | 76 files changed，4553 insertions，471 deletions |
| 源码改动 | 31 个修改文件 + 10 个新增源码/测试文件 |
| 工作区文件 | 37 个根级文件复制到 `/workspace` |
| 追踪入口 | `/workspace/nas-sync-tracker.md` |
| 推送时间 | 2026-08-30 17:40 +08:00 |

推送前的远程 `main` 检查结果为 `0850b0042282089f6b8dea5d0073127620a0059b`，与预期基线一致；推送后远程 `main` 为 `347f3ba`。

### 结果记录提交

本节本身会在首次上传后作为一条独立的文档提交再次推送到远程 `main`。NAS 侧使用 `git pull origin main` 后，请以远程最新 HEAD 为准。

### 老仓库核验

本次只向 `Novora-future` 推送，没有向 `https://github.com/PikaNova/Novora.git` 执行任何推送、tag 删除、分支覆盖或历史重写。
