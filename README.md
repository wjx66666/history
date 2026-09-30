# 全球历史时间线

本机单用户历史浏览项目。当前包含 P5 首批及 B13 增量真实只读样本、可重建 SQLite 索引和本地查询 API；这些样本不代表全球覆盖已经完成。

## 环境

- Node.js 24.21.0（见 `.node-version`）
- npm 11.x

## 启动开发环境

```powershell
npm ci
npm run data:rebuild-index
npm run dev
```

浏览器打开 `http://127.0.0.1:5173`。Vite 将 `/api` 请求代理至 `http://127.0.0.1:4173`。两个端口均固定绑定本机回环地址；端口占用时命令会明确失败，不会自动切换端口。

## 验证与生产模式

```powershell
npm run typecheck
npm test
npm run test:e2e
npm run build
npm run test:smoke
npm run data:import-fixture
npm run data:import-p5-sample
npm run data:import-p5-b13
npm run data:rebuild-index
npm start
```

`npm start` 在 `http://127.0.0.1:4173` 同时提供构建后的页面与 API。生产启动前必须先执行 `npm run build`。

当前页面可浏览 16 条真实只读实体事件样本，涵盖 7 条地区泳道和公元前 230 年至 1896 年；9 个批次部分完成、9 个未构建，外部参考尚未逐条核实。首次克隆后须从已提交的 `data/timeline/*.jsonl` 执行 `npm run data:rebuild-index`，SQLite 索引和本地备份不入库。事件页支持讲解缓存、许可图片和临时问答；默认未配置模型和来源，因此不会生成伪内容。`POST /api/revisions/propose` 只返回经来源、实体、日期、地区和整库不变量校验的结构化提案，不会应用变更。修订事务、备份、恢复、placement 和索引重算目前仅供隔离测试副本使用，正式自动修订仍未开放。`npm run test:e2e` 使用独立的 `127.0.0.1:4185` 生产构建服务，不复用开发端口。

真实模型配置只可写入已忽略的 `config/local.toml` 或环境变量。配置样例只保存环境变量名，不保存密钥。
