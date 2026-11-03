# 架构与方法：从数据到配置，再到可审计建议

本文说明 FinScope v2 的完整链路。核心原则只有一句：

> **数字由确定性引擎计算，模型只负责解释；任何建议都必须能回到数据、公式或约束。**

---

## 1. 总览

```text
用户录入：持仓 / 现金 / 负债 / 收入 / 目标 / 风险画像 / 约束
        │
        ▼
Next.js BFF（Prisma + Zod）
        │  POST /analyze（JSON 契约）
        ▼
Python FastAPI
        │
        ├─ providers：AkShare/东方财富 ETF、宏观、利率、汇率、RSS
        ├─ quant：收益/协方差 → 战略配置 → 战术倾斜 → 约束投影
        │           → 风险 → 回测 → 目标规划 → ETF 筛选
        ├─ agent：Planner + 4 位专家 + Portfolio Manager + Critic
        └─ report：HTML/PDF + matplotlib 图表
        │
        ▼
Next.js：配置分析 / 智能决策 / 研报 / 历史轨迹
```

### 为什么拆成两个服务？

| 层 | 负责 | 不负责 |
| --- | --- | --- |
| Next.js | UI、用户数据 CRUD、BFF、Zod 校验、报告预览 | 组合优化、回测、统计计算 |
| Python | 数据获取、量化计算、Agent 编排、报告渲染 | 用户账号、业务 CRUD |
| SQLite（Prisma） | 持仓、负债、目标、画像、运行记录 | 行情缓存 |
| SQLite（market.db） | 行情、宏观、分析/Agent 运行、报告 | 用户隐私数据 |

这样量化服务可以独立测试、独立替换；前端不需要理解 SLSQP 或协方差。

---

## 2. 数据管道

### 2.1 行情

- 标的池：23 只核心 ETF，覆盖现金、中国债券、中国权益、港股、海外、黄金、商品、行业卫星。
- 数据：`akshare.fund_etf_hist_em(symbol, adjust="qfq")`，前复权日线。
- 缓存：`price_history(code, date, open, high, low, close, volume, amount)`。
- 新鲜度：默认 12 小时；`refresh=true` 强制刷新。
- 回退：网络失败时返回缓存；无缓存则显式报错，不生成假数据。

### 2.2 宏观

- 中国：CPI、PPI、PMI、M2、GDP、LPR、社融、2Y/10Y 国债。
- 美国：10Y 国债、VIX（FRED CSV）。
- 汇率：美元兑人民币（中国银行）。
- 每个指标返回 `date`、`previous`、`change`、`source`；页面与报告标注实际观测日期。

### 2.3 资讯

- 内置演示资讯（离线可讲）。
- 真实 RSS：美联储新闻稿、WSJ Markets；`POST /api/news/refresh` 抓取、去重（source + 规范化标题哈希）、情绪/质量标签后入库。
- 资讯只用于解释背景，不直接生成买卖信号。

### 2.4 数据契约

前端 → Python 的 `AnalysisRequest`（Pydantic）：

```json
{
  "holdings": [{"code": "510300", "name": "沪深300ETF", "asset_class": "CN_EQUITY", "market_value": 300000}],
  "cash": 0,
  "liabilities": [{"name": "房贷", "balance": 900000, "rate": 4.2, "monthly_payment": 5200}],
  "goals": [{"name": "教育金", "type": "EDUCATION", "target_amount": 500000, "years": 8}],
  "profile": {"monthly_income": 30000, "monthly_expense": 15000, "risk_score": 58, "risk_band": "BALANCED"},
  "constraints": {"max_single_etf": 0.25, "max_equity": 0.75, "max_overseas": 0.3, "max_satellite": 0.2},
  "news": [],
  "include_backtest": true
}
```

---

## 3. 量化方法

### 3.1 收益与协方差

日收益：

```text
r_t = P_t / P_{t-1} - 1
```

年化期望收益：样本均值向横截面均值收缩 50%，降低噪声：

```text
mu_i = 0.5 * mean_i * 252 + 0.5 * mean_cross * 252
```

协方差使用 Ledoit-Wolf 风格收缩：

```text
S_hat = shrink * diag(S) + (1 - shrink) * S
shrink = min(max(b2 / d2, 0.2), 1)
```

其中 `b2` 是协方差估计的方差，`d2` 是样本协方差与对角目标的距离。下限 0.2 保证小样本下优化器不会把权重堆到个别资产。

### 3.2 风险平价

等风险贡献：

```text
RC_i = w_i * (Sigma w)_i / sqrt(w' Sigma w)
目标：RC_i = sigma_p / N
min_w sum_i (RC_i - sigma_p / N)^2
s.t. sum w = 1, 0 <= w_i <= cap_i
```

### 3.3 均值方差（最大夏普）

```text
max_w (w' mu - r_f) / sqrt(w' Sigma w)
s.t. sum w = 1, 0 <= w_i <= cap_i
```

### 3.4 Black-Litterman

市场均衡收益：

```text
pi = delta * Sigma * w_mkt
```

观点：

```text
P * E[R] = Q + epsilon,  epsilon ~ N(0, Omega)
Omega = diag(tau * P Sigma P' / confidence)
```

后验：

```text
E[R]_BL = pi + tau Sigma P' (P tau Sigma P' + Omega)^(-1) (Q - P pi)
```

观点来源：12-1 动量排名靠前/靠后的 ETF，收益观点取历史期望收益的保守值，置信度 0.35–0.45。

### 3.5 集成与战术倾斜

按市场状态混合：

| 状态 | 风险平价 | MVO | Black-Litterman |
| --- | ---: | ---: | ---: |
| Risk-on | 25% | 35% | 40% |
| Neutral | 40% | 30% | 30% |
| Risk-off | 55% | 20% | 25% |

战术倾斜：

```text
multiplier_i = 1 + clip(score_i / 3, -1, 1) * 0.25 * regime_multiplier
w_tactical = normalize(w_strategic * multiplier)
```

`score` 由 12-1 动量、6 个月动量、200 日均线趋势、63 日波动率合成。

### 3.6 约束投影

优化器的数学解不一定可执行。最终权重通过 SLSQP 投影：

```text
min_w ||w - w_target||^2
s.t. sum w = 1
     0 <= w_i <= max_single_etf
     class_lower <= sum_{i in class} w_i <= class_upper
```

默认大类上下限：

| 类别 | 下限 | 上限 |
| --- | ---: | ---: |
| 现金 | 3% | 15% |
| 中国债券 | 5% | 55% |
| 中国权益 | 10% | 60% |
| 港股 | 0% | 20% |
| 海外 | 0% | 25% |
| 黄金 | 0% | 20% |
| 商品 | 0% | 10% |
| 行业卫星 | 0% | 20% |

现金上限刻意压到 15%：现金是政策缓冲，不应因为波动率低而吞掉风险平价权重。

### 3.7 风险

历史 VaR：

```text
VaR_alpha = -quantile(r_port, 1 - alpha) * sqrt(horizon)
CVaR_alpha = -mean(r_port | r_port <= quantile(r_port, 1 - alpha))
```

压力测试：

- 历史窗口：2015-06-12~2015-08-26、2018-01-24~2018-12-28、2020-01-20~2020-03-23、2022-01-01~2022-10-31。
- 假设冲击：权益 -20%、利率 +100bp、人民币贬值 8%、滞胀。
- 缺失资产按 0 收益处理（不虚构收益）。

风险预算：

```text
RC_i = w_i * (Sigma w)_i / sigma_p
```

### 3.8 回测

- 月度最后一个交易日再平衡。
- 每次调仓只使用当日及之前的数据，避免未来函数。
- 单边交易成本 `cost_bps=10`。
- 组合净值按日更新，按周采样展示。
- 指标：CAGR、年化波动、Sharpe、Sortino、最大回撤、Calmar、胜率、换手率。
- 基准：沪深300ETF。

### 3.9 目标规划

未来成本：

```text
FV_cost = target * (1 + inflation)^years
```

预计积累：

```text
FV = current * (1 + r)^years + monthly * (((1 + r_m)^n - 1) / r_m)
```

建议月供：

```text
monthly = gap * r_m / ((1 + r_m)^n - 1)
```

养老：`target_corpus = future_annual_spend * 25`（4% 提取率），成功概率用蒙特卡洛（2000 次，正态月收益）。

负债：雪崩法（先高息）vs 雪球法（先小额），模拟最低还款 + 额外还款。

---

## 4. Agent 编排

```text
Planner（规划）
   │
   ├─ Data & Quant（工具调用，确定性）
   ├─ Macro Analyst（LLM 或规则）
   ├─ Portfolio Analyst
   ├─ Risk Manager
   └─ Goal Planner
          │
          ▼
   Portfolio Manager（综合叙事）
          │
          ▼
   Risk Critic（合规/一致性审查）
          │
          ▼
   Report Writer（HTML/PDF）
```

### 4.1 工具

Agent 可调用：`get_analysis_summary`、`get_allocation`、`get_risk`、`get_backtest`、`get_goals`、`get_macro`、`get_momentum`、`get_screening`、`get_portfolio`、`query_news`、`get_etf_info`。

工具只返回量化结果的视图，不重新计算，不访问外部网络。

### 4.2 LLM 的边界

- 专家 Prompt 明确：只能使用上下文数字；不得编造行情/收益/宏观；不给个股/目标价/买卖点。
- 组合经理只输出叙事字段（summary、regime_narrative、allocation_narrative 等），**不修改** allocation/trades/risk 数字。
- 审查员检查：
  - 是否出现目标价/止损位/收益承诺；
  - 目标大类权重合计是否为 1；
  - 风险提示是否 ≥2 条；
  - 是否有免责声明；
  - 数据缺失是否降低置信度。
- 审查失败：降低置信度、追加问题说明，不隐藏。

### 4.3 无 LLM 兜底

`app/agent/fallback.py` 用真实量化结果生成：
- 宏观备忘录（状态、信号、宏观指标）；
- 组合备忘录（当前 vs 目标、策略指标、换手）；
- 风险备忘录（VaR、压力、回撤）；
- 目标备忘录（现金流、应急金、目标缺口）；
- 建议（配置、ETF、动作、风险、置信度）。

因此没有 Key 也能完整演示，只是文字不如 LLM 灵活。

### 4.4 记忆与审计

- `agent_runs`：任务、状态、模式、模型、结果、报告 ID。
- `agent_steps`：序号、角色、类型、标题、详细输出、工具、耗时。
- 前端「执行轨迹」可逐条展开；历史运行可回看。
- Next 端 `AgentRun`/`AgentStep` 同步落库，报告同步写入 `Report`。

---

## 5. 报告

- HTML：内联 CSS + base64 PNG，适合浏览器预览/打印。
- PDF：ReportLab + 中文字体（`simhei.ttf`），3 页左右。
- 图表：配置对比、回测净值、压力测试、目标缺口、有效前沿。
- 内容：结论、配置表、ETF 方案、执行清单、风险、目标、证据、免责声明。
- 下载：`/api/reports/{id}/pdf`。

---

## 6. 失败模式与降级

| 场景 | 行为 |
| --- | --- |
| 无网络 | 使用本地行情/宏观缓存；无缓存则显式报错 |
| 无 LLM Key | 规则智能体；仍跑量化与报告 |
| LLM 超时/非 JSON/字段不符 | 当前角色回退规则备忘录；整体标记 fallback |
| LLM 越界 | 审查员标记问题、移除越界表述、降低置信度 |
| 某只 ETF 历史不足 | 从优化池剔除并在 warnings 标注 |
| 约束不可行 | 投影器回退到可行权重，并在 warnings 标注 |
| 回测数据不足 | 返回 `ok=false` 与原因，不伪造曲线 |
| 报告字体缺失 | HTML 仍可用；PDF 跳过并返回错误 |

---

## 7. 关键文件

| 路径 | 职责 |
| --- | --- |
| `services/quant/app/quant/engine.py` | 端到端分析编排 |
| `services/quant/app/quant/optimize.py` | 风险平价 / MVO / BL / 投影 |
| `services/quant/app/quant/risk.py` | VaR/CVaR / 压力 / 相关性 / 风险预算 |
| `services/quant/app/quant/backtest.py` | 无未来函数回测 |
| `services/quant/app/quant/goals.py` | 应急金 / 教育 / 养老 / 负债 |
| `services/quant/app/agent/orchestrator.py` | 多智能体编排 |
| `services/quant/app/agent/fallback.py` | 无 LLM 的确定性输出 |
| `services/quant/app/report/generator.py` | HTML/PDF/图表 |
| `src/app/api/*` | BFF 路由 |
| `src/lib/portfolio/service.ts` | Prisma → 量化请求 |
| `src/components/investment/*` | 图表、建议、分析、轨迹 |
