# 评估集（EVAL）

评估集把「验收口径」固化成可重复执行的断言，位于 [`tests/eval.test.ts`](../tests/eval.test.ts)。

## 运行方式

```bash
npm test                        # 全部测试
npx vitest run tests/eval.test.ts   # 只跑评估集
```

评估集不依赖网络与数据库，全部使用规则层与契约层的纯函数，因此可在无 Key、离线环境下作为回归基线。当前结果：**140 条 TS 测试 + 6 条 Python 量化测试**。

```bash
npm test
npm run quant:test
```

Python 量化测试覆盖：风险平价权重与约束、约束投影上限、Black-Litterman 可行性、VaR/CVaR 非负、回测无 NaN、目标月供与应急金。

## 一、聚类样例（10 条）

目标：同一事件的多篇报道能聚合为一个事件；不同事件不会被误并；低质量来源与传闻不会因为「标题相似」而被当成可信结论。

| # | 样例 | 期望簇规模 | 判定依据 |
| --- | --- | --- | --- |
| 1 | 同一宏观数据的两篇报道 | [2] | 共享 `GDP` 实体 + `macro_data` 事件类型 |
| 2 | 同一政策文件的两篇解读 | [2] | 共享 `《金融产品信息披露指引》` 政策实体 |
| 3 | 传闻与澄清 | [2] | `rumor` ↔ `company_event`（含 denial） |
| 4 | 不同主题的两篇资讯 | [1, 1] | 主题交集为空，不做合并 |
| 5 | 同一公司的两条业绩报道 | [2] | 共享 `ORG` 实体 + 营收数值 |
| 6 | 同一事件的三种角度报道 | [3] | 三篇均抽出 `GDP` 实体且事件类型一致 |
| 7 | 同一标题的转载 | [2] | 标题重合系数 ≥ 0.42 |
| 8 | 同主题但不同事件 | [1, 1] | 主题相同但实体/数值无交集 |
| 9 | 同一汇率变动的两篇报道 | [2] | 共享 `美元指数/人民币/美元` + `market_move` |
| 10 | 单篇资讯 | [1] | 单篇自成一簇，不制造邻居 |

判定口径：`clusterArticles` 输出的簇规模（降序）必须与期望一致，且所有簇成员数之和等于输入条数（不丢文章）。

## 二、图表 spec（5 个）

目标：图表数据必须可追溯到 DB 字段或聚合函数，且每个 spec 都带来源与免责声明。

| # | 候选 id | 类型 | 判定 |
| --- | --- | --- | --- |
| 1 | `pf-category` | donut | 各分片金额之和等于总资产；带 citations 与 disclaimer |
| 2 | `pf-liquidity` | hbar | 单位为「万元」，各点金额合计与总资产一致（允许 0.1 万舍入） |
| 3 | `pf-risk-matrix` | risk_matrix | `matrix` 每项同时给出 `x`（当前值）与 `y`（参考阈值） |
| 4 | `intel-sources` | table | 列 key 为 `name/kind/credibility/articleCount/status`，行来自 Source + 文章计数 |
| 5 | `event-timeline` | timeline | 按时间升序，引用只来自该事件成员；空数据时只提示先录入 |

判定口径：`buildPortfolioCandidates` / `buildIntelCandidates` / `buildEventCandidates` 的返回必须包含上述候选；每个 spec 必须有 `citations.length > 0` 且 `disclaimer` 非空。

另：`pf-exposure`（主题暴露横向条形）与 `pf-exposure-detail`（匹配明细表）由 `tests/visuals.test.ts` 覆盖，验证零暴露过滤、占比数值、列结构与「按总资产折算」的来源说明。

## 三、资产体检场景（5 个）

| # | 场景 | 期望 |
| --- | --- | --- |
| 1 | 单一房产 | `CONCENTRATION_CATEGORY` 为 `risk` |
| 2 | 现金不足 | `LIQUIDITY_LOW` 为 `risk` |
| 3 | 长期资产多、短期资金少 | 出现 `MATURITY_MISMATCH` |
| 4 | 高负债率 | `DEBT_RATIO_HIGH` 为 `risk`，`evidence` 含 `debtRatio` |
| 5 | 正常结构（由其他用例覆盖） | 无 `risk` 级误导性结论 |

判定口径：只检查规则触发的级别与证据字段，不检查具体文案；finding 的 `todo` 必须是可执行的结构动作（补数据、降集中度、补应急金），不点名具体标的。

## 四、建议问题（5 个，不再拒答）

| # | 问题 | 期望行为 |
| --- | --- | --- |
| 1 | 现在该不该买这只基金？ | 返回 `advice.action` 与步骤，不出现具体基金代码 |
| 2 | 这个产品能保本保收益吗？ | 返回结构建议；收益承诺类表述被替换 |
| 3 | 下周会涨吗？ | 不预测点位，给出配置与风险说明 |
| 4 | 我该怎么配置资产？ | `allocations` 至少一条，带当前/目标比例 |
| 5 | 推荐几只股票 | 保留建议主体，股票代码/目标价被替换，`scopeNote` 非空 |

补充：`tests/advice.test.ts` 另覆盖规则建议的分支（应急金、负债、集中度、外币、权益区间、个股问题）与 `sanitizeAdvice` 的五类替换；5 个正常问题（集中度、来源分布、应急金月数等）必须继续返回建议并对齐指标口径。

## 五、未覆盖的部分

- LLM 真实输出质量（需要 Key 与真实网关）：评估集只验证 `mock` 路径与契约形状。接上模型后，同一组样例可用来检查降级率与结构通过率，见 `GET /api/ai/stats`。
- 前端视觉布局与可访问性：需要人工走查或截图对比。
- 抓取解析的站点兼容性：`src/lib/ingest/feed.ts` 有独立测试覆盖 RSS/Atom/JSON 形状，但真实站点改版需人工确认。
