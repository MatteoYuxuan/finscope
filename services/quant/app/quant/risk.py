"""Risk measurement: VaR/CVaR, drawdown, stress tests, risk budgets."""

from __future__ import annotations

import numpy as np
import pandas as pd

from .returns import drawdown_series, max_drawdown, portfolio_returns, risk_contributions

STRESS_WINDOWS = [
    {
        "key": "2015_crash",
        "name": "2015 年 A 股去杠杆",
        "start": "2015-06-12",
        "end": "2015-08-26",
        "note": "千股跌停、流动性快速收缩",
    },
    {
        "key": "2018_trade_war",
        "name": "2018 年贸易摩擦",
        "start": "2018-01-24",
        "end": "2018-12-28",
        "note": "全年风险资产估值压缩",
    },
    {
        "key": "2020_covid",
        "name": "2020 年新冠冲击",
        "start": "2020-01-20",
        "end": "2020-03-23",
        "note": "全球风险资产同步下跌",
    },
    {
        "key": "2022_rate_shock",
        "name": "2022 年全球加息",
        "start": "2022-01-01",
        "end": "2022-10-31",
        "note": "股债双杀、美元走强",
    },
]

HYPOTHETICAL_SHOCKS = [
    {"key": "equity_shock", "name": "权益快速回撤 20%", "shocks": {"CN_EQUITY": -0.20, "HK_EQUITY": -0.22, "US_EQUITY": -0.18, "SATELLITE": -0.25, "CN_BOND": 0.02, "GOLD": 0.05, "CASH": 0.0}},
    {"key": "rate_shock", "name": "利率上行 100bp", "shocks": {"CN_BOND": -0.05, "CASH": 0.01, "CN_EQUITY": -0.06, "GOLD": -0.03, "US_EQUITY": -0.04}},
    {"key": "cny_shock", "name": "人民币快速贬值 8%", "shocks": {"US_EQUITY": 0.06, "HK_EQUITY": 0.03, "GOLD": 0.06, "CN_EQUITY": -0.04, "CN_BOND": -0.01}},
    {"key": "stagflation", "name": "滞胀情景", "shocks": {"CN_EQUITY": -0.15, "CN_BOND": -0.04, "GOLD": 0.10, "COMMODITY": 0.08, "CASH": 0.0}},
]


def var_cvar(weights: pd.Series, returns: pd.DataFrame, alpha: float = 0.95, horizon_days: int = 1) -> dict:
    port = portfolio_returns(weights, returns).dropna()
    if len(port) < 20:
        return {"var_historical": None, "cvar_historical": None, "var_parametric": None, "horizon_days": horizon_days, "alpha": alpha}
    scale = np.sqrt(max(horizon_days, 1))
    q = float(np.quantile(port, 1 - alpha))
    tail = port[port <= q]
    cvar = float(tail.mean()) if len(tail) else q
    mu = float(port.mean())
    sigma = float(port.std(ddof=1))
    from scipy.stats import norm

    param = float(mu * horizon_days + norm.ppf(1 - alpha) * sigma * scale)
    return {
        "alpha": alpha,
        "horizon_days": horizon_days,
        "var_historical": round(float(abs(q) * scale), 4),
        "cvar_historical": round(float(abs(cvar) * scale), 4),
        "var_parametric": round(float(abs(param)), 4),
        "confidence_note": "历史法基于样本分布，参数法假设正态；两者均不是最大损失保证。",
    }


def stress_test(weights: pd.Series, returns: pd.DataFrame, class_of: dict[str, str]) -> list[dict]:
    out = []
    for scenario in STRESS_WINDOWS:
        window = returns.loc[(returns.index >= scenario["start"]) & (returns.index <= scenario["end"])]
        if window.empty:
            continue
        cumulative = (1 + window.fillna(0)).prod() - 1
        available = [code for code in weights.index if code in cumulative.index]
        if not available:
            continue
        # Missing assets are treated as unchanged, not as zero-return winners.
        scenario_return = float((weights[available] * cumulative[available]).sum())
        out.append(
            {
                "key": scenario["key"],
                "name": scenario["name"],
                "type": "historical",
                "portfolio_return": round(scenario_return, 4),
                "note": scenario["note"],
                "window": f"{scenario['start']} ~ {scenario['end']}",
            }
        )

    for scenario in HYPOTHETICAL_SHOCKS:
        scenario_return = 0.0
        for code, weight in weights.items():
            cls = class_of.get(code, "OTHER")
            scenario_return += float(weight) * float(scenario["shocks"].get(cls, 0.0))
        out.append(
            {
                "key": scenario["key"],
                "name": scenario["name"],
                "type": "hypothetical",
                "portfolio_return": round(scenario_return, 4),
                "note": "基于资产类别映射的假设冲击",
                "window": "瞬时冲击",
            }
        )
    return out


def correlation_matrix(returns: pd.DataFrame) -> dict:
    if returns is None or returns.empty:
        return {"codes": [], "values": []}
    corr = returns.corr().fillna(0.0)
    return {
        "codes": [str(c) for c in corr.columns],
        "values": [[round(float(v), 3) for v in row] for row in corr.values],
    }


def risk_budget(weights: pd.Series, cov: pd.DataFrame) -> list[dict]:
    contrib = risk_contributions(weights, cov)
    return [
        {"code": code, "weight": round(float(weights.get(code, 0.0)), 4), "risk_contribution": round(float(value), 4)}
        for code, value in contrib.sort_values(ascending=False).items()
    ]


def portfolio_risk_snapshot(weights: pd.Series, returns: pd.DataFrame, cov: pd.DataFrame, class_of: dict[str, str]) -> dict:
    port = portfolio_returns(weights, returns).dropna()
    return {
        "var": {
            "95_1d": var_cvar(weights, returns, 0.95, 1),
            "99_1d": var_cvar(weights, returns, 0.99, 1),
            "95_1m": var_cvar(weights, returns, 0.95, 21),
        },
        "max_drawdown": round(max_drawdown((1 + port).cumprod()), 4) if len(port) else 0.0,
        "drawdown_series": [
            {"date": str(idx)[:10], "value": round(float(v), 4)}
            for idx, v in drawdown_series((1 + port).cumprod()).tail(260).items()
        ],
        "stress": stress_test(weights, returns, class_of),
        "correlation": correlation_matrix(returns.tail(252)),
        "risk_budget": risk_budget(weights, cov),
        "concentration": {
            "hhi": round(float((weights**2).sum()), 4),
            "top_weight": round(float(weights.max()), 4) if len(weights) else 0.0,
            "top3": round(float(weights.nlargest(3).sum()), 4) if len(weights) else 0.0,
        },
    }
