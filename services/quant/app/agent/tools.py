"""Tool registry exposed to the agent.

Tools return *views* of the deterministic analysis, so the model can inspect a
specific slice without ever recomputing or inventing numbers. The same registry
is used by the tool-calling loop and by the deterministic fallback.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from ..schemas import AnalysisRequest
from ..universe import BY_CODE, CLASS_META


@dataclass
class AgentContext:
    analysis: dict
    request: AnalysisRequest


def _round(value, digits=4):
    try:
        return round(float(value), digits)
    except Exception:
        return value


def tool_definitions() -> list[dict]:
    return [
        {
            "type": "function",
            "function": {
                "name": "get_analysis_summary",
                "description": "获取本次分析的市场状态、目标组合、风险与目标规划摘要。",
                "parameters": {"type": "object", "properties": {}},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_allocation",
                "description": "获取当前与目标大类权重、ETF 目标权重和再平衡交易清单。",
                "parameters": {"type": "object", "properties": {}},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_risk",
                "description": "获取 VaR/CVaR、压力测试、最大回撤、集中度与风险贡献。",
                "parameters": {"type": "object", "properties": {}},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_backtest",
                "description": "获取等权、60/40、风险平价、MVO、Black-Litterman 与集成策略的回测指标。",
                "parameters": {"type": "object", "properties": {}},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_goals",
                "description": "获取现金流、应急金、负债、教育金/养老金缺口与月供建议。",
                "parameters": {"type": "object", "properties": {}},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_macro",
                "description": "获取宏观指标、利率、汇率与市场状态评分。",
                "parameters": {"type": "object", "properties": {}},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_momentum",
                "description": "获取资产的动量、趋势与波动率信号。",
                "parameters": {"type": "object", "properties": {}},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_screening",
                "description": "获取 ETF 候选清单、费率、流动性与筛选理由。",
                "parameters": {"type": "object", "properties": {}},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_portfolio",
                "description": "获取用户当前持仓、现金、非可投资资产与负债。",
                "parameters": {"type": "object", "properties": {}},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "query_news",
                "description": "按关键词检索本次请求携带的新闻/事件。",
                "parameters": {
                    "type": "object",
                    "properties": {"keyword": {"type": "string", "description": "关键词，留空返回全部"}},
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_etf_info",
                "description": "查询一只 ETF 的类别、费率、角色与说明。",
                "parameters": {
                    "type": "object",
                    "properties": {"code": {"type": "string"}},
                    "required": ["code"],
                },
            },
        },
    ]


class ToolRegistry:
    def __init__(self, context: AgentContext):
        self.context = context
        self.calls: list[dict] = []

    def execute(self, name: str, args: dict | None = None) -> Any:
        args = args or {}
        analysis = self.context.analysis
        try:
            if name == "get_analysis_summary":
                result = {
                    "summary": analysis.get("summary"),
                    "meta": analysis.get("meta"),
                    "regime": analysis.get("market", {}).get("regime"),
                    "target": {
                        "class_weights": analysis.get("target", {}).get("class_weights"),
                        "expected_return": analysis.get("target", {}).get("expected_return"),
                        "expected_volatility": analysis.get("target", {}).get("expected_volatility"),
                        "turnover": analysis.get("target", {}).get("turnover"),
                    },
                    "top_risks": (analysis.get("risk", {}).get("target", {}).get("stress") or [])[:4],
                }
            elif name == "get_allocation":
                result = {
                    "current_class_weights": analysis.get("portfolio", {}).get("current_class_weights"),
                    "target_class_weights": analysis.get("target", {}).get("class_weights"),
                    "target_weights": analysis.get("target", {}).get("weights"),
                    "trades": analysis.get("target", {}).get("trades"),
                    "strategies": {
                        key: {"label": value.get("label"), "class_weights": value.get("class_weights"), "metrics": value.get("metrics")}
                        for key, value in (analysis.get("strategies") or {}).items()
                    },
                }
            elif name == "get_risk":
                result = {
                    "current": _risk_view(analysis.get("risk", {}).get("current")),
                    "target": _risk_view(analysis.get("risk", {}).get("target")),
                }
            elif name == "get_backtest":
                result = {
                    key: {
                        "ok": value.get("ok"),
                        "metrics": value.get("metrics"),
                        "turnover": value.get("turnover"),
                        "error": value.get("error"),
                    }
                    for key, value in (analysis.get("backtest") or {}).items()
                }
            elif name == "get_goals":
                result = analysis.get("goals")
            elif name == "get_macro":
                result = {
                    "regime": analysis.get("market", {}).get("regime"),
                    "indicators": analysis.get("market", {}).get("macro", {}).get("indicators"),
                    "derived": analysis.get("market", {}).get("macro", {}).get("derived"),
                }
            elif name == "get_momentum":
                result = analysis.get("market", {}).get("momentum")
            elif name == "get_screening":
                result = analysis.get("screening")
            elif name == "get_portfolio":
                result = analysis.get("portfolio")
            elif name == "query_news":
                keyword = str(args.get("keyword", "")).lower()
                news = self.context.request.news
                result = [
                    item.model_dump()
                    for item in news
                    if not keyword or keyword in f"{item.title} {item.summary} {item.topic or ''}".lower()
                ][:10]
            elif name == "get_etf_info":
                code = str(args.get("code", ""))
                asset = BY_CODE.get(code)
                if not asset:
                    result = {"error": f"未找到 ETF {code}"}
                else:
                    result = asset.to_dict()
            else:
                result = {"error": f"未知工具 {name}"}
            self.calls.append({"tool": name, "args": args, "ok": True})
            return result
        except Exception as exc:
            self.calls.append({"tool": name, "args": args, "ok": False, "error": str(exc)[:200]})
            return {"error": str(exc)[:200]}


def _risk_view(risk: dict | None) -> dict:
    if not risk:
        return {}
    return {
        "var": risk.get("var"),
        "max_drawdown": risk.get("max_drawdown"),
        "stress": risk.get("stress"),
        "concentration": risk.get("concentration"),
        "risk_budget": (risk.get("risk_budget") or [])[:8],
    }


def tool_trace_text(calls: list[dict]) -> str:
    if not calls:
        return "未调用工具"
    return "；".join(f"{item['tool']}({'成功' if item.get('ok') else '失败'})" for item in calls)
