# UI 重设计 Todo List

日期：2026-09-30　状态：UI 重设计已实施并通过自动化验证；P5 全球数据、真实模型联调、部署仍未完成　证据等级：自动化测试 + 生产构建 + 本地页面截图

说明：D0-D1 为设计阶段证据，D2-D5 为实施与验证证据（2026-09-30 执行）。验收编号见 [UI 重设计 Spec v1](ui-redesign-spec-v1.md)。

## D0 现状审查

- [x] 读取原产品 Spec、架构、Todo、README，确认 UI 设计不能替代 P5/P6 验收；证据：2026-09-30 只读检查。
- [x] 读取当前主页、详情页、样式、API 和 E2E，确认现有路由、筛选、搜索和状态恢复能力；证据：`src/web/App.tsx`、`src/web/styles.css`、`src/server/timeline-routes.ts`。
- [x] 核对正式数据规模，确认当前为 16 事件、40 placements、7 地区、6 时段、16 evidence；证据：`data/timeline/*.jsonl` 只读统计。
- [x] 观察 1440 和 390 视口页面，确认“无重叠但时间感弱、重复事件关系弱、对比缺失”的主要问题；证据：本地页面观察。

## D1 设计文档

- [x] 制定信息架构、URL 状态、桌面/平板/移动布局；证据：`ui-redesign-spec-v1.md` 第 5-6 节。
- [x] 制定时间矩阵、年表列表、上下文栏、对比栏和事件详情页调整；证据：`ui-redesign-spec-v1.md` 第 7 节。
- [x] 制定未构建、已查为空、筛选无结果、地区无样本和服务不可用状态；证据：`ui-redesign-spec-v1.md` 第 8 节。
- [x] 制定视觉方向、数据接口边界和技术影响；证据：`ui-redesign-spec-v1.md` 第 9-11 节。
- [x] 制定 U-01 至 U-12 可判定验收标准；证据：`ui-redesign-spec-v1.md` 第 13 节。
- [x] 生成实施计划和本 Todo；证据：`prompt_plan.md`、`todo_list.md`。
- [x] 更新文档索引和时间线；证据：`doc/README.md`。

## D2 实施准备（已完成）

- [x] 拆分 `App.tsx` 中的主页、详情页、筛选、搜索和对比状态；证据：`src/web/TimelinePage.tsx`、`src/web/EventPage.tsx`、`src/web/api.ts`、`src/web/format.ts`、`src/web/hooks.ts`。
- [x] 新增 timeline ViewModel，将 placements 转为行、标记、聚合和对比数据；证据：`src/web/timeline-model.ts`（纯函数）、`src/web/timeline-layout.ts`（刻度与标签分层）。
- [x] 新增标签分层/聚合纯函数测试，覆盖 BCE、区间截断、同日事件和长中文标题；证据：`src/web/timeline-model.test.ts`（10 个 describe）、`src/web/timeline-layout.test.ts`（9 个用例），含 `-0` 刻度归一化修复。
- [x] 更新 E2E 选择器计划，保留旧功能的回归路径；证据：`tests/e2e/timeline.spec.ts` 重写，6 个事件页用例原样保留。

## D3 前端实施（已完成）

- [x] 实现桌面三栏研究界面和紧凑时段导航；时段子节点全部可点击下钻，未构建子时段仅以样式区分。（U-01）
- [x] 实现共享刻度、点事件、区间横条、地区行、空地区压缩显示。（U-01、U-02、U-07）
- [x] 实现标签最多三层、超出聚合（角标计数）、键盘聚焦和窄屏降级。（U-03）
- [x] 实现跨地区同一事件的同步高亮和统一详情链接；证据：e2e “sampled event in two lanes”。（U-04）
- [x] 实现最多 3 个事件的加入、移除、清空和并排比较，上限有禁用提示。（U-05）
- [x] 实现 `period`、`regions`、`status`、`view`、`focus`、`compare` URL 恢复；status 筛选语义与地区一致（点选单一项=只看该项，全选时省略参数）。（U-06）
- [x] 实现移动端默认年表和可切换简化时间轴，对比栏为底部抽屉不遮挡内容。（U-08）
- [x] 调整事件详情页首屏和“加入对比”入口，讲解、媒体、问答保持可用。（U-10）

## D4 验证（已完成）

- [x] `npm run typecheck` 通过：`tsc -b --pretty false` 退出码 0（2026-09-30 复跑确认）。
- [x] `npm test` 通过：13 个测试文件、100 个用例全部通过；新增 `src/web/timeline-model.test.ts`、`src/web/timeline-layout.test.ts`。
- [x] `npm run build` 通过：生产构建成功，dist 由本地 4173 端口生产服务对外提供。
- [x] `npm run test:e2e` 通过：12/12 通过（`tests/e2e/timeline.spec.ts`；`test-results/.last-run.json` status=passed）。
- [x] `npm run test:smoke` 通过：`Production smoke passed at http://127.0.0.1:4183`。
- [x] 1440×900、1024×768、390×844 截图确认无重叠、无水平溢出；证据：e2e 三视口断言 + `%TEMP%\ui-root-1440.png`、`%TEMP%\ui-root-390.png`、`%TEMP%\ui-focus-compare.png`。（U-03、U-08）
- [x] 验证筛选无结果、地区无样本和服务不可用状态；未构建/已查为空状态已在代码中实现，但正式数据 6 个时段均为已构建，暂无数据驱动验证（如实记录）。（U-07 部分）
- [x] 验证对比选择、筛选、时段和视图在刷新、详情页往返后恢复；证据：e2e URL 状态恢复用例。（U-06）
- [x] 验证讲解、媒体、问答、修订提案没有回归；证据：6 个事件页 e2e 用例原样保留并通过。（U-10）

## D5 收尾（进行中）

- [x] 回填本 Todo 的命令、测试数量、截图路径和最高证据等级（本轮）。
- [x] 更新 `doc/README.md` 时间线，明确 UI 实施证据和仍未完成的 P5/P6（本轮）。
- [ ] 如用户要求，提交并推送代码；提交前做状态和敏感信息检查。

## 验收矩阵

| AC | 对应任务 | 当前证据 | 状态 |
| --- | --- | --- | --- |
| U-01 | D3 | e2e + `ui-root-1440.png` | 已验证 |
| U-02 | D3 | 单测（比例定位）+ e2e | 已验证 |
| U-03 | D2、D3、D4 | 单测 + e2e 三视口断言 + 截图 | 已验证 |
| U-04 | D3、D4 | e2e 双地区同步高亮用例 | 已验证 |
| U-05 | D3、D4 | e2e 对比流程用例 + `ui-focus-compare.png` | 已验证 |
| U-06 | D3、D4 | e2e URL 状态恢复用例 | 已验证 |
| U-07 | D3、D4 | 筛选无结果/地区无样本已验证；未构建/已查为空仅代码实现 | 部分验证 |
| U-08 | D3、D4 | e2e 移动端用例 + `ui-root-390.png` | 已验证 |
| U-09 | D3、D4 | 前端纯函数过滤，API/数据未变；单测 + e2e | 已验证 |
| U-10 | D3、D4 | 6 个事件页 e2e 用例通过 | 已验证 |
| U-11 | D4 | typecheck / 100 单测 / 构建 / 12 e2e / smoke 全通过 | 已验证 |
| U-12 | D5 | 本 Todo 与 README 如实记录证据边界 | 已收尾 |

当前未完成：真实模型/图片联调、全球数据构建（P5）、部署，以及代码提交推送（待用户确认）。U-07 的“未构建/已查为空”两态缺正式数据驱动验证，待 P5 数据扩充后回归。
