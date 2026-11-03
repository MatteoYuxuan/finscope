"""Unit tests for the quant primitives.

These tests are deliberately independent of the network: they use synthetic
returns so `pytest` can run on a plane, in CI, or during a demo without Wi-Fi.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.quant.backtest import run_backtest
from app.quant.goals import emergency_fund, required_monthly, project_goal
from app.quant.optimize import black_litterman, project_weights, risk_parity
from app.quant.returns import covariance, daily_returns, performance_stats
from app.quant.risk import var_cvar


def synthetic_prices(days: int = 420, assets: int = 4) -> pd.DataFrame:
    rng = np.random.default_rng(7)
    dates = pd.bdate_range("2023-01-02", periods=days)
    data = {}
    for i in range(assets):
        mu = 0.0002 + i * 0.00008
        vol = 0.008 + i * 0.002
        shocks = rng.normal(mu, vol, days)
        data[f"A{i}"] = 100 * np.exp(np.cumsum(shocks))
    return pd.DataFrame(data, index=[d.strftime("%Y-%m-%d") for d in dates])


def test_risk_parity_weights_are_valid():
    panel = synthetic_prices()
    cov = covariance(daily_returns(panel))
    weights = risk_parity(cov, [(0.0, 0.6)] * 4)
    assert len(weights) == 4
    assert weights.sum() == pytest.approx(1.0, abs=1e-6)
    assert (weights >= -1e-9).all()
    assert (weights <= 0.6001).all()


def test_projection_respects_single_asset_cap():
    target = np.array([0.8, 0.1, 0.05, 0.05])
    projected = project_weights(target, [(0.0, 0.4)] * 4, ["CN_EQUITY"] * 4, {"CN_EQUITY": (0.0, 1.0)})
    assert projected.sum() == pytest.approx(1.0, abs=1e-6)
    assert projected.max() <= 0.4001


def test_black_litterman_returns_feasible_weights():
    panel = synthetic_prices()
    cov = covariance(daily_returns(panel))
    views = [{"assets": {0: 1.0}, "return": 0.08, "confidence": 0.5}]
    posterior, weights = black_litterman(cov, np.ones(4) / 4, views, bounds=[(0.0, 0.6)] * 4)
    assert len(posterior) == 4
    assert weights.sum() == pytest.approx(1.0, abs=1e-6)


def test_var_is_non_negative_and_cvar_larger():
    panel = synthetic_prices()
    returns = daily_returns(panel)
    weights = pd.Series([0.4, 0.3, 0.2, 0.1], index=returns.columns)
    result = var_cvar(weights, returns, 0.95, 1)
    assert result["var_historical"] is not None
    assert result["var_historical"] >= 0
    assert result["cvar_historical"] >= result["var_historical"] - 1e-9


def test_backtest_produces_metrics_and_no_nan():
    panel = synthetic_prices()
    result = run_backtest(panel, "risk_parity", cost_bps=10)
    assert result["ok"] is True
    metrics = result["metrics"]
    assert metrics["volatility"] >= 0
    assert isinstance(metrics["sharpe"], float)
    assert result["series"]
    assert all(np.isfinite(point["portfolio"]) for point in result["series"])


def test_goal_math_and_emergency_fund():
    monthly = required_monthly(100_000, 0.05, 5)
    assert monthly > 0
    goal = project_goal(
        {"name": "教育金", "target_amount": 200_000, "current_amount": 20_000, "years": 5, "monthly_contribution": 1000},
        default_return=0.05,
        default_inflation=0.025,
    )
    assert goal["future_cost"] > goal["target_amount"]
    assert 0 <= goal["success_probability"] <= 1
    emergency = emergency_fund(60_000, 10_000, 6)
    assert emergency["target_amount"] == 60_000
    assert emergency["status"] == "ok"
