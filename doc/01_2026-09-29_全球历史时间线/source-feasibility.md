# P1-1 来源与许可首轮调查

日期：2026-09-29　状态：首轮完成　证据等级：真实只读通过（部分来源阻塞）

范围：只调查候选来源的官方文档、许可、接口和限流规则；不批量抓取数据，不注册账户，不取得 API Key，不解答或绕过人机验证，不导入本机，不进入 P1-2 分层抽样。

## 1. 访问口径与计数

- 调查日期：2026-09-29。
- 终端工具：`curl.exe 8.12.1.0`，强制 IPv4，超时 15 至 20 秒，带说明性 User-Agent。
- 浏览器工具：应用内浏览器，只读打开官方页并读取可见正文。
- 官方 URL 目标：14 个。成功读取：6 个。403、429、超时、TLS 失败或人机验证阻塞：8 个。
- 成功项：Wikidata Data access、Wikimedia Foundation Terms of Use、Commons:Licensing、MediaWiki API:Etiquette、The Met Collection API、Smithsonian EDAN API 文档。
- 阻塞项：Europeana API 与权利页、The Met 条款页、Smithsonian 主站两个路径、DP-LA 候选路径、Rijksmuseum 候选路径、MediaWiki API 主页面终端访问。

原始终端快照保存在工作区外的临时目录：

- `C:\Users\EDY\.codex\visualizations\2026\09\29\01a0ec87-0ac6-7052-8839-e5bf90e83b9a\p1-1-sources\met-api.html`
- `C:\Users\EDY\.codex\visualizations\2026\09\29\01a0ec87-0ac6-7052-8839-e5bf90e83b9a\p1-1-sources\smithsonian-edan-apidocs.html`

浏览器读取页没有另存 HTML，本文件保留其关键原文、页面标题、URL 和访问结果。

## 2. 来源结论表

“待 P1-2”表示官方文档不足以证明实际事件粒度、中文标签质量或引用完整度，必须在下一任务用受控样本核验，不能在本表写成已满足。

| 来源 | 事件或对象 | 时间 | 中文 | 引用 | 图片 | API 与批量 | 限额和使用条件 | P1-1 决定 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Wikidata | Item、Property、Statement 和图查询；是否以独立“事件”实体出现待 P1-2 | 日期语句与纬度值可表达日期和精度，跨年、约数、古代纪年待实测 | 有多语言标签、别名和描述，中文覆盖待实测 | Statement 可带参考来源，完整度和可验证性待实测 | 本体不托管图片，通常外链 Commons 或机构媒体 | Linked Data Interface、SPARQL/WDQS、REST、GraphQL、dump、Enterprise；批量能力明确存在 | 结构化数据 CC0；其他 namespace 文本为 CC BY-SA；API 遵守 User-Agent、串行请求、`maxlag`、429 退避；接口不承诺稳定 | 选为全球跨类型骨架候选；不得仅凭结构化事实当事件讲解来源。事件粒度是 P1-2 首要门槛 |
| MediaWiki / 维基百科体系 | 页面、分类、条目正文；事件文章是否存在待 P1-2 | 正文和元数据可含日期，精度不统一 | 有中文条目和跨语言链接，机器翻译姓名消歧待实测 | 条目通常含参考与外部链接，完整度按页差异很大 | 图片由 Commons 文件承载，必须逐文件核许可 | Action/Query API、页面查询、生成器和管道批量读取；页面文本可被缓存 | 文本 CC BY-SA 4.0，也可按 GFDL；API 受 User-Agent、Robot、API:Etiquette 约束；读取无硬限速但要求串行和退避 | 选为讲解与引用核查候选；只可作为有来源的文本参考，不可把整段页面直接当作事实或指令 |
| Wikimedia Commons | 媒体文件、文件描述、分类；不提供事件时间线 | 文件可含创建或拍摄日期，不代表历史事件年代 | 文件描述语言不统一，中文说明可能存在但不是保证 | 描述页要求来源、作者、日期和许可，引用的是媒体出处而非历史事件证据 | 仅接受 CC0、CC BY、CC BY-SA、公共领域或等价自由许可；CC BY-NC、CC BY-ND、fair use 作为唯一许可不合格 | 文件与分类 API 可查询；批量下载前要逐文件审计 | 每个文件必须标许可、来源、作者和日期；结构化文件元数据 CC0，非结构化文本 CC BY-SA 4.0；不得把“个人本机使用”当作免许可 | 选为真实图片候选；每张图在进入产品缓存前必须做许可与署名核验 |
| The Met Collection API | 470,000 件以上艺术品对象；属于物件记录，不是历史事件文章 | `objectDate`、`objectBeginDate`、`objectEndDate` 等；适合做时间锚点，不适合作全球事件主库 | 主要为英文元数据；中文覆盖未知 | 有出处和致谢字段，但不是事件级引用体系 | 公共领域高分辨率 JPEG；数据集声明 CC0、无限制商业和非商业使用 | RST JSON；`/objects`、`/objects/[objectID]`、`/departments`、`/v1.1/search` 分页；整表 CSV 可批量取 | 当前无需 API Key；文档要求限速 80 次/秒；旧 `/v1/search` 计划于 2026-10-01 退役；条款页 `https://www.metmuseum.org/information/terms-and-conditions` 本轮返回 429，待补查 | 选为真实图片和跨时期时间锚点候选；不作为事件文字主来源，必须补查条款页后才能在 P1-2 使用 |
| Smithsonian Open Access API | 物件、档案和藏品记录；不是事件时间线 | API 文档列出 `date` 类字段和对象数据集；实际事件粒度待 P1-2 | 文档页面有中文界面，但数据标签语言未知 | 条款页未取得，引用与署名规则未确认 | 文档说明为 CC0 对象或媒体；逐文件许可仍需后续核验 | Endpoint 包括 content、stats、category search、search、terms；分页默认 10，范围 0 至 1000 | API Key 必须从注册页取得；本轮未注册，因此未调用数据接口；条款页 `https://www.si.edu/termsofuse` 本轮 403 | 条件候选；只有在条款和 Key 获取获得单独授权后才可继续，当前不进入自动采集 |
| Europeana | 未取得完整 API 文档 | 未知 | 未知 | 未知 | 权利说明页 403，媒体许可未知 | `https://pro.europeana.eu/page/apis` 触发 Cloudflare 人机验证，未绕过 | 未确认；不得在规则不明时自动采集 | 本轮不选定，保持未决 |

## 3. 官方页面证据

### Wikidata

- 页面：`Wikidata:Data access - Wikidata`
- URL：`https://www.wikidata.org/wiki/Wikidata:Data_access`
- 访问：应用内浏览器成功；终端直连超时或连接重置，属于网络路径差异，不证明页面不存在。
- 原文要点：
  - “Wikidata currently contains over 120 million Items and over 1,3 million Lexemes”。
  - “All that data is licensed CC0, ‘No rights reserved’, for the public domain.”
  - 访问方法列有 Linked Data Interface、Wikidata Query Service、REST API、MediaWiki Action API、GraphQL、dump 和 Enterprise。
  - “Data sources on this page are not guaranteed to be stable interfaces.” 接口变更风险必须由适配层吸收。
  - 页面脚注指出结构化数据为 CC0，其他 namespace 文本为 Creative Commons Attribution-ShareAlike；附加条件仍适用。

### Wikimedia Foundation Terms of Use

- 页面：`Wikimedia Foundation Terms of Use`
- URL：`https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use`
- 访问：应用内浏览器成功。
- 原文要点：
  - 条款自 2023-06-07 起生效。
  - 用户提交文本按 Creative Commons Attribution-ShareAlike 4.0 或 GNU Free Documentation License 授权。
  - API 使用受 User-Agent Policy、Robot Policy 和 API:Etiquette 约束。
  - 复用必须遵守署名、许可和修改标注要求；这不是可忽略的页面提示。

### Wikimedia Commons

- 页面：`Commons:Licensing - Wikimedia Commons`
- URL：`https://commons.wikimedia.org/wiki/Commons:Licensing`
- 访问：应用内浏览器成功。
- 原文要点：
  - 只接受自由许可或公共领域媒体；CC BY 和 CC BY-SA 可接受，CC0 可接受。
  - CC BY-NC、CC BY-ND、CC BY-NC-ND 和仅靠 fair use 的内容不合格。
  - 每个文件必须标注许可，并给出源、作者、日期和可核查信息。
  - 文件结构化元数据为 CC0，非结构化文本为 CC BY-SA 4.0。

### MediaWiki Action API:Etiquette

- 页面：`API:Etiquette - MediaWiki`
- URL：`https://www.mediawiki.org/wiki/API:Etiquette`
- 访问：应用内浏览器成功；终端到同域主页面超时，浏览器到礼节页成功。
- 原文要点：
  - “There is no hard speed limit on read requests, but be considerate and try not to take a site down.”
  - 请求应串行而不是并行；能用管道或生成器一次请求多项时就合并。
  - 非交互任务使用 `maxlag`；User-Agent 要说明工具和联系方式；读取优先 GET，POST 只用于例外。
  - 限流错误使用 `ratelimited` 和指数退避；gzip 压缩可减少带宽。

### The Met Collection API

- 页面：`Latest Updates | The Metropolitan Museum of Art Collection API`
- URL：`https://metmuseum.github.io/`
- 访问：终端 `curl` 成功，快照 84,532 字节。
- 原文要点：
  - 数据集覆盖 470,000 件以上藏品，声明 CC0，可用于不受限制的商业和非商业用途。
  - “At this time, we do not require API users to register or obtain an API key to use the service. Please limit request rate to 80 requests per second.”
  - RST JSON 接口，包含物件列表、物件详情、部门和搜索；`/v1.1/search` 支持 `offset` 和 `limit`，单页上限 500，前 10,000 条可达。
  - 旧 `/v1/search` 计划于 2026-10-01 退役；批量应改用 `/objects` 或 Open Access 数据集。
  - 详情字段包含 `objectDate`、`objectBeginDate`、`objectEndDate`、`culture`、`primaryImage`、`additionalImages`、`objectWikidata_URL` 等。
  - 条款页 `https://www.metmuseum.org/information/terms-and-conditions` 本轮返回 429；本阶段只记录数据集说明，不声称已审完条款。

### Smithsonian Open Access API

- 页面：`Smithsonian Institution Open Access API`
- URL：`https://edan.si.edu/openaccess/apidocs/`
- 访问：应用内浏览器成功；终端只拿到未渲染模板。
- 原文要点：
  - “The Open Access API requires an API key to access the endpoints.”
  - Key 需从 `https://edan.si.edu/openaccess/signup/form` 取得；本轮未注册、未取得 Key。
  - Endpoint 覆盖 content、stats、category search、search、terms；分页 `rows` 默认 10，范围 0 至 1000。
  - 文档明确面向 CC0 对象或媒体；但完整使用权仍取决于条款页 `https://www.si.edu/termsofuse`，本轮 403 未取得。
  - 主站 `https://www.si.edu/openaccess/apidocs/` 与 `https://www.si.edu/openaccess` 均返回 403；成功的是 EDAN 子站。

### Europeana 与其他未决来源

- `https://pro.europeana.eu/page/apis`：应用内浏览器进入 Cloudflare “正在进行安全验证”页；终端返回 403。按安全规则未解答或绕过人机验证。
- `https://www.europeana.eu/en/rights`：终端返回 403，未取得权利说明。
- `https://api.dp.la/v2/api_key`：返回 404；该候选路径无效，不能据此否定来源整体。
- `https://data.rijksmuseum.nl/object-metadata/api/`：TLS 握手失败，结果不确定。
- `https://www.mediawiki.org/wiki/API:Main_page`：终端超时；同域的 API:Etiquette 经浏览器成功，说明失败主要在终端网络路径。

## 4. 可入选与门槛

- 第一层骨架候选：Wikidata。只提供结构化产物和外部标识，不直接把模型推断当真。
- 讲解与引用候选：Wikipedia/MediaWiki 页面文本，以 CC BY-SA 4.0 为基线；每段事实必须有可点击来源，且需逐页核验。
- 图片候选：Wikimedia Commons 与 The Met。Commons 每文件执行许可审计，The Met 仅使用公共领域图片并保存出处。
- 时间锚点候选：The Met 与 Smithsonian 的对象日期。它们可以帮助放置文物或器物，但不能替代政治、战争、思想、灾害等事件的史料链。
- 未决来源：Europeana、DP-LA、Rijksmuseum。规则不明或访问未确认前不进入自动采集。
- 任何来源都不得绕过访问限制、人机验证或账户注册；未取得条款的 Smithsonian 和 The Met 条款页保持在后续门槛。

## 5. P1-2 结果与后续任务验证

P1-2 已完成首轮受控抽样，结果见 [source-sampling-p1-2.md](source-sampling-p1-2.md)；P1-3 已完成覆盖与成本估算，结果见 [source-coverage-p1-3.md](source-coverage-p1-3.md)。本文件中的“待 P1-2”项已转为 P1-3 结论和后续门槛，不再沿用本文件作为事实抽样结果。

- P1-2 已完成 Wikidata 站内搜索和实体页首轮抽样，但未核引用网页内容，也未覆盖全部地区。
- 对 Wikipedia/MediaWiki 仍需核查中文标签、同名消歧、来源链和图像文件许可。
- 对 The Met 和 Smithsonian 仍需用真实只读样本核验物件日期字段、语言、图片授权和批量成本。
- P1-3 已基于 P1-2 样本给出地区×时期×目标层级的节点量情景、缺口、请求量下界和失败重试成本；这些仍是规划估算，不是全球事实。
- 本文件不提供全球覆盖率结论，也不把官方文档中的能力声明当作已完成数据采集。
