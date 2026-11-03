"""Return, covariance and performance primitives.

All functions are pure and unit-testable. Returns are daily decimals; covariance
is annualised (252 trading days) by default.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

TRADING_DAYS = 252


def daily_returns(prices: pd.DataFrame) -> pd.DataFrame:
    if prices is None or prices.empty:
        return pd.DataFrame()
    clean = prices.replace([np.inf, -np.inf], np.nan).ffill(limit=5)
    returns = clean.pct_change()
    returns = returns.replace([np.inf, -np.inf], np.nan)
    return returns


def expected_returns(returns: pd.DataFrame, method: str = "shrunk") -> pd.Series:
    """Annualised expected return.

    The sample mean is a notoriously noisy estimator. We shrink each asset's
    mean toward the cross-sectional average, which is a simple James-Stein style
    stabiliser and keeps the optimiser from putting all weight on one lucky ETF.
    """
    if returns is None or returns.empty:
        return pd.Series(dtype=float)
    mean = returns.mean() * TRADING_DAYS
    if method == "sample" or len(mean) < 3:
        return mean.fillna(0.0)
    grand = float(mean.mean())
    # Shrink 50% toward the grand mean; with long histories this is conservative.
    return (0.5 * mean + 0.5 * grand).fillna(grand)


def covariance(returns: pd.DataFrame, annualize: bool = True, shrinkage: bool = True) -> pd.DataFrame:
    """Covariance matrix with Ledoit-Wolf style shrinkage toward the diagonal."""
    if returns is None or returns.shape[1] == 0:
        return pd.DataFrame()
    clean = returns.dropna(how="all").fillna(0.0)
    n = len(clean)
    if n < 10:
        cov = clean.cov().fillna(0.0)
    else:
        x = clean.values
        x = x - x.mean(axis=0, keepdims=True)
        sample = (x.T @ x) / max(n - 1, 1)
        sample = np.nan_to_num(sample, nan=0.0, posinf=0.0, neginf=0.0)
        if shrinkage and sample.shape[0] > 1:
            target = np.diag(np.diag(sample))
            # Estimate the variance of sample covariance entries.
            # b2 = sum Var(s_ij); d2 = ||S - F||^2; shrinkage = min(b2/d2, 1)
            x2 = x * x
            var_ij = (x2.T @ x2) / max(n - 1, 1) - sample * sample
            b2 = float(np.nansum(var_ij))
            d2 = float(np.nansum((sample - target) ** 2))
            shrink = 0.0 if d2 <= 0 else min(max(b2 / d2, 0.0), 1.0)
            # Do not over-shrink; 0.2 is a floor for numerical stability.
            shrink = max(shrink, 0.2)
            sample = shrink * target + (1 - shrink) * sample
        cov = pd.DataFrame(sample, index=clean.columns, columns=clean.columns)
    if annualize:
        cov = cov * TRADING_DAYS
    return cov


def portfolio_returns(weights: pd.Series | np.ndarray, returns: pd.DataFrame) -> pd.Series:
    w = np.asarray(weights, dtype=float)
    if returns is None or returns.empty:
        return pd.Series(dtype=float)
    clean = returns.fillna(0.0)
    return pd.Series(clean.values @ w, index=clean.index)


def max_drawdown(series: pd.Series) -> float:
    if series is None or len(series) == 0:
        return 0.0
    values = series.astype(float).values
    peaks = np.maximum.accumulate(values)
    drawdowns = values / np.where(peaks == 0, np.nan, peaks) - 1
    return float(np.nanmin(drawdowns)) if len(drawdowns) else 0.0


def drawdown_series(series: pd.Series) -> pd.Series:
    if series is None or len(series) == 0:
        return pd.Series(dtype=float)
    values = series.astype(float)
    peaks = values.cummax()
    return values / peaks - 1


def annualized_return(series: pd.Series) -> float:
    if series is None or len(series) < 2:
        return 0.0
    total = float(series.iloc[-1] / series.iloc[0])
    years = max(len(series) / TRADING_DAYS, 1e-9)
    return total ** (1 / years) - 1 if total > 0 else 0.0


def annualized_vol(series: pd.Series) -> float:
    if series is None or len(series) < 2:
        return 0.0
    return float(series.pct_change().std(ddof=1) * np.sqrt(TRADING_DAYS))


def sharpe(series: pd.Series, rf: float = 0.02) -> float:
    vol = annualized_vol(series)
    if vol <= 0:
        return 0.0
    return (annualized_return(series) - rf) / vol


def sortino(series: pd.Series, rf: float = 0.02) -> float:
    if series is None or len(series) < 2:
        return 0.0
    r = series.pct_change().dropna()
    downside = r[r < 0]
    dd = float(downside.std(ddof=1) * np.sqrt(TRADING_DAYS)) if len(downside) > 1 else 0.0
    if dd <= 0:
        return 0.0
    return (annualized_return(series) - rf) / dd


def performance_stats(series: pd.Series, rf: float = 0.02) -> dict:
    if series is None or len(series) < 2:
        return {
            "cagr": 0.0,
            "volatility": 0.0,
            "sharpe": 0.0,
            "sortino": 0.0,
            "max_drawdown": 0.0,
            "calmar": 0.0,
            "win_rate": 0.0,
        }
    r = series.pct_change().dropna()
    mdd = max_drawdown(series)
    cagr = annualized_return(series)
    return {
        "cagr": round(cagr, 4),
        "volatility": round(annualized_vol(series), 4),
        "sharpe": round(sharpe(series, rf), 3),
        "sortino": round(sortino(series, rf), 3),
        "max_drawdown": round(mdd, 4),
        "calmar": round(cagr / abs(mdd), 3) if mdd < 0 else 0.0,
        "win_rate": round(float((r > 0).mean()), 3) if len(r) else 0.0,
    }


def risk_contributions(weights: pd.Series | np.ndarray, cov: pd.DataFrame) -> pd.Series:
    w = np.asarray(weights, dtype=float)
    sigma = np.asarray(cov, dtype=float)
    port_var = float(w @ sigma @ w)
    if port_var <= 0:
        return pd.Series(np.zeros(len(w)), index=cov.index)
    marginal = sigma @ w
    contrib = w * marginal / np.sqrt(port_var)
    contrib = contrib / contrib.sum() if contrib.sum() != 0 else contrib
    return pd.Series(contrib, index=cov.index)


def zscore(series: pd.Series) -> pd.Series:
    std = series.std(ddof=0)
    if not np.isfinite(std) or std <= 0:
        return pd.Series(np.zeros(len(series)), index=series.index)
    return (series - series.mean()) / std
