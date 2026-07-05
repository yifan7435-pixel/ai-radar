# agents-radar demo

> 信息雷达 · AI 生态日报降级版

基于 [agents-radar](https://github.com/duanyytop/agents-radar) 的保真降级实现。
从 3 个公开 API 抓取 AI 生态数据，自动去重、打分，生成 Top 5 推荐。

## 数据源

| 来源 | 方式 | 获取内容 |
|------|------|---------|
| **Hacker News** | Algolia API | AI 相关热门故事，6 个关键词并行查询，取前 30 |
| **GitHub** | Search API | AI 主题仓库（5 个主题），取前 30 |
| **ArXiv** | API | cs.AI/cs.CL/cs.LG 最新论文，取前 20 |

## 评分机制

多维评分 + 多样性优选：
- **AI 相关度** (30%) — 关键词命中率
- **热度** (40% HN / 50% GitHub) — 点赞、星标、评论数
- **新鲜度** — 24 小时内权重最高
- **多样性加分** — 确保推荐覆盖不同来源和分类

## 使用

```bash
cd agents-radar-demo
node run-demo.mjs
```

每次运行后：
- Markdown 报告 → `digests/YYYY-MM-DD/`
- HTML 仪表盘 → `docs/index.html`

## 与原项目对比

| 特性 | 原项目 agents-radar | 本 demo |
|------|-------------------|---------|
| 数据源 | 10 个 | 3 个核心源 |
| LLM 分析 | Claude/GPT 生成摘要 | 算法打分 |
| 输出 | GitHub Issues + Markdown | Markdown + HTML |
| 部署 | GitHub Actions | 本地 node 命令 |
| 密钥 | 需要 API Key | **无需任何密钥** |