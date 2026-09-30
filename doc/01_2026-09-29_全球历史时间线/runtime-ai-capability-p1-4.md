# P1-4 产品运行时 AI 能力调查

日期：2026-09-29　状态：首轮完成　证据等级：官方文档真实只读，未做模型调用

依赖：[P1-1 来源与许可首轮](source-feasibility.md)、[P1-2 分层抽样](source-sampling-p1-2.md)、[P1-3 覆盖与成本估算](source-coverage-p1-3.md)。

范围：区分开发执行模型与产品运行时模型，调查讲解、问答、来源追溯、图片元数据、超时、限流和密钥配置所需接口。只阅读官方文档；未使用 API Key，未进行付费调用，未把候选模型写成已选定。

## 1. 执行模型与运行时模型

- 开发执行模型：`DeepSeek V4.1 Flash` 负责按文档执行代码和任务，不因这个身份自动成为产品运行时讲解模型。
- 产品运行时模型：本轮没有选定。P1-4 只判断候选接口是否具备维护讲解、问答和修订的必要能力。
- 产品不得依赖模型自述事实。来源检索、引用校验和原始时间线写入必须由本项目代码控制。

## 2. 官方资料可达性

| 提供方 | 官方资料尝试 | 结果 | 本轮判断 |
| --- | --- | --- | --- |
| DeepSeek | `https://api-docs.deepseek.com/` 及 10 个官方页面 | 可读；文档、模型、价格、限流、JSON、工具、Responses、Vision、Anthropic 兼容页均已打开 | 唯一完成文档级能力核查的候选 |
| OpenAI | `https://developers.openai.com/`、`https://platform.openai.com/` | `Forbidden`、Cloudflare 阻断或连接关闭；官方文档页未能打开 | 未验证，不能写能力结论 |
| Anthropic | `https://docs.anthropic.com/en/docs/overview` | 页面返回 “App unavailable in region” | 当前区域不可用；未验证 |
| Gemini | `https://ai.google.dev/gemini-api/docs` | 超时或连接关闭 | 未验证，不能写能力结论 |

OpenAI 官方文档的尝试符合 `openai-docs` 技能顺序：先检索官方域、再打开实际页面；因官方域不可达，OpenAI 项保持待定。

## 3. 产品所需接口

讲解、问答和修订对运行时能力的要求不同：

| 产品动作 | 最低接口能力 | 不能交给模型的部分 |
| --- | --- | --- |
| 首次讲解生成 | 长上下文、中文生成、结构化 JSON、可选流式输出 | 来源检索、引用存在性校验、事件日期和实体归属 |
| 再次访问缓存 | 不调用模型 | 事件 ID 去重、缓存命中、失败保留旧讲解 |
| 临时问答 | 会话内上下文、结构化回答或工具调用 | 会话持久化策略、来源白名单、离线失败状态 |
| 图片说明 | 图像输入和描述 | 图片许可、作者、来源、下载条件和文件类型 |
| AI 修订提案 | 结构化差异、工具调用或严格 JSON Schema | 原始文件写入、备份、回滚、冲突处理和审计 |

## 4. DeepSeek 文档级能力表

| 项目 | 官方文档结论 | 对本产品的含义 | 验证状态 |
| --- | --- | --- | --- |
| 模型名 | `deepseek-flash`；旧名 `deepseek-v4-flash`、`deepseek-v4-flash-vision-exp` 已退役但仍被接受 | 可作为运行时候选名，但未选定 | 文档已读 |
| 备选模型 | `deepseek-v4-pro` | 更贵且并发更低；是否用于修订或高质量讲解待定 | 文档已读 |
| 接口格式 | OpenAI 兼容 `https://api.deepseek.com`；Anthropic 兼容 `https://api.deepseek.com/anthropic` | 适配层可隐藏提供方差异 | 文档已读 |
| 上下文长度 | 1M tokens | 足以容纳事件资料、引用片段和会话 | 文档已读 |
| 最大输出 | 384K tokens | 足够生成长讲解，但 JSON 模式必须防止中途截断 | 文档已读 |
| 思考模式 | 支持非思考和思考模式，默认思考 | 讲解质量和成本需要实测决定模式 | 未实测 |
| 流式输出 | Chat Completion 和 Responses 支持流式事件 | 可用于首次讲解的进度和超时反馈 | 文档已读 |
| JSON 输出 | `response_format: {'type':'json_object'}`，提示词需包含 JSON 示例，需设置 `max_tokens`；文档警告偶尔返回空内容 | 讲解和修订可要求结构化 JSON，但必须校验空输出和格式 | 文档已读 |
| 工具调用 | 支持 function tool calls；模型只产出调用，不执行工具；Thinking Mode 也支持 | 检索、来源校验和修订应通过本项目工具执行 | 文档已读 |
| 工具调用历史 | Anthropic API 和 Responses API 支持中途插入工具调用；Chat Completion 不支持中途插入工具调用 | 问答和修订适配层优先使用 Responses 或 Anthropic 格式 | 文档已读 |
| 严格模式 | Beta；函数需 `strict: true`，服务端校验 JSON Schema | 修订提案可使用严格 Schema；仍不能替代业务不变式 | 文档已读，未实测 |
| 图片输入 | `deepseek-flash` 支持 JPEG、PNG、GIF、WebP；可用 base64、外部 URL 或 Files API `file_id` | 可让模型读取真实图片或做 OCR，但图片许可仍由本项目处理 | 文档已读 |
| 图片限制 | 外部 URL 最长 8192 字符；单图 32 MiB，Files API 单图 64 MiB；单请求最多 600 图；图像 token 上限约 1024 | 图片应先落盘和审计，再按需送入模型 | 文档已读 |
| 内建检索 | Responses 工具表覆盖的 `web_search`、`file_search`、`code_interpreter`、`computer_use`、`mcp` 等内建工具均标记为 ignored；只支持 function 和 `apply_patch` custom 调用 | 不能把来源检索和引用追溯交给模型内建工具 | 文档已读，关键结论 |
| 引用追溯 | 没有官方文档说明模型自动生成可核查引用；Anthropic 的 `citations` 字段在兼容表中为 ignored | 引用必须由本项目从检索结果和真实页面生成并校验 | 文档已读，关键结论 |
| 并发限制 | `deepseek-flash` 2500；`deepseek-v4-pro` 500；按账号计算，超限返回 429 | 单用户产品通常远低于限制；仍要 429 退避 | 文档已读 |
| 超时机制 | 发送后长请求保持连接并发送 keep-alive；如果 10 分钟内没有开始推理，服务端关闭连接 | 讲解和修订需要长的客户端超时、流式首事件和失败状态 | 文档已读 |
| 用户隔离 | `user_id` 用于内容安全、KVCache 和调度隔离 | 本机单用户可自动生成稳定 user_id；不得把正文写入日志 | 文档已读 |
| 密钥 | API Key 需从平台申请；官方例子使用环境变量 `DEEPSEEK_API_KEY` | 密钥只能进本机环境或本机配置服务，不得进源文件、缓存、日志、fixture 或页面 | 文档已读，未取 Key |
| 价格 | Flash 缓存命中输入低价、缓存未命中输入高价、输出按 token 计费；有尖峰和离峰价 | 可用于 P2 成本上限估算；实际费用必须实测 | 文档已读，未实测 |

## 5. 对产品接口的结论

- 可以通过一个提供方适配层满足讲解、问答和修订，但适配层必须把来源检索与引用校验放在本项目一侧。
- 推荐内部接口不暴露模型提供方名称：
  - `generate_article(eventId, evidenceBundle) -> { text, citations, links, uncertainty }`
  - `ask_ephemeral(sessionId, question, evidenceBundle) -> { text, citations }`
  - `propose_revision(eventOrPeriod, prompt, currentSource) -> structuredDiff`
- `generate_article` 和 `ask_ephemeral` 可调用模型；`citations` 和 `links` 只能来自本地检索结果和已核验页面。
- `propose_revision` 先得到结构化提案，再由本项目执行实体消歧、日期校验、来源门槛和事务写入；模型不得直接改原始文件。
- 图片先由本项目按许可获取并落盘，再决定是否送模型做描述或 OCR；模型不得生成伪史料图片。
- 429 和 10 分钟无首事件都作为可识别失败状态，显式显示重试或离线，不覆盖已有讲解。

## 6. 候选结论

| 候选 | 文档级能力 | 当前可用性 | 结论 |
| --- | --- | --- | --- |
| DeepSeek `deepseek-flash` | 指标完整，支持 Responses、Anthropic、JSON、工具、Vision | 未取 Key，未调用 | 可进入 P2 适配层设计；不是已选定模型 |
| DeepSeek `deepseek-v4-pro` | 支持同类接口，价格和并发不同 | 未取 Key，未调用 | 备选；不到选定 |
| OpenAI | 官方文档本轮不可达 | 无法判定 | 待定 |
| Anthropic | 当前区域不可用 | 无法判定 | 在当前环境不作为候选 |
| Gemini | 官方文档不可达 | 无法判定 | 待定 |

## 7. 未验证和限制

- 未进行任何模型调用，因此生成质量、中文史料讲解质量、JSON 稳定性、空输出率、引用跟随、Vision 描述质量、延迟和真实费用均未验证。
- 未取得或写入 API Key；未在页面、日志或文档中保存密钥。
- 未确认 OpenAI、Anthropic、Gemini 在当前区域的真实可用性。
- 未进行图片输入实验，也未验证图片 token 与真实文件大小。
- 未验证修订提案工具是否能通过严格 Schema 约束到产品契约。
- 本报告不宣布任何运行时模型已选定，也不宣布讲解、问答或修订已可实现。

## 8. P2 前置输入

- P2-2 需要定义提供方适配层、来源检索接口、引用校验接口、图片元数据接口和修订事务接口，而不是把模型调用散落在页面。
- P2-2 需要把 `model/base_url/api_key/user_id/timeout/stream/response_format/tool_calls` 的配置边界写清；密钥只进本机环境。
- P2-3 需要在 fixture 和 Mock 中覆盖：模型空输出、假引用、429、10 分钟无首事件、图片过大、工具调用失败、修订提案被拒绝。
- 真实模型调用应作为 P4/P6 的单独授权项，不能从 P1-4 文档调查推断。
