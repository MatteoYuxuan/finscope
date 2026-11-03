"""SQLite cache for market data, analysis runs, agent traces and reports.

The Next.js app owns user data (Prisma/SQLite). This service owns *market and
computation* state. Keeping them separate avoids two writers on the same SQLite
file while still giving the demo a single-file, offline-capable cache.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator

from .config import MARKET_DB

_LOCK = threading.RLock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS price_history (
  code TEXT NOT NULL,
  date TEXT NOT NULL,
  open REAL, high REAL, low REAL, close REAL,
  volume REAL, amount REAL,
  source TEXT,
  PRIMARY KEY (code, date)
);
CREATE INDEX IF NOT EXISTS idx_price_code_date ON price_history(code, date);

CREATE TABLE IF NOT EXISTS fetch_log (
  key TEXT PRIMARY KEY,
  fetched_at REAL NOT NULL,
  rows INTEGER NOT NULL DEFAULT 0,
  meta TEXT
);

CREATE TABLE IF NOT EXISTS macro_series (
  series TEXT NOT NULL,
  date TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT,
  source TEXT,
  PRIMARY KEY (series, date)
);

CREATE TABLE IF NOT EXISTS spot_cache (
  code TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  fetched_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS analysis_runs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL,
  request TEXT,
  result TEXT,
  summary TEXT,
  mode TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  finished_at TEXT,
  task TEXT NOT NULL,
  status TEXT NOT NULL,
  mode TEXT,
  model TEXT,
  result TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS agent_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  tool_name TEXT,
  tool_input TEXT,
  tool_output TEXT,
  status TEXT NOT NULL DEFAULT 'ok',
  latency_ms INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_steps_run ON agent_steps(run_id, seq);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  title TEXT NOT NULL,
  html TEXT NOT NULL,
  markdown TEXT,
  payload TEXT,
  pdf_path TEXT,
  created_at TEXT NOT NULL
);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    with _LOCK:
        conn = sqlite3.connect(MARKET_DB, timeout=30)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            yield conn
            conn.commit()
        finally:
            conn.close()


def init_db() -> None:
    with connect() as conn:
        conn.executescript(SCHEMA)


def is_fresh(key: str, max_age_seconds: float) -> bool:
    with connect() as conn:
        row = conn.execute("SELECT fetched_at FROM fetch_log WHERE key = ?", (key,)).fetchone()
    return bool(row) and (time.time() - float(row["fetched_at"])) <= max_age_seconds


def touch(key: str, rows: int = 0, meta: dict | None = None) -> None:
    with connect() as conn:
        conn.execute(
            "INSERT INTO fetch_log(key, fetched_at, rows, meta) VALUES(?,?,?,?) "
            "ON CONFLICT(key) DO UPDATE SET fetched_at=excluded.fetched_at, rows=excluded.rows, meta=excluded.meta",
            (key, time.time(), rows, json.dumps(meta or {}, ensure_ascii=False)),
        )


def last_fetch(key: str) -> dict | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM fetch_log WHERE key = ?", (key,)).fetchone()
    return dict(row) if row else None


def upsert_prices(code: str, rows: list[dict], source: str = "akshare") -> int:
    if not rows:
        return 0
    payload = [
        (
            code,
            str(item.get("date")),
            _f(item.get("open")),
            _f(item.get("high")),
            _f(item.get("low")),
            _f(item.get("close")),
            _f(item.get("volume")),
            _f(item.get("amount")),
            source,
        )
        for item in rows
        if item.get("date") and item.get("close") is not None
    ]
    with connect() as conn:
        conn.executemany(
            "INSERT INTO price_history(code,date,open,high,low,close,volume,amount,source) "
            "VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(code,date) DO UPDATE SET "
            "open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close, "
            "volume=excluded.volume, amount=excluded.amount, source=excluded.source",
            payload,
        )
    return len(payload)


def load_prices(code: str, start: str | None = None, end: str | None = None) -> list[dict]:
    sql = "SELECT date, open, high, low, close, volume, amount FROM price_history WHERE code = ?"
    args: list[Any] = [code]
    if start:
        sql += " AND date >= ?"
        args.append(start)
    if end:
        sql += " AND date <= ?"
        args.append(end)
    sql += " ORDER BY date"
    with connect() as conn:
        rows = conn.execute(sql, args).fetchall()
    return [dict(row) for row in rows]


def upsert_macro(series: str, rows: list[dict], unit: str = "", source: str = "akshare") -> int:
    payload = [
        (series, str(item["date"]), float(item["value"]), unit, source)
        for item in rows
        if item.get("date") and item.get("value") is not None
    ]
    if not payload:
        return 0
    with connect() as conn:
        conn.executemany(
            "INSERT INTO macro_series(series,date,value,unit,source) VALUES(?,?,?,?,?) "
            "ON CONFLICT(series,date) DO UPDATE SET value=excluded.value, unit=excluded.unit, source=excluded.source",
            payload,
        )
    return len(payload)


def load_macro(series: str) -> list[dict]:
    with connect() as conn:
        rows = conn.execute(
            "SELECT date, value, unit, source FROM macro_series WHERE series = ? ORDER BY date",
            (series,),
        ).fetchall()
    return [dict(row) for row in rows]


def save_spot(rows: list[dict]) -> None:
    payload = [(str(item["code"]), json.dumps(item, ensure_ascii=False), time.time()) for item in rows]
    with connect() as conn:
        conn.executemany(
            "INSERT INTO spot_cache(code,payload,fetched_at) VALUES(?,?,?) "
            "ON CONFLICT(code) DO UPDATE SET payload=excluded.payload, fetched_at=excluded.fetched_at",
            payload,
        )


def load_spot(max_age_seconds: float = 3600) -> list[dict]:
    cutoff = time.time() - max_age_seconds
    with connect() as conn:
        rows = conn.execute("SELECT payload FROM spot_cache WHERE fetched_at >= ?", (cutoff,)).fetchall()
    return [json.loads(row["payload"]) for row in rows]


def save_analysis(run_id: str, kind: str, request: Any, result: Any, summary: str, mode: str, error: str | None = None) -> None:
    with connect() as conn:
        conn.execute(
            "INSERT INTO analysis_runs(id,created_at,kind,request,result,summary,mode,error) VALUES(?,?,?,?,?,?,?,?)",
            (
                run_id,
                now_iso(),
                kind,
                json.dumps(request, ensure_ascii=False, default=str),
                json.dumps(result, ensure_ascii=False, default=str),
                summary,
                mode,
                error,
            ),
        )


def get_analysis(run_id: str) -> dict | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM analysis_runs WHERE id = ?", (run_id,)).fetchone()
    if not row:
        return None
    data = dict(row)
    for key in ("request", "result"):
        try:
            data[key] = json.loads(data[key]) if data[key] else None
        except Exception:
            pass
    return data


def create_agent_run(run_id: str, task: str, mode: str, model: str | None) -> None:
    with connect() as conn:
        conn.execute(
            "INSERT INTO agent_runs(id,created_at,task,status,mode,model) VALUES(?,?,?,?,?,?)",
            (run_id, now_iso(), task, "running", mode, model),
        )


def finish_agent_run(run_id: str, status: str, result: Any = None, error: str | None = None) -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE agent_runs SET status=?, finished_at=?, result=?, error=? WHERE id=?",
            (
                status,
                now_iso(),
                json.dumps(result, ensure_ascii=False, default=str) if result is not None else None,
                error,
                run_id,
            ),
        )


def add_agent_step(
    run_id: str,
    seq: int,
    role: str,
    type_: str,
    title: str,
    detail: str = "",
    tool_name: str | None = None,
    tool_input: Any = None,
    tool_output: Any = None,
    status: str = "ok",
    latency_ms: int = 0,
) -> dict:
    step_id = f"step_{run_id}_{seq:03d}"
    with connect() as conn:
        conn.execute(
            "INSERT INTO agent_steps(id,run_id,seq,role,type,title,detail,tool_name,tool_input,tool_output,status,latency_ms,created_at) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                step_id,
                run_id,
                seq,
                role,
                type_,
                title,
                detail,
                tool_name,
                json.dumps(tool_input, ensure_ascii=False, default=str) if tool_input is not None else None,
                json.dumps(tool_output, ensure_ascii=False, default=str) if tool_output is not None else None,
                status,
                latency_ms,
                now_iso(),
            ),
        )
    return {"id": step_id, "seq": seq, "role": role, "type": type_, "title": title, "detail": detail, "status": status}


def get_agent_run(run_id: str) -> dict | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM agent_runs WHERE id = ?", (run_id,)).fetchone()
        steps = conn.execute("SELECT * FROM agent_steps WHERE run_id = ? ORDER BY seq", (run_id,)).fetchall()
    if not row:
        return None
    data = dict(row)
    if data.get("result"):
        try:
            data["result"] = json.loads(data["result"])
        except Exception:
            pass
    data["steps"] = []
    for step in steps:
        item = dict(step)
        for key in ("tool_input", "tool_output"):
            if item.get(key):
                try:
                    item[key] = json.loads(item[key])
                except Exception:
                    pass
        data["steps"].append(item)
    return data


def list_agent_runs(limit: int = 20) -> list[dict]:
    with connect() as conn:
        rows = conn.execute(
            "SELECT id,created_at,finished_at,task,status,mode,model,error FROM agent_runs ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [dict(row) for row in rows]


def save_report(report_id: str, title: str, html: str, markdown: str, payload: Any, run_id: str | None = None, pdf_path: str | None = None) -> None:
    with connect() as conn:
        conn.execute(
            "INSERT INTO reports(id,run_id,title,html,markdown,payload,pdf_path,created_at) VALUES(?,?,?,?,?,?,?,?) "
            "ON CONFLICT(id) DO UPDATE SET title=excluded.title, html=excluded.html, markdown=excluded.markdown, "
            "payload=excluded.payload, pdf_path=excluded.pdf_path",
            (
                report_id,
                run_id,
                title,
                html,
                markdown,
                json.dumps(payload, ensure_ascii=False, default=str),
                pdf_path,
                now_iso(),
            ),
        )


def get_report(report_id: str) -> dict | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM reports WHERE id = ?", (report_id,)).fetchone()
    if not row:
        return None
    data = dict(row)
    if data.get("payload"):
        try:
            data["payload"] = json.loads(data["payload"])
        except Exception:
            pass
    return data


def list_reports(limit: int = 30) -> list[dict]:
    with connect() as conn:
        rows = conn.execute(
            "SELECT id,run_id,title,created_at,pdf_path FROM reports ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [dict(row) for row in rows]


# Initialise on import so CLI, FastAPI and tests share the same schema.
init_db()


def _f(value: Any) -> float | None:
    try:
        if value is None:
            return None
        out = float(value)
        if out != out:  # NaN
            return None
        return out
    except Exception:
        return None
