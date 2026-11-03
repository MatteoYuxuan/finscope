"""Report generation: multimodal HTML + PDF with charts, tables and evidence."""

from __future__ import annotations

import base64
import io
import os
from datetime import datetime
from pathlib import Path
from xml.sax.saxutils import escape

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from .. import store
from ..config import REPORT_DIR
from ..universe import CLASS_META

plt.rcParams["font.sans-serif"] = ["Microsoft YaHei", "SimHei", "Arial Unicode MS", "DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False

PALETTE = ["#12b886", "#38bdf8", "#f59e0b", "#8b5cf6", "#ec4899", "#eab308", "#94a3b8", "#a16207"]


def _pct(value, digits=1):
    try:
        return f"{float(value) * 100:.{digits}f}%"
    except Exception:
        return "—"


def _money(value):
    try:
        value = float(value)
    except Exception:
        return "—"
    if abs(value) >= 1e8:
        return f"{value / 1e8:.2f} 亿元"
    if abs(value) >= 1e4:
        return f"{value / 1e4:.1f} 万元"
    return f"{value:,.0f} 元"


def _chart_allocation(analysis: dict, path: Path) -> None:
    current = {item["label"]: item["weight"] * 100 for item in analysis.get("portfolio", {}).get("current_class_weights", [])}
    target = {item["label"]: item["weight"] * 100 for item in analysis.get("target", {}).get("class_weights", [])}
    labels = list(dict.fromkeys(list(current.keys()) + list(target.keys())))
    if not labels:
        return
    x = np.arange(len(labels))
    fig, ax = plt.subplots(figsize=(8.2, 3.6))
    ax.bar(x - 0.2, [current.get(l, 0) for l in labels], 0.38, label="当前", color="#94a3b8")
    ax.bar(x + 0.2, [target.get(l, 0) for l in labels], 0.38, label="目标", color="#12b886")
    ax.set_xticks(x)
    ax.set_xticklabels(labels, fontsize=8)
    ax.set_ylabel("权重 (%)", fontsize=8)
    ax.legend(fontsize=8)
    ax.grid(axis="y", alpha=0.2)
    fig.tight_layout()
    fig.savefig(path, dpi=160)
    plt.close(fig)


def _chart_backtest(analysis: dict, path: Path) -> None:
    backtest = analysis.get("backtest") or {}
    series_map = {
        "combined": ("集成策略", "#12b886"),
        "risk_parity": ("风险平价", "#38bdf8"),
        "sixty_forty": ("60/40", "#f59e0b"),
    }
    plotted = False
    fig, ax = plt.subplots(figsize=(8.2, 3.6))
    for key, (label, color) in series_map.items():
        item = backtest.get(key) or {}
        if not item.get("ok") or not item.get("series"):
            continue
        dates = [p["date"] for p in item["series"]]
        values = [p["portfolio"] for p in item["series"]]
        ax.plot(dates, values, label=label, color=color, linewidth=1.4)
        plotted = True
        break
    combined = backtest.get("combined") or {}
    if combined.get("ok") and combined.get("series"):
        dates = [p["date"] for p in combined["series"]]
        bench = [p.get("benchmark") for p in combined["series"]]
        if any(v is not None for v in bench):
            ax.plot(dates, bench, label="沪深300", color="#94a3b8", linewidth=1, linestyle="--")
    if not plotted:
        plt.close(fig)
        return
    step = max(len(dates) // 6, 1)
    ax.set_xticks(dates[::step])
    ax.tick_params(axis="x", labelsize=7, rotation=20)
    ax.set_ylabel("净值", fontsize=8)
    ax.legend(fontsize=8)
    ax.grid(alpha=0.2)
    fig.tight_layout()
    fig.savefig(path, dpi=160)
    plt.close(fig)


def _chart_stress(analysis: dict, path: Path) -> None:
    stress = (analysis.get("risk", {}).get("target") or {}).get("stress") or []
    if not stress:
        return
    names = [item["name"] for item in stress]
    values = [item["portfolio_return"] * 100 for item in stress]
    fig, ax = plt.subplots(figsize=(8.2, 3.2))
    colors = ["#ef4444" if v < -5 else "#f59e0b" if v < 0 else "#12b886" for v in values]
    ax.barh(names, values, color=colors)
    ax.axvline(0, color="#334155", linewidth=0.8)
    ax.set_xlabel("组合估算收益 (%)", fontsize=8)
    ax.tick_params(labelsize=7)
    ax.grid(axis="x", alpha=0.2)
    fig.tight_layout()
    fig.savefig(path, dpi=160)
    plt.close(fig)


def _chart_goal(analysis: dict, path: Path) -> None:
    goals = (analysis.get("goals") or {}).get("goals") or []
    if not goals:
        return
    names = [g["name"] for g in goals]
    gaps = [max(float(g.get("gap", 0)), 0) for g in goals]
    fig, ax = plt.subplots(figsize=(8.2, 3.0))
    ax.barh(names, gaps, color="#f59e0b")
    ax.set_xlabel("资金缺口 (元)", fontsize=8)
    ax.tick_params(labelsize=7)
    for i, v in enumerate(gaps):
        ax.text(v, i, f" {_money(v)}", va="center", fontsize=7)
    ax.grid(axis="x", alpha=0.2)
    fig.tight_layout()
    fig.savefig(path, dpi=160)
    plt.close(fig)


def _chart_frontier(analysis: dict, path: Path) -> None:
    charts = analysis.get("charts") or []
    frontier = next((c for c in charts if c.get("id") == "efficient-frontier"), None)
    if not frontier or not frontier.get("data"):
        return
    points = [p for p in frontier["data"] if p.get("kind") not in {"target", "current"}]
    if not points:
        return
    fig, ax = plt.subplots(figsize=(7.2, 3.4))
    ax.scatter([p["volatility"] * 100 for p in points], [p["return"] * 100 for p in points], s=18, color="#38bdf8", label="有效前沿")
    line = sorted(points, key=lambda p: p["volatility"])
    ax.plot([p["volatility"] * 100 for p in line], [p["return"] * 100 for p in line], color="#38bdf8", linewidth=1)
    for point, color, label in [
        (next((p for p in frontier["data"] if p.get("kind") == "target"), None), "#12b886", "目标组合"),
        (next((p for p in frontier["data"] if p.get("kind") == "current"), None), "#ef4444", "当前组合"),
    ]:
        if point:
            ax.scatter([point["volatility"] * 100], [point["return"] * 100], s=70, color=color, label=label, zorder=5)
    ax.set_xlabel("年化波动率 (%)", fontsize=8)
    ax.set_ylabel("年化预期收益 (%)", fontsize=8)
    ax.legend(fontsize=8)
    ax.grid(alpha=0.2)
    fig.tight_layout()
    fig.savefig(path, dpi=160)
    plt.close(fig)


def _make_charts(analysis: dict, report_id: str) -> dict[str, str]:
    charts = {}
    for name, fn in [
        ("allocation", _chart_allocation),
        ("backtest", _chart_backtest),
        ("stress", _chart_stress),
        ("goal", _chart_goal),
        ("frontier", _chart_frontier),
    ]:
        path = REPORT_DIR / f"{report_id}_{name}.png"
        try:
            fn(analysis, path)
            if path.exists() and path.stat().st_size > 0:
                charts[name] = str(path)
        except Exception:
            continue
    return charts


def _b64(path: str) -> str:
    return base64.b64encode(Path(path).read_bytes()).decode("ascii")


def _allocation_rows(advice: dict) -> str:
    rows = []
    for item in advice.get("allocation", []):
        color = item.get("color", "#94a3b8")
        direction = {"increase": "提高", "reduce": "降低", "hold": "维持"}.get(item.get("direction"), "维持")
        rows.append(
            f"<tr><td><span class='dot' style='background:{color}'></span>{escape(item.get('label',''))}</td>"
            f"<td class='num'>{_pct(item.get('current'))}</td><td class='num'>{_pct(item.get('target'))}</td>"
            f"<td class='num'>{direction} {_pct(abs(item.get('delta',0)))}</td><td>{escape(item.get('rationale',''))}</td></tr>"
        )
    return "".join(rows)


def _instrument_rows(advice: dict) -> str:
    rows = []
    for item in sorted(advice.get("instruments", []), key=lambda x: x.get("target_weight", 0), reverse=True):
        rows.append(
            f"<tr><td>{escape(str(item.get('code','')))}</td><td>{escape(item.get('name',''))}</td>"
            f"<td>{escape(item.get('class_label',''))}</td><td class='num'>{_pct(item.get('target_weight'))}</td>"
            f"<td class='num'>{_pct(item.get('fee'),2) if item.get('fee') is not None else '—'}</td>"
            f"<td>{escape(item.get('reason') or '')}</td></tr>"
        )
    return "".join(rows)


def _action_rows(advice: dict) -> str:
    rows = []
    for item in advice.get("actions", []):
        rows.append(
            f"<tr><td><span class='pill pill-{escape(item.get('priority','medium'))}'>{ {'high':'高','medium':'中','low':'低'}.get(item.get('priority'),'中') }</span></td>"
            f"<td>{escape(item.get('action',''))}</td><td class='num'>{_money(item.get('amount'))}</td><td>{escape(item.get('rationale',''))}</td></tr>"
        )
    return "".join(rows)


def _goal_rows(analysis: dict) -> str:
    goals = (analysis.get("goals") or {}).get("goals") or []
    rows = []
    for g in goals:
        rows.append(
            f"<tr><td>{escape(g.get('name',''))}</td><td class='num'>{_money(g.get('future_cost'))}</td>"
            f"<td class='num'>{_money(g.get('projected_amount'))}</td><td class='num'>{_money(g.get('gap'))}</td>"
            f"<td class='num'>{_money(g.get('required_monthly'))}</td><td class='num'>{_pct(g.get('success_probability'))}</td></tr>"
        )
    return "".join(rows)


def _risk_rows(analysis: dict) -> str:
    target = analysis.get("risk", {}).get("target") or {}
    var = target.get("var") or {}
    rows = []
    for label, key in [("95% / 1 日历史 VaR", "95_1d"), ("99% / 1 日历史 VaR", "99_1d"), ("95% / 1 月历史 VaR", "95_1m")]:
        item = var.get(key) or {}
        rows.append(f"<tr><td>{label}</td><td class='num'>{_pct(item.get('var_historical'))}</td><td class='num'>{_pct(item.get('cvar_historical'))}</td></tr>")
    concentration = target.get("concentration") or {}
    rows.append(f"<tr><td>前三大资产合计</td><td class='num'>{_pct(concentration.get('top3'))}</td><td class='num'>HHI {concentration.get('hhi','—')}</td></tr>")
    rows.append(f"<tr><td>历史最大回撤（目标组合）</td><td class='num'>{_pct(target.get('max_drawdown'))}</td><td class='num'>—</td></tr>")
    return "".join(rows)


def build_html(analysis: dict, advice: dict, charts: dict[str, str]) -> str:
    regime = analysis.get("market", {}).get("regime", {})
    meta = analysis.get("meta", {})
    signals = "".join(
        f"<li>{escape(s.get('name',''))}<b>{escape(str(s.get('value','')))}</b><span>{escape(str(s.get('impact','')))}</span></li>"
        for s in (regime.get("signals") or [])[:6]
    )
    indicator_rows = "".join(
        f"<tr><td>{escape(i.get('label',''))}</td><td class='num'>{i.get('value')}{escape(i.get('unit',''))}</td>"
        f"<td>{escape(i.get('date',''))}</td><td class='num'>{i.get('change') if i.get('change') is not None else '—'}</td></tr>"
        for i in (analysis.get("market", {}).get("macro", {}).get("indicators") or [])
    )
    chart_html = "".join(
        f"<figure><img src='data:image/png;base64,{_b64(path)}' alt='{name}'><figcaption>{ {'allocation':'当前 vs 目标配置','backtest':'策略回测净值','stress':'压力测试','goal':'目标资金缺口','frontier':'有效前沿'}.get(name,name) }</figcaption></figure>"
        for name, path in charts.items()
    )
    conf = advice.get("confidence", "medium")
    conf_label = {"high": "较高", "medium": "中等", "low": "较低"}.get(conf, conf)
    generated = datetime.now().strftime("%Y-%m-%d %H:%M")
    return f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>知衡 FinScope · 资产配置报告</title>
<style>
  :root {{ --ink:#0a1220; --muted:#5d6f8a; --line:#dbe3ee; --brand:#0b9a71; --bg:#f6f8fb; }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; background:var(--bg); color:var(--ink); font-family:"Microsoft YaHei","PingFang SC",sans-serif; line-height:1.65; }}
  .page {{ max-width:980px; margin:0 auto; background:#fff; padding:42px 48px 56px; }}
  .kicker {{ color:var(--brand); font-size:11px; letter-spacing:.18em; text-transform:uppercase; font-weight:700; }}
  h1 {{ font-size:27px; margin:6px 0 4px; letter-spacing:-.02em; }}
  .sub {{ color:var(--muted); font-size:12px; }}
  h2 {{ font-size:16px; margin:28px 0 10px; padding-bottom:6px; border-bottom:1px solid var(--line); }}
  h3 {{ font-size:13px; margin:18px 0 6px; }}
  p {{ margin:7px 0; font-size:12.5px; }}
  .grid {{ display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin:16px 0; }}
  .stat {{ border:1px solid var(--line); border-radius:12px; padding:11px 12px; }}
  .stat span {{ display:block; color:var(--muted); font-size:10px; }}
  .stat b {{ display:block; font-size:17px; margin-top:3px; }}
  .badge {{ display:inline-block; padding:3px 8px; border-radius:99px; font-size:10px; font-weight:700; background:#ecfdf7; color:#0b9a71; border:1px solid #a7f3d6; }}
  .badge.warn {{ background:#fff7e6; color:#b45309; border-color:#fde68a; }}
  .badge.danger {{ background:#fef2f2; color:#b91c1c; border-color:#fecaca; }}
  .lead {{ font-size:13px; background:#f0fdf9; border-left:3px solid var(--brand); padding:10px 14px; border-radius:0 8px 8px 0; }}
  table {{ width:100%; border-collapse:collapse; margin:10px 0 16px; font-size:11.5px; }}
  th,td {{ border:1px solid var(--line); padding:6px 7px; vertical-align:top; text-align:left; }}
  th {{ background:#f1f5f9; font-weight:600; }}
  td.num {{ text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }}
  .dot {{ display:inline-block; width:7px; height:7px; border-radius:50%; margin-right:5px; }}
  .pill {{ display:inline-block; padding:1px 6px; border-radius:99px; font-size:10px; font-weight:700; }}
  .pill-high {{ background:#fef2f2; color:#b91c1c; }} .pill-medium {{ background:#fff7e6; color:#b45309; }} .pill-low {{ background:#f1f5f9; color:#475569; }}
  figure {{ margin:12px 0 18px; }} figure img {{ width:100%; border:1px solid var(--line); border-radius:8px; }}
  figcaption {{ color:var(--muted); font-size:10px; margin-top:3px; }}
  .two {{ display:grid; grid-template-columns:1fr 1fr; gap:18px; }}
  ul.signals {{ list-style:none; padding:0; margin:0; }} ul.signals li {{ display:flex; justify-content:space-between; gap:8px; border-bottom:1px dashed var(--line); padding:4px 0; font-size:11.5px; }}
  ul.signals li span {{ color:var(--muted); }}
  .risk li {{ margin:4px 0; font-size:11.5px; }}
  .disclaimer {{ margin-top:26px; padding-top:10px; border-top:1px solid var(--line); color:var(--muted); font-size:10px; }}
  @media print {{ body {{ background:#fff; }} .page {{ max-width:none; padding:18mm; }} figure {{ break-inside:avoid; }} table {{ break-inside:auto; }} }}
</style></head><body><div class="page">
  <div class="kicker">FinScope · Personal Asset Allocation</div>
  <h1>个人资产配置分析报告</h1>
  <p class="sub">生成时间 {generated} · 数据截至 {escape(meta.get('data_end',''))} · 可投资资产 {_money(meta.get('investable_value'))} · 风险画像 {escape(regime.get('label','—'))}</p>

  <div class="grid">
    <div class="stat"><span>市场状态</span><b>{escape(regime.get('label','—'))}</b><span>{regime.get('score','—')}/100</span></div>
    <div class="stat"><span>目标预期收益</span><b>{_pct(analysis.get('target',{}).get('expected_return'))}</b><span>年化，历史估计</span></div>
    <div class="stat"><span>目标波动率</span><b>{_pct(analysis.get('target',{}).get('expected_volatility'))}</b><span>年化</span></div>
    <div class="stat"><span>建议换手率</span><b>{_pct(analysis.get('target',{}).get('turnover'))}</b><span>单边</span></div>
  </div>

  <h2>结论摘要</h2>
  <p class="lead">{escape(advice.get('summary',''))}</p>
  <p><span class="badge {'danger' if conf == 'low' else 'warn' if conf == 'medium' else ''}">置信度 {conf_label}</span> {escape(advice.get('confidence_note',''))}</p>

  <h2>市场状态与宏观</h2>
  <div class="two"><div><h3>状态信号</h3><ul class="signals">{signals}</ul></div>
  <div><h3>宏观观测</h3><table><tr><th>指标</th><th>最新</th><th>日期</th><th>变化</th></tr>{indicator_rows}</table></div></div>

  <h2>配置调整</h2>
  <table><tr><th>资产类别</th><th>当前</th><th>目标</th><th>调整</th><th>理由</th></tr>{_allocation_rows(advice)}</table>
  {chart_html}

  <h2>ETF / 基金落地方案</h2>
  <table><tr><th>代码</th><th>名称</th><th>类别</th><th>目标权重</th><th>费率</th><th>筛选理由</th></tr>{_instrument_rows(advice)}</table>

  <h2>执行清单</h2>
  <table><tr><th>优先级</th><th>动作</th><th>金额</th><th>说明</th></tr>{_action_rows(advice)}</table>

  <h2>风险与压力测试</h2>
  <table><tr><th>指标</th><th>VaR</th><th>CVaR / 备注</th></tr>{_risk_rows(analysis)}</table>
  <ul class="risk">{''.join(f'<li>{escape(r)}</li>' for r in advice.get('risks', []))}</ul>

  <h2>目标规划</h2>
  <table><tr><th>目标</th><th>未来成本</th><th>预计积累</th><th>缺口</th><th>建议月供</th><th>成功概率</th></tr>{_goal_rows(analysis)}</table>

  <h2>证据与口径</h2>
  <ul class="risk">{''.join(f'<li><b>{escape(e.get("label",""))}</b>：{escape(str(e.get("detail","")))}（{escape(str(e.get("as_of","")))}）</li>' for e in advice.get('evidence', [])[:10])}</ul>

  <p class="disclaimer">{escape(advice.get('disclaimer',''))}</p>
</div></body></html>"""


def build_markdown(analysis: dict, advice: dict) -> str:
    lines = [
        "# 个人资产配置分析报告",
        "",
        f"- 数据截至：{analysis.get('meta',{}).get('data_end','')}",
        f"- 可投资资产：{_money(analysis.get('meta',{}).get('investable_value'))}",
        f"- 市场状态：{analysis.get('market',{}).get('regime',{}).get('label','')}",
        "",
        "## 结论摘要",
        "",
        advice.get("summary", ""),
        "",
        "## 配置调整",
        "",
        "| 资产类别 | 当前 | 目标 | 调整 | 理由 |",
        "| --- | ---: | ---: | ---: | --- |",
    ]
    for item in advice.get("allocation", []):
        lines.append(
            f"| {item.get('label')} | {_pct(item.get('current'))} | {_pct(item.get('target'))} | {_pct(item.get('delta'))} | {item.get('rationale','')} |"
        )
    lines += ["", "## ETF 落地方案", "", "| 代码 | 名称 | 目标权重 | 理由 |", "| --- | --- | ---: | --- |"]
    for item in advice.get("instruments", []):
        lines.append(f"| {item.get('code')} | {item.get('name')} | {_pct(item.get('target_weight'))} | {item.get('reason','')} |")
    lines += ["", "## 执行清单", ""]
    for item in advice.get("actions", []):
        lines.append(f"- **{item.get('priority')}** {item.get('action')}（{_money(item.get('amount'))}）：{item.get('rationale','')}")
    lines += ["", "## 主要风险", ""]
    for item in advice.get("risks", []):
        lines.append(f"- {item}")
    lines += ["", "## 免责声明", "", advice.get("disclaimer", "")]
    return "\n".join(lines)


def _pdf(html_path: Path, analysis: dict, advice: dict, charts: dict[str, str]) -> str | None:
    try:
        from reportlab.lib import colors
        from reportlab.lib.enums import TA_LEFT
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
        from reportlab.lib.units import mm
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        from reportlab.platypus import Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    except Exception:
        return None

    font_candidates = [
        ("C:/Windows/Fonts/simhei.ttf", 0),
        ("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", 0),
        ("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc", 0),
        ("/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc", 0),
    ]
    registered = False
    for font_path, index in font_candidates:
        if not os.path.exists(font_path):
            continue
        try:
            pdfmetrics.registerFont(TTFont("CN", font_path, subfontIndex=index))
            registered = True
            break
        except Exception:
            continue
    if not registered:
        return None

    styles = getSampleStyleSheet()
    title = ParagraphStyle("title", parent=styles["Title"], fontName="CN", fontSize=20, leading=26, textColor=colors.HexColor("#0a1220"))
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], fontName="CN", fontSize=12, leading=16, spaceBefore=10, spaceAfter=4, textColor=colors.HexColor("#0b9a71"))
    body = ParagraphStyle("body", parent=styles["BodyText"], fontName="CN", fontSize=8.5, leading=13, alignment=TA_LEFT)
    small = ParagraphStyle("small", parent=body, fontSize=7.5, leading=11, textColor=colors.HexColor("#5d6f8a"))
    cell = ParagraphStyle("cell", parent=body, fontSize=7.5, leading=10)

    def p(text):
        return Paragraph(escape(str(text)).replace("\n", "<br/>"), body)

    def table(data, widths=None):
        rows = [[Paragraph(escape(str(c)), cell) for c in row] for row in data]
        t = Table(rows, colWidths=widths, repeatRows=1)
        t.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f5f9")),
                    ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#dbe3ee")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 3),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 3),
                    ("TOPPADDING", (0, 0), (-1, -1), 2),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                ]
            )
        )
        return t

    story = [
        Paragraph("个人资产配置分析报告", title),
        Paragraph(
            f"数据截至 {escape(str(analysis.get('meta',{}).get('data_end','')))} · 可投资资产 {_money(analysis.get('meta',{}).get('investable_value'))} · 市场状态 {escape(str(analysis.get('market',{}).get('regime',{}).get('label','')))}",
            small,
        ),
        Spacer(1, 6),
        p(advice.get("summary", "")),
        Spacer(1, 4),
        Paragraph("配置调整", h2),
    ]
    alloc_data = [["资产类别", "当前", "目标", "调整", "理由"]]
    for item in advice.get("allocation", []):
        alloc_data.append([item.get("label", ""), _pct(item.get("current")), _pct(item.get("target")), _pct(item.get("delta")), item.get("rationale", "")])
    story.append(table(alloc_data, [24 * mm, 16 * mm, 16 * mm, 16 * mm, 90 * mm]))
    story.append(Spacer(1, 4))

    for name, path in charts.items():
        try:
            img = Image(path)
            width = 170 * mm
            height = width * img.imageHeight / img.imageWidth
            if height > 80 * mm:
                height = 80 * mm
                width = height * img.imageWidth / img.imageHeight
            story.append(Image(path, width=width, height=height))
            story.append(Spacer(1, 3))
        except Exception:
            continue

    story.append(Paragraph("ETF / 基金落地方案", h2))
    inst_data = [["代码", "名称", "类别", "目标权重", "理由"]]
    for item in advice.get("instruments", []):
        inst_data.append([item.get("code", ""), item.get("name", ""), item.get("class_label", ""), _pct(item.get("target_weight")), item.get("reason", "")])
    story.append(table(inst_data, [18 * mm, 34 * mm, 24 * mm, 18 * mm, 70 * mm]))

    story.append(Paragraph("执行清单", h2))
    act_data = [["优先级", "动作", "金额", "说明"]]
    for item in advice.get("actions", []):
        act_data.append([{"high": "高", "medium": "中", "low": "低"}.get(item.get("priority"), "中"), item.get("action", ""), _money(item.get("amount")), item.get("rationale", "")])
    story.append(table(act_data, [12 * mm, 78 * mm, 22 * mm, 54 * mm]))

    story.append(Paragraph("主要风险", h2))
    for item in advice.get("risks", []):
        story.append(p("• " + item))

    story.append(Paragraph("目标规划", h2))
    goal_data = [["目标", "未来成本", "预计积累", "缺口", "建议月供", "成功概率"]]
    for g in (analysis.get("goals", {}).get("goals") or []):
        goal_data.append([g.get("name", ""), _money(g.get("future_cost")), _money(g.get("projected_amount")), _money(g.get("gap")), _money(g.get("required_monthly")), _pct(g.get("success_probability"))])
    story.append(table(goal_data, [34 * mm, 30 * mm, 30 * mm, 26 * mm, 26 * mm, 20 * mm]))

    story.append(Paragraph("免责声明", h2))
    story.append(Paragraph(escape(advice.get("disclaimer", "")), small))

    pdf_path = REPORT_DIR / f"{html_path.stem}.pdf"
    doc = SimpleDocTemplate(str(pdf_path), pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=14 * mm, bottomMargin=14 * mm)
    doc.build(story)
    return str(pdf_path)


def generate_report(analysis: dict, advice: dict, run_id: str | None = None) -> dict:
    report_id = f"rpt_{run_id or datetime.now().strftime('%Y%m%d%H%M%S')}"
    charts = _make_charts(analysis, report_id)
    html = build_html(analysis, advice, charts)
    markdown = build_markdown(analysis, advice)
    html_path = REPORT_DIR / f"{report_id}.html"
    html_path.write_text(html, encoding="utf-8")
    pdf_path = _pdf(html_path, analysis, advice, charts)
    store.save_report(
        report_id,
        "个人资产配置分析报告",
        html,
        markdown,
        {"analysis_meta": analysis.get("meta"), "advice": advice, "charts": list(charts)},
        run_id=run_id,
        pdf_path=pdf_path,
    )
    return {
        "report_id": report_id,
        "title": "个人资产配置分析报告",
        "html_path": str(html_path),
        "pdf_path": pdf_path,
        "markdown": markdown,
    }
