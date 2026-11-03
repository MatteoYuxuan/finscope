"""Market data provider (AkShare / Eastmoney), cached in SQLite.

All functions are best-effort: if the network is unavailable, cached data is
returned. If there is no cache, the caller gets an explicit DataUnavailable
error rather than silent fake numbers.
"""

from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta
from typing import Iterable

import pandas as pd

from .. import store
from ..config import settings
from ..universe import BY_CODE, UNIVERSE

_AK = None
_AK_LOCK = threading.Lock()
_FETCH_LOCK = threading.Lock()


class DataUnavailable(RuntimeError):
    pass


def _ak():
    global _AK
    with _AK_LOCK:
        if _AK is None:
            import akshare as ak  # imported lazily: startup stays fast

            _AK = ak
    return _AK


def _today() -> str:
    return date.today().strftime("%Y%m%d")


def _norm_date(value) -> str:
    if isinstance(value, (datetime, date)):
        return value.strftime("%Y-%m-%d")
    text = str(value).strip()
    if len(text) == 8 and text.isdigit():
        return f"{text[:4]}-{text[4:6]}-{text[6:]}"
    return text[:10]


def _num(value):
    try:
        out = float(value)
        return None if out != out else out
    except Exception:
        return None


def fetch_etf_history(code: str, start: str = "2015-01-01", force: bool = False) -> pd.DataFrame:
    """Fetch adjusted daily ETF bars. Returns a DataFrame indexed by date."""
    cache_key = f"etf:{code}"
    cached = store.load_prices(code, start=start)
    if cached and not force and store.is_fresh(cache_key, settings.price_cache_hours * 3600):
        return _frame(cached)

    if not settings.allow_live_data:
        if cached:
            return _frame(cached)
        raise DataUnavailable(f"{code} 无本地缓存，且当前禁止联网")

    try:
        raw = _ak().fund_etf_hist_em(
            symbol=code,
            period="daily",
            start_date=start.replace("-", ""),
            end_date=_today(),
            adjust="qfq",
        )
    except Exception as exc:  # network / provider error
        if cached:
            store.touch(cache_key, len(cached), {"warning": str(exc)[:200]})
            return _frame(cached)
        raise DataUnavailable(f"无法获取 {code} 行情：{str(exc)[:160]}") from exc

    if raw is None or len(raw) == 0:
        if cached:
            return _frame(cached)
        raise DataUnavailable(f"{code} 行情为空")

    df = _normalise_hist(raw)
    rows = df.reset_index().to_dict("records")
    store.upsert_prices(code, rows)
    store.touch(cache_key, len(rows), {"last_date": str(df.index.max())[:10]})
    return df


def _normalise_hist(raw: pd.DataFrame) -> pd.DataFrame:
    # AkShare returns Chinese column names; map defensively by common aliases.
    aliases = {
        "date": ["日期", "date", "时间"],
        "open": ["开盘", "开盘价", "open"],
        "high": ["最高", "最高价", "high"],
        "low": ["最低", "最低价", "low"],
        "close": ["收盘", "收盘价", "close"],
        "volume": ["成交量", "volume"],
        "amount": ["成交额", "amount"],
    }
    out = pd.DataFrame()
    for target, names in aliases.items():
        col = next((name for name in names if name in raw.columns), None)
        if col is None:
            if target in {"open", "high", "low"}:
                out[target] = None
            elif target in {"volume", "amount"}:
                out[target] = 0.0
            else:
                raise DataUnavailable(f"行情缺少字段：{target}")
        else:
            out[target] = raw[col]
    out["date"] = out["date"].map(_norm_date)
    out = out.dropna(subset=["date", "close"])
    out = out.drop_duplicates(subset=["date"], keep="last").sort_values("date")
    for col in ("open", "high", "low", "close", "volume", "amount"):
        out[col] = pd.to_numeric(out[col], errors="coerce")
    out = out.set_index("date")
    out.index.name = "date"
    return out


def _frame(rows: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(rows)
    df["date"] = df["date"].map(_norm_date)
    df = df.set_index("date").sort_index()
    for col in ("open", "high", "low", "close", "volume", "amount"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    return df


def fetch_index_history(symbol: str, start: str = "2010-01-01", force: bool = False) -> pd.DataFrame:
    """Fetch a Chinese index series for regime/benchmark analysis."""
    code = f"idx:{symbol}"
    cached = store.load_prices(code, start=start)
    if cached and not force and store.is_fresh(code, settings.price_cache_hours * 3600):
        return _frame(cached)
    if not settings.allow_live_data:
        if cached:
            return _frame(cached)
        raise DataUnavailable(f"{symbol} 无本地缓存")
    try:
        raw = _ak().stock_zh_index_daily(symbol=f"sh{symbol}" if symbol.startswith(("000", "399")) and symbol != "399006" else symbol)
        if raw is None or len(raw) == 0:
            raw = _ak().stock_zh_index_daily(symbol=symbol)
    except Exception as exc:
        if cached:
            return _frame(cached)
        raise DataUnavailable(f"无法获取指数 {symbol}：{str(exc)[:120]}") from exc
    df = _normalise_hist(raw)
    store.upsert_prices(code, df.reset_index().to_dict("records"))
    store.touch(code, len(df), {"symbol": symbol})
    return df


def get_panel(
    codes: Iterable[str] | None = None,
    start: str = "2019-01-01",
    end: str | None = None,
    refresh: bool = False,
) -> pd.DataFrame:
    """Return an aligned close-price panel for the requested ETF codes."""
    codes = list(codes or [item.code for item in UNIVERSE])
    frames: dict[str, pd.Series] = {}
    errors: dict[str, str] = {}

    def load(code: str):
        try:
            df = fetch_etf_history(code, start=start, force=refresh)
            return code, df["close"]
        except Exception as exc:
            return code, exc

    # Four concurrent requests is a good trade-off: fast enough, gentle on the
    # public endpoints, and avoids AkShare's internal progress-bar noise.
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(load, code) for code in codes]
        for future in as_completed(futures):
            code, result = future.result()
            if isinstance(result, Exception):
                errors[code] = str(result)[:160]
            else:
                frames[code] = result

    if not frames:
        raise DataUnavailable(f"没有任何行情可用：{errors}")

    panel = pd.DataFrame(frames).sort_index()
    panel = panel.loc[:, [code for code in codes if code in panel.columns]]
    if end:
        panel = panel.loc[:end]
    panel = panel.ffill(limit=5)
    return panel


def get_spot(force: bool = False, live: bool = True) -> list[dict]:
    """Latest ETF quote/liquidity snapshot.

    `live=False` means "use cache only" — important for fast page loads and for
    demos where the public endpoint is slow. `refresh` explicitly opts into live.
    """
    cached = store.load_spot(settings.spot_cache_minutes * 60)
    if cached and not force:
        return cached
    if not settings.allow_live_data or not live:
        return cached
    try:
        raw = _ak().fund_etf_spot_em()
    except Exception:
        return cached
    if raw is None or len(raw) == 0:
        return cached
    records = []
    for _, row in raw.iterrows():
        code = str(row.iloc[0]).zfill(6)
        if code not in BY_CODE:
            continue
        records.append(
            {
                "code": code,
                "name": str(row.iloc[1]),
                "price": _num(row.iloc[2]),
                "change_pct": _num(row.iloc[6]),
                "volume": _num(row.iloc[7]),
                "amount": _num(row.iloc[8]),
                "turnover": _num(row.iloc[14]),
                "shares": _num(row.iloc[33]) if len(row) > 33 else None,
                "market_cap": _num(row.iloc[35]) if len(row) > 35 else None,
                "as_of": _norm_date(row.iloc[-2]) if len(row) > 1 else date.today().isoformat(),
            }
        )
    if records:
        store.save_spot(records)
    return records or cached


def latest_price(code: str) -> float | None:
    df = fetch_etf_history(code, start=(date.today() - timedelta(days=20)).isoformat())
    if df.empty:
        return None
    return _num(df["close"].iloc[-1])


def data_health() -> dict:
    sample = store.load_prices("510300")
    try:
        with store.connect() as conn:
            cached_series = int(conn.execute("SELECT COUNT(DISTINCT code) FROM price_history").fetchone()[0])
    except Exception:
        cached_series = 0
    return {
        "cached_series": cached_series,
        "510300_rows": len(sample),
        "last_date": sample[-1]["date"] if sample else None,
        "live_allowed": settings.allow_live_data,
        "price_cache_hours": settings.price_cache_hours,
    }
