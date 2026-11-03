"""Goal-based planning: emergency fund, education, retirement, debt payoff.

These are planning calculations, not guarantees. Every projection returns the
assumptions used (return, inflation, horizon) so the UI and the agent can show
them next to the number.
"""

from __future__ import annotations

import math
from datetime import date
from typing import Any

import numpy as np


def monthly_rate(annual: float) -> float:
    return (1 + annual) ** (1 / 12) - 1 if annual > -1 else 0.0


def fv_lump(present: float, annual_return: float, years: float) -> float:
    return float(present) * (1 + annual_return) ** max(years, 0)


def fv_annuity(monthly: float, annual_return: float, years: float) -> float:
    n = int(max(years, 0) * 12)
    if n <= 0:
        return 0.0
    r = monthly_rate(annual_return)
    if abs(r) < 1e-12:
        return float(monthly) * n
    return float(monthly) * (((1 + r) ** n - 1) / r)


def required_monthly(target: float, annual_return: float, years: float) -> float:
    n = int(max(years, 0) * 12)
    if n <= 0:
        return float(target)
    r = monthly_rate(annual_return)
    if abs(r) < 1e-12:
        return float(target) / n
    return float(target) * r / ((1 + r) ** n - 1)


def _years_until(target_date: str | None, fallback_years: float | None) -> float:
    if fallback_years is not None:
        return max(float(fallback_years), 0.0)
    if not target_date:
        return 5.0
    try:
        y, m, d = [int(x) for x in target_date[:10].split("-")]
        target = date(y, m, d)
        return max((target - date.today()).days / 365.25, 0.0)
    except Exception:
        return 5.0


def _mc_success(
    current: float,
    monthly: float,
    target: float,
    years: float,
    expected_return: float,
    volatility: float,
    simulations: int = 2000,
) -> float:
    """Monte Carlo probability of reaching a nominal target."""
    n = int(max(years, 0) * 12)
    if n <= 0:
        return 1.0 if current >= target else 0.0
    rng = np.random.default_rng(42)
    monthly_mu = monthly_rate(expected_return)
    monthly_sigma = max(volatility, 0.0) / math.sqrt(12)
    draws = rng.normal(monthly_mu, monthly_sigma, size=(simulations, n))
    values = np.full(simulations, float(current))
    for month in range(n):
        values = values * (1 + draws[:, month]) + float(monthly)
    return float((values >= target).mean())


def emergency_fund(cash_like: float, monthly_expense: float, target_months: float = 6.0) -> dict:
    if monthly_expense <= 0:
        return {
            "target_amount": None,
            "current": round(cash_like, 2),
            "gap": None,
            "months_covered": None,
            "target_months": target_months,
            "status": "unknown",
            "note": "未填写月必要支出，无法计算应急金目标。",
        }
    target = monthly_expense * target_months
    gap = max(target - cash_like, 0.0)
    months = cash_like / monthly_expense
    return {
        "target_amount": round(target, 2),
        "current": round(cash_like, 2),
        "gap": round(gap, 2),
        "months_covered": round(months, 2),
        "target_months": target_months,
        "status": "ok" if gap <= 0 else "shortfall",
        "note": "应急金以高流动性资产计，建议覆盖 3–6 个月必要支出。",
    }


def project_goal(goal: dict, default_return: float = 0.05, default_inflation: float = 0.025) -> dict:
    years = _years_until(goal.get("target_date"), goal.get("years"))
    inflation = float(goal.get("inflation", default_inflation))
    expected_return = float(goal.get("expected_return", default_return))
    volatility = float(goal.get("volatility", 0.10))
    target_nominal = float(goal.get("target_amount", 0.0))
    future_cost = target_nominal * (1 + inflation) ** years
    current = float(goal.get("current_amount", 0.0))
    monthly = float(goal.get("monthly_contribution", 0.0))
    projected = fv_lump(current, expected_return, years) + fv_annuity(monthly, expected_return, years)
    gap = max(future_cost - projected, 0.0)
    needed = required_monthly(gap, expected_return, years) if gap > 0 else 0.0
    success = _mc_success(current, monthly, future_cost, years, expected_return, volatility)
    return {
        "name": goal.get("name", "目标"),
        "type": goal.get("type", "OTHER"),
        "priority": goal.get("priority", "medium"),
        "years": round(years, 2),
        "target_amount": round(target_nominal, 2),
        "future_cost": round(future_cost, 2),
        "current_amount": round(current, 2),
        "monthly_contribution": round(monthly, 2),
        "projected_amount": round(projected, 2),
        "gap": round(gap, 2),
        "required_monthly": round(needed, 2),
        "success_probability": round(success, 3),
        "assumptions": {
            "inflation": inflation,
            "expected_return": expected_return,
            "volatility": volatility,
            "target_date": goal.get("target_date"),
        },
        "status": "on_track" if gap <= 0 else "shortfall",
    }


def debt_payoff(liabilities: list[dict], extra_payment: float = 0.0, strategy: str = "avalanche", max_months: int = 600) -> dict:
    """Simulate debt payoff with minimum payments and an optional extra payment."""
    debts = []
    for item in liabilities:
        balance = float(item.get("balance", item.get("amount", 0.0)) or 0.0)
        rate = float(item.get("rate", item.get("interest_rate", 0.0)) or 0.0) / 100.0
        payment = float(item.get("monthly_payment", 0.0) or 0.0)
        if balance <= 0:
            continue
        debts.append({"name": item.get("name", "负债"), "balance": balance, "rate": rate, "payment": payment})
    if not debts:
        return {"months": 0, "total_interest": 0.0, "schedule": [], "strategy": strategy, "note": "没有录入负债。"}

    def order(items: list[dict]) -> list[dict]:
        if strategy == "snowball":
            return sorted(items, key=lambda x: x["balance"])
        return sorted(items, key=lambda x: x["rate"], reverse=True)

    debts = order(debts)
    total_interest = 0.0
    months = 0
    schedule = []
    while any(item["balance"] > 0.01 for item in debts) and months < max_months:
        months += 1
        month_interest = 0.0
        for item in debts:
            if item["balance"] <= 0:
                continue
            interest = item["balance"] * item["rate"] / 12
            item["balance"] += interest
            month_interest += interest
        total_interest += month_interest
        # Minimum payments first.
        for item in debts:
            if item["balance"] <= 0:
                continue
            pay = min(item["payment"], item["balance"]) if item["payment"] > 0 else min(item["balance"], max(item["balance"] * 0.03, 50))
            item["balance"] -= pay
        # Extra payment goes to the first non-zero debt in strategy order.
        remaining_extra = max(extra_payment, 0.0)
        for item in debts:
            if remaining_extra <= 0:
                break
            if item["balance"] <= 0:
                continue
            pay = min(remaining_extra, item["balance"])
            item["balance"] -= pay
            remaining_extra -= pay
        if months % 12 == 0 or months == 1:
            schedule.append(
                {
                    "month": months,
                    "total_balance": round(sum(max(x["balance"], 0) for x in debts), 2),
                    "interest_paid": round(total_interest, 2),
                }
            )
    return {
        "months": months,
        "years": round(months / 12, 2),
        "total_interest": round(total_interest, 2),
        "schedule": schedule[:36],
        "strategy": "雪球（先还小额）" if strategy == "snowball" else "雪崩（先还高息）",
        "note": "按最低还款额与额外还款模拟；实际利率、提前还款条款以合同为准。",
    }


def goal_plan(
    profile: dict,
    goals: list[dict],
    liabilities: list[dict],
    cash_like: float,
) -> dict:
    monthly_income = float(profile.get("monthly_income", 0) or 0)
    monthly_expense = float(profile.get("monthly_expense", 0) or 0)
    monthly_debt = sum(float(item.get("monthly_payment", 0) or 0) for item in liabilities)
    surplus = monthly_income - monthly_expense - monthly_debt
    emergency = emergency_fund(cash_like, monthly_expense, float(profile.get("emergency_months", 6) or 6))

    high_interest = [item for item in liabilities if float(item.get("rate", item.get("interest_rate", 0)) or 0) >= 8]
    avalanche = debt_payoff(liabilities, extra_payment=max(surplus * 0.3, 0), strategy="avalanche")
    snowball = debt_payoff(liabilities, extra_payment=max(surplus * 0.3, 0), strategy="snowball")

    projected = [project_goal(goal, default_return=0.05, default_inflation=0.025) for goal in goals]
    projected.sort(key=lambda item: {"high": 0, "medium": 1, "low": 2}.get(item["priority"], 1))
    total_required = sum(item["required_monthly"] for item in projected)
    recommended_emergency_topup = min(max(surplus * 0.3, 0), emergency["gap"] or 0)
    investable = max(surplus - recommended_emergency_topup, 0)

    # Retirement is a special goal; use a dedicated corpus calculation when the
    # profile contains age information.
    retirement = None
    current_age = profile.get("current_age")
    retire_age = profile.get("retirement_age")
    if current_age and retire_age and int(retire_age) > int(current_age):
        years = int(retire_age) - int(current_age)
        annual_spend = float(profile.get("retirement_annual_spend", monthly_expense * 12) or monthly_expense * 12)
        real_return = float(profile.get("retirement_return", 0.04) or 0.04)
        inflation = float(profile.get("inflation", 0.025) or 0.025)
        future_spend = annual_spend * (1 + inflation) ** years
        # 25x rule as a transparent starting point; a 4% real return is assumed.
        corpus = future_spend * 25
        current_retirement = float(profile.get("retirement_savings", 0) or 0)
        monthly_ret = float(profile.get("retirement_contribution", 0) or 0)
        projected_corpus = fv_lump(current_retirement, real_return + inflation, years) + fv_annuity(monthly_ret, real_return + inflation, years)
        gap = max(corpus - projected_corpus, 0)
        retirement = {
            "years_to_retirement": years,
            "annual_spend_today": round(annual_spend, 2),
            "future_annual_spend": round(future_spend, 2),
            "target_corpus": round(corpus, 2),
            "projected_corpus": round(projected_corpus, 2),
            "gap": round(gap, 2),
            "required_monthly": round(required_monthly(gap, real_return + inflation, years), 2) if gap > 0 else 0,
            "success_probability": round(_mc_success(current_retirement, monthly_ret, corpus, years, real_return + inflation, 0.12), 3),
            "assumptions": {"real_return": real_return, "inflation": inflation, "withdrawal_rate": 0.04},
        }

    return {
        "cashflow": {
            "monthly_income": round(monthly_income, 2),
            "monthly_expense": round(monthly_expense, 2),
            "monthly_debt_payment": round(monthly_debt, 2),
            "monthly_surplus": round(surplus, 2),
            "monthly_investable": round(investable, 2),
        },
        "emergency_fund": emergency,
        "high_interest_debt": {
            "count": len(high_interest),
            "total_balance": round(sum(float(x.get("balance", x.get("amount", 0)) or 0) for x in high_interest), 2),
            "note": "利率 ≥ 8% 的负债优先于新增投资。" if high_interest else "未发现高成本负债。",
        },
        "debt_payoff": {"avalanche": avalanche, "snowball": snowball},
        "goals": projected,
        "total_required_monthly": round(total_required, 2),
        "funding_gap": round(max(total_required - investable, 0), 2),
        "retirement": retirement,
        "priority_order": [
            "1. 应急金补足至 3–6 个月",
            "2. 偿还利率 ≥ 8% 的高成本负债",
            "3. 按优先级为目标定投",
            "4. 剩余资金进入长期资产配置",
        ],
    }
