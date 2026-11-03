"""Deterministic fallback for every agent role.

This module is not a mock: it uses the real analysis artifacts produced by the
quant engine. It exists so the product remains fully usable when no LLM is
configured, and so the LLM can be checked against a grounded baseline.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from ..schemas import AnalysisRequest
from ..universe import CLASS_META


def _pct(value: float | None, digits: int = 1) -> str:
    if value is None:
        return "—"
    return f"{value * 100:.{digits}f}%"


def _money(value: float | None) -> str:
    if value is None:
        return "—"
    if abs(value) >= 1e8:
        return f"{value / 1e8:.2f} 亿"
    if abs(value) >= 1e4:
        return f"{value / 1e4:.1f} 万"
    return f"{value:,.0f}"


def _class_map(items: list[dict] | None) -> dict[str, dict]:
    return {item.get("key"): item for item in (items or []) if item.get("key")}


def _direction(delta: float) -> str:
    if delta > 0.01:
        return "increase"
    if delta < -0.01:
        return "reduce"
    return "hold"


def build_allocation(analysis: dict) -> list[dict]:
    current = _class_map(analysis.get("portfolio", {}).get("current_class_weights"))
    target = _class_map(analysis.get("target", {}).get("class_weights"))
    regime = analysis.get("market", {}).get("regime", {})
    out = []
    for key in ["CASH", "CN_BOND", "CN_EQUITY", "HK_EQUITY", "US_EQUITY", "GOLD", "COMMODITY", "SATELLITE"]:
        cur = float(current.get(key, {}).get("weight", 0.0))
        tgt = float(target.get(key, {}).get("weight", 0.0))
        if cur <= 0 and tgt <= 0:
            continue
        delta = tgt - cur
        out.append(
            {
                "asset_class": key,
                "label": CLASS_META.get(key, {}).get("label", key),
                "color": CLASS_META.get(key, {}).get("color", "#94a3b8"),
                "current": round(cur, 4),
                "target": round(tgt, 4),
                "delta": round(delta, 4),
                "direction": _direction(delta),
                "rationale": _class_rationale(key, cur, tgt, regime),
            }
        )
    return out


def _class_rationale(key: str, current: float, target: float, regime: dict) -> str:
    delta = target - current
    regime_label = regime.get("label", "中性")
    if key == "CASH":
        return f"保留 {_pct(target)} 现金作为应急金与再平衡弹药；当前 {_pct(current)}，{'提高' if delta > 0 else '降低' if delta < 0 else '维持'}。"
    if key == "CN_BOND":
        return f"债券是组合压舱石，目标 {_pct(target)}；利率与信用环境决定久期选择，当前 {_pct(current)}。"
    if key == "CN_EQUITY":
        return f"中国权益目标 {_pct(target)}；{regime_label}下由风险平价、估值与动量共同决定，当前 {_pct(current)}。"
    if key in {"HK_EQUITY", "US_EQUITY"}:
        return f"海外权益用于分散单一市场与币种风险，目标 {_pct(target)}；需承担汇率波动，当前 {_pct(current)}。"
    if key == "GOLD":
        return f"黄金用于对冲通胀、地缘与货币风险，目标 {_pct(target)}；不产生现金流，当前 {_pct(current)}。"
    if key == "COMMODITY":
        return f"商品与股票债券相关性低，目标 {_pct(target)}；波动大，仅作小比例分散。"
    if key == "SATELLITE":
        return f"行业卫星仓目标 {_pct(target)}，用于表达结构性观点；单一行业风险高，需严格控制上限。"
    return f"目标 {_pct(target)}，当前 {_pct(current)}。"


def build_instruments(analysis: dict) -> list[dict]:
    """Map the optimiser's actual ETF target weights to screening evidence.

    Important: the target weight shown for an ETF is the optimiser's weight, not
    an arbitrary split of the class weight. Alternatives are explicitly marked
    with target_weight=0 so the implementation list never contradicts the trade
    list.
    """
    target = _class_map(analysis.get("target", {}).get("class_weights"))
    target_weights = analysis.get("target", {}).get("weights") or []
    screening = analysis.get("screening") or []
    screen_by_code = {str(item.get("code")): item for item in screening}
    used_codes = set()
    out = []
    for item in target_weights:
        code = str(item.get("code"))
        weight = float(item.get("weight", 0.0))
        if weight <= 0.001:
            continue
        screen = screen_by_code.get(code, {})
        used_codes.add(code)
        out.append(
            {
                "code": code,
                "name": item.get("name") or screen.get("name", code),
                "asset_class": item.get("asset_class"),
                "class_label": item.get("class_label"),
                "target_weight": round(weight, 4),
                "role": screen.get("role", item.get("role")),
                "fee": screen.get("fee"),
                "price": screen.get("price"),
                "amount": screen.get("amount"),
                "score": screen.get("score"),
                "reason": screen.get("reason") or "优化器在约束内给出的目标权重。",
                "is_alternative": False,
            }
        )

    # Add at most one alternative per class for transparency.
    seen_classes = set()
    for item in sorted(screening, key=lambda x: x.get("score", 0), reverse=True):
        cls = item.get("asset_class")
        code = str(item.get("code"))
        if code in used_codes or cls in seen_classes:
            continue
        if float(target.get(cls, {}).get("weight", 0.0)) <= 0.001:
            continue
        seen_classes.add(cls)
        out.append(
            {
                "code": code,
                "name": item.get("name"),
                "asset_class": cls,
                "class_label": item.get("class_label", cls),
                "target_weight": 0.0,
                "role": item.get("role"),
                "fee": item.get("fee"),
                "price": item.get("price"),
                "amount": item.get("amount"),
                "score": item.get("score"),
                "reason": "备选：同类中流动性/费率更优，但未进入本次目标权重。",
                "is_alternative": True,
            }
        )
    return out


def build_actions(analysis: dict) -> list[dict]:
    actions: list[dict] = []
    trades = analysis.get("target", {}).get("trades") or []
    for trade in trades:
        if trade.get("action") == "HOLD":
            continue
        delta = abs(float(trade.get("delta_weight", 0)))
        actions.append(
            {
                "priority": "high" if delta >= 0.05 else "medium",
                "action": f"{'买入' if trade['action'] == 'BUY' else '卖出'} {trade['name']}（{trade['code']}）约 {_money(abs(trade.get('delta_value', 0)))} 元",
                "amount": round(abs(float(trade.get("delta_value", 0))), 2),
                "shares": trade.get("shares"),
                "rationale": trade.get("reason", ""),
                "kind": "rebalance",
            }
        )
        if len(actions) >= 6:
            break

    goals = analysis.get("goals") or {}
    emergency = goals.get("emergency_fund") or {}
    if emergency.get("status") == "shortfall" and emergency.get("gap"):
        actions.insert(
            0,
            {
                "priority": "high",
                "action": f"先补足应急金缺口约 {_money(emergency['gap'])} 元",
                "amount": round(float(emergency["gap"]), 2),
                "rationale": f"当前仅覆盖 {emergency.get('months_covered')} 个月必要支出，建议 3–6 个月。",
                "kind": "goal",
            },
        )
    high_debt = goals.get("high_interest_debt") or {}
    if high_debt.get("count", 0) > 0:
        actions.insert(
            0,
            {
                "priority": "high",
                "action": f"优先偿还高成本负债（余额约 {_money(high_debt.get('total_balance'))} 元）",
                "amount": round(float(high_debt.get("total_balance", 0)), 2),
                "rationale": "利率 ≥ 8% 的负债成本通常高于可预期的长期投资收益。",
                "kind": "debt",
            },
        )
    for goal in (goals.get("goals") or [])[:2]:
        if goal.get("status") == "shortfall":
            actions.append(
                {
                    "priority": goal.get("priority", "medium"),
                    "action": f"为「{goal['name']}」每月追加约 {_money(goal.get('required_monthly'))} 元",
                    "amount": round(float(goal.get("required_monthly", 0)), 2),
                    "rationale": f"按当前假设，目标资金缺口约 {_money(goal.get('gap'))} 元，成功概率约 {_pct(goal.get('success_probability'))}。",
                    "kind": "goal",
                }
            )
    if not actions:
        actions.append(
            {
                "priority": "low",
                "action": "保持当前配置，按季度复核比例与风险预算",
                "amount": 0,
                "rationale": "当前偏离在阈值内，频繁交易会增加成本。",
                "kind": "monitor",
            }
        )
    return actions


def build_risks(analysis: dict) -> list[str]:
    risks = []
    target_risk = analysis.get("risk", {}).get("target") or {}
    stress = sorted(target_risk.get("stress") or [], key=lambda x: x.get("portfolio_return", 0))[:3]
    for item in stress:
        risks.append(f"{item['name']}情景下，目标组合估算回撤 {_pct(item.get('portfolio_return'))}（{item.get('window')}）。")
    var = (target_risk.get("var") or {}).get("95_1m") or {}
    if var.get("var_historical") is not None:
        risks.append(f"95% 置信度下，目标组合未来一个月历史 VaR 约 {_pct(var['var_historical'])}，不是最大损失保证。")
    concentration = target_risk.get("concentration") or {}
    if concentration.get("top3"):
        risks.append(f"目标组合前三大资产占 {_pct(concentration['top3'])}，仍需关注集中度。")
    warnings = analysis.get("meta", {}).get("warnings") or []
    risks.extend(warnings[:2])
    if not risks:
        risks.append("模型基于历史数据与假设，市场结构变化会使结论失效。")
    return risks[:5]


def confidence(analysis: dict) -> tuple[str, str]:
    meta = analysis.get("meta", {})
    warnings = meta.get("warnings") or []
    try:
        start = date.fromisoformat(meta.get("data_start", "2020-01-01"))
        end = date.fromisoformat(meta.get("data_end", date.today().isoformat()))
        years = (end - start).days / 365.25
    except Exception:
        years = 0
    if warnings or years < 3 or meta.get("universe", 0) < 5:
        return "low", f"数据覆盖约 {years:.1f} 年，存在缺失或流动性限制；结论应视为方向性参考。"
    if years >= 5 and meta.get("universe", 0) >= 8:
        return "high", f"数据覆盖约 {years:.1f} 年、{meta.get('universe')} 个资产；仍无法消除模型与历史样本风险。"
    return "medium", f"数据覆盖约 {years:.1f} 年，样本与假设有限；建议按季度复核。"


def build_advice(analysis: dict, request: AnalysisRequest | None = None) -> dict:
    conf, conf_note = confidence(analysis)
    regime = analysis.get("market", {}).get("regime", {})
    return {
        "title": "个人资产配置建议",
        "summary": analysis.get("summary", ""),
        "regime": {
            "key": regime.get("regime"),
            "label": regime.get("label"),
            "score": regime.get("score"),
            "signals": regime.get("signals", [])[:5],
        },
        "allocation": build_allocation(analysis),
        "instruments": build_instruments(analysis),
        "actions": build_actions(analysis),
        "risks": build_risks(analysis),
        "confidence": conf,
        "confidence_note": conf_note,
        "goal": analysis.get("goals"),
        "evidence": analysis.get("citations", []),
        "disclaimer": (
            "本建议基于公开数据、历史统计与你录入的信息，仅用于个人资产配置学习与辅助决策；"
            "不构成证券投资咨询，不推荐个股，不承诺收益。投资有风险，决策前请核对数据并咨询持牌专业人士。"
        ),
    }


def build_memos(analysis: dict) -> dict[str, str]:
    regime = analysis.get("market", {}).get("regime", {})
    macro = analysis.get("market", {}).get("macro", {})
    target = analysis.get("target", {})
    risk = analysis.get("risk", {})
    goals = analysis.get("goals", {})

    signals = "；".join(f"{s['name']} {s['value']}" for s in (regime.get("signals") or [])[:4])
    indicators = "；".join(
        f"{i['label']} {i['value']}{i['unit']}（{i['date']}）" for i in (macro.get("indicators") or [])[:6]
    )
    macro_memo = (
        f"市场状态为{regime.get('label', '中性')}，评分 {regime.get('score', 50)}/100。"
        f"主要信号：{signals or '暂无'}。"
        f"宏观观测：{indicators or '暂无'}。"
        "注意：部分宏观指标存在发布滞后，不能当作当日数据。"
    )

    current = _class_map(analysis.get("portfolio", {}).get("current_class_weights"))
    target_map = _class_map(target.get("class_weights"))
    changes = []
    for key in ["CN_EQUITY", "CN_BOND", "CASH", "US_EQUITY", "GOLD", "SATELLITE"]:
        cur = float(current.get(key, {}).get("weight", 0))
        tgt = float(target_map.get(key, {}).get("weight", 0))
        if abs(tgt - cur) >= 0.02:
            changes.append(f"{CLASS_META.get(key, {}).get('label', key)} {_pct(cur)}→{_pct(tgt)}")
    strategy_bits = "；".join(
        f"{value.get('label')} 预期收益 {_pct(value.get('metrics', {}).get('expected_return'))}"
        for value in (analysis.get("strategies") or {}).values()
    )
    portfolio_memo = (
        f"当前可投资资产 {_money(analysis.get('meta', {}).get('investable_value'))} 元。"
        f"主要调整：{'、'.join(changes) if changes else '大类比例基本不变'}。"
        f"策略对比：{strategy_bits}。目标组合换手率约 {_pct(target.get('turnover'))}。"
    )

    target_risk = risk.get("target") or {}
    stress = sorted(target_risk.get("stress") or [], key=lambda x: x.get("portfolio_return", 0))[:3]
    stress_text = "；".join(f"{s['name']} {_pct(s.get('portfolio_return'))}" for s in stress)
    var = (target_risk.get("var") or {}).get("95_1m") or {}
    risk_memo = (
        f"目标组合 95% 一个月历史 VaR 约 {_pct(var.get('var_historical'))}，CVaR 约 {_pct(var.get('cvar_historical'))}；"
        f"压力情景：{stress_text or '暂无'}。"
        f"最大回撤估计 {_pct(target_risk.get('max_drawdown'))}。"
        "风险指标基于历史样本，危机时相关性会上升，实际损失可能更大。"
    )

    cashflow = goals.get("cashflow") or {}
    emergency = goals.get("emergency_fund") or {}
    goal_text = "；".join(
        f"{g['name']}缺口 {_money(g.get('gap'))}，需月供 {_money(g.get('required_monthly'))}"
        for g in (goals.get("goals") or [])[:3]
    )
    goal_memo = (
        f"月收入 {_money(cashflow.get('monthly_income'))}，月支出 {_money(cashflow.get('monthly_expense'))}，"
        f"月供 {_money(cashflow.get('monthly_debt_payment'))}，月结余 {_money(cashflow.get('monthly_surplus'))}。"
        f"应急金覆盖 {emergency.get('months_covered')} 个月（目标 {emergency.get('target_months')} 个月）。"
        f"目标缺口：{goal_text or '暂无'}。"
    )

    return {
        "macro": macro_memo,
        "portfolio": portfolio_memo,
        "risk": risk_memo,
        "goal": goal_memo,
        "manager": analysis.get("summary", ""),
        "critic": "数值来自量化引擎；未发现个股推荐或收益承诺。",
    }
