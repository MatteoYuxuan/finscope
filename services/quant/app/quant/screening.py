"""ETF / fund screening.

Screening is deliberately separate from optimisation: the optimiser chooses
*asset-class* weights, then this module chooses the most suitable liquid
instrument inside each class. That separation makes the advice auditable.
"""

from __future__ import annotations

import math
from typing import Iterable

import numpy as np
import pandas as pd

from ..universe import BY_CODE, CLASS_META, UNIVERSE


def _log_score(value: float | None, lo: float, hi: float) -> float:
    if value is None or value <= 0:
        return 0.0
    v = math.log10(max(value, 1))
    return float(np.clip((v - lo) / max(hi - lo, 1e-6), 0, 1))


def screen_etfs(
    spot: list[dict],
    target_class_weights: dict[str, float] | None = None,
    returns: pd.DataFrame | None = None,
    max_per_class: int = 3,
    min_amount: float = 5_000_000,
) -> list[dict]:
    target_class_weights = target_class_weights or {}
    spot_by_code = {str(item.get("code")): item for item in spot}
    rows = []
    for asset in UNIVERSE:
        quote = spot_by_code.get(asset.code, {})
        amount = quote.get("amount")
        market_cap = quote.get("market_cap") or quote.get("shares")
        liquidity = _log_score(amount, 6.0, 9.5)  # 1M -> 3B CNY
        size = _log_score(market_cap, 8.0, 11.0)
        fee_score = float(np.clip(1 - asset.fee / 0.012, 0, 1))

        # Tracking error vs the equally weighted class peers (a transparent proxy
        # when the benchmark index series is not available for every ETF).
        tracking = 0.5
        if returns is not None and asset.code in returns.columns:
            peers = [
                item.code
                for item in UNIVERSE
                if item.asset_class == asset.asset_class and item.code in returns.columns and item.code != asset.code
            ]
            if peers:
                peer_ret = returns[peers].mean(axis=1)
                diff = (returns[asset.code] - peer_ret).dropna().tail(252)
                if len(diff) > 20:
                    te = float(diff.std() * np.sqrt(252))
                    tracking = float(np.clip(1 - te / 0.25, 0, 1))

        score = 0.45 * liquidity + 0.20 * size + 0.20 * fee_score + 0.15 * tracking
        if amount is not None and amount < min_amount:
            score *= 0.5
        rows.append(
            {
                "code": asset.code,
                "name": asset.name,
                "asset_class": asset.asset_class,
                "class_label": CLASS_META[asset.asset_class]["label"],
                "role": asset.role,
                "fee": asset.fee,
                "price": quote.get("price"),
                "amount": amount,
                "market_cap": market_cap,
                "change_pct": quote.get("change_pct"),
                "score": round(score, 4),
                "liquidity_score": round(liquidity, 3),
                "fee_score": round(fee_score, 3),
                "tracking_score": round(tracking, 3),
                "target_class_weight": round(float(target_class_weights.get(asset.asset_class, 0.0)), 4),
                "reason": _reason(asset, liquidity, fee_score, tracking, amount),
            }
        )

    rows.sort(key=lambda item: (item["asset_class"], -item["score"]))
    picked = []
    counts: dict[str, int] = {}
    for row in rows:
        cls = row["asset_class"]
        if counts.get(cls, 0) >= max_per_class:
            continue
        # Only surface instruments in classes the target actually wants, but
        # always keep at least one candidate per class for transparency.
        if target_class_weights and target_class_weights.get(cls, 0) <= 0.001 and counts.get(cls, 0) > 0:
            continue
        picked.append(row)
        counts[cls] = counts.get(cls, 0) + 1
    return picked


def _reason(asset, liquidity: float, fee_score: float, tracking: float, amount: float | None) -> str:
    parts = []
    if liquidity > 0.7:
        parts.append("成交活跃")
    elif liquidity < 0.3:
        parts.append("成交额偏低")
    if asset.fee <= 0.003:
        parts.append("费率低")
    if tracking > 0.7:
        parts.append("与同类走势接近")
    if asset.role == "core":
        parts.append("核心配置")
    elif asset.role == "satellite":
        parts.append("卫星配置")
    if amount is not None and amount < 5_000_000:
        parts.append("流动性不足，仅作参考")
    return "，".join(parts) or "常规候选"
