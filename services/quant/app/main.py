"""FastAPI entry point for the FinScope quant & agent service."""

from __future__ import annotations

import os
import uuid
from datetime import date
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse

from . import store
from .agent import llm
from .agent.orchestrator import run_agent
from .config import settings
from .providers import market
from .providers.macro import macro_snapshot
from .quant.engine import analyze
from .quant.tactical import market_regime, momentum_table
from .schemas import AgentRequest, AnalysisRequest, ReportRequest, VisionRequest
from .universe import CLASS_META, UNIVERSE
from .utils import to_native

app = FastAPI(title="FinScope Quant & Agent", version=settings.version)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/llm/config")
def get_llm_config() -> dict:
    return settings.public_llm()


@app.post("/llm/config")
def set_llm_config(payload: dict) -> dict:
    settings.update_llm(payload)
    return settings.public_llm()


@app.post("/llm/test")
def test_llm() -> dict:
    if not settings.llm_configured:
        raise HTTPException(status_code=400, detail="未配置 LLM")
    try:
        message = llm.chat([{"role": "user", "content": "只回复两个字：可用"}], temperature=0, timeout_ms=20000)
        return {"ok": True, "reply": str(message.get("content", ""))[:100], "model": settings.llm_model}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)[:300])


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "version": settings.version,
        "llm_configured": settings.llm_configured,
        "llm_model": settings.llm_model or None,
        "vision_configured": llm.vision_configured(),
        "data": market.data_health(),
    }


@app.get("/universe")
def universe() -> dict:
    return {
        "items": [item.to_dict() for item in UNIVERSE],
        "classes": [{"key": key, **meta} for key, meta in CLASS_META.items()],
    }


@app.get("/market/overview")
def market_overview(refresh: bool = False) -> dict:
    try:
        panel = market.get_panel(start="2018-01-01", refresh=refresh)
        macro = macro_snapshot(force=refresh)
        regime = market_regime(panel, macro)
        momentum = momentum_table(panel)
        from .universe import BY_CODE

        momentum_rows = []
        for code, info in sorted(momentum.items(), key=lambda kv: kv[1].get("score", 0), reverse=True):
            asset = BY_CODE.get(code)
            if not asset:
                continue
            row = {
                "code": code,
                "name": asset.name,
                "asset_class": asset.asset_class,
                "class_label": CLASS_META.get(asset.asset_class, {}).get("label", asset.asset_class),
            }
            for key, value in info.items():
                if key == "code":
                    continue
                row[key] = round(float(value), 4) if isinstance(value, (int, float)) and value is not None else value
            momentum_rows.append(row)
        return to_native(
            {
                "as_of": date.today().isoformat(),
                "data_end": str(panel.index[-1])[:10] if len(panel.index) else None,
                "regime": regime,
                "macro": macro,
                "momentum": momentum_rows,
                "quotes": market.get_spot(force=refresh, live=refresh)[:40],
            }
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)[:400])


@app.get("/market/series")
def market_series(
    codes: str = Query(default="510300,510500,511010,518880,513100"),
    start: str = Query(default="2020-01-01"),
    normalize: bool = Query(default=True),
) -> dict:
    code_list = [c.strip() for c in codes.split(",") if c.strip()]
    try:
        panel = market.get_panel(codes=code_list, start=start)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)[:300])
    if normalize:
        panel = panel / panel.iloc[0] * 100
    payload = {
        "dates": [str(idx)[:10] for idx in panel.index],
        "series": [
            {
                "code": code,
                "name": next((item.name for item in UNIVERSE if item.code == code), code),
                "values": [None if v != v else round(float(v), 4) for v in panel[code].tolist()],
            }
            for code in panel.columns
        ],
    }
    return to_native(payload)


@app.post("/analyze")
def analyze_endpoint(request: AnalysisRequest) -> dict:
    run_id = f"ana_{uuid.uuid4().hex[:10]}"
    try:
        result = analyze(request)
        store.save_analysis(run_id, "FULL", request.model_dump(), result, result.get("summary", ""), "real_data")
        result["analysis_id"] = run_id
        return result
    except Exception as exc:
        store.save_analysis(run_id, "FULL", request.model_dump(), None, "", "error", str(exc)[:500])
        raise HTTPException(status_code=422, detail=str(exc)[:500])


@app.post("/agent/run")
def agent_endpoint(request: AgentRequest) -> dict:
    try:
        return run_agent(request)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)[:500])


@app.get("/agent/runs")
def agent_runs(limit: int = 20) -> dict:
    return {"items": store.list_agent_runs(limit=min(limit, 100))}


@app.get("/agent/runs/{run_id}")
def agent_run_detail(run_id: str) -> dict:
    data = store.get_agent_run(run_id)
    if not data:
        raise HTTPException(status_code=404, detail="run not found")
    return data


@app.post("/vision/analyze")
def vision_endpoint(request: VisionRequest) -> dict:
    context = ""
    if request.portfolio:
        try:
            result = analyze(request.portfolio)
            context = result.get("summary", "")[:1500]
        except Exception:
            context = ""
    try:
        text = llm.analyze_image(request.image_base64, request.mime, request.prompt, context)
        return {"ok": True, "text": text, "vision_model": settings.llm_vision_model or settings.llm_model}
    except Exception as exc:
        return JSONResponse(status_code=503, content={"ok": False, "error": str(exc)[:400]})


@app.get("/report/{report_id}", response_class=HTMLResponse)
def report_html(report_id: str) -> HTMLResponse:
    data = store.get_report(report_id)
    if not data:
        raise HTTPException(status_code=404, detail="report not found")
    return HTMLResponse(content=data["html"])


@app.get("/report/{report_id}/pdf")
def report_pdf(report_id: str):
    data = store.get_report(report_id)
    if not data:
        raise HTTPException(status_code=404, detail="report not found")
    path = data.get("pdf_path")
    if not path or not os.path.exists(path):
        raise HTTPException(status_code=404, detail="pdf not generated")
    return FileResponse(path, media_type="application/pdf", filename=f"{report_id}.pdf")


@app.get("/reports")
def reports(limit: int = 30) -> dict:
    return {"items": store.list_reports(limit=min(limit, 100))}


@app.post("/reports/generate")
def report_generate(request: ReportRequest) -> dict:
    from .report.generator import generate_report

    meta = generate_report(request.analysis, request.advice or {}, request.run_id)
    return meta


@app.post("/data/refresh")
def data_refresh() -> dict:
    """Warm the cache before a demo. Returns row counts, never fake data."""
    try:
        panel = market.get_panel(refresh=True)
        macro = macro_snapshot(force=True)
        spot = market.get_spot(force=True)
        return {
            "ok": True,
            "series": len(panel.columns),
            "rows": int(panel.shape[0]),
            "data_end": str(panel.index[-1])[:10],
            "macro_indicators": len(macro.get("indicators", [])),
            "quotes": len(spot),
        }
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)[:400])
