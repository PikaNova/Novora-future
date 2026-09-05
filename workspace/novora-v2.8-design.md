# Novora v2.8.0 设计方案（评审稿）

状态：草案，供评审；评审通过后按第 7 节任务拆分实施。

## 1. 目标与非目标

**目标**

- 考试管理从"单行 JSONB 快照整体覆盖"演进为 ExamRecord 关系模型 + 生命周期状态机。
- 支持考试列表、历史、归档、复制，不再依赖整行 `majors` 快照翻找。
- 旧客户端（离线 outbox、ETag、三方合并、ClassIsland 插件）零破坏兼容。

**非目标（本版不做）**

- 不拆微服务；不引入新 ORM 或迁移框架（延续 `api/_schemaMigration.ts` 门禁模式）。
- 不做跨校远程控制与设备命令队列（v2.9 前置设计，v2.8 不实现）。
- 不做多租户/商业化。

## 2. 现状与问题

- `exam_data` 单行（id=1），保存即整行 COALESCE 覆盖；并发靠 ETag(`updated_at`) + 三方合并兜底，字段级冲突粒度粗。
- 考试"历史/归档"只能从 `majors` 数组翻找；列表与历史共用一次全量下发。
- `exam_metadata`/`lifecycle` JSONB 列已存在（阶段 5 原型透传），无状态语义。

## 3. 数据模型

### 3.1 新表 `exam_records`（单向投影，非权威）

```sql
CREATE TABLE IF NOT EXISTS exam_records (
  id            TEXT PRIMARY KEY,              -- 与 MajorExam.id 一致
  name          TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'draft', -- draft|published|ended|archived
  items         JSONB NOT NULL DEFAULT '[]',   -- ExamItem[]，发布时冻结快照
  target_grade_ids JSONB NOT NULL DEFAULT '[]',
  target_class_ids JSONB NOT NULL DEFAULT '[]',
  source        TEXT NOT NULL DEFAULT 'regular',   -- regular|quick
  temporary     BOOLEAN NOT NULL DEFAULT FALSE,
  priority_over_schedule BOOLEAN NOT NULL DEFAULT FALSE,
  created_by    INTEGER,
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL,
  published_at  BIGINT,
  ended_at      BIGINT,
  archived_at   BIGINT,
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_exam_records_status  ON exam_records(status);
CREATE INDEX IF NOT EXISTS idx_exam_records_updated ON exam_records(updated_at DESC);
```

- `id` 复用 `MajorExam.id`：前端数据结构零改动，映射层唯一。
- `exam_data.majors` 仍是**权威存储**（outbox/三方合并契约不动）；`exam_records` 是服务端单向投影。

### 3.2 投影策略（方案 A：单向投影 + 状态提升）

- 每次现有保存管道写 `majors` 成功后，**同事务**内从 `majors` 全量重建（幂等 upsert）`exam_records`；崩溃后下次保存自愈，另提供一致性自检接口。
- 状态字段持久化在 `exam_records`，转换动作**回写 `majors` 对应字段**（`endedAt`/`temporary`/`priorityOverSchedule` 等）并走现有保存管道，保证唯一写路径。
  - 结果：权威数据永远只有一份来源，投影永远可重建，无双写漂移。
  - 方案 B（exam_records 升级为权威、majors 降级为投影）列为 v2.8.x 后续演进，本版不做。

### 3.3 生命周期状态机

```
draft ──publish──> published ──(时间窗自动判定)──> ongoing(派生态) ──end──> ended ──archive──> archived
   ▲                                                                  │
   └────────────────────────── unarchive ─────────────────────────────┘
```

- **持久化仅四态**：`draft / published / ended / archived`；`ongoing` 是按考试时间窗的计算派生态，不落库、不需要定时器。
- 草稿：新建考试默认；现有"快速发布"直接产生 `published`（沿用 `quick` 语义）。
- 转换全部写 `app_audit_logs`（`exam.record.publish|end|archive|unarchive|copy`），记录操作者与目标。
- 归档 = 软隐藏 + 保留历史；反归档回 `ended`。

## 4. 兼容矩阵（核心验收）

| 消费方 | 现状 | v2.8 影响 | 策略 |
|---|---|---|---|
| 客户端 outbox / 三方合并 | 读 `majors` JSONB | 不变 | 零改动 |
| ETag / 版本比较 | `exam_data.updated_at` | 不变 | 零改动 |
| ClassIsland `/api/plugin` | `examPayload → resolvePluginExams` | 不变（payload 仍从 majors 组装） | 零改动 |
| 设备心跳 current_exam | 服务端从 majors 计算 | 不变 | 零改动 |
| 管理端列表/历史 | 全量 majors 下发 | 新增 records 查询（分页/归档过滤） | 新接口，旧路径保留 |
| 复制考试 | 前端深拷贝 | 新增 server action `record-copy`（带幂等键） | 新 API |

## 5. API 增量

- `GET /api/exams?resource=records&status=...&page=...`：列表/历史/归档查询（读 `exam_records`）。
- `POST /api/exams` 新 action：`record-publish / record-end / record-archive / record-unarchive / record-copy`。
- 全部走现有 `requireActor` + `writeAudit` + 权限（`major.edit` / `major.delete`）+ 全局写槽。

## 6. 迁移与回滚

- `_schemaMigration` 追加 v2.8 步骤：建表 + 首次全量回填（从 `majors` 生成投影，空库/旧库均可重复执行）。
- 回滚：`DROP TABLE exam_records` 纯投影无损；`majors` 始终权威。
- 集成测试新增场景：空库回填、旧库升级、投影与 majors 逐字段一致性、并发保存下投影原子性、转换审计。

## 7. 任务拆分建议（对应版本表 v2.8.0）

| 任务 | 内容 | 优先级 |
|---|---|---|
| T-280-01 | `exam_records` 表结构 + 迁移门禁 + 回填 | P1 |
| T-280-02 | 单向投影器 + 一致性自检 | P1 |
| T-280-03 | 生命周期 API（publish/end/archive/copy）+ 审计 | P1 |
| T-280-04 | 考试列表/历史/归档 UI（分页 + 归档过滤） | P1 |
| T-280-05 | 复制考试 server action（幂等键） | P2 |
| T-280-06 | 集成测试矩阵 | P1 |

## 8. 验收出口

- 460+ 单测不回归；新增集成场景全过。
- 旧客户端（未刷新缓存的浏览器）在 v2.8 服务端上保存/同步成功。
- ClassIsland 插件与设备心跳读取契约回归通过。
- 投影重建后 `exam_records` 与 `majors` 逐字段一致。
