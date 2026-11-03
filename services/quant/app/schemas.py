"""Pydantic contracts shared by the API, the agent and the Next.js client."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class Holding(BaseModel):
    code: str | None = Field(default=None, description="ETF/fund code, e.g. 510300")
    name: str = Field(default="未命名持仓", max_length=80)
    asset_class: str | None = Field(default=None, description="CASH/CN_BOND/CN_EQUITY/HK_EQUITY/US_EQUITY/GOLD/COMMODITY/SATELLITE/REAL_ESTATE/OTHER")
    market_value: float = Field(default=0.0, ge=0, description="市值，人民币元")
    cost_basis: float | None = Field(default=None, ge=0)
    quantity: float | None = Field(default=None, ge=0)
    currency: str = "CNY"
    industry: str | None = None
    note: str | None = None


class Liability(BaseModel):
    name: str = "负债"
    category: str = "OTHER"
    balance: float = Field(default=0.0, ge=0)
    rate: float = Field(default=0.0, ge=0, le=100, description="年化利率，百分数")
    monthly_payment: float = Field(default=0.0, ge=0)
    remaining_months: int | None = Field(default=None, ge=0, le=600)


class Goal(BaseModel):
    name: str = "目标"
    type: Literal["EMERGENCY", "EDUCATION", "RETIREMENT", "HOUSE", "OTHER"] = "OTHER"
    target_amount: float = Field(default=0.0, ge=0)
    current_amount: float = Field(default=0.0, ge=0)
    target_date: str | None = None
    years: float | None = Field(default=None, ge=0, le=80)
    monthly_contribution: float = Field(default=0.0, ge=0)
    priority: Literal["high", "medium", "low"] = "medium"
    inflation: float = Field(default=0.025, ge=0, le=0.2)
    expected_return: float = Field(default=0.05, ge=-0.2, le=0.3)
    volatility: float = Field(default=0.10, ge=0, le=0.8)


class Profile(BaseModel):
    monthly_income: float = Field(default=0.0, ge=0)
    monthly_expense: float = Field(default=0.0, ge=0)
    monthly_investable: float | None = Field(default=None, ge=0)
    current_age: int | None = Field(default=None, ge=18, le=100)
    retirement_age: int | None = Field(default=None, ge=40, le=100)
    retirement_annual_spend: float | None = Field(default=None, ge=0)
    retirement_savings: float = Field(default=0.0, ge=0)
    retirement_contribution: float = Field(default=0.0, ge=0)
    retirement_return: float = Field(default=0.04, ge=-0.1, le=0.2)
    risk_score: int = Field(default=50, ge=0, le=100)
    risk_band: Literal["CONSERVATIVE", "STEADY", "BALANCED", "GROWTH", "AGGRESSIVE"] = "BALANCED"
    horizon_years: float = Field(default=10, ge=0.5, le=50)
    max_drawdown: float = Field(default=0.20, ge=0.02, le=0.8)
    emergency_months: float = Field(default=6, ge=1, le=24)


class Constraints(BaseModel):
    max_single_etf: float = Field(default=0.25, ge=0.05, le=1)
    max_turnover: float = Field(default=0.35, ge=0.05, le=1)
    min_cash: float = Field(default=0.03, ge=0, le=0.5)
    max_equity: float = Field(default=0.75, ge=0, le=1)
    max_overseas: float = Field(default=0.30, ge=0, le=1)
    max_satellite: float = Field(default=0.20, ge=0, le=1)
    excluded_codes: list[str] = Field(default_factory=list)
    rebalance_frequency: Literal["monthly", "quarterly", "semiannual"] = "quarterly"
    class_bounds: dict[str, tuple[float, float]] | None = None


class NewsItem(BaseModel):
    id: str | None = None
    title: str
    summary: str = ""
    source: str | None = None
    published_at: str | None = None
    url: str | None = None
    sentiment: str | None = None
    topic: str | None = None


class AnalysisRequest(BaseModel):
    as_of: str | None = None
    holdings: list[Holding] = Field(default_factory=list)
    cash: float = Field(default=0.0, ge=0)
    liabilities: list[Liability] = Field(default_factory=list)
    goals: list[Goal] = Field(default_factory=list)
    profile: Profile = Field(default_factory=Profile)
    constraints: Constraints = Field(default_factory=Constraints)
    news: list[NewsItem] = Field(default_factory=list)
    include_backtest: bool = True
    refresh_data: bool = False
    benchmark: str = "510300"

    @field_validator("holdings")
    @classmethod
    def _dedupe_codes(cls, value: list[Holding]) -> list[Holding]:
        seen = set()
        out = []
        for item in value:
            key = item.code or item.name
            if key in seen:
                continue
            seen.add(key)
            out.append(item)
        return out

    @model_validator(mode="after")
    def _has_value(self):
        total = sum(item.market_value for item in self.holdings) + self.cash
        if total <= 0:
            raise ValueError("持仓与现金合计必须大于 0")
        return self


class AgentRequest(BaseModel):
    task: str = Field(default="请分析我的资产配置并给出再平衡建议", min_length=1, max_length=2000)
    portfolio: AnalysisRequest
    history: list[dict[str, str]] = Field(default_factory=list)
    use_llm: bool = True
    include_report: bool = True


class VisionRequest(BaseModel):
    image_base64: str = Field(min_length=20)
    mime: str = "image/png"
    prompt: str = "请识别这张图片中的持仓/行情/财务信息，并说明它对我的资产配置有什么影响。"
    portfolio: AnalysisRequest | None = None


class ReportRequest(BaseModel):
    analysis: dict[str, Any]
    advice: dict[str, Any] | None = None
    run_id: str | None = None
    title: str = "资产配置分析报告"


class QuantHealth(BaseModel):
    status: str
    version: str
    llm_configured: bool
    data: dict[str, Any] = Field(default_factory=dict)
