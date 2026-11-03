import { prisma } from "@/lib/db";
import { computePortfolioMetrics, liabilityMix } from "@/lib/rules/metrics";
import { runCheckup } from "@/lib/rules/checkup";
import { scoreRiskProfile, RISK_QUESTIONS } from "@/lib/rules/risk-profile";
import type {
  AssetCategory,
  AssetLike,
  CheckupResult,
  Currency,
  LiabilityCategory,
  LiabilityLike,
  LiquidityTier,
  PortfolioMetrics,
  RiskBand,
} from "@/lib/types/domain";
import { getMonthlySpend } from "./settings";

export interface RiskProfileRow {
  id: string;
  answers: number[];
  score: number;
  band: RiskBand;
  createdAt: string;
}

function toAssetLike(row: {
  id: string;
  name: string;
  category: string;
  currency: string;
  amount: number;
  institution: string | null;
  industry: string | null;
  liquidity: string | null;
  maturityMonths: number | null;
  note: string | null;
}): AssetLike {
  return {
    id: row.id,
    name: row.name,
    category: row.category as AssetCategory,
    currency: row.currency as Currency,
    amount: row.amount,
    institution: row.institution,
    industry: row.industry,
    liquidity: (row.liquidity as LiquidityTier | null) ?? null,
    maturityMonths: row.maturityMonths,
    note: row.note,
  };
}

function toLiabilityLike(row: {
  id: string;
  name: string;
  category: string;
  currency: string;
  amount: number;
  interestRate: number | null;
  monthlyPayment: number | null;
  remainingMonths: number | null;
  note: string | null;
}): LiabilityLike {
  return {
    id: row.id,
    name: row.name,
    category: row.category as LiabilityCategory,
    currency: row.currency as Currency,
    amount: row.amount,
    interestRate: row.interestRate,
    monthlyPayment: row.monthlyPayment,
    remainingMonths: row.remainingMonths,
    note: row.note,
  };
}

export async function listAssets(): Promise<AssetLike[]> {
  const rows = await prisma.asset.findMany({ orderBy: [{ createdAt: "asc" }] });
  return rows.map(toAssetLike);
}

export async function listLiabilities(): Promise<LiabilityLike[]> {
  const rows = await prisma.liability.findMany({ orderBy: [{ createdAt: "asc" }] });
  return rows.map(toLiabilityLike);
}

export interface PortfolioBundle {
  assets: AssetLike[];
  liabilities: LiabilityLike[];
  metrics: PortfolioMetrics;
  liabilityMix: ReturnType<typeof liabilityMix>;
}

export async function loadPortfolio(): Promise<PortfolioBundle> {
  const [assets, liabilities, monthlySpend] = await Promise.all([
    listAssets(),
    listLiabilities(),
    getMonthlySpend(),
  ]);
  const metrics = computePortfolioMetrics({ assets, liabilities, monthlySpend });
  return { assets, liabilities, metrics, liabilityMix: liabilityMix(liabilities) };
}

export async function getLatestRiskProfile(): Promise<RiskProfileRow | null> {
  const row = await prisma.riskProfile.findFirst({ orderBy: { createdAt: "desc" } });
  if (!row) return null;
  let answers: number[] = [];
  try {
    const parsed = JSON.parse(row.answers);
    if (Array.isArray(parsed)) answers = parsed.map(Number);
  } catch {
    answers = [];
  }
  return {
    id: row.id,
    answers,
    score: row.score,
    band: row.band as RiskBand,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function saveRiskProfile(answers: number[]): Promise<RiskProfileRow> {
  const result = scoreRiskProfile(answers);
  const row = await prisma.riskProfile.create({
    data: { answers: JSON.stringify(answers), score: result.score, band: result.band },
  });
  return {
    id: row.id,
    answers,
    score: row.score,
    band: row.band as RiskBand,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface CheckupBundle {
  metrics: PortfolioMetrics;
  checkup: CheckupResult;
  riskProfile: RiskProfileRow | null;
}

export async function loadCheckup(): Promise<CheckupBundle> {
  const [portfolio, riskProfile] = await Promise.all([loadPortfolio(), getLatestRiskProfile()]);
  const checkup = runCheckup(portfolio.metrics, riskProfile?.band ?? null);
  return { metrics: portfolio.metrics, checkup, riskProfile };
}

export function riskQuestionCount(): number {
  return RISK_QUESTIONS.length;
}
