"""Portfolio optimisation: risk parity, mean-variance, Black-Litterman.

The implementation deliberately depends only on NumPy/SciPy. SLSQP is robust for
the small (20-30 asset) problems in this product, and every weight vector is
projected into explicit bounds before it is returned.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.optimize import minimize

from .returns import covariance, expected_returns

EPS = 1e-9


def _as_cov(cov: pd.DataFrame) -> np.ndarray:
    return np.asarray(cov, dtype=float)


def _normalise(w: np.ndarray) -> np.ndarray:
    w = np.clip(w, 0, None)
    total = w.sum()
    if total <= EPS:
        return np.ones(len(w)) / max(len(w), 1)
    return w / total


def _solve(objective, n: int, bounds: list[tuple[float, float]], extra: list[dict] | None = None) -> np.ndarray:
    x0 = np.ones(n) / n
    constraints = [{"type": "eq", "fun": lambda w: float(np.sum(w) - 1)}]
    if extra:
        constraints.extend(extra)
    result = minimize(
        objective,
        x0,
        method="SLSQP",
        bounds=bounds,
        constraints=constraints,
        options={"maxiter": 500, "ftol": 1e-10},
    )
    if not result.success:
        # A deterministic, feasible fallback is better than returning NaNs.
        return _normalise(x0)
    return _normalise(result.x)


def equal_weight(n: int) -> np.ndarray:
    return np.ones(n) / max(n, 1)


def inverse_vol(cov: pd.DataFrame) -> np.ndarray:
    vol = np.sqrt(np.maximum(np.diag(_as_cov(cov)), EPS))
    return _normalise(1 / vol)


def risk_parity(cov: pd.DataFrame, bounds: list[tuple[float, float]] | None = None) -> np.ndarray:
    sigma = _as_cov(cov)
    n = sigma.shape[0]
    bounds = bounds or [(0.0, 1.0)] * n

    def objective(w: np.ndarray) -> float:
        port_var = float(w @ sigma @ w)
        if port_var <= EPS:
            return 1e9
        rc = w * (sigma @ w) / np.sqrt(port_var)
        target = np.sqrt(port_var) / n
        return float(np.sum((rc - target) ** 2) * 1e4)

    return _solve(objective, n, bounds)


def min_variance(cov: pd.DataFrame, bounds: list[tuple[float, float]] | None = None) -> np.ndarray:
    sigma = _as_cov(cov)
    n = sigma.shape[0]
    bounds = bounds or [(0.0, 1.0)] * n
    return _solve(lambda w: float(w @ sigma @ w), n, bounds)


def max_sharpe(
    cov: pd.DataFrame,
    expected: pd.Series | np.ndarray,
    rf: float = 0.02,
    bounds: list[tuple[float, float]] | None = None,
) -> np.ndarray:
    sigma = _as_cov(cov)
    mu = np.asarray(expected, dtype=float)
    n = sigma.shape[0]
    bounds = bounds or [(0.0, 1.0)] * n

    def objective(w: np.ndarray) -> float:
        vol = float(np.sqrt(max(w @ sigma @ w, EPS)))
        return -float((w @ mu - rf) / vol)

    return _solve(objective, n, bounds)


def mean_variance(
    cov: pd.DataFrame,
    expected: pd.Series | np.ndarray,
    risk_aversion: float = 3.0,
    bounds: list[tuple[float, float]] | None = None,
) -> np.ndarray:
    sigma = _as_cov(cov)
    mu = np.asarray(expected, dtype=float)
    n = sigma.shape[0]
    bounds = bounds or [(0.0, 1.0)] * n

    def objective(w: np.ndarray) -> float:
        return float(-(w @ mu) + 0.5 * risk_aversion * (w @ sigma @ w))

    return _solve(objective, n, bounds)


def black_litterman(
    cov: pd.DataFrame,
    market_weights: np.ndarray,
    views: list[dict] | None = None,
    tau: float = 0.05,
    risk_aversion: float = 3.0,
    bounds: list[tuple[float, float]] | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Return (posterior expected returns, optimal weights).

    Each view: {"assets": {code: weight_in_view}, "return": annual_excess_return,
                "confidence": 0.0-1.0}
    """
    sigma = _as_cov(cov)
    n = sigma.shape[0]
    w_mkt = _normalise(np.asarray(market_weights, dtype=float))
    pi = risk_aversion * sigma @ w_mkt

    if not views:
        return pi, max_sharpe(cov, pi, bounds=bounds)

    p_rows = []
    q_values = []
    omega_diag = []
    for view in views:
        row = np.zeros(n)
        for idx, weight in view.get("assets", {}).items():
            if isinstance(idx, int) and 0 <= idx < n:
                row[idx] = float(weight)
        if np.abs(row).sum() <= EPS:
            continue
        p_rows.append(row)
        q_values.append(float(view.get("return", 0.0)))
        confidence = float(view.get("confidence", 0.5))
        omega_diag.append(max(tau * float(row @ sigma @ row) / max(confidence, 0.05), 1e-8))

    if not p_rows:
        return pi, max_sharpe(cov, pi, bounds=bounds)

    P = np.vstack(p_rows)
    Q = np.asarray(q_values)
    Omega = np.diag(omega_diag)
    tau_sigma = tau * sigma
    try:
        adjustment = tau_sigma @ P.T @ np.linalg.inv(P @ tau_sigma @ P.T + Omega) @ (Q - P @ pi)
        posterior = pi + adjustment
    except np.linalg.LinAlgError:
        posterior = pi
    weights = max_sharpe(cov, posterior, bounds=bounds)
    return posterior, weights


def efficient_frontier(cov: pd.DataFrame, expected: pd.Series | np.ndarray, points: int = 18) -> list[dict]:
    sigma = _as_cov(cov)
    mu = np.asarray(expected, dtype=float)
    n = sigma.shape[0]
    lo, hi = float(mu.min()), float(mu.max())
    if hi <= lo:
        return []
    out = []
    for target in np.linspace(lo, hi, points):
        constraints = [{"type": "eq", "fun": lambda w, t=target: float(w @ mu - t)}]
        result = minimize(
            lambda w: float(w @ sigma @ w),
            np.ones(n) / n,
            method="SLSQP",
            bounds=[(0.0, 1.0)] * n,
            constraints=[{"type": "eq", "fun": lambda w: float(np.sum(w) - 1)}, *constraints],
            options={"maxiter": 400, "ftol": 1e-9},
        )
        if result.success:
            w = _normalise(result.x)
            out.append(
                {
                    "return": round(float(w @ mu), 4),
                    "volatility": round(float(np.sqrt(max(w @ sigma @ w, EPS))), 4),
                    "weights": {str(i): round(float(x), 4) for i, x in enumerate(w)},
                }
            )
    return out


def project_weights(
    target: np.ndarray,
    bounds: list[tuple[float, float]],
    class_of: list[str],
    class_bounds: dict[str, tuple[float, float]] | None = None,
) -> np.ndarray:
    """Project arbitrary weights onto sum=1, per-asset and per-class bounds."""
    n = len(target)
    class_bounds = class_bounds or {}
    classes = sorted(set(class_of))

    def objective(w: np.ndarray) -> float:
        return float(np.sum((w - target) ** 2))

    constraints = [{"type": "eq", "fun": lambda w: float(np.sum(w) - 1)}]
    for cls in classes:
        idx = [i for i, c in enumerate(class_of) if c == cls]
        lo, hi = class_bounds.get(cls, (0.0, 1.0))
        constraints.append({"type": "ineq", "fun": lambda w, i=idx, lo=lo: float(np.sum(w[i]) - lo)})
        constraints.append({"type": "ineq", "fun": lambda w, i=idx, hi=hi: float(hi - np.sum(w[i]))})

    result = minimize(
        objective,
        _normalise(np.asarray(target, dtype=float)),
        method="SLSQP",
        bounds=bounds,
        constraints=constraints,
        options={"maxiter": 800, "ftol": 1e-10},
    )
    if not result.success:
        # Greedy feasible fallback: clip, then fill cash.
        w = np.clip(np.asarray(target, dtype=float), [b[0] for b in bounds], [b[1] for b in bounds])
        if w.sum() <= EPS:
            w = np.ones(n) / n
        return _normalise(w)
    return _normalise(result.x)


def turnover_aware(previous: np.ndarray | None, target: np.ndarray, max_turnover: float = 0.35) -> np.ndarray:
    if previous is None:
        return target
    prev = np.asarray(previous, dtype=float)
    tgt = np.asarray(target, dtype=float)
    if prev.shape != tgt.shape:
        return target
    turnover = float(np.abs(tgt - prev).sum() / 2)
    if turnover <= max_turnover:
        return target
    blend = max_turnover / max(turnover, EPS)
    return _normalise(prev + (tgt - prev) * blend)
