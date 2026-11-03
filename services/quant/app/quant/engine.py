"""End-to-end analysis engine.

Pipeline:
  holdings + cash
    -> data panel (real ETF prices)
    -> current allocation / investable vs non-investable
    -> strategic engines (risk parity, MVO, Black-Litterman)
    -> tactical overlay (momentum / trend / macro regime)
    -> constraint projection
    -> implementation (ETF trades)
    -> risk (VaR/CVaR, stress, drawdown, risk budget)
    -> backtest (no look-ahead)
    -> goals (emergency / education / retirement / debt)
    -> screening + charts + citations

Every number in the result comes from this pipeline or from the database; the
LLM layer only interprets it.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

import numpy as np
import pandas as pd

from .. import store
from ..providers import market
from ..providers.macro import macro_snapshot
from .backtest import run_all_strategies, run_backtest
from .goals import goal_plan
from .optimize import black_litterman, efficient_frontier, max_sharpe, project_weights, risk_parity
from .returns import (
    annualized_return,
    annualized_vol,
    covariance,
    daily_returns,
    expected_returns,
    performance_stats,
    portfolio_returns,
    sharpe,
)
from .risk import portfolio_risk_snapshot
from .screening import screen_etfs
from .tactical import market_regime, momentum_table, tactical_tilt
from ..schemas import AnalysisRequest
from ..universe import BY_CODE, CLASS_META, CLASS_ORDER, DEFAULT_CLASS_BOUNDS, UNIVERSE
from ..utils import to_native

INVESTABLE_CLASSES = {"CASH", "CN_BOND", "CN_EQUITY", "HK_EQUITY", "US_EQUITY", "GOLD", "COMMODITY", "SATELLITE"}
NON_INVESTABLE_CLASSES = {"REAL_ESTATE", "INSURANCE", "OTHER"}


def _class_of(code: str | None, fallback: str | None = None) -> str:
    if code and code in BY_CODE:
        return BY_CODE[code].asset_class
    if fallback in INVESTABLE_CLASSES or fallback in NON_INVESTABLE_CLASSES:
        return str(fallback)
    return "OTHER"


def _name_of(code: str) -> str:
    return BY_CODE[code].name if code in BY_CODE else code


def _weights_series(mapping: dict[str, float]) -> pd.Series:
    series = pd.Series(mapping, dtype=float)
    return series[series > 0].sort_values(ascending=False)


def _stats(weights: pd.Series, returns: pd.DataFrame, rf: float = 0.02) -> dict:
    if weights.empty or returns.empty:
        return {"expected_return": 0.0, "volatility": 0.0, "sharpe": 0.0, "max_drawdown": 0.0}
    aligned = weights.reindex(returns.columns).fillna(0.0)
    port = portfolio_returns(aligned, returns).dropna()
    stats = performance_stats((1 + port).cumprod(), rf)
    return {
        "expected_return": round(float((aligned * expected_returns(returns).reindex(aligned.index).fillna(0)).sum()), 4),
        "volatility": round(annualized_vol((1 + port).cumprod()), 4),
        "sharpe": round(sharpe((1 + port).cumprod(), rf), 3),
        "max_drawdown": stats.get("max_drawdown", 0.0),
    }


def _project(
    raw: np.ndarray,
    codes: list[str],
    constraints,
) -> pd.Series:
    classes = [_class_of(code) for code in codes]
    bounds = []
    for code, cls in zip(codes, classes):
        upper = float(constraints.max_single_etf)
        if cls == "CASH":
            upper = min(upper, 0.40)
        bounds.append((0.0, upper))

    class_bounds = dict(DEFAULT_CLASS_BOUNDS)
    if constraints.class_bounds:
        for cls, pair in constraints.class_bounds.items():
            class_bounds[cls] = (max(0.0, float(pair[0])), min(1.0, float(pair[1])))
    # Respect user-level caps by tightening class upper bounds.
    for cls in ("CN_EQUITY", "HK_EQUITY", "US_EQUITY", "SATELLITE"):
        lo, hi = class_bounds.get(cls, (0.0, 1.0))
        class_bounds[cls] = (lo, min(hi, float(constraints.max_equity)))
    for cls in ("HK_EQUITY", "US_EQUITY"):
        lo, hi = class_bounds.get(cls, (0.0, 1.0))
        class_bounds[cls] = (lo, min(hi, float(constraints.max_overseas)))
    lo, hi = class_bounds.get("SATELLITE", (0.0, 1.0))
    class_bounds["SATELLITE"] = (lo, min(hi, float(constraints.max_satellite)))
    lo, hi = class_bounds.get("CASH", (0.0, 1.0))
    class_bounds["CASH"] = (max(lo, float(constraints.min_cash)), hi)

    # If lower bounds are infeasible, scale them down proportionally.
    lower_total = sum(class_bounds.get(cls, (0, 0))[0] for cls in set(classes))
    if lower_total > 0.98:
        scale = 0.98 / lower_total
        for cls in list(class_bounds):
            lo, hi = class_bounds[cls]
            class_bounds[cls] = (lo * scale, hi)

    projected = project_weights(raw, bounds, classes, class_bounds)
    return pd.Series(projected, index=codes)


def _strategic(
    codes: list[str],
    returns: pd.DataFrame,
    regime: dict,
    constraints,
    current_weights: pd.Series,
    rf: float = 0.02,
) -> dict[str, pd.Series]:
    cov = covariance(returns[codes]) if len(codes) > 1 else pd.DataFrame()
    if cov.empty:
        eq = pd.Series(1 / len(codes), index=codes)
        return {"risk_parity": eq, "mvo": eq, "black_litterman": eq, "ensemble": eq}

    bounds = [(0.0, float(constraints.max_single_etf))] * len(codes)
    mu = expected_returns(returns[codes])
    rp = pd.Series(risk_parity(cov, bounds), index=codes)
    mvo = pd.Series(max_sharpe(cov, mu, rf=rf, bounds=bounds), index=codes)

    momentum = momentum_table(returns[codes])
    ranked = sorted(momentum.items(), key=lambda kv: kv[1].get("score", 0), reverse=True)
    views = []
    for code, info in ranked[:3]:
        if info.get("score", 0) > 0:
            views.append({"assets": {codes.index(code): 1.0}, "return": max(float(mu.get(code, 0.04)), 0.015), "confidence": 0.45})
    for code, info in ranked[-2:]:
        if info.get("score", 0) < 0:
            views.append({"assets": {codes.index(code): 1.0}, "return": min(float(mu.get(code, 0.0)), -0.01), "confidence": 0.35})
    market_weights = current_weights.reindex(codes).fillna(0.0).values
    if market_weights.sum() <= 0:
        market_weights = np.ones(len(codes)) / len(codes)
    posterior, bl_raw = black_litterman(cov, market_weights, views, bounds=bounds)
    bl = pd.Series(bl_raw, index=codes)

    regime_name = regime.get("regime", "NEUTRAL")
    if regime_name == "RISK_ON":
        mix = (0.25, 0.35, 0.40)
    elif regime_name == "RISK_OFF":
        mix = (0.55, 0.20, 0.25)
    else:
        mix = (0.40, 0.30, 0.30)
    ensemble_raw = mix[0] * rp.values + mix[1] * mvo.values + mix[2] * bl.values
    ensemble = _project(ensemble_raw, codes, constraints)

    return {
        "risk_parity": _project(rp.values, codes, constraints),
        "mvo": _project(mvo.values, codes, constraints),
        "black_litterman": _project(bl.values, codes, constraints),
        "ensemble": ensemble,
        "expected_returns": mu,
        "posterior": pd.Series(posterior, index=codes),
        "mix": {"risk_parity": mix[0], "mvo": mix[1], "black_litterman": mix[2]},
    }


def _weights_payload(weights: pd.Series) -> list[dict]:
    return [
        {
            "code": code,
            "name": _name_of(code),
            "asset_class": _class_of(code),
            "class_label": CLASS_META.get(_class_of(code), {}).get("label", _class_of(code)),
            "color": CLASS_META.get(_class_of(code), {}).get("color", "#94a3b8"),
            "weight": round(float(weight), 4),
        }
        for code, weight in weights.sort_values(ascending=False).items()
        if weight > 0.0001
    ]


def _class_payload(weights: pd.Series) -> list[dict]:
    buckets: dict[str, float] = {}
    for code, weight in weights.items():
        cls = _class_of(code)
        buckets[cls] = buckets.get(cls, 0.0) + float(weight)
    return [
        {
            "key": cls,
            "label": CLASS_META.get(cls, {}).get("label", cls),
            "color": CLASS_META.get(cls, {}).get("color", "#94a3b8"),
            "weight": round(weight, 4),
        }
        for cls, weight in sorted(buckets.items(), key=lambda kv: kv[1], reverse=True)
    ]


def _build_charts(
    current_class: list[dict],
    target_class: list[dict],
    frontier: list[dict],
    backtest: dict,
    risk_current: dict | None,
    risk_target: dict | None,
    goal: dict,
    macro: dict,
) -> list[dict]:
    charts = []
    charts.append(
        {
            "id": "allocation-compare",
            "type": "grouped_bar",
            "title": "当前配置 vs 目标配置",
            "unit": "%",
            "data": [
                {
                    "label": item["label"],
                    "current": round(item["weight"] * 100, 1),
                    "target": round(next((t["weight"] for t in target_class if t["key"] == item["key"]), 0.0) * 100, 1),
                    "color": item["color"],
                }
                for item in current_class
            ],
            "note": "目标权重由风险平价 / 均值方差 / Black-Litterman 集成后，经约束投影得到。",
        }
    )
    if frontier:
        charts.append(
            {
                "id": "efficient-frontier",
                "type": "scatter",
                "title": "有效前沿与当前/目标组合",
                "xLabel": "年化波动率",
                "yLabel": "年化预期收益",
                "data": frontier,
                "note": "仅使用历史数据估计，不代表未来收益。",
            }
        )
    combined = (backtest or {}).get("combined") or {}
    if combined.get("ok") and combined.get("series"):
        charts.append(
            {
                "id": "backtest",
                "type": "line",
                "title": "策略回测：组合净值",
                "data": combined["series"],
                "note": "月度再平衡、单边 10bp 交易成本；基准为沪深300ETF。",
            }
        )
        charts.append(
            {
                "id": "drawdown",
                "type": "area",
                "title": "回测最大回撤",
                "data": combined.get("drawdown", []),
                "note": "回撤衡量从历史高点到低点的跌幅。",
            }
        )
    if risk_target and risk_target.get("risk_budget"):
        charts.append(
            {
                "id": "risk-budget",
                "type": "hbar",
                "title": "目标组合风险贡献",
                "data": [
                    {"label": _name_of(item["code"]), "value": round(item["risk_contribution"] * 100, 1)}
                    for item in risk_target["risk_budget"][:10]
                ],
                "note": "风险贡献不等于资金权重；低波动资产可能占用更多资金但贡献更少风险。",
            }
        )
    if risk_target and risk_target.get("correlation"):
        charts.append(
            {
                "id": "correlation",
                "type": "heatmap",
                "title": "资产相关性（近一年）",
                "data": risk_target["correlation"],
                "note": "相关性越低，分散效果越好；危机时相关性可能上升。",
            }
        )
    if macro.get("indicators"):
        charts.append(
            {
                "id": "macro",
                "type": "table",
                "title": "宏观仪表盘",
                "columns": [
                    {"key": "label", "label": "指标"},
                    {"key": "value", "label": "最新值"},
                    {"key": "date", "label": "观测日期"},
                    {"key": "change", "label": "环比变化"},
                ],
                "rows": [
                    {
                        "label": item["label"],
                        "value": f"{item['value']}{item['unit']}",
                        "date": item["date"],
                        "change": f"{item['change']:+.2f}" if item.get("change") is not None else "—",
                    }
                    for item in macro["indicators"]
                ],
                "note": "宏观数据存在发布滞后；每个指标标注实际观测日期。",
            }
        )
    if goal.get("goals"):
        charts.append(
            {
                "id": "goal-progress",
                "type": "hbar",
                "title": "目标资金缺口",
                "data": [
                    {"label": item["name"], "value": round(item["gap"], 0)}
                    for item in goal["goals"]
                ],
                "note": "缺口按目标日期、通胀与假设收益率折现；假设见目标明细。",
            }
        )
    return charts


def _citations(as_of: str, panel: pd.DataFrame, macro: dict) -> list[dict]:
    dates = [str(idx)[:10] for idx in panel.index[-1:]]
    latest = dates[0] if dates else as_of
    citations = [
        {
            "type": "market",
            "label": "ETF 日行情",
            "detail": f"AkShare / 东方财富，复权收盘价，最新交易日 {latest}",
            "as_of": latest,
        },
        {
            "type": "macro",
            "label": "中国宏观与利率",
            "detail": "国家统计局、中国人民银行、中国债券信息网、FRED；各指标观测日期见宏观表",
            "as_of": macro.get("as_of", as_of),
        },
        {
            "type": "method",
            "label": "组合优化",
            "detail": "风险平价（等风险贡献）、均值方差（最大夏普）、Black-Litterman（动量观点）、约束投影",
            "as_of": as_of,
        },
        {
            "type": "method",
            "label": "风险与回测",
            "detail": "历史 VaR/CVaR、参数 VaR、历史压力窗口、月度再平衡、单边 10bp 成本",
            "as_of": as_of,
        },
    ]
    return citations


def analyze(request: AnalysisRequest) -> dict:
    as_of = request.as_of or date.today().isoformat()
    warnings: list[str] = []

    # 1. Current holdings and investable / non-investable split.
    total_value = sum(item.market_value for item in request.holdings) + request.cash
    non_investable = 0.0
    investable_map: dict[str, float] = {}
    holding_rows = []
    for item in request.holdings:
        cls = _class_of(item.code, item.asset_class)
        if cls in NON_INVESTABLE_CLASSES:
            non_investable += item.market_value
        else:
            code = item.code if item.code in BY_CODE else None
            if code is None:
                # A liquid holding without a known ETF code: keep it visible but
                # do not force it into the optimiser.
                non_investable += item.market_value
                warnings.append(f"「{item.name}」没有可识别的 ETF 代码，已计入非可投资资产。")
            else:
                investable_map[code] = investable_map.get(code, 0.0) + item.market_value
        holding_rows.append(
            {
                "code": item.code,
                "name": item.name,
                "asset_class": cls,
                "class_label": CLASS_META.get(cls, {}).get("label", cls),
                "market_value": round(item.market_value, 2),
                "cost_basis": item.cost_basis,
                "quantity": item.quantity,
                "weight_total": round(item.market_value / total_value, 4) if total_value else 0,
            }
        )
    if request.cash > 0:
        investable_map["511880"] = investable_map.get("511880", 0.0) + request.cash
    investable_value = sum(investable_map.values())
    if investable_value <= 0:
        raise ValueError("没有可投资的 ETF/现金资产，无法进行配置优化。请至少录入一只 ETF 或现金。")

    # 2. Market data.
    panel = market.get_panel(start="2018-01-01", refresh=request.refresh_data)
    if panel.empty:
        raise market.DataUnavailable("行情数据不可用，请检查网络或本地缓存。")
    panel = panel.ffill(limit=5)
    returns = daily_returns(panel).dropna(how="all")

    available = [code for code in investable_map if code in panel.columns and panel[code].notna().sum() >= 120]
    missing = [code for code in investable_map if code not in available]
    if missing:
        warnings.append(f"以下持仓历史不足或不在核心池，未参与优化：{', '.join(missing)}")
    if len(available) < 2:
        raise ValueError("可参与优化的资产不足 2 个。请录入核心宽基 ETF 或现金。")
    current_weights = pd.Series({code: investable_map[code] / investable_value for code in available}, dtype=float)
    current_weights = current_weights / current_weights.sum()

    # 3. Macro and regime.
    macro = macro_snapshot(force=request.refresh_data)
    regime = market_regime(panel, macro)

    # 4. Strategic + tactical.
    momentum = momentum_table(panel[available])
    strategic = _strategic(available, returns, regime, request.constraints, current_weights)
    target = tactical_tilt(strategic["ensemble"], momentum, regime, max_tilt=0.25)
    target = _project(target.values, available, request.constraints)

    # 5. Strategies and implementation.
    latest_prices = {code: float(panel[code].dropna().iloc[-1]) for code in available}
    target_value = {code: float(target.get(code, 0.0)) * investable_value for code in available}
    current_value = {code: float(current_weights.get(code, 0.0)) * investable_value for code in available}
    trades = []
    for code in available:
        delta = target_value[code] - current_value[code]
        price = latest_prices.get(code)
        shares = 0
        if price and price > 0:
            shares = int(round(abs(delta) / price / 100.0) * 100) * (1 if delta > 0 else -1)
            if shares == 0 and abs(delta) / investable_value >= 0.005:
                shares = 100 * (1 if delta > 0 else -1)
        trades.append(
            {
                "code": code,
                "name": _name_of(code),
                "asset_class": _class_of(code),
                "current_weight": round(float(current_weights.get(code, 0.0)), 4),
                "target_weight": round(float(target.get(code, 0.0)), 4),
                "delta_weight": round(float(target.get(code, 0.0) - current_weights.get(code, 0.0)), 4),
                "current_value": round(current_value[code], 2),
                "target_value": round(target_value[code], 2),
                "delta_value": round(delta, 2),
                "price": round(price, 4) if price else None,
                "shares": shares,
                "action": "BUY" if delta > 0.005 * investable_value else "SELL" if delta < -0.005 * investable_value else "HOLD",
                "reason": _trade_reason(code, target, current_weights, regime, momentum),
            }
        )
    trades.sort(key=lambda item: abs(item["delta_value"]), reverse=True)

    # 6. Risk.
    cov = covariance(returns[available]) if len(available) > 1 else pd.DataFrame()
    class_map = {code: _class_of(code) for code in available}
    risk_current = portfolio_risk_snapshot(current_weights, returns[available], cov, class_map)
    risk_target = portfolio_risk_snapshot(target, returns[available], cov, class_map)

    # 7. Efficient frontier.
    mu = strategic["expected_returns"]
    frontier = []
    try:
        raw = efficient_frontier(cov, mu)
        for point in raw:
            # efficient_frontier uses positional weights; map back to codes.
            weights = [point["weights"].get(str(i), 0.0) for i in range(len(available))]
            point["weights"] = {available[i]: weights[i] for i in range(len(available))}
            frontier.append(point)
        frontier.append(
            {
                "return": round(float((target * mu.reindex(target.index)).sum()), 4),
                "volatility": round(float(np.sqrt(max(float(target.values @ cov.values @ target.values), 0))), 4),
                "label": "目标组合",
                "kind": "target",
            }
        )
        frontier.append(
            {
                "return": round(float((current_weights * mu.reindex(current_weights.index)).sum()), 4),
                "volatility": round(float(np.sqrt(max(float(current_weights.values @ cov.values @ current_weights.values), 0))), 4),
                "label": "当前组合",
                "kind": "current",
            }
        )
    except Exception:
        frontier = []

    # 8. Backtest (cached by data end date + universe).
    backtest = {}
    if request.include_backtest:
        cache_key = f"bt:{panel.index[-1]}:{','.join(available)}"
        cached = getattr(analyze, "_bt_cache", None)
        if cached and cached.get("key") == cache_key:
            backtest = cached["value"]
        else:
            backtest = run_all_strategies(panel[available], start="2019-01-01")
            analyze._bt_cache = {"key": cache_key, "value": backtest}  # type: ignore[attr-defined]

    # 9. Goals.
    cash_like = sum(item.market_value for item in request.holdings if _class_of(item.code, item.asset_class) == "CASH") + request.cash
    goal = goal_plan(request.profile.model_dump(), [item.model_dump() for item in request.goals], [item.model_dump() for item in request.liabilities], cash_like)

    # 10. Screening.
    try:
        spot = market.get_spot(force=request.refresh_data, live=request.refresh_data)
        screening = screen_etfs(spot, {item["key"]: item["weight"] for item in _class_payload(target)}, returns[available])
    except Exception:
        screening = []

    current_class = _class_payload(pd.Series({code: investable_map[code] / investable_value for code in available}))
    target_class = _class_payload(target)
    charts = _build_charts(current_class, target_class, frontier, backtest, risk_current, risk_target, goal, macro)

    # 11. Summary and citations.
    summary = _summary(current_class, target_class, regime, risk_target, goal, investable_value)
    citations = _citations(as_of, panel, macro)

    strategy_payload = {}
    for key in ("risk_parity", "mvo", "black_litterman", "ensemble"):
        weights = strategic[key]
        strategy_payload[key] = {
            "label": {
                "risk_parity": "风险平价",
                "mvo": "均值方差（最大夏普）",
                "black_litterman": "Black-Litterman",
                "ensemble": "集成策略",
            }[key],
            "weights": _weights_payload(weights),
            "class_weights": _class_payload(weights),
            "metrics": _stats(weights, returns[available]),
        }

    target_stats = _stats(target, returns[available])
    turnover = float((target - current_weights.reindex(target.index).fillna(0.0)).abs().sum() / 2)

    return to_native({
        "meta": {
            "as_of": as_of,
            "data_start": str(panel.index[0])[:10],
            "data_end": str(panel.index[-1])[:10],
            "universe": len(available),
            "total_value": round(total_value, 2),
            "investable_value": round(investable_value, 2),
            "non_investable_value": round(non_investable, 2),
            "mode": "real_data",
            "warnings": warnings,
            "llm_configured": False,
        },
        "market": {
            "regime": regime,
            "macro": macro,
            "breadth": next((s for s in regime.get("signals", []) if "站上" in s["name"]), None),
            "benchmark": {
                "code": "510300",
                "name": "沪深300ETF",
                "last": round(float(panel["510300"].dropna().iloc[-1]), 4) if "510300" in panel.columns and not panel["510300"].dropna().empty else None,
                "trend": next((s["value"] for s in regime.get("signals", []) if "200 日" in s["name"]), None),
            },
            "momentum": [
                {
                    "code": code,
                    "name": _name_of(code),
                    "asset_class": _class_of(code),
                    "score": round(float(info.get("score", 0)), 3),
                    "mom_12m": round(float(info.get("mom_12m", 0)), 4),
                    "mom_6m": round(float(info.get("mom_6m", 0)), 4),
                    "trend": info.get("trend"),
                    "volatility": round(float(info["vol"]), 4) if info.get("vol") is not None else None,
                }
                for code, info in sorted(momentum.items(), key=lambda kv: kv[1].get("score", 0), reverse=True)
            ],
        },
        "portfolio": {
            "total_value": round(total_value, 2),
            "investable_value": round(investable_value, 2),
            "non_investable_value": round(non_investable, 2),
            "holdings": holding_rows,
            "current_weights": _weights_payload(current_weights),
            "current_class_weights": current_class,
            "liabilities": [item.model_dump() for item in request.liabilities],
        },
        "strategies": strategy_payload,
        "target": {
            "weights": _weights_payload(target),
            "class_weights": target_class,
            "trades": trades,
            "turnover": round(turnover, 4),
            "expected_return": target_stats["expected_return"],
            "expected_volatility": target_stats["volatility"],
            "expected_sharpe": target_stats["sharpe"],
            "max_drawdown": target_stats["max_drawdown"],
            "mix": strategic.get("mix"),
        },
        "risk": {
            "current": risk_current,
            "target": risk_target,
        },
        "backtest": backtest,
        "goals": goal,
        "screening": screening,
        "charts": charts,
        "summary": summary,
        "citations": citations,
    })


def _trade_reason(code: str, target: pd.Series, current: pd.Series, regime: dict, momentum: dict) -> str:
    delta = float(target.get(code, 0.0) - current.get(code, 0.0))
    if abs(delta) < 0.005:
        return "偏离在 0.5% 以内，暂不调整。"
    direction = "增加" if delta > 0 else "降低"
    cls = _class_of(code)
    parts = [f"{direction}「{_name_of(code)}」以贴近目标权重"]
    info = momentum.get(code, {})
    if info.get("trend") == "UP":
        parts.append("趋势向上")
    elif info.get("trend") == "DOWN":
        parts.append("趋势偏弱")
    if cls in {"CN_EQUITY", "HK_EQUITY", "US_EQUITY", "SATELLITE"}:
        parts.append(f"当前市场状态为{regime.get('label', '中性')}")
    return "；".join(parts) + "。"


def _summary(current: list[dict], target: list[dict], regime: dict, risk: dict, goal: dict, investable: float) -> str:
    target_map = {item["key"]: item["weight"] for item in target}
    current_map = {item["key"]: item["weight"] for item in current}
    changes = []
    for key in CLASS_ORDER:
        delta = target_map.get(key, 0.0) - current_map.get(key, 0.0)
        if abs(delta) >= 0.03:
            label = CLASS_META.get(key, {}).get("label", key)
            changes.append(f"{label}{'+' if delta > 0 else ''}{delta * 100:.0f}%")
    change_text = "、".join(changes[:4]) if changes else "大类比例基本不变"
    var = (risk or {}).get("var", {}).get("95_1m", {}).get("var_historical")
    var_text = f"目标组合 95% 一个月历史 VaR 约 {var * 100:.1f}%" if var else "风险指标待补"
    emergency = goal.get("emergency_fund", {})
    emergency_text = (
        f"应急金覆盖 {emergency.get('months_covered')} 个月"
        if emergency.get("months_covered") is not None
        else "应急金待补充月支出"
    )
    return (
        f"市场状态：{regime.get('label', '中性')}（{regime.get('score', 50)}/100）。"
        f"可投资资产 {investable:,.0f} 元，建议调整：{change_text}。"
        f"{var_text}；{emergency_text}。"
        f"所有比例均为资产大类/ETF 层面，不构成个股买卖点建议。"
    )
