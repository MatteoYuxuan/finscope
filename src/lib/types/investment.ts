/** Shared types for the portfolio -> quant -> agent pipeline. */

export type AssetClass =
  | "CASH"
  | "CN_BOND"
  | "CN_EQUITY"
  | "HK_EQUITY"
  | "US_EQUITY"
  | "GOLD"
  | "COMMODITY"
  | "SATELLITE"
  | "REAL_ESTATE"
  | "INSURANCE"
  | "OTHER";

export interface PortfolioAsset {
  id?: string;
  name: string;
  code?: string | null;
  assetClass: AssetClass;
  marketValue: number;
  category?: string;
  currency?: string;
  liquidity?: string | null;
  industry?: string | null;
  note?: string | null;
  costBasis?: number | null;
  quantity?: number | null;
}

export interface PortfolioLiability {
  id?: string;
  name: string;
  category?: string;
  balance: number;
  rate: number;
  monthlyPayment: number;
  remainingMonths?: number | null;
}

export interface PortfolioGoal {
  id?: string;
  name: string;
  type: "EMERGENCY" | "EDUCATION" | "RETIREMENT" | "HOUSE" | "OTHER";
  targetAmount: number;
  currentAmount: number;
  targetDate?: string | null;
  years?: number | null;
  monthlyContribution: number;
  priority: "high" | "medium" | "low";
  inflation: number;
  expectedReturn: number;
  volatility: number;
}

export interface PortfolioProfile {
  baseCurrency: string;
  monthlyIncome: number;
  monthlyExpense: number;
  monthlyInvestable: number;
  currentAge: number | null;
  retirementAge: number | null;
  retirementAnnualSpend: number | null;
  retirementSavings: number;
  retirementContribution: number;
  riskScore: number;
  riskBand: "CONSERVATIVE" | "STEADY" | "BALANCED" | "GROWTH" | "AGGRESSIVE";
  horizonYears: number;
  maxDrawdown: number;
  emergencyMonths: number;
  constraints: {
    max_single_etf: number;
    max_turnover: number;
    min_cash: number;
    max_equity: number;
    max_overseas: number;
    max_satellite: number;
    rebalance_frequency?: "monthly" | "quarterly" | "semiannual";
  };
}

export interface PortfolioPayload {
  assets: PortfolioAsset[];
  liabilities: PortfolioLiability[];
  goals: PortfolioGoal[];
  profile: PortfolioProfile;
}

export interface ClassWeight {
  key: string;
  label: string;
  color: string;
  weight: number;
}

export interface WeightItem {
  code: string;
  name: string;
  asset_class: string;
  class_label: string;
  color: string;
  weight: number;
}

export interface TradeItem {
  code: string;
  name: string;
  asset_class: string;
  current_weight: number;
  target_weight: number;
  delta_weight: number;
  current_value: number;
  target_value: number;
  delta_value: number;
  price: number | null;
  shares: number;
  action: "BUY" | "SELL" | "HOLD";
  reason: string;
}

export interface StrategyResult {
  label: string;
  weights: WeightItem[];
  class_weights: ClassWeight[];
  metrics: {
    expected_return: number;
    volatility: number;
    sharpe: number;
    max_drawdown: number;
  };
}

export interface StressItem {
  key: string;
  name: string;
  type: string;
  portfolio_return: number;
  note: string;
  window: string;
}

export interface RiskSnapshot {
  var: Record<string, { var_historical?: number; cvar_historical?: number; var_parametric?: number; horizon_days?: number; alpha?: number }>;
  max_drawdown: number;
  drawdown_series: { date: string; value: number }[];
  stress: StressItem[];
  correlation: { codes: string[]; values: number[][] };
  risk_budget: { code: string; weight: number; risk_contribution: number }[];
  concentration: { hhi: number; top_weight: number; top3: number };
}

export interface BacktestResult {
  ok: boolean;
  error?: string;
  metrics?: {
    cagr: number;
    volatility: number;
    sharpe: number;
    sortino: number;
    max_drawdown: number;
    calmar: number;
    win_rate: number;
  };
  turnover?: number;
  series?: { date: string; portfolio: number; benchmark: number | null }[];
  drawdown?: { date: string; value: number }[];
}

export interface MacroIndicator {
  key: string;
  label: string;
  value: number;
  previous: number | null;
  change: number | null;
  unit: string;
  date: string;
  source: string;
}

export interface AnalysisResult {
  analysis_id?: string;
  meta: {
    as_of: string;
    data_start: string;
    data_end: string;
    universe: number;
    total_value: number;
    investable_value: number;
    non_investable_value: number;
    mode: string;
    warnings: string[];
  };
  market: {
    regime: {
      regime: "RISK_ON" | "NEUTRAL" | "RISK_OFF";
      label: string;
      score: number;
      signals: { name: string; value: string; impact: number }[];
    };
    macro: { as_of: string; indicators: MacroIndicator[]; derived: Record<string, number | boolean | null>; note: string };
    benchmark: { code: string; name: string; last: number | null; trend: string | null };
    momentum: { code: string; name: string; asset_class: string; score: number; mom_12m: number; mom_6m: number; trend: string; volatility: number | null }[];
  };
  portfolio: {
    total_value: number;
    investable_value: number;
    non_investable_value: number;
    holdings: {
      code: string | null;
      name: string;
      asset_class: string;
      class_label: string;
      market_value: number;
      cost_basis: number | null;
      quantity: number | null;
      weight_total: number;
    }[];
    current_weights: WeightItem[];
    current_class_weights: ClassWeight[];
    liabilities: Record<string, unknown>[];
  };
  strategies: Record<string, StrategyResult>;
  target: {
    weights: WeightItem[];
    class_weights: ClassWeight[];
    trades: TradeItem[];
    turnover: number;
    expected_return: number;
    expected_volatility: number;
    expected_sharpe: number;
    max_drawdown: number;
    mix: Record<string, number>;
  };
  risk: { current: RiskSnapshot; target: RiskSnapshot };
  backtest: Record<string, BacktestResult>;
  goals: {
    cashflow: {
      monthly_income: number;
      monthly_expense: number;
      monthly_debt_payment: number;
      monthly_surplus: number;
      monthly_investable: number;
    };
    emergency_fund: {
      target_amount: number | null;
      current: number;
      gap: number | null;
      months_covered: number | null;
      target_months: number;
      status: string;
      note: string;
    };
    high_interest_debt: { count: number; total_balance: number; note: string };
    debt_payoff: Record<string, unknown>;
    goals: {
      name: string;
      type: string;
      priority: string;
      years: number;
      target_amount: number;
      future_cost: number;
      current_amount: number;
      monthly_contribution: number;
      projected_amount: number;
      gap: number;
      required_monthly: number;
      success_probability: number;
      assumptions: Record<string, number | string | null>;
      status: string;
    }[];
    total_required_monthly: number;
    funding_gap: number;
    retirement: {
      years_to_retirement: number;
      annual_spend_today: number;
      future_annual_spend: number;
      target_corpus: number;
      projected_corpus: number;
      gap: number;
      required_monthly: number;
      success_probability: number;
      assumptions: Record<string, number>;
    } | null;
    priority_order: string[];
  };
  screening: {
    code: string;
    name: string;
    asset_class: string;
    class_label: string;
    role: string;
    fee: number;
    price: number | null;
    amount: number | null;
    market_cap: number | null;
    change_pct: number | null;
    score: number;
    target_class_weight: number;
    reason: string;
  }[];
  charts: {
    id: string;
    type: string;
    title: string;
    unit?: string;
    xLabel?: string;
    yLabel?: string;
    data?: unknown;
    rows?: Record<string, string | number>[];
    columns?: { key: string; label: string }[];
    note?: string;
  }[];
  summary: string;
  citations: { type: string; label: string; detail: string; as_of: string }[];
}

export interface AdviceAllocation {
  asset_class: string;
  label: string;
  color: string;
  current: number;
  target: number;
  delta: number;
  direction: "increase" | "reduce" | "hold";
  rationale: string;
}

export interface AdviceInstrument {
  code: string;
  name: string;
  asset_class: string;
  class_label: string;
  target_weight: number;
  role?: string;
  fee?: number;
  price?: number;
  amount?: number;
  score?: number;
  reason?: string;
  is_alternative?: boolean;
}

export interface AdviceAction {
  priority: "high" | "medium" | "low";
  action: string;
  amount: number;
  shares?: number;
  rationale: string;
  kind?: string;
}

export interface Advice {
  title: string;
  summary: string;
  regime: { key: string; label: string; score: number; signals: { name: string; value: string; impact: number }[] };
  allocation: AdviceAllocation[];
  instruments: AdviceInstrument[];
  actions: AdviceAction[];
  risks: string[];
  confidence: "high" | "medium" | "low";
  confidence_note: string;
  goal: AnalysisResult["goals"];
  evidence: { type: string; label: string; detail: string; as_of?: string }[];
  disclaimer: string;
  generated_at?: string;
  mode?: string;
  critic?: { pass: boolean; issues: string[]; required_changes: string[] };
  notes?: string[];
  manager_summary?: string;
  manager_confidence_note?: string;
  regime_narrative?: string;
  allocation_narrative?: string;
  risk_narrative?: string;
  goal_narrative?: string;
  action_narrative?: string;
}

export interface AgentStep {
  id: string;
  seq: number;
  role: string;
  type: string;
  title: string;
  detail: string;
  tool_name?: string | null;
  status: string;
  latency_ms?: number;
  created_at?: string;
}

export interface AgentRunResult {
  run_id: string;
  status: string;
  mode: "llm" | "fallback" | "deterministic";
  model: string | null;
  started_at: string;
  finished_at: string;
  analysis: AnalysisResult;
  advice: Advice;
  memos: Record<string, string>;
  critic: { pass: boolean; issues: string[]; required_changes: string[] };
  plan: { index: number; question: string; role: string; evidence: string }[];
  report: { report_id: string; title: string; html_path?: string; pdf_path?: string | null; markdown?: string } | null;
  notes: string[];
  steps: AgentStep[];
  citations: Advice["evidence"];
  disclaimer: string;
}

export interface AgentRunSummary {
  id: string;
  created_at: string;
  finished_at?: string | null;
  task: string;
  status: string;
  mode: string;
  model?: string | null;
  error?: string | null;
}
