import { prisma } from "@/lib/db";
import { DEMO_SOURCES, DEMO_TOPICS } from "@/lib/demo/dataset";
import { REAL_SOURCES } from "@/lib/demo/real-sources";
import { refreshSources } from "./intel";
import { defaultSettings } from "./settings";

const DEFAULT_ASSETS = [
  { name: "沪深300ETF", category: "FUND", currency: "CNY", amount: 300000, institution: "场内 ETF", industry: "宽基指数", liquidity: "HIGH", maturityMonths: 0, assetClass: "CN_EQUITY", instrumentCode: "510300", quantity: 73600, note: "演示持仓：核心宽基" },
  { name: "中证500ETF", category: "FUND", currency: "CNY", amount: 150000, institution: "场内 ETF", industry: "宽基指数", liquidity: "HIGH", maturityMonths: 0, assetClass: "CN_EQUITY", instrumentCode: "510500", quantity: 24100, note: "演示持仓：中盘宽基" },
  { name: "红利ETF", category: "FUND", currency: "CNY", amount: 120000, institution: "场内 ETF", industry: "红利低波", liquidity: "HIGH", maturityMonths: 0, assetClass: "CN_EQUITY", instrumentCode: "510880", quantity: 40300, note: "演示持仓：价值风格" },
  { name: "国债ETF", category: "BOND", currency: "CNY", amount: 120000, institution: "场内 ETF", industry: "利率债", liquidity: "HIGH", maturityMonths: 60, assetClass: "CN_BOND", instrumentCode: "511010", quantity: 1090, note: "演示持仓：组合压舱石" },
  { name: "黄金ETF", category: "FUND", currency: "CNY", amount: 80000, institution: "场内 ETF", industry: "黄金", liquidity: "HIGH", maturityMonths: 0, assetClass: "GOLD", instrumentCode: "518880", quantity: 13500, note: "演示持仓：对冲资产" },
  { name: "纳指ETF", category: "FUND", currency: "CNY", amount: 80000, institution: "场内 ETF", industry: "海外科技", liquidity: "HIGH", maturityMonths: 0, assetClass: "US_EQUITY", instrumentCode: "513100", quantity: 51000, note: "演示持仓：海外分散" },
  { name: "半导体ETF", category: "FUND", currency: "CNY", amount: 50000, institution: "场内 ETF", industry: "半导体", liquidity: "HIGH", maturityMonths: 0, assetClass: "SATELLITE", instrumentCode: "512480", quantity: 46900, note: "演示持仓：行业卫星" },
  { name: "现金与货币基金", category: "CASH", currency: "CNY", amount: 100000, institution: "示例银行", liquidity: "HIGH", maturityMonths: 0, assetClass: "CASH", instrumentCode: "511880", quantity: 1000, note: "演示：应急金与再平衡弹药" },
  { name: "自住房产", category: "REAL_ESTATE", currency: "CNY", amount: 1800000, institution: null, industry: "房地产", liquidity: "LOW", maturityMonths: 120, assetClass: "REAL_ESTATE", instrumentCode: null, quantity: null, note: "示例估值，非真实房产；不计入可投资资产" },
];

const DEFAULT_LIABILITIES = [
  { name: "住房贷款", category: "MORTGAGE", currency: "CNY", amount: 900000, interestRate: 4.2, monthlyPayment: 5200, remainingMonths: 240, note: "演示负债：利率 4.2%" },
  { name: "消费分期", category: "CONSUMER_LOAN", currency: "CNY", amount: 15000, interestRate: 9.5, monthlyPayment: 1300, remainingMonths: 12, note: "示例：高成本负债，优先偿还" },
];

const DEFAULT_RISK_ANSWERS = [3, 2, 2, 3, 2, 3, 2, 2, 2, 2];

const DEFAULT_PROFILE = {
  id: "default",
  baseCurrency: "CNY",
  monthlyIncome: 30000,
  monthlyExpense: 15000,
  monthlyInvestable: 9800,
  currentAge: 20,
  retirementAge: 60,
  retirementAnnualSpend: 120000,
  retirementSavings: 200000,
  retirementContribution: 2000,
  riskScore: 58,
  riskBand: "BALANCED",
  horizonYears: 10,
  maxDrawdown: 0.2,
  emergencyMonths: 6,
  constraints: JSON.stringify({
    max_single_etf: 0.25,
    max_turnover: 0.35,
    min_cash: 0.03,
    max_equity: 0.75,
    max_overseas: 0.3,
    max_satellite: 0.2,
    rebalance_frequency: "quarterly",
  }),
};

const DEFAULT_GOALS = [
  { name: "应急金", type: "EMERGENCY", targetAmount: 180000, currentAmount: 100000, years: 1, monthlyContribution: 0, priority: "high", inflation: 0.02, expectedReturn: 0.02, volatility: 0.01, note: "覆盖 6 个月必要支出" },
  { name: "教育金", type: "EDUCATION", targetAmount: 500000, currentAmount: 50000, years: 8, monthlyContribution: 3000, priority: "high", inflation: 0.03, expectedReturn: 0.05, volatility: 0.1, note: "8 年后使用，按月定投" },
  { name: "养老储备", type: "RETIREMENT", targetAmount: 3000000, currentAmount: 200000, years: 40, monthlyContribution: 2000, priority: "medium", inflation: 0.025, expectedReturn: 0.05, volatility: 0.12, note: "长期目标，允许较高波动" },
];

export interface SeedResult {
  topics: number;
  sources: number;
  articlesAdded: number;
  articlesSkipped: number;
  events: number;
  assets: number;
  liabilities: number;
  riskProfile: boolean;
  goals: number;
}

/**
 * 初始化演示数据（幂等）：
 * - 主题/信息源按唯一键 upsert；
 * - 资讯按 contentHash 去重；
 * - 资产/负债/问卷仅在为空时写入，避免覆盖用户改动。
 */
export async function seedDemoData(): Promise<SeedResult> {
  for (const topic of DEMO_TOPICS) {
    await prisma.topic.upsert({
      where: { slug: topic.slug },
      create: {
        slug: topic.slug,
        name: topic.name,
        kind: topic.kind,
        keywords: JSON.stringify(topic.keywords),
        followed: topic.followed,
        color: topic.color,
        sortOrder: topic.sortOrder,
      },
      update: {
        name: topic.name,
        kind: topic.kind,
        keywords: JSON.stringify(topic.keywords),
        color: topic.color,
        sortOrder: topic.sortOrder,
      },
    });
  }

  for (const source of DEMO_SOURCES) {
    const existing = await prisma.source.findFirst({ where: { name: source.name } });
    if (existing) {
      await prisma.source.update({
        where: { id: existing.id },
        data: {
          kind: source.kind,
          url: source.url,
          credibility: source.credibility,
          topicHint: source.topicHint,
          isSample: true,
        },
      });
    } else {
      await prisma.source.create({
        data: {
          name: source.name,
          kind: source.kind,
          url: source.url,
          enabled: source.enabled,
          credibility: source.credibility,
          topicHint: source.topicHint,
          isSample: true,
        },
      });
    }
  }

  // 真实公开源默认停用：需要时在「市场情报 → 信息源」里打开，即可抓取线上 RSS。
  for (const source of REAL_SOURCES) {
    const existing = await prisma.source.findFirst({ where: { name: source.name } });
    if (!existing) {
      await prisma.source.create({
        data: {
          name: source.name,
          kind: source.kind,
          url: source.url,
          enabled: false,
          credibility: source.credibility,
          topicHint: source.topicHint,
          isSample: false,
        },
      });
    }
  }

  const refresh = await refreshSources();

  const [assetCount, liabilityCount, riskCount, goalCount] = await Promise.all([
    prisma.asset.count(),
    prisma.liability.count(),
    prisma.riskProfile.count(),
    prisma.goal.count(),
  ]);

  let assets = 0;
  if (assetCount === 0) {
    await prisma.asset.createMany({ data: DEFAULT_ASSETS });
    assets = DEFAULT_ASSETS.length;
  }

  let liabilities = 0;
  if (liabilityCount === 0) {
    await prisma.liability.createMany({ data: DEFAULT_LIABILITIES });
    liabilities = DEFAULT_LIABILITIES.length;
  }

  let riskProfile = false;
  if (riskCount === 0) {
    const total = DEFAULT_RISK_ANSWERS.reduce((acc, value) => acc + value, 0);
    const score = Math.round((total / 40) * 100);
    await prisma.riskProfile.create({
      data: {
        answers: JSON.stringify(DEFAULT_RISK_ANSWERS),
        score,
        band: score < 20 ? "CONSERVATIVE" : score < 40 ? "STEADY" : score < 60 ? "BALANCED" : score < 80 ? "GROWTH" : "AGGRESSIVE",
      },
    });
    riskProfile = true;
  }

  await prisma.portfolioProfile.upsert({
    where: { id: "default" },
    create: DEFAULT_PROFILE,
    update: {},
  });

  let goals = 0;
  if (goalCount === 0) {
    await prisma.goal.createMany({ data: DEFAULT_GOALS });
    goals = DEFAULT_GOALS.length;
  }

  const defaults = defaultSettings();
  for (const [key, value] of Object.entries(defaults)) {
    if (key === "demo.seededAt") continue;
    await prisma.setting.upsert({ where: { key }, create: { key, value }, update: {} });
  }
  await prisma.setting.upsert({
    where: { key: "demo.seededAt" },
    create: { key: "demo.seededAt", value: new Date().toISOString() },
    update: { value: new Date().toISOString() },
  });

  return {
    topics: DEMO_TOPICS.length,
    sources: DEMO_SOURCES.length,
    articlesAdded: refresh.added,
    articlesSkipped: refresh.skipped,
    events: refresh.events,
    assets,
    liabilities,
    riskProfile,
    goals,
  };
}

/** 清空业务数据，保留设置与主题配置（信息源会被清空，可重新初始化） */
export async function clearBusinessData(options: { includeTopics?: boolean } = {}): Promise<void> {
  await prisma.articleTopic.deleteMany();
  await prisma.article.deleteMany();
  await prisma.event.deleteMany();
  await prisma.source.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.liability.deleteMany();
  await prisma.riskProfile.deleteMany();
  await prisma.goal.deleteMany();
  await prisma.portfolioProfile.deleteMany();
  await prisma.analysisRun.deleteMany();
  await prisma.agentStep.deleteMany();
  await prisma.agentRun.deleteMany();
  await prisma.report.deleteMany();
  await prisma.chatMessage.deleteMany();
  await prisma.upload.deleteMany();
  if (options.includeTopics) await prisma.topic.deleteMany();
  await prisma.setting.upsert({
    where: { key: "demo.seededAt" },
    create: { key: "demo.seededAt", value: "" },
    update: { value: "" },
  });
}
