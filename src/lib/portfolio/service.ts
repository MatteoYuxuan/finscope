import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type {
  AnalysisResult,
  PortfolioAsset,
  PortfolioGoal,
  PortfolioLiability,
  PortfolioPayload,
  PortfolioProfile,
} from "@/lib/types/investment";

const DEFAULT_CONSTRAINTS: PortfolioProfile["constraints"] = {
  max_single_etf: 0.25,
  max_turnover: 0.35,
  min_cash: 0.03,
  max_equity: 0.75,
  max_overseas: 0.3,
  max_satellite: 0.2,
  rebalance_frequency: "quarterly",
};

function inferClass(assetClass: string | null, category: string): PortfolioAsset["assetClass"] {
  if (assetClass) return assetClass as PortfolioAsset["assetClass"];
  if (category === "CASH" || category === "MONEY_FUND" || category === "DEPOSIT") return "CASH";
  if (category === "BOND") return "CN_BOND";
  if (category === "STOCK" || category === "FUND") return "CN_EQUITY";
  if (category === "REAL_ESTATE") return "REAL_ESTATE";
  if (category === "INSURANCE") return "INSURANCE";
  return "OTHER";
}

function categoryOf(asset: PortfolioAsset): string {
  if (asset.category) return asset.category;
  switch (asset.assetClass) {
    case "CASH":
      return "CASH";
    case "CN_BOND":
      return "BOND";
    case "REAL_ESTATE":
      return "REAL_ESTATE";
    case "INSURANCE":
      return "INSURANCE";
    case "OTHER":
      return "OTHER";
    default:
      return "FUND";
  }
}

function parseConstraints(raw: string | null): PortfolioProfile["constraints"] {
  if (!raw) return DEFAULT_CONSTRAINTS;
  try {
    const parsed = JSON.parse(raw) as Partial<PortfolioProfile["constraints"]>;
    return { ...DEFAULT_CONSTRAINTS, ...parsed };
  } catch {
    return DEFAULT_CONSTRAINTS;
  }
}

export async function loadPortfolioPayload(): Promise<PortfolioPayload> {
  const [assets, liabilities, goals, profileRow] = await Promise.all([
    prisma.asset.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.liability.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.goal.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.portfolioProfile.findUnique({ where: { id: "default" } }),
  ]);

  const profile: PortfolioProfile = profileRow
    ? {
        baseCurrency: profileRow.baseCurrency,
        monthlyIncome: profileRow.monthlyIncome ?? 0,
        monthlyExpense: profileRow.monthlyExpense ?? 0,
        monthlyInvestable: profileRow.monthlyInvestable ?? 0,
        currentAge: profileRow.currentAge,
        retirementAge: profileRow.retirementAge,
        retirementAnnualSpend: profileRow.retirementAnnualSpend,
        retirementSavings: profileRow.retirementSavings,
        retirementContribution: profileRow.retirementContribution,
        riskScore: profileRow.riskScore,
        riskBand: profileRow.riskBand as PortfolioProfile["riskBand"],
        horizonYears: profileRow.horizonYears,
        maxDrawdown: profileRow.maxDrawdown,
        emergencyMonths: profileRow.emergencyMonths,
        constraints: parseConstraints(profileRow.constraints),
      }
    : {
        baseCurrency: "CNY",
        monthlyIncome: 0,
        monthlyExpense: 0,
        monthlyInvestable: 0,
        currentAge: null,
        retirementAge: null,
        retirementAnnualSpend: null,
        retirementSavings: 0,
        retirementContribution: 0,
        riskScore: 50,
        riskBand: "BALANCED",
        horizonYears: 10,
        maxDrawdown: 0.2,
        emergencyMonths: 6,
        constraints: DEFAULT_CONSTRAINTS,
      };

  return {
    assets: assets.map((row) => ({
      id: row.id,
      name: row.name,
      code: row.instrumentCode,
      assetClass: inferClass(row.assetClass, row.category),
      marketValue: row.amount,
      category: row.category,
      currency: row.currency,
      liquidity: row.liquidity,
      industry: row.industry,
      note: row.note,
      costBasis: row.costPrice,
      quantity: row.quantity,
    })),
    liabilities: liabilities.map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      balance: row.amount,
      rate: row.interestRate ?? 0,
      monthlyPayment: row.monthlyPayment ?? 0,
      remainingMonths: row.remainingMonths,
    })),
    goals: goals.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type as PortfolioGoal["type"],
      targetAmount: row.targetAmount,
      currentAmount: row.currentAmount,
      targetDate: row.targetDate ? row.targetDate.toISOString().slice(0, 10) : null,
      years: row.years,
      monthlyContribution: row.monthlyContribution,
      priority: row.priority as PortfolioGoal["priority"],
      inflation: row.inflation,
      expectedReturn: row.expectedReturn,
      volatility: row.volatility,
    })),
    profile,
  };
}

export async function savePortfolioPayload(payload: PortfolioPayload): Promise<PortfolioPayload> {
  const assets = payload.assets.filter((item) => item.name.trim() && item.marketValue >= 0);
  const liabilities = payload.liabilities.filter((item) => item.name.trim() && item.balance >= 0);
  const goals = payload.goals.filter((item) => item.name.trim());

  const operations: Prisma.PrismaPromise<unknown>[] = [
    prisma.asset.deleteMany(),
    prisma.liability.deleteMany(),
    prisma.goal.deleteMany(),
  ];
  if (assets.length > 0) {
    operations.push(
      prisma.asset.createMany({
        data: assets.map((item) => ({
          name: item.name.trim().slice(0, 80),
          category: categoryOf(item),
          currency: item.currency ?? "CNY",
          amount: Math.max(0, Number(item.marketValue) || 0),
          institution: null,
          industry: item.industry ?? null,
          liquidity: item.liquidity ?? null,
          maturityMonths: null,
          assetClass: item.assetClass,
          instrumentCode: item.code?.trim() || null,
          quantity: item.quantity ?? null,
          costPrice: item.costBasis ?? null,
          note: item.note ?? null,
        })),
      }),
    );
  }
  if (liabilities.length > 0) {
    operations.push(
      prisma.liability.createMany({
        data: liabilities.map((item) => ({
          name: item.name.trim().slice(0, 80),
          category: item.category ?? "OTHER",
          currency: "CNY",
          amount: Math.max(0, Number(item.balance) || 0),
          interestRate: Number(item.rate) || 0,
          monthlyPayment: Number(item.monthlyPayment) || 0,
          remainingMonths: item.remainingMonths ?? null,
          note: null,
        })),
      }),
    );
  }
  if (goals.length > 0) {
    operations.push(
      prisma.goal.createMany({
        data: goals.map((item) => ({
          name: item.name.trim().slice(0, 80),
          type: item.type,
          targetAmount: Math.max(0, Number(item.targetAmount) || 0),
          currentAmount: Math.max(0, Number(item.currentAmount) || 0),
          targetDate: item.targetDate ? new Date(item.targetDate) : null,
          years: item.years ?? null,
          monthlyContribution: Math.max(0, Number(item.monthlyContribution) || 0),
          priority: item.priority,
          inflation: Number(item.inflation) || 0.025,
          expectedReturn: Number(item.expectedReturn) || 0.05,
          volatility: Number(item.volatility) || 0.1,
          note: null,
        })),
      }),
    );
  }
  operations.push(
    prisma.portfolioProfile.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        baseCurrency: payload.profile.baseCurrency ?? "CNY",
        monthlyIncome: payload.profile.monthlyIncome,
        monthlyExpense: payload.profile.monthlyExpense,
        monthlyInvestable: payload.profile.monthlyInvestable,
        currentAge: payload.profile.currentAge,
        retirementAge: payload.profile.retirementAge,
        retirementAnnualSpend: payload.profile.retirementAnnualSpend,
        retirementSavings: payload.profile.retirementSavings,
        retirementContribution: payload.profile.retirementContribution,
        riskScore: payload.profile.riskScore,
        riskBand: payload.profile.riskBand,
        horizonYears: payload.profile.horizonYears,
        maxDrawdown: payload.profile.maxDrawdown,
        emergencyMonths: payload.profile.emergencyMonths,
        constraints: JSON.stringify(payload.profile.constraints ?? DEFAULT_CONSTRAINTS),
      },
      update: {
        baseCurrency: payload.profile.baseCurrency ?? "CNY",
        monthlyIncome: payload.profile.monthlyIncome,
        monthlyExpense: payload.profile.monthlyExpense,
        monthlyInvestable: payload.profile.monthlyInvestable,
        currentAge: payload.profile.currentAge,
        retirementAge: payload.profile.retirementAge,
        retirementAnnualSpend: payload.profile.retirementAnnualSpend,
        retirementSavings: payload.profile.retirementSavings,
        retirementContribution: payload.profile.retirementContribution,
        riskScore: payload.profile.riskScore,
        riskBand: payload.profile.riskBand,
        horizonYears: payload.profile.horizonYears,
        maxDrawdown: payload.profile.maxDrawdown,
        emergencyMonths: payload.profile.emergencyMonths,
        constraints: JSON.stringify(payload.profile.constraints ?? DEFAULT_CONSTRAINTS),
      },
    }),
  );

  return loadPortfolioPayload();
}

export async function loadNews(limit = 12) {
  const rows = await prisma.article.findMany({
    include: { source: { select: { name: true } } },
    orderBy: { publishedAt: "desc" },
    take: limit,
  });
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    summary: row.summary,
    source: row.source.name,
    published_at: row.publishedAt.toISOString(),
    url: row.url,
    sentiment: row.sentiment,
    topic: null as string | null,
  }));
}

export function toAnalysisRequest(payload: PortfolioPayload, news: Awaited<ReturnType<typeof loadNews>>) {
  return {
    as_of: new Date().toISOString().slice(0, 10),
    holdings: payload.assets.map((item) => ({
      code: item.code ?? null,
      name: item.name,
      asset_class: item.assetClass,
      market_value: item.marketValue,
      cost_basis: item.costBasis ?? null,
      quantity: item.quantity ?? null,
      currency: item.currency ?? "CNY",
      note: item.note ?? null,
    })),
    cash: 0,
    liabilities: payload.liabilities.map((item) => ({
      name: item.name,
      category: item.category ?? "OTHER",
      balance: item.balance,
      rate: item.rate,
      monthly_payment: item.monthlyPayment,
      remaining_months: item.remainingMonths ?? null,
    })),
    goals: payload.goals.map((item) => ({
      name: item.name,
      type: item.type,
      target_amount: item.targetAmount,
      current_amount: item.currentAmount,
      target_date: item.targetDate ?? null,
      years: item.years ?? null,
      monthly_contribution: item.monthlyContribution,
      priority: item.priority,
      inflation: item.inflation,
      expected_return: item.expectedReturn,
      volatility: item.volatility,
    })),
    profile: {
      monthly_income: payload.profile.monthlyIncome,
      monthly_expense: payload.profile.monthlyExpense,
      monthly_investable: payload.profile.monthlyInvestable,
      current_age: payload.profile.currentAge,
      retirement_age: payload.profile.retirementAge,
      retirement_annual_spend: payload.profile.retirementAnnualSpend,
      retirement_savings: payload.profile.retirementSavings,
      retirement_contribution: payload.profile.retirementContribution,
      risk_score: payload.profile.riskScore,
      risk_band: payload.profile.riskBand,
      horizon_years: payload.profile.horizonYears,
      max_drawdown: payload.profile.maxDrawdown,
      emergency_months: payload.profile.emergencyMonths,
    },
    constraints: payload.profile.constraints,
    news,
    include_backtest: true,
    refresh_data: false,
    benchmark: "510300",
  };
}

export async function saveAnalysisRecord(input: unknown, result: AnalysisResult, summary: string) {
  return prisma.analysisRun.create({
    data: {
      kind: "FULL",
      status: "ok",
      input: JSON.stringify(input),
      result: JSON.stringify(result),
      summary,
      mode: "real_data",
    },
  });
}

export async function getLatestAnalysis(): Promise<{ id: string; createdAt: string; result: AnalysisResult } | null> {
  const row = await prisma.analysisRun.findFirst({
    where: { status: "ok" },
    orderBy: { createdAt: "desc" },
  });
  if (!row?.result) return null;
  try {
    return { id: row.id, createdAt: row.createdAt.toISOString(), result: JSON.parse(row.result) as AnalysisResult };
  } catch {
    return null;
  }
}
