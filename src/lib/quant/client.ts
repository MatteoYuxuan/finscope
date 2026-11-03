/** Server-side client for the Python quant & agent service. */

const BASE = (process.env.QUANT_SERVICE_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");

export class QuantError extends Error {
  readonly status: number;
  readonly detail?: string;

  constructor(message: string, status: number, detail?: string) {
    super(message);
    this.name = "QuantError";
    this.status = status;
    this.detail = detail;
  }
}

export async function quantFetch<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 180_000,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new QuantError(
      "量化服务不可用，请确认 Python 服务已启动（npm run quant:dev）",
      503,
      error instanceof Error ? error.message : String(error),
    );
  }

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const detail =
      payload && typeof payload === "object" && "detail" in payload
        ? String((payload as { detail: unknown }).detail)
        : text.slice(0, 300);
    throw new QuantError(detail || `量化服务返回 HTTP ${response.status}`, response.status, detail);
  }
  return payload as T;
}

export async function quantHealth(): Promise<{
  status: string;
  version: string;
  llm_configured: boolean;
  vision_configured?: boolean;
  data?: Record<string, unknown>;
}> {
  return quantFetch("/health", {}, 10_000);
}

export { BASE as QUANT_BASE_URL };
