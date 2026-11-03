"""Backtesting with monthly rebalancing and explicit transaction costs.

The important property is *no look-ahead*: at every rebalance date the strategy
only sees prices up to that date. The resulting curve is therefore an honest
out-of-sample-ish simulation of the rule, not a fitted narrative.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..universe import BY_CODE
from .optimize import black_litterman, max_sharpe, project_weights, risk_parity
from .returns import annualized_return, covariance, daily_returns, drawdown_series, expected_returns, max_drawdown, performance_stats
from .tactical import momentum_table, tactical_tilt


def _available_codes(panel: pd.DataFrame, min_obs: int = 120) -> list[str]:
    return [code for code in panel.columns if panel[code].notna().sum() >= min_obs]


def _weights_equal(codes: list[str]) -> pd.Series:
    return pd.Series(1.0 / len(codes), index=codes) if codes else pd.Series(dtype=float)


def _weights_class(codes: list[str], class_weights: dict[str, float]) -> pd.Series:
    classes: dict[str, list[str]] = {}
    for code in codes:
        cls = BY_CODE.get(code).asset_class if BY_CODE.get(code) else "OTHER"
        classes.setdefault(cls, []).append(code)
    out = {}
    for cls, members in classes.items():
        target = class_weights.get(cls, 0.0)
        for code in members:
            out[code] = target / len(members)
    total = sum(out.values())
    return pd.Series(out) / total if total > 0 else _weights_equal(codes)


def _strategy_weights(
    strategy: str,
    history: pd.DataFrame,
    codes: list[str],
    previous: pd.Series | None,
    bounds: list[tuple[float, float]],
    class_of: list[str],
) -> pd.Series:
    returns = daily_returns(history[codes]).dropna(how="all")
    if len(returns) < 60 or len(codes) < 2:
        return _weights_equal(codes)
    cov = covariance(returns)
    mu = expected_returns(returns)
    try:
        if strategy == "equal":
            raw = _weights_equal(codes).values
        elif strategy == "sixty_forty":
            raw = _weights_class(codes, {"CN_EQUITY": 0.6, "CN_BOND": 0.4}).reindex(codes).fillna(0).values
        elif strategy == "risk_parity":
            raw = risk_parity(cov, bounds)
        elif strategy == "mvo":
            raw = max_sharpe(cov, mu, bounds=bounds)
        elif strategy == "black_litterman":
            momentum = momentum_table(history[codes])
            views = []
            ranked = sorted(momentum.items(), key=lambda kv: kv[1].get("score", 0), reverse=True)
            for code, info in ranked[:3]:
                if info.get("score", 0) > 0:
                    views.append({"assets": {codes.index(code): 1.0}, "return": max(float(mu.get(code, 0.04)), 0.02), "confidence": 0.45})
            for code, info in ranked[-2:]:
                if info.get("score", 0) < 0:
                    views.append({"assets": {codes.index(code): 1.0}, "return": min(float(mu.get(code, 0.0)), -0.01), "confidence": 0.35})
            _, raw = black_litterman(cov, np.ones(len(codes)) / len(codes), views, bounds=bounds)
        elif strategy == "combined":
            rp = risk_parity(cov, bounds)
            bl, _ = black_litterman(cov, np.ones(len(codes)) / len(codes), [], bounds=bounds)
            base = pd.Series(0.55 * rp + 0.45 * bl, index=codes)
            momentum = momentum_table(history[codes])
            regime = {"regime": "NEUTRAL"}
            base = tactical_tilt(base, momentum, regime, max_tilt=0.2)
            raw = base.reindex(codes).fillna(0).values
        else:
            raw = _weights_equal(codes).values
        projected = project_weights(raw, bounds, class_of, None)
        return pd.Series(projected, index=codes)
    except Exception:
        return _weights_equal(codes)


def run_backtest(
    panel: pd.DataFrame,
    strategy: str,
    start: str | None = None,
    end: str | None = None,
    cost_bps: float = 10.0,
    rf: float = 0.02,
    max_single: float = 0.30,
) -> dict:
    data = panel.copy()
    data.index = pd.to_datetime(data.index)
    if start:
        data = data.loc[data.index >= pd.Timestamp(start)]
    if end:
        data = data.loc[data.index <= pd.Timestamp(end)]
    data = data.dropna(how="all")
    if len(data) < 260:
        return {"strategy": strategy, "ok": False, "error": "历史数据不足 1 年"}

    codes = _available_codes(data)
    if len(codes) < 2:
        return {"strategy": strategy, "ok": False, "error": "可用资产不足"}
    data = data[codes].ffill()
    returns = daily_returns(data).fillna(0.0)

    # Last trading day of each month.
    periods = data.index.to_series().groupby(pd.PeriodIndex(data.index, freq="M")).max()
    rebalance_dates = list(periods.values)
    rebalance_dates = [d for d in rebalance_dates if d in data.index]

    equity = [1.0]
    dates = [data.index[0]]
    previous_weights = None
    turnover_total = 0.0
    weights_history = []

    for idx, rebalance in enumerate(rebalance_dates[:-1]):
        next_date = rebalance_dates[idx + 1]
        history = data.loc[:rebalance]
        class_of = [BY_CODE[c].asset_class if c in BY_CODE else "OTHER" for c in codes]
        bounds = [(0.0, max_single)] * len(codes)
        weights = _strategy_weights(strategy, history, codes, previous_weights, bounds, class_of)
        turnover = float((weights - previous_weights).abs().sum() / 2) if previous_weights is not None else 0.0
        turnover_total += turnover
        cost = turnover * cost_bps / 10000.0
        previous_weights = weights
        weights_history.append({"date": str(rebalance)[:10], "weights": {c: round(float(w), 4) for c, w in weights.items()}})

        period = returns.loc[(returns.index > rebalance) & (returns.index <= next_date)]
        if period.empty:
            continue
        for date_, row in period.iterrows():
            port_ret = float((weights * row.reindex(weights.index).fillna(0.0)).sum())
            if len(equity) > 0 and date_ == period.index[0]:
                port_ret -= cost
            equity.append(equity[-1] * (1 + port_ret))
            dates.append(date_)

    if len(equity) < 2:
        return {"strategy": strategy, "ok": False, "error": "回测没有产生有效净值"}

    series = pd.Series(equity, index=pd.to_datetime(dates)).sort_index()
    # Downsample for the UI while keeping at least monthly resolution.
    sample = series.resample("W").last().dropna()
    benchmark = data["510300"].dropna() if "510300" in data.columns else data.iloc[:, 0].dropna()
    benchmark = benchmark / benchmark.iloc[0]
    bench_sample = benchmark.resample("W").last().dropna().reindex(sample.index).ffill()

    return {
        "strategy": strategy,
        "ok": True,
        "metrics": performance_stats(series, rf),
        "turnover": round(turnover_total / max(len(rebalance_dates) - 1, 1), 4),
        "series": [
            {
                "date": str(idx)[:10],
                "portfolio": round(float(value), 4),
                "benchmark": round(float(bench_sample.get(idx, np.nan)), 4) if idx in bench_sample.index else None,
            }
            for idx, value in sample.items()
            if np.isfinite(value)
        ],
        "drawdown": [
            {"date": str(idx)[:10], "value": round(float(value), 4)}
            for idx, value in drawdown_series(series).resample("W").last().dropna().items()
        ],
        "latest_weights": weights_history[-1] if weights_history else None,
        "latest_drawdown": round(max_drawdown(series), 4),
        "latest_cagr": round(annualized_return(series), 4),
    }


def run_all_strategies(panel: pd.DataFrame, start: str | None = None, cost_bps: float = 10.0) -> dict:
    strategies = ["equal", "sixty_forty", "risk_parity", "mvo", "black_litterman", "combined"]
    out = {}
    for name in strategies:
        out[name] = run_backtest(panel, name, start=start, cost_bps=cost_bps)
    return out
