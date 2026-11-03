"""Multi-agent orchestration with a deterministic, auditable fallback.

Roles:
  1. Planner          – decomposes the task (deterministic if no LLM)
  2. Data & Quant     – runs the real engine (always deterministic)
  3. Macro Analyst    – interprets regime + macro
  4. Portfolio Analyst– interprets current vs target + strategies
  5. Risk Manager     – interprets VaR / stress / drawdown
  6. Goal Planner     – interprets cashflow / goals / debt
  7. Portfolio Manager– writes the final narrative
  8. Risk Critic      – checks compliance and numeric consistency

The LLM never computes numbers. Every specialist receives a compact JSON view of
the engine output; the manager's narrative is merged with the deterministic
allocation, trades and risk metrics.
"""

from __future__ import annotations

import json
import re
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

from .. import store
from ..config import settings
from ..quant.engine import analyze
from ..schemas import AgentRequest
from . import llm
from .fallback import build_advice, build_memos
from .prompts import BASE_SYSTEM, CRITIC, GOAL, MACRO, MANAGER, PLANNER, PORTFOLIO, RISK
from .tools import AgentContext, ToolRegistry, tool_definitions

BANNED = re.compile(r"(目标价|止损位|买入价|卖出价|保证收益|稳赚|必涨|必跌|翻倍|个股推荐)")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _compact(value, limit: int = 12000) -> str:
    try:
        text = json.dumps(value, ensure_ascii=False, default=str)
    except Exception:
        text = str(value)
    return text[:limit]


def _add(run_id: str, seq: int, role: str, type_: str, title: str, detail: str = "", **kwargs) -> int:
    store.add_agent_step(run_id, seq, role, type_, title, detail[:4000], **kwargs)
    return seq + 1


def _role_context(role: str, analysis: dict, request: AgentRequest) -> dict:
    macro = analysis.get("market", {}).get("macro", {})
    if role == "macro":
        return {
            "regime": analysis.get("market", {}).get("regime"),
            "macro": macro.get("indicators"),
            "derived": macro.get("derived"),
            "benchmark": analysis.get("market", {}).get("benchmark"),
            "momentum_top": (analysis.get("market", {}).get("momentum") or [])[:8],
        }
    if role == "portfolio":
        return {
            "current_class": analysis.get("portfolio", {}).get("current_class_weights"),
            "target_class": analysis.get("target", {}).get("class_weights"),
            "target_weights": analysis.get("target", {}).get("weights"),
            "trades": analysis.get("target", {}).get("trades"),
            "strategies": {
                key: {"label": value.get("label"), "metrics": value.get("metrics"), "class_weights": value.get("class_weights")}
                for key, value in (analysis.get("strategies") or {}).items()
            },
            "turnover": analysis.get("target", {}).get("turnover"),
        }
    if role == "risk":
        target = analysis.get("risk", {}).get("target") or {}
        return {
            "var": target.get("var"),
            "max_drawdown": target.get("max_drawdown"),
            "stress": target.get("stress"),
            "concentration": target.get("concentration"),
            "risk_budget": (target.get("risk_budget") or [])[:8],
        }
    if role == "goal":
        return analysis.get("goals")
    return {}


def _plan(task: str, analysis: dict, use_llm: bool) -> tuple[list[dict], bool]:
    fallback = [
        {"index": 1, "question": "当前市场状态与宏观环境如何？", "role": "macro", "evidence": "regime / macro / momentum"},
        {"index": 2, "question": "当前组合与目标的差异、各策略权重如何？", "role": "portfolio", "evidence": "allocation / strategies / trades"},
        {"index": 3, "question": "目标组合的风险、压力情景与回撤如何？", "role": "risk", "evidence": "VaR / stress / risk budget"},
        {"index": 4, "question": "现金流、应急金与目标缺口是否可持续？", "role": "goal", "evidence": "cashflow / goals / debt"},
        {"index": 5, "question": "如何综合成可执行的再平衡建议？", "role": "manager", "evidence": "all memos + constraints"},
    ]
    if not use_llm or not llm.configured():
        return fallback, False
    try:
        data = llm.chat_json(
            [
                {"role": "system", "content": BASE_SYSTEM + "\n" + PLANNER},
                {
                    "role": "user",
                    "content": f"用户任务：{task}\n分析摘要：{_compact({'summary': analysis.get('summary'), 'meta': analysis.get('meta'), 'regime': analysis.get('market', {}).get('regime')}, 3000)}",
                },
            ],
            schema_hint='{"steps":[{"index":1,"question":"...","role":"macro|portfolio|risk|goal|manager","evidence":"..."}]}',
            temperature=0.1,
        )
        steps = data.get("steps") if isinstance(data, dict) else None
        if isinstance(steps, list) and 3 <= len(steps) <= 7:
            return steps, True
    except Exception:
        pass
    return fallback, False


def _specialist(role: str, prompt: str, analysis: dict, request: AgentRequest) -> tuple[str, bool, str | None, list[dict]]:
    context = _role_context(role, analysis, request)
    fallback = build_memos(analysis)[role]
    if not llm.configured():
        return fallback, False, "未配置 LLM，使用规则备忘录", []
    # Give each specialist only the tools relevant to its role. This keeps the
    # tool surface small and makes the trace explainable.
    allowed = {
        "macro": {"get_macro", "get_momentum", "get_analysis_summary"},
        "portfolio": {"get_allocation", "get_screening", "get_etf_info"},
        "risk": {"get_risk", "get_backtest"},
        "goal": {"get_goals", "get_portfolio"},
    }.get(role, {"get_analysis_summary"})
    registry = ToolRegistry(AgentContext(analysis, request.portfolio))
    tools = [item for item in tool_definitions() if item["function"]["name"] in allowed]
    messages = [
        {"role": "system", "content": BASE_SYSTEM + "\n" + prompt},
        {
            "role": "user",
            "content": (
                f"用户任务：{request.task}\n"
                f"结构化数据（只可引用，不可新增数字）：{_compact(context)}"
            ),
        },
    ]
    try:
        text, trace = llm.chat_with_tools(
            messages,
            tools=tools,
            executor=registry.execute,
            max_rounds=3,
            temperature=0.2,
        )
        if not text or len(text.strip()) < 40:
            # If the model only called tools and stopped, ask once more for the memo.
            message = llm.chat(messages, temperature=0.2)
            text = str(message.get("content", "")).strip()
        if len(text) < 40:
            return fallback, False, "LLM 输出过短，已回退", trace
        if trace:
            text = text + "\n\n工具调用：" + "；".join(f"{item['tool']}({'成功' if item.get('status') == 'ok' else '失败'})" for item in trace)
        return text, True, None, trace
    except Exception as exc:
        return fallback, False, str(exc)[:200], []


def _manager(analysis: dict, memos: dict[str, str], request: AgentRequest) -> tuple[dict, bool, str | None]:
    fallback = build_advice(analysis, request.portfolio)
    if not llm.configured():
        return fallback, False, "未配置 LLM，使用规则建议"
    try:
        data = llm.chat_json(
            [
                {"role": "system", "content": BASE_SYSTEM + "\n" + MANAGER},
                {
                    "role": "user",
                    "content": (
                        f"用户任务：{request.task}\n"
                        f"宏观备忘录：{memos.get('macro', '')}\n"
                        f"组合备忘录：{memos.get('portfolio', '')}\n"
                        f"风险备忘录：{memos.get('risk', '')}\n"
                        f"目标备忘录：{memos.get('goal', '')}\n"
                        f"确定性指标（不得修改数字）：{_compact({'target': analysis.get('target', {}).get('class_weights'), 'risk': analysis.get('risk', {}).get('target', {}).get('var'), 'goals': analysis.get('goals', {}).get('cashflow')}, 5000)}"
                    ),
                },
            ],
            schema_hint='{"summary":"...","regime_narrative":"...","allocation_narrative":"...","risk_narrative":"...","goal_narrative":"...","action_narrative":"...","confidence_note":"...","risks":["..."]}',
            temperature=0.3,
        )
        if not isinstance(data, dict):
            raise ValueError("manager output is not an object")
        # Merge only narrative fields; deterministic numbers stay authoritative.
        merged = dict(fallback)
        mr = merged.get("risks") or []
        for key in ("regime_narrative", "allocation_narrative", "risk_narrative", "goal_narrative", "action_narrative"):
            if isinstance(data.get(key), str) and len(data[key].strip()) > 10:
                merged[key] = data[key].strip()
        # Keep the deterministic summary as the top-line fact statement; the
        # manager's own wording is shown separately as "AI 解读".
        if isinstance(data.get("summary"), str) and len(data["summary"].strip()) > 10:
            merged["manager_summary"] = data["summary"].strip()
        if isinstance(data.get("confidence_note"), str) and len(data["confidence_note"].strip()) > 10:
            merged["manager_confidence_note"] = data["confidence_note"].strip()
        merged["risks"] = mr
        if isinstance(data.get("risks"), list):
            risks = [str(x).strip() for x in data["risks"] if str(x).strip()]
            if len(risks) >= 2:
                merged["risks"] = risks[:5]
        if isinstance(data.get("risks"), list):
            risks = [str(x).strip() for x in data["risks"] if str(x).strip()]
            if len(risks) >= 2:
                merged["risks"] = risks[:5]
        return merged, True, None
    except Exception as exc:
        return fallback, False, str(exc)[:200]


def _critic(advice: dict, analysis: dict, use_llm: bool) -> tuple[dict, bool, str | None]:
    issues = []
    if BANNED.search(json.dumps(advice, ensure_ascii=False)):
        issues.append("文本中出现目标价/买卖点/收益承诺等越界表述")
    total = sum(float(item.get("target", 0)) for item in advice.get("allocation", []))
    if not (0.98 <= total <= 1.02):
        issues.append(f"目标大类权重合计 {total:.3f}，不等于 1")
    if len(advice.get("risks") or []) < 2:
        issues.append("风险提示少于 2 条")
    if not advice.get("disclaimer"):
        issues.append("缺少免责声明")
    if analysis.get("meta", {}).get("warnings"):
        issues.append("数据存在缺失或不完整，已降低置信度")
    result = {"pass": not issues, "issues": issues, "required_changes": []}
    if use_llm and llm.configured():
        try:
            data = llm.chat_json(
                [
                    {"role": "system", "content": BASE_SYSTEM + "\n" + CRITIC},
                    {"role": "user", "content": _compact({"advice": advice, "target": analysis.get("target"), "risk": analysis.get("risk", {}).get("target")}, 9000)},
                ],
                schema_hint='{"pass":true,"issues":["..."],"required_changes":["..."]}',
                temperature=0.1,
            )
            if isinstance(data, dict):
                result["pass"] = bool(data.get("pass")) and result["pass"]
                result["issues"] = list(dict.fromkeys(result["issues"] + [str(x) for x in data.get("issues", [])]))[:8]
                result["required_changes"] = [str(x) for x in data.get("required_changes", [])][:5]
        except Exception as exc:
            result["issues"].append(f"审查模型不可用：{str(exc)[:120]}")
    return result, bool(llm.configured()), None


def _sanitize_advice(advice: dict) -> dict:
    """Remove banned phrases from narrative fields without touching numbers."""
    for key in ("summary", "manager_summary", "regime_narrative", "allocation_narrative", "risk_narrative", "goal_narrative", "action_narrative", "confidence_note", "manager_confidence_note"):
        if isinstance(advice.get(key), str) and BANNED.search(advice[key]):
            advice[key] = BANNED.sub("（越界表述已移除）", advice[key])
    if isinstance(advice.get("risks"), list):
        advice["risks"] = [BANNED.sub("（越界表述已移除）", str(x)) for x in advice["risks"]]
    return advice


def run_agent(request: AgentRequest) -> dict:
    run_id = f"run_{uuid.uuid4().hex[:12]}"
    started = _now()
    use_llm = bool(request.use_llm and settings.llm_configured)
    mode = "llm" if use_llm else "deterministic"
    store.create_agent_run(run_id, request.task, mode, settings.llm_model or None)
    seq = 1
    memos: dict[str, str] = {}
    notes: list[str] = []

    try:
        seq = _add(run_id, seq, "Planner", "plan", "任务规划", "正在拆解任务并准备数据。")

        # 1. Deterministic analysis.
        try:
            analysis = analyze(request.portfolio)
        except Exception as exc:
            store.finish_agent_run(run_id, "error", error=str(exc)[:500])
            raise
        registry = ToolRegistry(AgentContext(analysis, request.portfolio))
        summary_tool = registry.execute("get_analysis_summary", {})
        seq = _add(
            run_id,
            seq,
            "Data & Quant",
            "tool",
            "真实数据与量化引擎",
            _compact(summary_tool, 2500),
            tool_name="get_analysis_summary",
            tool_input={},
            tool_output=summary_tool,
        )

        planned, planner_llm = _plan(request.task, analysis, use_llm)
        seq = _add(
            run_id,
            seq,
            "Planner",
            "plan",
            "执行计划" + ("（模型规划）" if planner_llm else "（规则规划）"),
            "；".join(f"{item.get('index')}. {item.get('question')}" for item in planned),
        )

        # 2. Specialists (parallel when LLM is available).
        roles = {
            "macro": ("Macro Analyst", "宏观与市场状态", MACRO),
            "portfolio": ("Portfolio Analyst", "组合与配置", PORTFOLIO),
            "risk": ("Risk Manager", "风险与压力测试", RISK),
            "goal": ("Goal Planner", "目标与现金流", GOAL),
        }
        if use_llm:
            with ThreadPoolExecutor(max_workers=4) as pool:
                futures = {pool.submit(_specialist, key, prompt, analysis, request): key for key, (_, _, prompt) in roles.items()}
                for future in as_completed(futures):
                    key = futures[future]
                    text, used_llm, error, trace = future.result()
                    memos[key] = text
                    if error:
                        notes.append(f"{key}: {error}")
                    seq = _add(
                        run_id,
                        seq,
                        roles[key][0],
                        "analysis",
                        roles[key][1] + ("（LLM）" if used_llm else "（规则兜底）"),
                        text,
                        tool_name=",".join(item["tool"] for item in trace) if trace else None,
                        tool_output=trace or None,
                    )
        else:
            base = build_memos(analysis)
            for key, (role_name, title, _) in roles.items():
                memos[key] = base[key]
                seq = _add(run_id, seq, role_name, "analysis", title + "（规则）", base[key])

        # 3. Portfolio manager.
        advice, manager_llm, manager_error = _manager(analysis, memos, request)
        if manager_error:
            notes.append(f"manager: {manager_error}")
        seq = _add(
            run_id,
            seq,
            "Portfolio Manager",
            "synthesis",
            "综合建议" + ("（LLM）" if manager_llm else "（规则兜底）"),
            advice.get("summary", ""),
        )

        # 4. Critic.
        critic, critic_llm, critic_error = _critic(advice, analysis, use_llm)
        if critic_error:
            notes.append(f"critic: {critic_error}")
        advice = _sanitize_advice(advice)
        advice["critic"] = critic
        if not critic.get("pass"):
            advice["confidence"] = "low"
            advice["confidence_note"] = (advice.get("confidence_note", "") + " 审查发现：" + "；".join(critic.get("issues", [])[:3])).strip()
        seq = _add(
            run_id,
            seq,
            "Risk Critic",
            "reflection",
            "合规与一致性审查" + ("（LLM）" if critic_llm else "（规则）"),
            _compact(critic, 2500),
        )

        # 5. Evidence and final metadata.
        if advice.get("manager_confidence_note"):
            advice["confidence_note"] = advice["manager_confidence_note"]
        advice["evidence"] = (analysis.get("citations") or []) + [
            {
                "type": "news",
                "label": item.title,
                "detail": (item.summary or "")[:160],
                "as_of": item.published_at or analysis.get("meta", {}).get("as_of"),
            }
            for item in request.portfolio.news[:5]
        ]
        advice["generated_at"] = _now()
        advice["mode"] = "llm" if (use_llm and (manager_llm or any(memos))) else "deterministic"
        if notes:
            advice["notes"] = notes[:6]

        final_mode = "llm" if use_llm and manager_llm else "fallback" if use_llm else "deterministic"

        # 6. Report (optional; generated by the report module).
        report_meta = None
        if request.include_report:
            try:
                from ..report.generator import generate_report

                report_meta = generate_report(analysis, advice, run_id)
                seq = _add(
                    run_id,
                    seq,
                    "Report Writer",
                    "artifact",
                    "生成 HTML / PDF 研报",
                    f"报告 {report_meta.get('report_id')} 已生成。",
                    tool_name="generate_report",
                    tool_output={"report_id": report_meta.get("report_id"), "pdf": report_meta.get("pdf_path")},
                )
            except Exception as exc:
                notes.append(f"report: {str(exc)[:160]}")

        result = {
            "run_id": run_id,
            "status": "done",
            "mode": final_mode,
            "model": settings.llm_model or None,
            "started_at": started,
            "finished_at": _now(),
            "analysis": analysis,
            "advice": advice,
            "memos": memos,
            "critic": critic,
            "plan": planned,
            "report": report_meta,
            "notes": notes,
            "citations": advice.get("evidence"),
            "disclaimer": advice.get("disclaimer"),
        }
        store.finish_agent_run(run_id, "done", result=result)
        result["steps"] = (store.get_agent_run(run_id) or {}).get("steps", [])
        return result
    except Exception as exc:
        store.finish_agent_run(run_id, "error", error=str(exc)[:500])
        raise
