"""Macro data provider: China growth/inflation/liquidity + rates + FX.

The public data endpoints are sometimes delayed. The API therefore returns the
observation date for every indicator and never pretends that a stale print is
today's number. Missing indicators are omitted, not filled with fabricated data.
"""

from __future__ import annotations

import csv
import io
import re
from datetime import date
from typing import Any

import httpx
import pandas as pd

from .. import store
from ..config import settings

_AK = None


def _ak():
    global _AK
    if _AK is None:
        import akshare as ak

        _AK = ak
    return _AK


SERIES_META = {
    "cn_cpi": ("中国 CPI 同比", "%", "国家统计局 / 东方财富"),
    "cn_ppi": ("中国 PPI 同比", "%", "国家统计局 / 东方财富"),
    "cn_pmi": ("中国制造业 PMI", "点", "国家统计局 / 东方财富"),
    "cn_m2": ("中国 M2 同比", "%", "中国人民银行 / 东方财富"),
    "cn_gdp": ("中国 GDP 同比", "%", "国家统计局 / 东方财富"),
    "cn_lpr1y": ("1 年期 LPR", "%", "全国银行间同业拆借中心"),
    "cn_lpr5y": ("5 年期 LPR", "%", "全国银行间同业拆借中心"),
    "cn_10y": ("中国 10 年期国债收益率", "%", "中国债券信息网 / 东方财富"),
    "cn_2y": ("中国 2 年期国债收益率", "%", "中国债券信息网 / 东方财富"),
    "us_10y": ("美国 10 年期国债收益率", "%", "FRED"),
    "us_vix": ("VIX 波动率指数", "点", "FRED"),
    "usdcny": ("美元兑人民币", "CNY/USD", "中国银行 / 国家外汇管理局"),
    "cn_shrzgm": ("中国社会融资规模增量", "亿元", "中国人民银行"),
}


def _norm_date(value) -> str:
    text = str(value).strip()
    if len(text) == 8 and text.isdigit():
        return f"{text[:4]}-{text[4:6]}-{text[6:]}"
    match = re.search(r"(\d{4})\D+(\d{1,2})", text)
    if match:
        return f"{match.group(1)}-{int(match.group(2)):02d}-01"
    return text[:10]


def _num(value):
    try:
        out = float(value)
        return None if out != out else out
    except Exception:
        return None


def _latest(df: pd.DataFrame, date_col: str, value_col: str) -> tuple[str, float] | None:
    if df is None or len(df) == 0 or date_col not in df.columns or value_col not in df.columns:
        return None
    work = df[[date_col, value_col]].copy()
    work[value_col] = pd.to_numeric(work[value_col], errors="coerce")
    work = work.dropna(subset=[value_col])
    if work.empty:
        return None
    row = work.iloc[-1]
    return _norm_date(row[date_col]), float(row[value_col])


def _series_from_ak(series: str, df: pd.DataFrame, date_candidates: list[str], value_candidates: list[str]) -> list[dict]:
    date_col = next((c for c in date_candidates if c in df.columns), None)
    value_col = next((c for c in value_candidates if c in df.columns), None)
    if not date_col or not value_col:
        return []
    work = df[[date_col, value_col]].copy()
    work[value_col] = pd.to_numeric(work[value_col], errors="coerce")
    work = work.dropna(subset=[value_col])
    rows = []
    for _, row in work.iterrows():
        rows.append({"date": _norm_date(row[date_col]), "value": float(row[value_col])})
    rows.sort(key=lambda item: item["date"])
    # De-duplicate after date normalisation, keeping the last observation.
    dedup: dict[str, dict] = {}
    for item in rows:
        dedup[item["date"]] = item
    return list(dedup.values())


def _cached_or_fetch(series: str, fetcher, force: bool = False) -> list[dict]:
    cached = store.load_macro(series)
    if cached and not force and store.is_fresh(f"macro:{series}", settings.macro_cache_hours * 3600):
        return cached
    if not settings.allow_live_data:
        return cached
    try:
        rows = fetcher()
    except Exception:
        return cached
    if rows:
        store.upsert_macro(series, rows, SERIES_META.get(series, ("", "", ""))[1])
        store.touch(f"macro:{series}", len(rows))
        return rows
    return cached


def _fetch_china_indicator(func_name: str, series: str) -> list[dict]:
    fn = getattr(_ak(), func_name)
    df = fn()
    return _series_from_ak(series, df, ["日期", "date", "月份"], ["今值", "值", "value"])


def _fresh(series: str) -> bool:
    return store.is_fresh(f"macro:{series}", settings.macro_cache_hours * 3600)


def _fetch_lpr(force: bool = False) -> tuple[list[dict], list[dict]]:
    if not force and _fresh("cn_lpr1y") and _fresh("cn_lpr5y"):
        return store.load_macro("cn_lpr1y"), store.load_macro("cn_lpr5y")

    def load():
        return _ak().macro_china_lpr()

    try:
        df = load()
    except Exception:
        df = pd.DataFrame()
    rows1 = _series_from_ak("cn_lpr1y", df, ["TRADE_DATE", "日期"], ["LPR1Y", "1年期"])
    rows5 = _series_from_ak("cn_lpr5y", df, ["TRADE_DATE", "日期"], ["LPR5Y", "5年期"])
    if rows1:
        store.upsert_macro("cn_lpr1y", rows1, "%")
        store.touch("macro:cn_lpr1y", len(rows1))
    if rows5:
        store.upsert_macro("cn_lpr5y", rows5, "%")
        store.touch("macro:cn_lpr5y", len(rows5))
    return store.load_macro("cn_lpr1y"), store.load_macro("cn_lpr5y")


def _fetch_rates(force: bool = False) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    if not force and _fresh("cn_10y") and _fresh("cn_2y"):
        return {key: store.load_macro(key) for key in ("cn_2y", "cn_10y", "us_10y")}
    try:
        df = _ak().bond_zh_us_rate()
        mapping = {
            "cn_2y": ["中国国债收益率2年", "中国国债收益率2年期"],
            "cn_10y": ["中国国债收益率10年", "中国国债收益率10年期"],
            "us_10y": ["美国国债收益率10年", "美国国债收益率10年期"],
        }
        for series, candidates in mapping.items():
            col = next((c for c in candidates if c in df.columns), None)
            if col:
                rows = _series_from_ak(series, df, ["日期", "date"], [col])
                if rows:
                    store.upsert_macro(series, rows, "%")
                    store.touch(f"macro:{series}", len(rows))
                out[series] = rows
    except Exception:
        pass
    return {key: store.load_macro(key) for key in ("cn_2y", "cn_10y", "us_10y")}


def _fetch_fx(force: bool = False) -> list[dict]:
    if not force and _fresh("usdcny"):
        return store.load_macro("usdcny")
    try:
        df = _ak().currency_boc_safe()
        col = next((c for c in ["美元", "USD"] if c in df.columns), None)
        date_col = next((c for c in ["日期", "date"] if c in df.columns), None)
        if not col or not date_col:
            return store.load_macro("usdcny")
        work = df[[date_col, col]].copy()
        work[col] = pd.to_numeric(work[col], errors="coerce")
        work = work.dropna(subset=[col])
        rows = []
        for _, row in work.iterrows():
            value = float(row[col])
            if value > 20:  # BOC quotes CNY per 100 USD
                value /= 100
            rows.append({"date": _norm_date(row[date_col]), "value": value})
        if rows:
            store.upsert_macro("usdcny", rows, "CNY/USD")
            store.touch("macro:usdcny", len(rows))
        return store.load_macro("usdcny")
    except Exception:
        return store.load_macro("usdcny")


def _fetch_fred(series: str, fred_id: str, force: bool = False) -> list[dict]:
    cached = store.load_macro(series)
    if cached and not force and store.is_fresh(f"macro:{series}", settings.macro_cache_hours * 3600):
        return cached
    if not settings.allow_live_data:
        return cached
    try:
        with httpx.Client(timeout=20) as client:
            resp = client.get(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={fred_id}")
            resp.raise_for_status()
        reader = csv.DictReader(io.StringIO(resp.text))
        rows = []
        for item in reader:
            raw = item.get(fred_id)
            value = _num(raw)
            if value is None:
                continue
            rows.append({"date": item.get("DATE") or item.get("observation_date"), "value": value})
        if rows:
            store.upsert_macro(series, rows, SERIES_META.get(series, ("", "", ""))[1], source="FRED")
            store.touch(f"macro:{series}", len(rows))
        return rows or cached
    except Exception:
        return cached


def _latest_of(rows: list[dict]) -> tuple[str, float, float | None] | None:
    if not rows:
        return None
    last = rows[-1]
    prev = rows[-2]["value"] if len(rows) > 1 else None
    return last["date"], float(last["value"]), prev


def macro_snapshot(force: bool = False) -> dict[str, Any]:
    """Return latest macro indicators plus a few derived signals."""
    fetched: dict[str, list[dict]] = {}
    for series, func in [
        ("cn_cpi", "macro_china_cpi_monthly"),
        ("cn_ppi", "macro_china_ppi_yearly"),
        ("cn_pmi", "macro_china_pmi_yearly"),
        ("cn_m2", "macro_china_m2_yearly"),
        ("cn_gdp", "macro_china_gdp_yearly"),
        ("cn_shrzgm", "macro_china_shrzgm"),
    ]:
        fetched[series] = _cached_or_fetch(series, lambda f=func, s=series: _fetch_china_indicator(f, s), force)

    lpr1, lpr5 = _fetch_lpr(force)
    fetched["cn_lpr1y"] = lpr1
    fetched["cn_lpr5y"] = lpr5
    fetched.update(_fetch_rates(force))
    fetched["usdcny"] = _fetch_fx(force)
    fetched["us_10y"] = _fetch_fred("us_10y", "DGS10") or fetched.get("us_10y", [])
    fetched["us_vix"] = _fetch_fred("us_vix", "VIXCLS")

    indicators = []
    for series, rows in fetched.items():
        latest = _latest_of(rows)
        if not latest:
            continue
        date_, value, prev = latest
        label, unit, source = SERIES_META.get(series, (series, "", ""))
        indicators.append(
            {
                "key": series,
                "label": label,
                "value": round(value, 4),
                "previous": round(prev, 4) if prev is not None else None,
                "change": round(value - prev, 4) if prev is not None else None,
                "unit": unit,
                "date": date_,
                "source": source,
            }
        )

    by_key = {item["key"]: item for item in indicators}
    cn_10y = by_key.get("cn_10y", {}).get("value")
    cn_2y = by_key.get("cn_2y", {}).get("value")
    us_10y = by_key.get("us_10y", {}).get("value")

    return {
        "as_of": date.today().isoformat(),
        "indicators": indicators,
        "derived": {
            "cn_term_spread": round(cn_10y - cn_2y, 4) if cn_10y is not None and cn_2y is not None else None,
            "cn_us_spread": round(cn_10y - us_10y, 4) if cn_10y is not None and us_10y is not None else None,
            "pmi_above_50": (by_key.get("cn_pmi", {}).get("value") or 0) > 50 if "cn_pmi" in by_key else None,
            "cpi_below_3": (by_key.get("cn_cpi", {}).get("value") or 0) < 3 if "cn_cpi" in by_key else None,
        },
        "note": "宏观数据来自公开接口，发布日期可能滞后于行情；每个指标均标注实际观测日期。",
    }


def macro_for_prompt(snapshot: dict[str, Any]) -> str:
    lines = []
    for item in snapshot.get("indicators", []):
        lines.append(f"- {item['label']}：{item['value']}{item['unit']}（{item['date']}，前值 {item['previous']}）")
    return "\n".join(lines) or "- 暂无可用宏观数据"
