import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type ApiEnvelope<T> = {
  ok: true;
  data: T;
  meta: {
    mode: "mock" | "llm" | "fallback";
    degraded?: boolean;
    degradedReason?: string;
    generatedAt: string;
    demoData: boolean;
    disclaimer: string;
  };
};

export type ApiFailure = {
  ok: false;
  error: { code: string; message: string; hint?: string; issues?: { path: string; message: string }[] };
};

export class ApiError extends Error {
  readonly code: string;
  readonly hint?: string;
  readonly status: number;

  constructor(message: string, code: string, status: number, hint?: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.hint = hint;
  }
}

async function parse<T>(response: Response): Promise<ApiEnvelope<T>> {
  let payload: ApiEnvelope<T> | ApiFailure | null = null;
  try {
    payload = (await response.json()) as ApiEnvelope<T> | ApiFailure;
  } catch {
    throw new ApiError(`服务返回了无法解析的内容（HTTP ${response.status}）`, "BAD_RESPONSE", response.status);
  }
  if (!payload || payload.ok !== true) {
    const error = (payload as ApiFailure | null)?.error;
    throw new ApiError(
      error?.message ?? `请求失败（HTTP ${response.status}）`,
      error?.code ?? "UNKNOWN",
      response.status,
      error?.hint,
    );
  }
  return payload;
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<ApiEnvelope<T>> {
  const response = await fetch(path, { cache: "no-store", signal, headers: { Accept: "application/json" } });
  return parse<T>(response);
}

export async function apiSend<T>(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<ApiEnvelope<T>> {
  const response = await fetch(path, {
    method,
    cache: "no-store",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return parse<T>(response);
}

export function errorText(error: unknown): string {
  if (error instanceof ApiError) return error.hint ? `${error.message}（${error.hint}）` : error.message;
  if (error instanceof Error) return error.message;
  return "未知错误，请稍后重试";
}
