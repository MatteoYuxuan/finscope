"""OpenAI-compatible LLM client with tool calling and a strict failure mode.

The agent never trusts free-form model output for numbers. This client is only
responsible for transport; the orchestrator validates and merges model text
with deterministic artifacts.
"""

from __future__ import annotations

import json
import re
from typing import Any, Callable

import httpx

from ..config import settings


class LLMError(RuntimeError):
    pass


def configured() -> bool:
    return settings.llm_configured


def vision_configured() -> bool:
    return bool(
        (settings.llm_base_url or settings.llm_vision_base_url)
        and (settings.llm_api_key or settings.llm_vision_api_key)
        and settings.llm_vision_model
    )


def _headers(api_key: str | None = None) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key or settings.llm_api_key}",
        "Content-Type": "application/json",
    }


def _url(base: str | None = None) -> str:
    if not base:
        return settings.llm_chat_url
    base = base.rstrip("/")
    if base.endswith("/chat/completions"):
        return base
    if base.endswith("/v1"):
        return f"{base}/chat/completions"
    return f"{base}/v1/chat/completions"


def chat(
    messages: list[dict[str, Any]],
    *,
    tools: list[dict] | None = None,
    model: str | None = None,
    temperature: float | None = None,
    response_format: dict | None = None,
    timeout_ms: int | None = None,
    base_url: str | None = None,
    api_key: str | None = None,
    vision: bool = False,
) -> dict[str, Any]:
    if not settings.llm_configured and not vision:
        raise LLMError("未配置 LLM（LLM_BASE_URL / LLM_API_KEY / LLM_MODEL）")
    if vision and not vision_configured():
        raise LLMError("未配置视觉模型（LLM_VISION_BASE_URL / LLM_VISION_API_KEY / LLM_VISION_MODEL）")

    use_model = model or (settings.llm_vision_model if vision else settings.llm_model)
    payload: dict[str, Any] = {
        "model": use_model,
        "messages": messages,
        "temperature": settings.llm_temperature if temperature is None else temperature,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"
    if response_format:
        payload["response_format"] = response_format

    url = _url(settings.llm_vision_base_url if vision and settings.llm_vision_base_url else base_url)
    key = settings.llm_vision_api_key if vision and settings.llm_vision_api_key else (api_key or settings.llm_api_key)
    timeout = (timeout_ms or settings.llm_timeout_ms) / 1000

    try:
        with httpx.Client(timeout=timeout) as client:
            response = client.post(url, headers=_headers(key), json=payload)
    except Exception as exc:
        raise LLMError(f"LLM 请求失败：{str(exc)[:180]}") from exc

    if response.status_code >= 400:
        raise LLMError(f"LLM HTTP {response.status_code}：{response.text[:300]}")
    try:
        data = response.json()
    except Exception as exc:
        raise LLMError(f"LLM 返回非 JSON：{response.text[:200]}") from exc
    choices = data.get("choices") or []
    if not choices:
        raise LLMError("LLM 返回为空")
    return choices[0].get("message", {}) or {}


def extract_json(text: str) -> Any:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        return json.loads(cleaned)
    except Exception:
        pass
    for opener, closer in (("{", "}"), ("[", "]")):
        start = cleaned.find(opener)
        end = cleaned.rfind(closer)
        if start >= 0 and end > start:
            try:
                return json.loads(cleaned[start : end + 1])
            except Exception:
                continue
    raise LLMError("LLM 输出无法解析为 JSON")


def chat_json(
    messages: list[dict[str, Any]],
    *,
    schema_hint: str,
    model: str | None = None,
    temperature: float = 0.2,
    timeout_ms: int | None = None,
) -> Any:
    system = {
        "role": "system",
        "content": (
            "你只输出一个合法 JSON 对象，不要 Markdown 代码块，不要解释。"
            f"输出必须符合以下结构：{schema_hint}"
        ),
    }
    message = chat([system, *messages], model=model, temperature=temperature, timeout_ms=timeout_ms)
    return extract_json(str(message.get("content", "")))


def chat_with_tools(
    messages: list[dict[str, Any]],
    *,
    tools: list[dict],
    executor: Callable[[str, dict], Any],
    model: str | None = None,
    max_rounds: int = 6,
    temperature: float = 0.2,
) -> tuple[str, list[dict]]:
    """Run a tool-calling loop. Returns (final_text, trace)."""
    trace: list[dict] = []
    conversation = list(messages)
    for _ in range(max_rounds):
        message = chat(conversation, tools=tools, model=model, temperature=temperature)
        tool_calls = message.get("tool_calls") or []
        if not tool_calls:
            return str(message.get("content", "")), trace
        conversation.append(
            {
                "role": "assistant",
                "content": message.get("content") or "",
                "tool_calls": tool_calls,
            }
        )
        for call in tool_calls:
            fn = (call.get("function") or {})
            name = fn.get("name", "")
            raw_args = fn.get("arguments") or "{}"
            try:
                args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
            except Exception:
                args = {}
            try:
                result = executor(name, args)
                content = json.dumps(result, ensure_ascii=False, default=str)[:12000]
                status = "ok"
            except Exception as exc:
                content = json.dumps({"error": str(exc)[:300]}, ensure_ascii=False)
                status = "error"
            trace.append({"tool": name, "input": args, "output": result if status == "ok" else str(exc), "status": status})
            conversation.append(
                {
                    "role": "tool",
                    "tool_call_id": call.get("id", name),
                    "content": content,
                }
            )
    return "工具调用轮次达到上限，以下为已有结果摘要。", trace


def analyze_image(image_base64: str, mime: str, prompt: str, context: str = "") -> str:
    """Send an image to a vision-capable model. No OCR fallback is pretended."""
    if not vision_configured():
        raise LLMError(
            "未配置视觉模型。请在设置中填写 LLM_VISION_BASE_URL / LLM_VISION_API_KEY / LLM_VISION_MODEL；"
            "未配置时系统不会假装识别图片内容。"
        )
    messages = [
        {
            "role": "system",
            "content": (
                "你是金融图像分析助手。只描述图片中可见的信息；无法确认的内容必须标注“不确定”。"
                "不要编造数字、股票代码或收益。输出中文，分点说明：识别到的信息、对资产配置的含义、需要用户核对的地方。"
            ),
        },
        {
            "role": "user",
            "content": [
                {"type": "text", "text": prompt + ("\n\n已知组合上下文：\n" + context if context else "")},
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{image_base64}"}},
            ],
        },
    ]
    message = chat(messages, vision=True, temperature=0.2)
    return str(message.get("content", "")).strip()
