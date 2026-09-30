# P2-2 架构与存储定稿

日期：2026-09-29　状态：首轮定稿候选　证据等级：静态确认

依赖：[P2-1 数据契约](data-contract-p2-1.md)、[P1-4 运行时 AI 能力](runtime-ai-capability-p1-4.md)。

范围：固定本机技术栈、目录边界、事实源与索引、查询 API、页面路由、模型适配、文章缓存、媒体和修订事务。只做架构文档，不写业务代码、不安装依赖、不调用模型。

## 1. 本机事实

- `node v24.21.0`、`npm 11.19.0` 可用。
- `python` 当前是 Microsoft Store shim，不能作为构建或服务运行时依赖。
- 当前目录只有文档，没有前端、后端、数据库或脚本。
- 终端可访问部分外部站点，但 Wikidata 直连和部分模型供应商域不可达；数据源适配不能依赖当前终端网络。

## 2. 技术选型

| 层 | 选择 | 理由 | 版本策略 |
| --- | --- | --- | --- |
| 运行时 | Node.js 24.x | 本机可用的 LTS 级运行时，前后端和构建器统一 | 当前实机 24.21.0；P3-1 写 `.node-version`，不依赖机器全局漂移 |
| 包管理 | npm 11.x + `package-lock.json` | 本机已有，锁文件可复现 | P3-1 固定精确依赖版本 |
| 语言 | TypeScript strict | 契约、API 和 ViewModel 可静态检查 | 单一语言减少契约漂移 |
| 前端 | React + Vite | 适合本地桌面 SPA、路由和 SVG 时间线 | P3-1 固定 React/Vite 版本 |
| 路由 | React Router | 主页、period、event、search 路由清晰 | URL 为筛选和视口状态主入口 |
| 时间线 | SVG + `d3-scale` | 用线性 ordinal 轴，不用真实日历库；便于分段尺度和重叠布局 | 不引入完整 timeline 组件库 |
| 后端 | Fastify + TypeScript | 本地 JSON API、schema 校验、静态文件和插件边界清楚 | 单进程、仅监听本机 |
| 校验 | JSON Schema 2020-12 + Ajv | P2-1 契约与实现语言解耦，外部源和本地文件共用校验器 | P3-1 固定 Ajv |
| 索引 | SQLite，优先 Node 内置 `node:sqlite` | 本地单用户、可重建、无需外部数据库 | P3-1 核实 FTS5；不可用则退到 `better-sqlite3`，不改事实源 |
| 测试 | Vitest + Playwright | 单元/契约与桌面浏览器验收 | P3-1 固定版本 |
| 模型 | Provider Adapter，多协议 | DeepSeek 文档验证了 Responses/Anthropic/JSON/tool；不把提供方写死 | 未选运行时模型 |

## 3. 目录与存储边界

```text
global-history-timeline/
  data/
    timeline/              # 事实源，审阅友好的 JSONL
      regions.jsonl
      periods.jsonl
      events.jsonl
      placements.jsonl
      relations.jsonl
      evidence.jsonl
      change-log.jsonl
    index/
      timeline.sqlite      # 派生查询索引，可由 timeline 重建
    articles/
      <event_id>.json      # 讲解缓存，不是事实源
    media/
      <image_id>/          # 图片和许可元数据
    backups/
      <timestamp>/         # 原始文件审计备份
  config/
    sources.example.toml
    model.example.toml
  schemas/
    *.schema.json
  src/
    shared/                 # 时间、ID、schema、纯函数
    builder/                # 导入、校验、索引构建
    server/                 # 本地 API、检索、模型适配、事务
    web/                    # 页面、路由、时间线 ViewModel
  scripts/                  # CLI 入口
  var/
    log/                    # 仅运行日志，禁密钥
    tmp/                    # 原子写入和暂存区
```

规则：

- 只有 `data/timeline/` 是可追溯事实源；`index`、`articles`、`media`、`backups` 不互为事实源。
- 索引必须可从 `data/timeline/` 重建；重建不能改源文件。
- 文章缓存和索引不得内嵌 API Key、连接串或私有正文。
- `config/*.example.toml` 可提交结构；本机真实配置写 `config/local.toml`，加入忽略规则。

## 4. 链路

```text
用户操作
→ React 路由与 URL 状态
→ 本地 Fastify API
→ SQLite 查询索引（段/事件/搜索）
→ data/timeline 事实源或 articles 缓存
→ 如需首次讲解：检索服务 → 模型适配 → 来源校验 → 原子写缓存
→ ViewModel
→ 页面
```

修订链路单独串行：

```text
模型或人工提案
→ 结构化 diff
→ 来源/实体/日期校验
→ 测试副本事务
→ 备份、原子替换、索引重建
→ 失败回滚或成功审计
```

## 5. 本地查询 API

| 方法 | 路由 | 用途 | 失败区分 |
| --- | --- | --- | --- |
| GET | `/api/timeline` | 段、子段、泳道、事件 placement、视口 | `period_not_found`、`region_not_found`、`unbuilt`、`source_failed` |
| GET | `/api/periods/:id` | period 详情和子段状态 | `period_not_found`、`expandable=false` |
| GET | `/api/events/:id` | 事件、时间、关系、evidence 摘要 | `event_not_found`、`provisional`、`not_found_external` |
| GET | `/api/articles/:eventId` | 读缓存，不生成 | `article_none`、`article_stale`、`article_failed` |
| POST | `/api/articles/:eventId/generate` | 首次或重新生成讲解 | `rate_limited`、`offline`、`source_insufficient`、`schema_error` |
| POST | `/api/qa` | 临时问答，响应不留会话 | `offline`、`rate_limited`、`no_verifiable_source` |
| POST | `/api/revisions/propose` | 只返回结构化 diff | `evidence_missing`、`invariant_failed`、`entity_ambiguous` |
| POST | `/api/revisions/apply` | 仅测试副本或额外授权后使用 | `stale_version`、`lock_timeout`、`rollback_required` |

查询参数和返回：

- `regions`、`parent_period_id`、`start_ordinal`、`end_ordinal`、`scale`、`viewport` 由 JSON Schema 校验。
- “无结果”和“未构建”返回不同状态码。
- API 只返回 ViewModel，不返回完整源文件或密钥。

## 6. 页面路由

| 路由 | 内容 | 状态 |
| --- | --- | --- |
| `/` | 全球横向主线和筛选 | 首屏必须可用，不是营销首页 |
| `/period/:periodId` | 下钻时间线、面包屑、段刻度 | 不可展开段显式为空态 |
| `/event/:eventId` | 中文事件页、来源、相关事件、图片 | 首次生成与缓存状态分开 |
| `/search` | 事件/人物/国家/文明搜索 | 人物搜索结果落到事件 |
| `/qa` | 临时追问 | 关闭不持久化 |

筛选、视口和层级状态优先放 URL 查询串；本地临时 UI 状态不使用另一个持久化事实源。

## 7. 模型与检索适配

`AiProvider` 接口：

```ts
interface AiProvider {
  generateArticle(input: EvidenceBundle): Promise<ArticleDraftCandidate>;
  answerEphemeral(input: EphemeralQuestion): Promise<AnswerCandidate>;
  proposeRevision(input: RevisionProposalInput): Promise<StructuredDiff>;
  describeImage?(input: ImageBundle): Promise<ImageDescription>;
}
```

约束：

- `base_url`、模型名、超时、重试、reasoning 参数来自 `config/local.toml` 或环境变量。
- `api_key_env` 只存环境变量名，真实 Key 不进入 TOML 值、日志或数据库。
- 模型输出先通过 JSON Schema 校验，再由本项目附加 citation、entity link 和 uncertainty。
- 来源检索由 `RetrievalService` 独立实现；模型内建检索不可用时不改变产品契约。
- 429、离线、10 分钟无首事件、空 JSON、假引用都走显式错误状态。

## 8. 事务和恢复

正式修改流程（启用前另授权）：

1. 获取 dataset lock，读取当前 dataset version。
2. 复制相关源文件到 `var/tmp`，应用结构化 diff。
3. 校验 ID、时间、父子、placement、evidence 和来源。
4. 将旧源文件写入 `data/backups/<timestamp>/`。
5. 原子替换 JSONL 源文件。
6. 在临时目录重建 SQLite 索引。
7. 校验新索引和引用完整性；失败则恢复旧源文件和旧索引。
8. 写 `change-log.jsonl`，记录旧值、新值、来源、时间和失败原因。
9. 使受影响 article 缓存 stale，但不删除旧缓存。

失败注入：并发写、无权限、进程中断、JSON 截断、索引失败、审计失败、恢复重试。

## 9. 安全和错误

- 服务只监听 `127.0.0.1`，不加公网 CORS。
- 外部抓取只允许 `http/https`，限制重定向、大小、MIME 和超时，拒绝 `file://` 和本地路径穿越。
- 日志脱敏 URL 查询串中的 token/key；不记录 secrets。
- 404 必须区分：路由 404、本地 period/event 404、外部来源 404、对象/媒体 404、映射 404、权限伪装 404。
- 错误状态至少包括：`offline`、`rate_limited`、`source_unavailable`、`source_insufficient`、`schema_error`、`stale_version`、`invariant_failed`。

## 10. 验证和版本

- 契约级测试：P2-1 所有不变量。
- 单元测试：BCE/CE 排序、半开区间、同名、重叠、空段。
- 构建测试：JSONL → schema → SQLite → 删除索引重建一致性。
- API 测试：筛选、搜索、404 分类、无结果/未构建/失败。
- 浏览器测试：主页、下钻、返回、筛选、搜索、事件页、离线和无图。
- 模型 Mock：空 JSON、假引用、429、10 分钟无首事件、图片过大、修订拒绝。
- 2026-09-30 P3-1 至 P3-6 已用实际锁文件固定依赖和启动命令；Schema、JSONL、SQLite/FTS5 trigram 中文索引、查询 API 和业务页面均已实现。P4-1 本地模型适配 Mock 也已实现；当前仍仅有契约 Mock，未调用真实模型或构建全球数据。

## 11. 本阶段结论

- 采用 Node/TypeScript 单栈，事实源 JSONL，SQLite 派生索引，文章/媒体/备份分离。
- 模型通过 Provider Adapter 接入；来源检索、引用和修订事务不得下放到模型。
- 架构满足 AC-05/08/10 的设计边界，但尚无代码、数据库、页面或依赖版本锁，不能标记实现完成。
