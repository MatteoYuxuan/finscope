import { describe, expect, it } from "vitest";
import { clusterArticles } from "@/lib/rules/cluster";
import type { ClusterInput } from "@/lib/rules/cluster";
import { runCheckup } from "@/lib/rules/checkup";
import { extractArticle } from "@/lib/rules/extract";
import { computePortfolioMetrics, liabilityMix } from "@/lib/rules/metrics";
import { buildEventCandidates, buildIntelCandidates, buildPortfolioCandidates } from "@/lib/visuals/catalog";
import { buildRuleAdvice } from "@/lib/rules/advice";
import { sanitizeAdvice } from "@/lib/llm/advice-scope";
import type { AssetLike, LiabilityLike, TopicKind } from "@/lib/types/domain";

/**
 * 评估集：把验收口径固化成可重复执行的断言。
 * 这些用例不依赖网络与数据库，只验证规则层与契约层的稳定性。
 */

const NOW = Date.now();
const hoursAgo = (hours: number) => new Date(NOW - hours * 3600_000);

function clusterInput(item: {
  title: string;
  summary: string;
  hours: number;
  source?: string;
  topic?: { slug: string; name: string; kind: TopicKind };
}): ClusterInput {
  // 生产管道入库时会写入规则抽取结果，聚类实体规则依赖这些字段；
  // 评估集必须走同一路径，否则只能退回纯文本相似度。
  const extraction = extractArticle({ title: item.title, summary: item.summary });
  return {
    title: item.title,
    summary: item.summary,
    publishedAt: hoursAgo(item.hours),
    sourceId: item.source ?? "s-demo",
    sourceName: item.source ?? "示例来源",
    sourceCredibility: 4,
    topics: item.topic ? [{ ...item.topic, score: 1 }] : [],
    entities: extraction.entities,
    eventType: extraction.eventType,
    claims: extraction.claims,
  };
}

const MACRO = { slug: "macro-cn", name: "中国宏观", kind: "macro" as TopicKind };
const POLICY = { slug: "policy-reg", name: "金融监管", kind: "policy" as TopicKind };
const COMPANY = { slug: "company-hengqi", name: "恒启科技", kind: "company" as TopicKind };
const SEMI = { slug: "industry-semi", name: "半导体", kind: "industry" as TopicKind };
const NEW_ENERGY = { slug: "industry-newenergy", name: "新能源", kind: "industry" as TopicKind };
const FX = { slug: "fx-usdcny", name: "人民币汇率", kind: "fx" as TopicKind };

/** 10 条聚类样例：每个样例给一组文章与期望的簇规模（降序） */
const CLUSTER_CASES: { name: string; items: ClusterInput[]; sizes: number[] }[] = [
  {
    name: "同一宏观数据的两篇报道合并",
    sizes: [2],
    items: [
      clusterInput({ title: "统计局：三季度 GDP 同比增长 4.8%，服务业贡献提升", summary: "三季度 GDP 同比增长 4.8%，服务业增加值同比增长 5.2%。", hours: 3, source: "宏观观察站", topic: MACRO }),
      clusterInput({ title: "统计局解读三季度 GDP 数据：服务业贡献提升", summary: "统计局解读三季度 GDP 数据，服务业贡献提升、高技术制造业投资保持增长。", hours: 2, source: "经济参考速递", topic: MACRO }),
    ],
  },
  {
    name: "同一政策文件的两篇解读合并",
    sizes: [2],
    items: [
      clusterInput({ title: "《金融产品信息披露指引》征求意见：费用与风险等级需明示", summary: "《金融产品信息披露指引》开始征求意见，要求销售环节明示费用与风险等级。", hours: 5, source: "监管政策发布", topic: POLICY }),
      clusterInput({ title: "《金融产品信息披露指引》过渡期或为 12 个月", summary: "业内人士称《金融产品信息披露指引》过渡期或为 12 个月。", hours: 4, source: "监管观察周报", topic: POLICY }),
    ],
  },
  {
    name: "传闻与澄清报道合并为同一事件",
    sizes: [2],
    items: [
      clusterInput({ title: "传闻：恒启科技或获 12 亿元订单，内部人士称很快公布", summary: "有传闻称恒启科技或获 12 亿元订单，消息未获公司确认。", hours: 2, source: "市井财经爆料", topic: COMPANY }),
      clusterInput({ title: "恒启科技澄清：未获 12 亿元订单，相关传闻不实", summary: "恒启科技发布澄清公告，称未获 12 亿元订单，相关传闻不实。", hours: 1, source: "公司公告聚合", topic: COMPANY }),
    ],
  },
  {
    name: "不同主题的两篇资讯保持独立",
    sizes: [1, 1],
    items: [
      clusterInput({ title: "原油价格回落，化工品成本压力缓解", summary: "原油价格回落，化工品成本压力有所缓解。", hours: 2, source: "行业前沿简报", topic: { slug: "commodity-oil", name: "原油与大宗", kind: "commodity" } }),
      clusterInput({ title: "云枢半导体发布新一代刻蚀设备", summary: "云枢半导体发布新一代刻蚀设备，称已进入客户验证阶段。", hours: 2, source: "行业前沿简报", topic: SEMI }),
    ],
  },
  {
    name: "同一公司的两条业绩报道合并",
    sizes: [2],
    items: [
      clusterInput({ title: "云枢半导体：三季度营收同比增长 32%", summary: "云枢半导体披露三季度营收同比增长 32%，毛利率提升。", hours: 4, source: "公司公告聚合", topic: SEMI }),
      clusterInput({ title: "云枢半导体发布三季报：营收同比增长 32%", summary: "云枢半导体发布三季报，营收同比增长 32%，研发投入继续增加。", hours: 3, source: "海外财经连线", topic: SEMI }),
    ],
  },
  {
    name: "同一事件的三种角度报道合并",
    sizes: [3],
    items: [
      clusterInput({ title: "统计局：三季度 GDP 同比增长 4.8%", summary: "统计局发布三季度 GDP 数据，同比增长 4.8%。", hours: 6, source: "宏观观察站", topic: MACRO }),
      clusterInput({ title: "三季度 GDP 数据发布：服务业贡献提升", summary: "三季度 GDP 数据发布，统计局称服务业贡献提升。", hours: 5, source: "经济参考速递", topic: MACRO }),
      clusterInput({ title: "统计局解读 GDP 数据：三个结构性变化", summary: "统计局解读三季度 GDP 数据，提到三个结构性变化。", hours: 4, source: "政策快讯", topic: MACRO }),
    ],
  },
  {
    name: "同一标题的转载合并",
    sizes: [2],
    items: [
      clusterInput({ title: "美联储维持利率不变，暗示年内或降息", summary: "美联储维持利率不变，声明暗示年内可能降息。", hours: 8, source: "海外财经连线", topic: { slug: "macro-rate", name: "利率与货币政策", kind: "macro" } }),
      clusterInput({ title: "美联储维持利率不变，暗示年内或降息", summary: "美联储维持利率不变，声明暗示年内可能降息。", hours: 7, source: "经济参考速递", topic: { slug: "macro-rate", name: "利率与货币政策", kind: "macro" } }),
    ],
  },
  {
    name: "同主题但不同事件保持独立",
    sizes: [1, 1],
    items: [
      clusterInput({ title: "光伏组件排产环比回升", summary: "调研显示光伏组件排产环比回升，库存下降。", hours: 2, source: "行业前沿简报", topic: NEW_ENERGY }),
      clusterInput({ title: "新能源车销量创新高，渗透率继续提升", summary: "新能源车销量创新高，渗透率继续提升。", hours: 1, source: "行业前沿简报", topic: NEW_ENERGY }),
    ],
  },
  {
    name: "同一汇率变动的两篇报道合并",
    sizes: [2],
    items: [
      clusterInput({ title: "人民币兑美元升破 7.10，美元指数走弱", summary: "人民币兑美元升破 7.10，美元指数同步走弱。", hours: 3, source: "跨境汇率快讯", topic: FX }),
      clusterInput({ title: "美元走弱，人民币汇率升至 7.10 附近", summary: "美元指数走弱，人民币汇率升至 7.10 附近。", hours: 2, source: "经济参考速递", topic: FX }),
    ],
  },
  {
    name: "单篇资讯自成一簇",
    sizes: [1],
    items: [clusterInput({ title: "某新能源车企发布新车型，续航提升至 800 公里", summary: "车企发布新车型，官方称续航提升至 800 公里。", hours: 1, source: "行业前沿简报", topic: NEW_ENERGY })],
  },
];

describe("评估集：10 条资讯聚类样例", () => {
  for (const testCase of CLUSTER_CASES) {
    it(testCase.name, () => {
      const clusters = clusterArticles(testCase.items);
      const sizes = clusters.map((cluster) => cluster.articleCount).sort((a, b) => b - a);
      expect(sizes).toEqual(testCase.sizes);
      const memberCount = clusters.reduce((sum, cluster) => sum + cluster.articleCount, 0);
      expect(memberCount).toBe(testCase.items.length);
    });
  }
});

const portfolioAssets: AssetLike[] = [
  { name: "工资卡活期", category: "CASH", currency: "CNY", amount: 20000, liquidity: "HIGH" },
  { name: "一年期定存", category: "DEPOSIT", currency: "CNY", amount: 50000, maturityMonths: 12, liquidity: "MEDIUM" },
  { name: "沪深300指数基金", category: "STOCK", currency: "CNY", amount: 60000, industry: "宽基指数" },
  { name: "美股科技ETF", category: "FUND", currency: "USD", amount: 5000, industry: "科技", maturityMonths: 60 },
  { name: "自住房产", category: "REAL_ESTATE", currency: "CNY", amount: 900000, maturityMonths: 120 },
];
const portfolioLiabilities: LiabilityLike[] = [
  { name: "房贷", category: "MORTGAGE", currency: "CNY", amount: 500000, interestRate: 4.2, monthlyPayment: 3200, remainingMonths: 240 },
];
const portfolioMetrics = computePortfolioMetrics({ assets: portfolioAssets, liabilities: portfolioLiabilities, monthlySpend: 8000 });
const portfolioCandidates = buildPortfolioCandidates({
  metrics: portfolioMetrics,
  liabilityMix: liabilityMix(portfolioLiabilities),
  findings: runCheckup(portfolioMetrics, null).findings,
});

describe("评估集：5 个图表 spec 样例", () => {
  it("类别占比环图：数值之和等于总资产，带来源与免责声明", () => {
    const spec = portfolioCandidates.find((item) => item.id === "pf-category")?.spec;
    expect(spec?.type).toBe("donut");
    const sum = (spec?.points ?? []).reduce((total, point) => total + point.value, 0);
    expect(sum).toBeCloseTo(portfolioMetrics.totalAssetsCny, 2);
    expect(spec?.citations.length).toBeGreaterThan(0);
    expect(spec?.disclaimer).toBeTruthy();
  });

  it("流动性分层：金额合计等于总资产，单位为万元", () => {
    const spec = portfolioCandidates.find((item) => item.id === "pf-liquidity")?.spec;
    expect(spec?.type).toBe("hbar");
    expect(spec?.unit).toBe("万元");
    const points = spec?.points ?? [];
    // 每点按 0.1 万取整，允许 1000 元/点的舍入误差
    const sumCny = points.reduce((total, point) => total + point.value * 10000, 0);
    expect(Math.abs(sumCny - portfolioMetrics.totalAssetsCny)).toBeLessThanOrEqual(1000 * points.length);
  });

  it("风险矩阵：每项同时给出当前值与参考阈值", () => {
    const spec = portfolioCandidates.find((item) => item.id === "pf-risk-matrix")?.spec;
    expect(spec?.type).toBe("risk_matrix");
    expect(spec?.matrix?.length).toBeGreaterThan(0);
    for (const point of spec?.matrix ?? []) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeGreaterThan(0);
    }
  });

  it("来源对照表：列与数据来自 Source / Article 聚合", () => {
    const intel = buildIntelCandidates({
      events: [{ id: "e1", title: "事件", eventType: "macro_data", articleCount: 3, sourceCount: 2, credibility: 70, lastSeenAt: new Date().toISOString() }],
      topics: [{ slug: "macro-cn", name: "中国宏观", articleCount: 3 }],
      sources: [{ name: "宏观观察站", kind: "RSS", credibility: 4, articleCount: 3, enabled: true, lastStatus: "ok" }],
    });
    const spec = intel.find((item) => item.id === "intel-sources")?.spec;
    const keys = spec?.table?.columns.map((column) => column.key) ?? [];
    expect(keys).toEqual(expect.arrayContaining(["name", "kind", "credibility", "articleCount", "status"]));
    expect(spec?.table?.rows.length).toBe(1);
    expect(spec?.source).toContain("Source");
  });

  it("事件时间线：按时间升序且引用只来自该事件", () => {
    const event = buildEventCandidates({
      eventId: "e1",
      eventTitle: "宏观数据发布",
      timeline: [
        { at: "2026-11-01T10:00:00.000Z", label: "数据发布", articleId: "a1" },
        { at: "2026-11-01T12:00:00.000Z", label: "机构点评", articleId: "a2" },
      ],
      keyNumbers: [],
      articles: [
        { id: "a1", title: "发布", sourceName: "宏观观察站", credibility: 4, qualityScore: 80, publishedAt: "2026-11-01T10:00:00.000Z", url: "https://example.com/a1" },
        { id: "a2", title: "点评", sourceName: "经济参考速递", credibility: 3, qualityScore: 70, publishedAt: "2026-11-01T12:00:00.000Z", url: null },
      ],
    });
    const spec = event.find((item) => item.id === "event-timeline")?.spec;
    const times = (spec?.timeline ?? []).map((item) => Date.parse(item.at));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(spec?.citations[0]).toMatchObject({ type: "event", id: "e1" });
  });
});

function metricsOf(assets: AssetLike[], liabilities: LiabilityLike[] = [], monthlySpend?: number) {
  return computePortfolioMetrics({ assets, liabilities, monthlySpend });
}

describe("评估集：5 份资产体检场景", () => {
  it("空数据：只提示先录入", () => {
    const checkup = runCheckup(metricsOf([]), null);
    expect(checkup.findings.map((item) => item.id)).toEqual(["NO_DATA"]);
  });

  it("单一房产：类别集中度为 risk", () => {
    const checkup = runCheckup(metricsOf([{ name: "自住房产", category: "REAL_ESTATE", currency: "CNY", amount: 1_000_000 }]), null);
    expect(checkup.findings.find((item) => item.id === "CONCENTRATION_CATEGORY")?.level).toBe("risk");
  });

  it("现金不足：应急金覆盖不足为 risk", () => {
    const checkup = runCheckup(
      metricsOf([{ name: "活期", category: "CASH", currency: "CNY", amount: 5000, liquidity: "HIGH" }], [], 8000),
      null,
    );
    expect(checkup.findings.find((item) => item.id === "LIQUIDITY_LOW")?.level).toBe("risk");
  });

  it("长期资产多、短期资金少：触发期限错配提示", () => {
    const checkup = runCheckup(
      metricsOf([
        { name: "活期", category: "CASH", currency: "CNY", amount: 1000, liquidity: "HIGH" },
        { name: "长期债基", category: "BOND", currency: "CNY", amount: 200000, maturityMonths: 120, liquidity: "LOW" },
      ], [], 5000),
      null,
    );
    expect(checkup.findings.map((item) => item.id)).toContain("MATURITY_MISMATCH");
  });

  it("高负债率：负债率提示为 risk，并给出证据", () => {
    const checkup = runCheckup(
      metricsOf([{ name: "活期", category: "CASH", currency: "CNY", amount: 100000, liquidity: "HIGH" }], [
        { name: "消费贷", category: "CONSUMER_LOAN", currency: "CNY", amount: 900000, interestRate: 8, monthlyPayment: 12000, remainingMonths: 120 },
      ], 8000),
      null,
    );
    const debt = checkup.findings.find((item) => item.id === "DEBT_RATIO_HIGH");
    expect(debt?.level).toBe("risk");
    expect(debt?.evidence).toContain("debtRatio");
  });
});

const ADVICE_CASES = [
  "现在该不该买这只基金？",
  "这个产品能保本保收益吗？",
  "下周会涨吗？",
  "我该怎么配置资产？",
  "推荐几只股票",
];

function adviceMetrics() {
  return metricsOf(
    [
      { name: "活期", category: "CASH", currency: "CNY", amount: 120_000, liquidity: "HIGH" },
      { name: "自住房产", category: "REAL_ESTATE", currency: "CNY", amount: 1_500_000, maturityMonths: 240 },
      { name: "沪深300", category: "FUND", currency: "CNY", amount: 380_000, liquidity: "MEDIUM" },
      { name: "美股 ETF", category: "FUND", currency: "USD", amount: 12_000, liquidity: "MEDIUM" },
    ],
    [
      { name: "房贷", category: "MORTGAGE", currency: "CNY", amount: 900_000, interestRate: 4.2, monthlyPayment: 5200, remainingMonths: 240 },
    ],
    8000,
  );
}

describe("评估集：5 个建议问题（不再拦截）", () => {
  for (const question of ADVICE_CASES) {
    it(`对「${question}」给出结构建议`, () => {
      const metrics = adviceMetrics();
      const checkup = runCheckup(metrics, "BALANCED");
      const advice = buildRuleAdvice({
        question,
        metrics,
        findings: checkup.findings,
        riskBand: "BALANCED",
        riskScore: 53,
        monthlySpend: 8000,
      });
      expect(advice.action).toBeTruthy();
      expect(advice.summary.length).toBeGreaterThan(8);
      expect(advice.steps.length).toBeGreaterThan(0);
      expect(advice.risks.length).toBeGreaterThan(0);
      expect(advice.summary).not.toContain("无法回答");
    });
  }

  it("配置类问题给出类别目标比例", () => {
    const metrics = adviceMetrics();
    const checkup = runCheckup(metrics, "BALANCED");
    const advice = buildRuleAdvice({
      question: "我该怎么配置资产？",
      metrics,
      findings: checkup.findings,
      riskBand: "BALANCED",
      monthlySpend: 8000,
    });
    expect(advice.allocations.length).toBeGreaterThan(0);
    for (const item of advice.allocations) {
      expect(item.currentShare).toBeGreaterThanOrEqual(0);
      expect(item.currentShare).toBeLessThanOrEqual(100);
      expect(item.targetShare).toBeGreaterThanOrEqual(0);
      expect(item.targetShare).toBeLessThanOrEqual(100);
    }
  });

  it("选股问题保留建议但收敛到结构层面", () => {
    const metrics = adviceMetrics();
    const checkup = runCheckup(metrics, "BALANCED");
    const advice = buildRuleAdvice({
      question: "推荐几只股票",
      metrics,
      findings: checkup.findings,
      riskBand: "BALANCED",
      monthlySpend: 8000,
    });
    expect(advice.scopeNote ?? "").toContain("建议范围");
    const sanitized = sanitizeAdvice({
      ...advice,
      summary: "建议买入 600519，目标价 1800 元，预计上涨 20%。",
    });
    expect(sanitized.adjusted).toBe(true);
    expect(sanitized.advice.summary).not.toContain("600519");
    expect(sanitized.advice.scopeNote ?? "").toContain("建议范围");
  });
});
