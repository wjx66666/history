# P2-1 数据契约设计

日期：2026-09-29　状态：首轮定稿候选　证据等级：规划、静态推演

依赖：[Spec v1](global-history-timeline-spec-v1.md)、[P1-1 来源与许可](source-feasibility.md)、[P1-2 分层抽样](source-sampling-p1-2.md)、[P1-3 覆盖与成本](source-coverage-p1-3.md)、[P1-4 运行时 AI 能力](runtime-ai-capability-p1-4.md)。

范围：定义 `period`、`event`、`event_placement`、`region`、`relation`、`article`、`image`、`evidence` 的稳定 ID、时间表示、来源与争议、层级、placement、缓存和状态字段。不写业务代码，不导入数据，不把 P1 抽样项写成已确认全量事实。

## 1. 契约原则

- 事实源与派生索引分离：原始结构化文件是可追溯事实源，查询索引、路由和页面 ViewModel 都可重建。
- 本地 ID 与外部 ID 分离：外部 ID 变化或合并不能改写本地 ID。
- 事件 ID 与 placement 分离：跨地区、跨线重复展示只增加 placement，不复制事件。
- 事实与讲解分离：讲解缓存不能成为事件或日期的第二事实源。
- 主张级证据：标题、日期、类型、地区和关系分别引用 evidence；不设无法回查的“总来源”。
- 状态显式化：空段、未构建、失败、争议、未验证不能共用空值。
- 秘密不入库：密钥、连接串和私有正文不进时间线文件、索引、文章缓存或审计。

## 2. 时间模型

### 2.1 历史纪年表示

面向用户的年使用：

`{ era: "BCE" | "CE", year: 1..N }`

内部排序使用 `year_ordinal`：

- `CE`: `year_ordinal = year`
- `BCE`: `year_ordinal = 1 - year`

这样 `1 BCE = 0`、`1 CE = 1`，不需要内部“公元 0 年”作为用户年前缀；禁止输入 `CE 0`。

### 2.2 TemporalValue

`TemporalValue` 至少包含：

| 字段 | 约定 |
| --- | --- |
| `calendar` | `gregorian`、`julian`、`other:<id>` 或 `unknown`；显示保留原历法 |
| `era` / `year` | 原始历史纪年 |
| `month` / `day` | 可空 |
| `precision` | `day`、`month`、`year`、`decade`、`century`、`unknown` |
| `approx` | 是否约数或估计 |
| `source_text` | 原始显示串，例如“公元前 31 年 9 月 2 日” |
| `year_ordinal` | 派生排序值，不手改 |
| `sort_tuple` | `[year_ordinal, month ?? 0, day ?? 0]`，只用于同精度排序 |

### 2.3 TimeSpan 和端点

事件时间使用以下两种形态：

- `point`：单一时刻或单一精度值。
- `range`：`[start, end_exclusive)` 半开区间。

区间规则：

- `start` 包含在区间内。
- `end_exclusive` 不包含在区间内。
- 年精度区间“1346 至 1352”写为 start 1346、end_exclusive 1353。
- 公元前连续年份向公元方向递增：230 BCE 之后是 229 BCE，最后是 1 BCE，再是 1 CE。
- `range.start.sort_tuple < range.end_exclusive.sort_tuple` 必须成立。
- 争议日期可保留多个 `date_claims`，主显示时间由解决策略选择，但所有候选都保留。

### 2.4 低精度处理

- `decade` 和 `century` 归一为半开区间，例如 9 世纪按地区历史边界展开。
- `unknown` 不允许伪造落点；事件可存在于未定时区，但不能进入按年代比例定位的主时间线，除非使用明确“年代未知”区域。
- 同日、同年的排序使用稳定 tie-breaker：本地 ID，不能使用标题字符串。

## 3. 实体契约

### 3.1 ID 与外部标识

- 本地 ID 形态为 `前缀_不可变随机值`，建议使用 ULID 或 UUIDv7，显示层不暴露含义。
- 前缀固定：`period_`、`event_`、`place_`、`reg_`、`rel_`、`evid_`、`art_`、`img_`。
- 外部 ID 使用数组 `external_ids[]`，元素为 `{ source, id, url, source_timestamp }`；Wikidata QID 只放这里，不替代本地 ID。
- 标题、语言名、别名、上级区域、来源合并都不能改变本地 ID。
- 插入、更新、合并和拆分必须有 `change_log`，记录旧 ID、新 ID、原因和 evidence。

### 3.2 Region

`Region` 表示时间线泳道，不是政治国家表：

| 字段 | 约定 |
| --- | --- |
| `region_id` | 本地稳定 ID |
| `name_zh` / `names_other` | 中文主名和其他语言名 |
| `region_type` | `continent`、`macro_region`、`country`、`historical_state`、`civilization`、`cultural_area`、`place` |
| `parent_id` | 可空；允许多个区域线同级重叠 |
| `valid_time` | 可空；历史政权和文明适用时期 |
| `child_policy` | `include`、`separate`、`manual`，决定筛选是否自动带出子线 |
| `external_ids[]` | 外部标识 |

筛选语义：选“罗马”只显示罗马线及其明确子线，不自动显示欧洲其他区域线。

### 3.3 Period

`Period` 是预制下钻段，不是事件：

| 字段 | 约定 |
| --- | --- |
| `period_id` | 本地稳定 ID |
| `parent_period_id` | 父段；主页大段可空 |
| `title_zh` | 中文标题 |
| `time_span` | 半开区间 |
| `scale` | `era`、`century`、`decade`、`custom` |
| `child_ids[]` | 子段；为空时不可执行下钻 |
| `expandable` | 仅当子段存在且覆盖状态不为失败时 true |
| `coverage_status` | `built`、`checked_empty`、`unbuilt`、`failed` |
| `evidence_scope` | checked_empty 时必须记录查询口径、时间、来源和结果 |

约束：

- 父段区间必须包住子段区间；例外必须写入 `boundary_exception` 和 evidence。
- `expandable = true` 则必须至少有一个子段。
- `checked_empty` 不等于 `unbuilt`；前者是已查无可用事件，后者是尚未构建。

### 3.4 Event

`Event` 表示可稳定引用的事实对象，不管它出现在多少泳道：

| 字段 | 约定 |
| --- | --- |
| `event_id` | 本地稳定 ID |
| `title_zh` / `aliases` | 中文显示名和别名 |
| `event_kind` | `point_event`、`interval_event`、`war`、`process`、`disaster`、`policy`、`discovery`、`other` |
| `time_span` | `point` 或半开 range |
| `date_claims[]` | 每个日期主张和 evidence；有冲突时保留 |
| `type_claims[]` | 事件类型主张及 evidence |
| `place_claims[]` | 地点、地区主张及 evidence |
| `region_refs[]` | 关联 Region ID，不等于 placement |
| `relation_ids[]` | 与人物、政权、事件、地点的关系 |
| `evidence_ids[]` | 事件级来源，不替代主张级 evidence |
| `data_status` | `verified`、`provisional`、`disputed`、`insufficient`、`rejected` |
| `external_ids[]` | Wikidata 等外部标识 |

最低写入规则：至少一个真实来源支持标题/类型/核心日期中的关键主张；无来源的猜测不得入库。

### 3.5 EventPlacement

`EventPlacement` 决定事件在哪个泳道、哪个时间段和哪一层显示：

| 字段 | 约定 |
| --- | --- |
| `placement_id` | 本地稳定 ID |
| `event_id` | 指向唯一 Event |
| `line_id` | Region 或历史政权线 |
| `period_id` | 当前显示段 |
| `display_weight` | 主事件、次要事件或背景事件 |
| `order_index` | 同层排序稳定值 |
| `role` | `primary`、`secondary`、`context`、`commemoration` |

约束：

- `(event_id, line_id, period_id)` 唯一，重复只能合并或显式标注重复来源。
- placement 时间必须与父 period 相交；不相交则拒绝或触发 period 边界修订。
- 同一 event 的多 placement 共享标题、时间、来源和讲解，不复制正文。

### 3.6 Relation

`Relation` 是有方向、可带时间和证据的关联：

| 字段 | 约定 |
| --- | --- |
| `relation_id` | 本地稳定 ID |
| `from_ref` / `to_ref` | `{ type, id }`，指向 event、region、person、place、period 等对象 |
| `relation_type` | `part_of`、`participant`、`located_in`、`caused_by`、`followed_by`、`same_as`、`different_from`、`commemorates`、`described_by` |
| `time_scope` | 可空 |
| `evidence_ids[]` | 关系证据 |
| `status` | `verified`、`provisional`、`disputed`、`rejected` |

约束：`same_as` 和 `different_from` 不能形成自相矛盾；合并关系必须经过人工或规则审核。

### 3.7 Evidence

`Evidence` 是来源和主张之间的桥：

| 字段 | 约定 |
| --- | --- |
| `evidence_id` | 本地稳定 ID |
| `source_url` | 公开可回查 URL |
| `publisher` | 发布机构或站点 |
| `source_type` | `primary`、`reference`、`encyclopedia`、`database`、`image`、`other` |
| `retrieved_at` | 获取时间 |
| `claim_text` | 该来源具体支持的短句或事实 |
| `supports` / `contradicts` | 指向 claim 或 relation |
| `license` | 文字和媒体使用条件 |
| `quote_safe` | 是否已确认可保存引用片段 |

URL 存在不等于 evidence 有效；至少要有可核对的 claim_text、publisher 和 retrieved_at。

### 3.8 Article

`Article` 是事件讲解缓存，不是事实源：

| 字段 | 约定 |
| --- | --- |
| `article_id` | 本地稳定 ID，按 event_id 去重 |
| `event_id` | 指向唯一 Event |
| `status` | `none`、`generating`、`cached`、`stale`、`failed` |
| `content` | 中文讲解正文 |
| `citations[]` | 只引用已存在且可核查的 evidence_id/URL |
| `link_refs[]` | 可跳转的事件、地点、人物或 region |
| `images[]` | 图片 ID 和元数据 |
| `model_profile` | 提供方、模型名、base_url 名和参数，不存 Key |
| `generated_at` | 生成时间 |
| `content_hash` | 正文 hash，用于缓存命中 |
| `source_bundle_hash` | 生成时使用的证据 bundle hash |

规则：重新生成成功才覆盖；失败保留旧 article；citations 不得凭空生成；旧版本可不显示在 UI，但审计记录保留。

### 3.9 Image

图片必须带许可元数据：

`image_id`、`local_path`、`source_url`、`publisher`、`author`、`license`、`license_url`、`retrieved_at`、`dimensions`、`mime`、`caption_zh`、`evidence_id`。

许可不明时不下载；无图允许 article 纯文字；模型只可描述图片，不得生成伪史料图。

## 4. 不变量

| 编号 | 不变量 | 失败处理 |
| --- | --- | --- |
| INV-TIME-01 | 禁止 `CE 0`；BCE year 必须为正 | 拒绝写入，记录原因 |
| INV-TIME-02 | 时间排序只用 `year_ordinal/sort_tuple`，不用字符串 | 拒绝写入索引 |
| INV-TIME-03 | range 必须 `start < end_exclusive` | 拒绝写入 |
| INV-ID-01 | 本地 ID 不因标题、来源或合并变化 | 保留旧 ID，新增 change_log |
| INV-EXT-01 | 外部 ID 只作引用，不成为主键 | 拒绝写入 |
| INV-PERIOD-01 | 父段必须包住子段 | 先修边界或写明确例外 |
| INV-PERIOD-02 | `expandable=true` 必须有子段 | 降级为不可展开 |
| INV-PERIOD-03 | `checked_empty` 必须有查询口径和 evidence_scope | 保持 unbuilt |
| INV-PLACE-01 | placement 必须指向存在的 event、line、period | 拒绝写入 |
| INV-PLACE-02 | 同一 event+line+period 不得重复 | 合并或标记 duplicate_source |
| INV-EVID-01 | 外部事实必须有可回查 evidence | 保持 provisional 或拒绝 |
| INV-REL-01 | relation 两端必须存在；same/different 不得矛盾 | 拒绝提案 |
| INV-ARTICLE-01 | article citation 必须解析到现有 evidence | 整体拒绝覆盖 |
| INV-IMAGE-01 | 图片必须许可元数据完整 | 不下载、不展示 |
| INV-SECRET-01 | 任何文件、日志、fixture 禁止 API Key 和连接串 | 阻止提交并报警 |

## 5. 推演实例

### 5.1 跨公元前和公元后

样本：P1-2 `S01` 秦灭六国之战（Wikidata `Q2986801`）和 `S15` 希吉拉（`Q131482`）。

- 秦灭六国之战的年范围写为 `230 BCE` start、`220 BCE` end_exclusive；`sort_tuple` 为 `[-229,0,0]` 到 `[-219,0,0]`。
- 希吉拉写为 `622-09-13` start、`622-09-28` end_exclusive；排序在公元后正数区域。
- 比较结果：秦灭六国整段早于希吉拉；任何字符串排序、无纪年排序或内部 0 年实现都会失败。

### 5.2 同名事件消歧

样本：P1-2 `S04` 亚克兴海战（`Q160387`，31 BCE，日精度，2 条日期引用）和 `S11` 同名 435 BCE 项（`Q9173813`，0 条日期引用）。

- 两项分配不同 `event_id`，外部 ID 保留各自 QID。
- 显示标题相同不能触发合并；搜索必须同时显示年代、地区和 `different_from` 关系。
- `Q9173813` 在无中文标签且无日期引用时保持 `provisional`，不得抢占 31 BCE 项的文章缓存。

### 5.3 同期政权和重叠线

契约 fixture（不是历史事实）：`reg_a` 与 `reg_b` 为两条独立泳道，两个政权 period 区间有重叠。

- 事件 `event_x` 同时放置到 `reg_a` 和 `reg_b`，只增加两个 placement，`event_id` 不变。
- 两条泳道各自保留轴顺序，不把重叠解释为替代关系。
- 只有显式 relation 才能表达派系、继承或从属。

### 5.4 空段和未构建

契约 fixture：`period_checked_empty` 与 `period_unbuilt` 都是空段。

- `period_checked_empty` 带 evidence_scope：已按地区/时期/来源查询、样本数为 0、查询时间记录完整。
- `period_unbuilt` 没有查询记录。
- UI 都不可显示下钻入口，但覆盖报告必须区分两者；`failed` 也必须是第三类。

### 5.5 跨年灾害和多 placement

样本：P1-2 `S07` 黑死病（`Q42005`，1346 至 1352，跨欧洲、亚洲、北非）。

- `time_span = range { start: 1346, end_exclusive: 1353 }`。
- 同一 event 建立欧洲、亚洲、北非的多个 placement，不复制事件和日期。
- 其时间陈述的“日期引用”必须逐地区或逐主张核验，不能因为某一个地区有来源而让其他 placement 自动 verified。

### 5.6 争议和未定精度

样本：玛雅崩解的世纪精度（S12）；或同一事件有多个日期来源。

- `date_claims[]` 保留所有候选，每项带 evidence_id 和查阅时间。
- 主显示时间可以选择最精确且有来源的候选，但必须另设 `data_status = disputed` 或 `provisional`。
- 不得静默删除冲突来源。

## 6. 写入和提交规则

- 外部来源先写入 `evidence`，再创建或更新 event/period/relation claim。
- 事件新增/修正、period 边界调整、层级调整都先生成结构化 diff。
- 写入前执行 ID、时间、父子和 placement 不变量校验。
- 失败整笔拒绝，不留下部分提交；原文件先备份，再原子替换，并记录旧值、新值、来源、时间和失败原因。
- 索引、路由和文章缓存只能由已校验源文件重建；不能让索引成为唯一事实源。

## 7. 验收推演结论

| 验收点 | 推演结果 |
| --- | --- |
| 跨公元前后 | 通过：BCE ordinal 与 CE ordinal 连续无 0 年 |
| 区间端点 | 通过：年范围和日范围都用半开区间 |
| 同名消歧 | 通过：本地 ID、外部 ID 和 `different_from` 分离 |
| 同期重叠 | 通过：独立泳道与多 placement，不复制 event |
| 空段 | 通过：checked_empty、unbuilt、failed 三态分离 |
| 争议来源 | 通过：保留多个 date_claim，不静默择一 |
| 多地区 placement | 通过：一个 event 多个 placement，共享讲解 |
| 来源门槛 | 通过：事实必须绑定 evidence，讲解决不能反向成为事实 |

## 8. 留给 P2-2 的决定

- 归一化日历的物理实现：是否引入 Julian/Gregorian 转换库，还是只保存原历法和排序 tuple。
- 本地文件格式和 schema 版本策略。
- 索引产物、备份目录和原子替换机制。
- relation 的 person/place 对象是否与 event 共用同一存储文件。
- article/model/image 元数据的具体文件边界。
- 实际 API、模型调用和数据库是否使用；当前不预设。
