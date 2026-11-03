"""Runtime configuration.

The service is intentionally dependency-light: it reads the repository `.env`
without requiring python-dotenv, so the same file can be shared with Next.js.
LLM credentials can also be updated at runtime from the settings page; they are
stored in `data/llm.json` and never logged.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SERVICE_ROOT.parents[1]
DATA_DIR = SERVICE_ROOT / "data"
CACHE_DIR = DATA_DIR / "cache"
REPORT_DIR = DATA_DIR / "reports"
MARKET_DB = DATA_DIR / "market.db"
DEMO_SNAPSHOT = DATA_DIR / "snapshot.json"
LLM_CONFIG_FILE = DATA_DIR / "llm.json"

for folder in (DATA_DIR, CACHE_DIR, REPORT_DIR):
    folder.mkdir(parents=True, exist_ok=True)


def _load_env(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


_load_env(REPO_ROOT / ".env")
_load_env(SERVICE_ROOT / ".env")


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _read_runtime_llm() -> dict:
    if not LLM_CONFIG_FILE.exists():
        return {}
    try:
        data = json.loads(LLM_CONFIG_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


class Settings:
    service_name = "FinScope Quant & Agent"
    version = "2.0.0"

    quant_host = env("QUANT_HOST", "127.0.0.1")
    quant_port = int(env("QUANT_PORT", "8000"))

    llm_timeout_ms = int(env("LLM_TIMEOUT_MS", "60000"))
    llm_temperature = float(env("LLM_TEMPERATURE", "0.2"))

    price_cache_hours = int(env("PRICE_CACHE_HOURS", "12"))
    macro_cache_hours = int(env("MACRO_CACHE_HOURS", "24"))
    spot_cache_minutes = int(env("SPOT_CACHE_MINUTES", "30"))
    allow_live_data = env("ALLOW_LIVE_DATA", "true").lower() not in {"0", "false", "no"}

    def __init__(self) -> None:
        self._runtime = _read_runtime_llm()

    @property
    def llm_base_url(self) -> str:
        return str(self._runtime.get("base_url") or env("LLM_BASE_URL")).strip()

    @property
    def llm_api_key(self) -> str:
        return str(self._runtime.get("api_key") or env("LLM_API_KEY")).strip()

    @property
    def llm_model(self) -> str:
        return str(self._runtime.get("model") or env("LLM_MODEL")).strip()

    @property
    def llm_vision_base_url(self) -> str:
        return str(self._runtime.get("vision_base_url") or env("LLM_VISION_BASE_URL")).strip()

    @property
    def llm_vision_api_key(self) -> str:
        return str(self._runtime.get("vision_api_key") or env("LLM_VISION_API_KEY")).strip()

    @property
    def llm_vision_model(self) -> str:
        return str(self._runtime.get("vision_model") or env("LLM_VISION_MODEL") or self.llm_model).strip()

    @property
    def llm_configured(self) -> bool:
        return bool(self.llm_base_url and self.llm_api_key and self.llm_model)

    @property
    def llm_chat_url(self) -> str:
        base = self.llm_base_url.rstrip("/")
        if base.endswith("/chat/completions"):
            return base
        if base.endswith("/v1"):
            return f"{base}/chat/completions"
        return f"{base}/v1/chat/completions"

    def update_llm(self, payload: dict) -> None:
        allowed = {"base_url", "api_key", "model", "vision_base_url", "vision_api_key", "vision_model"}
        for key, value in payload.items():
            if key in allowed and isinstance(value, str):
                if value.strip():
                    self._runtime[key] = value.strip()
                elif key in self._runtime:
                    self._runtime.pop(key, None)
        LLM_CONFIG_FILE.write_text(json.dumps(self._runtime, ensure_ascii=False, indent=2), encoding="utf-8")

    def public_llm(self) -> dict:
        def mask(value: str) -> str:
            if not value:
                return ""
            return f"{value[:4]}…{value[-4:]}" if len(value) > 8 else "已配置"

        return {
            "base_url": self.llm_base_url,
            "model": self.llm_model,
            "api_key_masked": mask(self.llm_api_key),
            "configured": self.llm_configured,
            "vision_base_url": self.llm_vision_base_url,
            "vision_model": self.llm_vision_model if self.llm_vision_model != self.llm_model else "",
            "vision_api_key_masked": mask(self.llm_vision_api_key),
            "vision_configured": bool(
                (self.llm_base_url or self.llm_vision_base_url)
                and (self.llm_api_key or self.llm_vision_api_key)
                and self.llm_vision_model
            ),
        }


settings = Settings()
