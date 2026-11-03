"""Tactical signals: momentum, trend, volatility and macro regime."""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..universe import BY_CODE
from .returns import zscore


def _last_price(prices: pd.DataFrame, code: str) -> pd.Series | None:
    if code not in prices.columns:
        return None
    series = prices[code].dropna()
    return series if len(series) > 5 else None


def momentum_score(prices: pd.DataFrame, code: str) -> dict:
    """12-1 momentum + 6-month momentum + trend state."""
    series = _last_price(prices, code)
    if series is None:
        return {"code": code, "score": 0.0, "mom_12m": 0.0, "mom_6m": 0.0, "trend": "NA", "vol": None}
    series = series[series > 0]
    if len(series) < 5:
        return {"code": code, "score": 0.0, "mom_12m": 0.0, "mom_6m": 0.0, "trend": "NA", "vol": None}
    n = len(series)
    lookback = min(252, n - 1)
    skip = min(21, max(0, n - 2))
    start_idx = max(0, n - 1 - lookback)
    end_idx = max(start_idx + 1, n - 1 - skip)
    mom12 = float(series.iloc[end_idx] / series.iloc[start_idx] - 1) if start_idx < end_idx else 0.0
    m6 = min(126, n - 1)
    mom6 = float(series.iloc[-1] / series.iloc[-m6] - 1) if m6 > 0 else 0.0
    ma50 = float(series.tail(50).mean()) if n >= 50 else float(series.mean())
    ma200 = float(series.tail(200).mean()) if n >= 200 else float(series.mean())
    last = float(series.iloc[-1])
    trend = "UP" if last > ma200 and ma50 > ma200 else "DOWN" if last < ma200 else "MIXED"
    vol = float(series.pct_change().tail(63).std() * np.sqrt(252)) if n > 20 else None
    return {"code": code, "mom_12m": mom12, "mom_6m": mom6, "trend": trend, "vol": vol, "score": 0.0}


def momentum_table(prices: pd.DataFrame) -> dict[str, dict]:
    rows = {code: momentum_score(prices, code) for code in prices.columns}
    if not rows:
        return rows
    mom12 = pd.Series({code: row["mom_12m"] for code, row in rows.items()})
    mom6 = pd.Series({code: row["mom_6m"] for code, row in rows.items()})
    vols = pd.Series({code: (row["vol"] if row["vol"] is not None else 0.0) for code, row in rows.items()})
    z12 = zscore(mom12)
    z6 = zscore(mom6)
    zv = zscore(vols)
    for code, row in rows.items():
        trend_bonus = 0.5 if row["trend"] == "UP" else -0.5 if row["trend"] == "DOWN" else 0.0
        row["score"] = float(0.6 * z12.get(code, 0.0) + 0.4 * z6.get(code, 0.0) + trend_bonus - 0.25 * zv.get(code, 0.0))
    return rows


def market_regime(prices: pd.DataFrame, macro: dict) -> dict:
    """Combine trend, breadth, volatility and macro into a 0-100 risk score."""
    signals = []
    score = 50.0

    # 1. Equity trend (CSI300 ETF as the market proxy).
    proxy = _last_price(prices, "510300")
    if proxy is not None and len(proxy) >= 200:
        ma200 = float(proxy.tail(200).mean())
        last = float(proxy.iloc[-1])
        above = last > ma200
        score += 12 if above else -12
        signals.append({"name": "沪深300 200 日均线", "value": "上方" if above else "下方", "impact": 12 if above else -12})

    # 2. Breadth: share of risk assets above their 200-day average.
    risk_codes = [c for c in prices.columns if BY_CODE.get(c) and BY_CODE[c].asset_class in {"CN_EQUITY", "HK_EQUITY", "US_EQUITY", "SATELLITE"}]
    if risk_codes:
        above_count = 0
        valid = 0
        for code in risk_codes:
            series = _last_price(prices, code)
            if series is not None and len(series) >= 200:
                valid += 1
                if float(series.iloc[-1]) > float(series.tail(200).mean()):
                    above_count += 1
        if valid:
            breadth = above_count / valid
            score += (breadth - 0.5) * 30
            signals.append({"name": "风险资产站上 200 日线比例", "value": f"{breadth:.0%}", "impact": round((breadth - 0.5) * 30, 1)})

    # 3. Realised volatility of the market proxy (inverse).
    if proxy is not None and len(proxy) > 30:
        vol = float(proxy.pct_change().tail(63).std() * np.sqrt(252))
        impact = 8 if vol < 0.15 else -8 if vol > 0.30 else 0
        score += impact
        signals.append({"name": "沪深300 60 日年化波动", "value": f"{vol:.1%}", "impact": impact})

    # 4. Macro: PMI, CPI, 10Y yield, USD/CNY.
    indicators = {item["key"]: item for item in macro.get("indicators", [])}
    pmi = indicators.get("cn_pmi")
    if pmi and pmi.get("value") is not None:
        impact = 8 if pmi["value"] >= 50 else -8
        score += impact
        signals.append({"name": "制造业 PMI", "value": f"{pmi['value']:.1f}", "impact": impact})

    cpi = indicators.get("cn_cpi")
    if cpi and cpi.get("value") is not None:
        impact = -5 if cpi["value"] > 3 else 3 if cpi["value"] < 2 else 0
        score += impact
        signals.append({"name": "CPI 同比", "value": f"{cpi['value']:.1f}%", "impact": impact})

    cn10y = indicators.get("cn_10y")
    if cn10y and cn10y.get("change") is not None:
        impact = -4 if cn10y["change"] > 0.1 else 4 if cn10y["change"] < -0.1 else 0
        score += impact
        signals.append({"name": "10 年期国债收益率变化", "value": f"{cn10y['change']:+.2f}pp", "impact": impact})

    fx = indicators.get("usdcny")
    if fx and fx.get("change") is not None:
        # A sharp CNY depreciation is a risk-off signal for CNY assets.
        impact = -4 if fx["change"] > 0.01 else 0
        score += impact
        signals.append({"name": "美元兑人民币变化", "value": f"{fx['change']:+.3f}", "impact": impact})

    vix = indicators.get("us_vix")
    if vix and vix.get("value") is not None:
        impact = -8 if vix["value"] > 28 else 5 if vix["value"] < 18 else 0
        score += impact
        signals.append({"name": "VIX", "value": f"{vix['value']:.1f}", "impact": impact})

    score = float(np.clip(score, 0, 100))
    regime = "RISK_ON" if score >= 65 else "RISK_OFF" if score <= 35 else "NEUTRAL"
    label = {"RISK_ON": "风险偏好上行", "NEUTRAL": "中性震荡", "RISK_OFF": "风险偏好收缩"}[regime]
    return {"regime": regime, "label": label, "score": round(score, 1), "signals": signals}


def tactical_tilt(
    strategic: pd.Series,
    momentum: dict[str, dict],
    regime: dict,
    max_tilt: float = 0.25,
) -> pd.Series:
    """Tilt strategic weights toward positive momentum, scaled by regime."""
    regime_multiplier = {"RISK_ON": 1.0, "NEUTRAL": 0.6, "RISK_OFF": 0.3}[regime["regime"]]
    multipliers = {}
    for code, weight in strategic.items():
        info = momentum.get(code, {})
        score = float(info.get("score", 0.0))
        # score is roughly in [-3, 3]; map to a bounded multiplier.
        tilt = float(np.clip(score / 3.0, -1, 1)) * max_tilt * regime_multiplier
        # Never let a single ETF go to zero solely on momentum.
        multipliers[code] = max(0.2, 1.0 + tilt)
    tilted = pd.Series({code: weight * multipliers.get(code, 1.0) for code, weight in strategic.items()})
    total = tilted.sum()
    return tilted / total if total > 0 else strategic
