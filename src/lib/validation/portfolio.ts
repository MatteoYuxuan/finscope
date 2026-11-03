import { z } from "zod";

const assetClass = z.enum([
  "CASH",
  "CN_BOND",
  "CN_EQUITY",
  "HK_EQUITY",
  "US_EQUITY",
  "GOLD",
  "COMMODITY",
  "SATELLITE",
  "REAL_ESTATE",
  "INSURANCE",
  "OTHER",
]);

export const portfolioAssetSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "请填写名称").max(80),
  code: z.string().trim().max(20).optional().nullable(),
  assetClass,
  marketValue: z.number().finite().min(0).max(10_000_000_000),
  category: z.string().max(30).optional(),
  currency: z.string().length(3).default("CNY"),
  liquidity: z.string().max(10).optional().nullable(),
  industry: z.string().max(60).optional().nullable(),
  note: z.string().max(300).optional().nullable(),
  costBasis: z.number().finite().min(0).optional().nullable(),
  quantity: z.number().finite().min(0).optional().nullable(),
});

export const portfolioLiabilitySchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(80),
  category: z.string().max(30).default("OTHER"),
  balance: z.number().finite().min(0).max(10_000_000_000),
  rate: z.number().finite().min(0).max(100),
  monthlyPayment: z.number().finite().min(0).max(10_000_000_000),
  remainingMonths: z.number().int().min(0).max(600).optional().nullable(),
});

export const portfolioGoalSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(80),
  type: z.enum(["EMERGENCY", "EDUCATION", "RETIREMENT", "HOUSE", "OTHER"]),
  targetAmount: z.number().finite().min(0).max(10_000_000_000),
  currentAmount: z.number().finite().min(0).max(10_000_000_000),
  targetDate: z.string().max(20).optional().nullable(),
  years: z.number().finite().min(0).max(80).optional().nullable(),
  monthlyContribution: z.number().finite().min(0).max(10_000_000_000),
  priority: z.enum(["high", "medium", "low"]),
  inflation: z.number().finite().min(0).max(0.2),
  expectedReturn: z.number().finite().min(-0.2).max(0.3),
  volatility: z.number().finite().min(0).max(0.8),
});

export const portfolioProfileSchema = z.object({
  baseCurrency: z.string().length(3).default("CNY"),
  monthlyIncome: z.number().finite().min(0),
  monthlyExpense: z.number().finite().min(0),
  monthlyInvestable: z.number().finite().min(0),
  currentAge: z.number().int().min(18).max(100).nullable(),
  retirementAge: z.number().int().min(40).max(100).nullable(),
  retirementAnnualSpend: z.number().finite().min(0).nullable(),
  retirementSavings: z.number().finite().min(0),
  retirementContribution: z.number().finite().min(0),
  riskScore: z.number().int().min(0).max(100),
  riskBand: z.enum(["CONSERVATIVE", "STEADY", "BALANCED", "GROWTH", "AGGRESSIVE"]),
  horizonYears: z.number().int().min(1).max(50),
  maxDrawdown: z.number().finite().min(0.02).max(0.8),
  emergencyMonths: z.number().finite().min(1).max(24),
  constraints: z.object({
    max_single_etf: z.number().min(0.05).max(1),
    max_turnover: z.number().min(0.05).max(1),
    min_cash: z.number().min(0).max(0.5),
    max_equity: z.number().min(0).max(1),
    max_overseas: z.number().min(0).max(1),
    max_satellite: z.number().min(0).max(1),
    rebalance_frequency: z.enum(["monthly", "quarterly", "semiannual"]).optional(),
  }),
});

export const portfolioPayloadSchema = z.object({
  assets: z.array(portfolioAssetSchema).max(120),
  liabilities: z.array(portfolioLiabilitySchema).max(60),
  goals: z.array(portfolioGoalSchema).max(30),
  profile: portfolioProfileSchema,
});

export type PortfolioPayloadInput = z.infer<typeof portfolioPayloadSchema>;
