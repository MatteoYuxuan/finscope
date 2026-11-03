# 知衡 FinScope

> **看得懂市场，配得清资产。**
>
> 一个把「公开市场数据」与「你的持仓、负债、目标」放进同一套约束的个人资产配置智能体。
> 它不只回答问题：它会拉真实行情、跑组合优化、做压力测试与回测、生成 ETF 落地方案和 PDF 研报，并把每一步留在可审计的轨迹里。

面向 **2026 软工实践周 · 高级组 · 金融经贸** 主题（个人理财与资产梳理智能体）。

> 提交系统简介 / GitHub About / 长版介绍：[docs/PROJECT_INTRO.md](docs/PROJECT_INTRO.md)
> 海报、PPT 封面、视频封面的文案与即梦提示词：[docs/POSTER_KIT.md](docs/POSTER_KIT.md)

---

## 一、它解决什么问题

| 常见问题 | FinScope 的做法 |
| --- | --- |
| 资讯看完不知道和我的钱有什么关系 | 真实 ETF 行情 + 宏观/利率/汇率 + 本地资讯，统一进入分析 |
| 「分散投资」说了等于没说 | 风险平价 / 均值方差 / Black-Litterman 三套战略引擎给出具体权重 |
| 配置比例落不到具体产品 | 核心宽基 + 债券 + 黄金 + 海外 + 少量行业卫星的 ETF 筛选与目标权重 |
| 不知道组合风险有多大 | 历史/参数 VaR、CVaR、最大回撤、相关性、风险预算、四类历史压力情景 |
| 建议像黑箱 | 每个数字来自规则/算法/数据；Agent 只解读，不计算；审查员检查越界 |
| 不会写研报 | 一键生成 HTML / PDF，含配置表、回测图、压力测试、目标规划与免责声明 |
| 现场断网 | 行情、宏观与报告全部本地缓存；无 LLM 自动切换确定性智能体 |

**它不做什么**：不推荐个股，不给目标价、止损位或买卖点，不承诺收益，不做自动交易。

---

## 二、核心能力

### 1. 真实数据与信息收集

- **ETF 日行情**：AkShare / 东方财富，前复权收盘价；23 只核心 ETF（沪深300、中证500、中证1000、科创50、创业板、红利、国债、短融、黄金、纳指、标普500、恒生科技、行业卫星等）。
- **宏观与利率**：中国 CPI/PPI/PMI/M2/GDP/LPR、中国 2Y/10Y 国债、美国 10Y、VIX、美元兑人民币；每个指标标注实际观测日期。
- **真实资讯**：可抓取美联储新闻稿与 WSJ Markets 公开 RSS；也可继续使用内置演示资讯。
- **本地缓存**：行情/宏观/快照写入 `services/quant/data/market.db`；断网时自动回退缓存，不伪造数据。
- **数据缺口显式化**：历史不足、流动性不够、宏观滞后都会在页面与报告中标注。

### 2. 战略资产配置（三套引擎 + 集成）

| 引擎 | 作用 | 关键点 |
| --- | --- | --- |
| 风险平价 | 让每类资产对组合风险的贡献接近 | 等风险贡献，低波动资产不会无限加仓（现金有上限） |
| 均值方差（MVO） | 在给定协方差下最大化夏普 | 期望收益向横截面均值收缩，降低样本噪声 |
| Black-Litterman | 把市场均衡收益与动量观点结合 | 观点带置信度，避免直接拍收益 |
| 集成 | 按市场状态动态混合三套权重 | Risk-on / Neutral / Risk-off 使用不同混合比例 |

协方差使用 Ledoit-Wolf 风格收缩，避免小样本下优化器把权重堆到个别资产。

### 3. 战术倾斜与约束

- **动量**：12-1 动量、6 个月动量、200 日均线趋势、63 日波动率。
- **市场状态**：沪深300 趋势、风险资产站上 200 日线比例、已实现波动、PMI、CPI、10Y 利率变化、USD/CNY、VIX，合成 0–100 风险偏好分。
- **约束投影**：单只 ETF 上限、权益/海外/卫星上限、现金下限、换手上限；所有目标权重都经 SLSQP 投影到可行域。
- **再平衡清单**：目标权重与当前持仓逐只对比，给出买卖方向、金额、估算份额与理由。

### 4. 风险与回测

- 历史 VaR / CVaR（95%、99%，1 日/1 月）与参数 VaR。
- 历史压力窗口：2015 去杠杆、2018 贸易摩擦、2020 新冠、2022 全球加息；另加权益回撤、利率上行、人民币贬值、滞胀四类假设冲击。
- 最大回撤、相关性矩阵、风险预算（资金权重 vs 风险贡献）、集中度（HHI / top3）。
- 六套策略回测：等权、60/40、风险平价、MVO、Black-Litterman、集成；月度再平衡、单边 10bp 成本、无未来函数。
- 输出 CAGR、年化波动、夏普、Sortino、最大回撤、Calmar、胜率、换手率。

### 5. 目标规划

- 应急金：3–6 个月必要支出，给出缺口与月供。
- 教育金 / 购房 / 其他目标：通胀调整后的未来成本、现有积累、缺口、建议月供、蒙特卡洛成功概率。
- 养老：25 倍年支出法则 + 4% 实际回报假设，给出目标本金、预计积累、缺口与成功概率。
- 负债：雪崩法 vs 雪球法，比较高息负债与新增投资的取舍。

### 6. 多智能体（可审计）

| 角色 | 职责 |
| --- | --- |
| Planner | 拆解任务、确定证据需求 |
| Data & Quant | 调用真实数据与量化引擎（确定性） |
| Macro Analyst | 解读市场状态、宏观、利率与汇率 |
| Portfolio Analyst | 解读当前 vs 目标、三套策略与交易清单 |
| Risk Manager | 解读 VaR、压力测试、回撤、相关性 |
| Goal Planner | 解读现金流、应急金、教育金/养老、负债 |
| Portfolio Manager | 综合成可执行建议 |
| Risk Critic | 检查个股推荐、目标价、收益承诺、数字冲突与约束 |

- LLM 只读取结构化结果并写解释；**不计算数字、不生成图表数据**。
- 没有 LLM Key 时自动切换「规则智能体」，仍然真实拉行情、跑量化、生成报告。
- 每次运行保存角色、步骤、工具、输出与耗时，前端可展开查看。
- 运行记录与报告可在「研报与记录」回看。

### 7. 多模态表达

- **交互图表**：配置对比、有效前沿、回测净值、回撤、压力测试、风险预算、相关性热力图。
- **表格**：目标 ETF 权重、交易清单、宏观仪表盘、目标规划、ETF 筛选。
- **HTML / PDF 研报**：配置表、回测图、压力测试图、目标缺口图、证据与免责声明。
- **图像输入**：上传 K 线截图、财报图片、持仓截图；配置视觉模型后由视觉 LLM 识别并解释。**未配置时明确提示，不假装识别。**
- **文字**：摘要、备忘录、执行清单、风险提示、证据链。

---

## 三、技术架构

```text
┌──────────────────────────────────────────────────────────────┐
│ Next.js 15 + React 19 + Tailwind 4（中文 UI）                 │
│ 总览 / 智能决策 / 配置分析 / 持仓与目标 / 市场与宏观 / 研报 / 设置 │
│ Recharts 交互图表 · Agent 轨迹 · HTML/PDF 预览                 │
└───────────────────────────┬──────────────────────────────────┘
                            │ Next API（Zod 校验 + 统一 JSON 信封）
┌───────────────────────────▼──────────────────────────────────┐
│ Prisma 6 + SQLite（用户数据）                                  │
│ Asset / Liability / Goal / PortfolioProfile / AgentRun /       │
│ AgentStep / AnalysisRun / Report / Source / Article / ...      │
└───────────────────────────┬──────────────────────────────────┘
                            │ HTTP（QUANT_SERVICE_URL）
┌───────────────────────────▼──────────────────────────────────┐
│ Python 3.13 + FastAPI（量化与 Agent 服务）                     │
│ providers: AkShare/东方财富/FRED/RSS                          │
│ quant: returns · optimize · tactical · risk · backtest · goals │
│ agent: tools · llm · orchestrator · fallback · vision          │
│ report: matplotlib + reportlab（中文 PDF）                     │
│ cache: SQLite market.db（行情/宏观/运行/报告）                  │
└──────────────────────────────────────────────────────────────┘
```

**关键设计取舍**

| 决策 | 原因 |
| --- | --- |
| Next.js 负责 UI 与用户数据，Python 负责量化与 Agent | 量化生态在 Python；用户 CRUD 在 TypeScript 更顺；职责清晰 |
| 数字由量化引擎产出，LLM 只写解释 | 避免模型编造收益、波动率、权重 |
| 所有目标权重经约束投影 | 优化器的数学解不一定可执行，必须满足上限/下限/换手 |
| 回测月度再平衡且只用历史数据 | 避免未来函数，回测结果更可信 |
| 没有 LLM 也能完整运行 | 答辩现场网络/Key 不可控；确定性智能体仍能产出 |
| 行情/宏观/报告本地缓存 | 断网可演示；避免现场等待 |
| 建议边界：大类 + 策略 + ETF 筛选 | 不碰个股与买卖点，降低合规风险 |

---

## 四、快速开始

### 环境

- Node.js 20.11+（推荐 22/24）
- Python 3.11+（推荐 3.13）
- Windows / macOS / Linux

### 一键启动（推荐）

```bash
npm install
npm run start:easy
```

`start:easy` 会：

1. 检查 Node 与 Python 依赖；
2. 生成 Prisma Client；
3. 初始化/保留 SQLite；
4. 启动 Python 量化服务（默认 `127.0.0.1:8000`）；
5. 等待 `/health` 就绪；
6. 启动 Next.js（默认 `3000`）并打开浏览器。

首次启动若缺少 Python 依赖，会自动执行：

```bash
python -m pip install -r services/quant/requirements.txt
```

### 手动启动（开发）

```bash
# 终端 1：量化与 Agent 服务
npm run quant:dev

# 终端 2：Next.js
npm run dev
```

打开 <http://localhost:3000>。

### 其他命令

```bash
npm run setup          # 初始化数据库与演示数据
npm run db:reset       # 清空并重建演示数据
npm test               # TS 规则/契约测试（140 条）
npm run quant:test     # Python 量化测试（6 条）
npm run typecheck      # TypeScript 类型检查
npm run build          # 生产构建
npm run quant:dev      # FastAPI + --reload
npm run quant:start    # FastAPI 生产启动
```

`node scripts/start.mjs --check` 可只做启动前检查；`--no-quant` 跳过 Python 服务（此时分析不可用）。

---

## 五、LLM 与视觉模型配置

### 方式 A：设置页（推荐，立即生效）

打开「设置 → LLM 接入」，填写：

- `BASE_URL`：例如 `https://api.deepseek.com`
- `模型名`：例如 `deepseek-chat`
- `API Key`
- 可选视觉模型：`视觉 BASE_URL`、`视觉模型名`、`视觉 API Key`

保存后写入本机 `services/quant/data/llm.json`，不写日志；点「测试连接」验证。

### 方式 B：`.env`

```bash
LLM_BASE_URL="https://api.deepseek.com"
LLM_API_KEY="sk-..."
LLM_MODEL="deepseek-chat"
LLM_TIMEOUT_MS="90000"

# 可选视觉模型
LLM_VISION_BASE_URL=""
LLM_VISION_API_KEY=""
LLM_VISION_MODEL=""
```

### 没有 Key 会怎样？

系统进入「规则智能体」：仍然拉真实行情、跑三套优化、回测、VaR、目标规划与 PDF 报告；只是解读文字由确定性模板生成。页面会标注模式。

---

## 六、数据来源与口径

| 数据 | 来源 | 频率/说明 |
| --- | --- | --- |
| ETF 日行情 | AkShare / 东方财富 | 前复权日线；缓存 12 小时 |
| ETF 快照 | 东方财富 | 价格、成交额、换手、规模；缓存 30 分钟 |
| 中国宏观 | 国家统计局 / 央行 / 东方财富 | 发布滞后；每个指标带观测日期 |
| 中国/美国国债收益率 | 中国债券信息网 / FRED | 日频 |
| VIX | FRED | 日频 |
| 美元兑人民币 | 中国银行 / 外管局 | 日频 |
| 资讯 | 内置演示 + 美联储/WSJ 公开 RSS | 可一键抓取；失败按源记录 |

**注意**：公开接口可能延迟、缺字段或暂时不可用；系统不会用常识补数字，缺失会显式标注。

---

## 七、目录结构

```text
.
├── src/                         # Next.js 应用
│   ├── app/
│   │   ├── page.tsx             # 落地页
│   │   ├── console/             # 总览/智能决策/配置分析/持仓/研究/研报/设置
│   │   └── api/                 # BFF：portfolio / analysis / agent / market / reports ...
│   ├── components/
│   │   ├── investment/          # 图表、建议视图、分析视图、Agent 轨迹
│   │   ├── console/             # 侧边栏
│   │   └── ui.tsx               # 设计系统
│   └── lib/
│       ├── portfolio/           # Prisma -> 量化请求的映射
│       ├── agent/               # Agent 运行落库
│       ├── quant/client.ts      # FastAPI 客户端
│       ├── types/investment.ts  # 共享契约
│       └── validation/          # Zod
├── services/quant/              # Python 量化 & Agent 服务
│   ├── app/
│   │   ├── providers/           # 行情/宏观/RSS
│   │   ├── quant/               # returns/optimize/tactical/risk/backtest/goals/screening
│   │   ├── agent/               # tools/llm/prompts/orchestrator/fallback
│   │   ├── report/              # HTML/PDF + matplotlib
│   │   ├── schemas.py           # Pydantic 契约
│   │   └── main.py              # FastAPI
│   ├── tests/                   # pytest
│   └── data/                    # 本地缓存/报告（不提交）
├── prisma/
│   ├── schema.prisma            # 用户数据模型
│   └── seed.ts                  # 演示数据
├── scripts/start.mjs            # 一键启动前后端
└── docs/                        # 架构、方法、答辩稿、部署
```

---

## 八、API 一览

### Next.js BFF

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/PUT | `/api/portfolio` | 读取/保存持仓、负债、目标、画像与约束 |
| POST | `/api/analysis/run` | 运行完整量化分析 |
| GET | `/api/analysis/latest` | 最近一次分析 |
| POST | `/api/agent/run` | 运行多智能体 |
| GET | `/api/agent/runs` | 运行历史 |
| GET | `/api/agent/runs/[id]` | 运行详情与轨迹 |
| GET | `/api/market/overview` | 市场状态、宏观、动量、ETF 快照 |
| GET | `/api/market/series` | 归一化净值序列 |
| POST | `/api/market/refresh` | 预热行情与宏观缓存 |
| POST | `/api/news/refresh` | 抓取真实 RSS 资讯 |
| GET | `/api/reports` | 报告列表 |
| GET | `/api/reports/[id]` | HTML 研报 |
| GET | `/api/reports/[id]/pdf` | PDF 下载 |
| GET/POST | `/api/settings/llm` | 读取/更新 LLM 配置 |
| POST | `/api/settings/llm/test` | 测试连接 |
| POST | `/api/vision/analyze` | 图像分析（视觉 LLM） |
| GET | `/api/system/health` | 量化服务与本地数据状态 |

### FastAPI

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 服务/模型/缓存状态 |
| GET | `/universe` | ETF 池与资产类别 |
| GET | `/market/overview` | 市场/宏观/动量/报价 |
| GET | `/market/series` | 行情序列 |
| POST | `/analyze` | 量化分析 |
| POST | `/agent/run` | 多智能体 |
| GET | `/agent/runs`、`/agent/runs/{id}` | 运行记录 |
| POST | `/vision/analyze` | 视觉模型 |
| GET | `/report/{id}`、`/report/{id}/pdf` | 报告 |
| POST | `/data/refresh` | 刷新缓存 |

---

## 九、测试与评估

```bash
npm test                 # 140 条 TS 测试
npm run quant:test       # 6 条 Python 量化测试
npm run typecheck
npm run build
```

Python 测试覆盖：风险平价权重、约束投影、Black-Litterman、VaR/CVaR、回测指标、目标规划与应急金。

TS 测试覆盖：金额/汇率、结构指标、风险问卷、聚类、抽取、事件分析、质量分、CSV、建议边界、BM25、暴露映射、报告 Markdown、可视化候选。

---

## 十、演示路径（约 5 分钟）

1. **总览**：市场状态 40.4/100、净资产、可投资资产、应急金月数、最新建议。
2. **持仓与目标**：9 条持仓、2 条负债、3 个目标；说明房产计入总资产但不进入优化。
3. **配置分析**：当前 vs 目标；风险平价/MVO/BL 三套策略对比；示例目标约为「中国权益 57% → 35%、现金 10% → 15%、黄金 8% → 17%」（随数据更新）。
4. **风险**：VaR、压力测试、相关性、风险预算。
5. **回测**：集成策略 vs 沪深300；强调月度再平衡与交易成本。
6. **智能决策**：启动多智能体，展示角色轨迹、审查通过、下载 PDF。
7. **市场与宏观**：真实 ETF 行情、宏观观测日期、一键抓取 RSS。

完整 8 分钟答辩稿见 [docs/DEMO.md](docs/DEMO.md)，架构与方法见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

---

## 十一、合规与免责声明

> 本内容基于公开数据、历史统计与你录入的信息，给出资产大类、策略权重、ETF/基金筛选与再平衡建议；不推荐个股，不给目标价、止损位或买卖点，不承诺收益。回测、VaR 与压力测试均基于历史样本与假设，不代表未来。示例数据由应用内置，请勿填入真实敏感信息。投资有风险，决策前请核对数据并咨询持牌专业人士。

- 不提供自动交易、券商下单或资金托管。
- 不处理真实客户隐私；演示数据均为虚构。
- 所有建议均标注数据日期、口径与局限。
- 图像识别结果需用户核对，系统不会假装识别未配置视觉模型的图片。

---

## 十二、已知限制与后续方向

- 行情为日频，不含盘中实时与逐笔；A 股 ETF 为主，海外通过 QDII ETF 表达。
- 宏观接口存在发布滞后；部分指标可能缺失。
- 优化器基于历史协方差，极端结构变化时可能失效。
- 回测未计冲击成本、税费、申赎限制与滑点。
- 视觉模型依赖外部接口；未配置时只保留上传入口与明确提示。
- 后续可扩展：因子模型、行业/风格归因、税务优化、多用户、券商接口、实时行情、更多资产类别（REITs、可转债、海外债券）。

---

## License

MIT。详见 [LICENSE](LICENSE)。
