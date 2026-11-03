import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { DISCLAIMER_ZH } from "@/lib/constants";
import { QuantError } from "@/lib/quant/client";
import type { LLMMode } from "@/lib/types/domain";
import { flattenIssues } from "@/lib/validation/schemas";

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "BAD_REQUEST"
  | "LLM_UNAVAILABLE"
  | "FORBIDDEN_INTENT"
  | "INTERNAL";

export interface ApiMeta {
  mode: LLMMode;
  degraded: boolean;
  degradedReason?: string;
  generatedAt: string;
  demoData: true;
  disclaimer: string;
  llm?: { model: string | null; latencyMs: number };
}

export function buildMeta(partial: Partial<ApiMeta> = {}): ApiMeta {
  return {
    mode: partial.mode ?? "mock",
    degraded: partial.degraded ?? false,
    generatedAt: new Date().toISOString(),
    demoData: true,
    disclaimer: DISCLAIMER_ZH,
    ...partial,
  };
}

export function ok<T>(data: T, meta: Partial<ApiMeta> = {}, status = 200): NextResponse {
  return NextResponse.json({ ok: true, data, meta: buildMeta(meta) }, { status });
}

export function fail(
  code: ErrorCode,
  message: string,
  options: { hint?: string; issues?: { path: string; message: string }[]; status?: number } = {},
): NextResponse {
  const status =
    options.status ??
    ({
      VALIDATION_ERROR: 400,
      NOT_FOUND: 404,
      BAD_REQUEST: 400,
      LLM_UNAVAILABLE: 503,
      FORBIDDEN_INTENT: 422,
      INTERNAL: 500,
    }[code] ?? 500);

  return NextResponse.json(
    {
      ok: false,
      error: {
        code,
        message,
        ...(options.hint ? { hint: options.hint } : {}),
        ...(options.issues ? { issues: options.issues } : {}),
      },
    },
    { status },
  );
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly hint?: string;

  constructor(code: ErrorCode, message: string, hint?: string, status?: number) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.hint = hint;
    this.status = status ?? 400;
  }
}

/** 统一异常出口：所有 route 都包一层，前端永远拿到同一种错误形状 */
export async function handleRoute(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof AppError) {
      return fail(error.code, error.message, { hint: error.hint, status: error.status });
    }
    if (error instanceof ZodError) {
      return fail("VALIDATION_ERROR", "提交的数据不符合要求", {
        issues: flattenIssues(error),
        hint: "请按提示修改后重试",
      });
    }
    if (error instanceof QuantError) {
      return fail("LLM_UNAVAILABLE", error.message, {
        hint: error.detail ? String(error.detail).slice(0, 300) : "请确认 Python 量化服务已启动",
        status: error.status >= 400 && error.status < 600 ? error.status : 503,
      });
    }
    if (typeof error === "object" && error !== null && "code" in error) {
      const prismaCode = String((error as { code?: unknown }).code ?? "");
      if (prismaCode === "P2002") {
        return fail("BAD_REQUEST", "数据重复，已存在相同记录", { hint: "可以修改名称或金额后重试" });
      }
      if (prismaCode === "P2025") {
        return fail("NOT_FOUND", "记录不存在或已被删除");
      }
    }
    console.error("[api] unhandled error:", error);
    return fail("INTERNAL", "服务端处理失败", {
      hint: "请稍后重试；若持续出现，可在「设置」页清空数据后重新初始化",
    });
  }
}

/** 解析 JSON body，空 body 视为 {} */
export async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("BAD_REQUEST", "请求体不是合法 JSON", "请检查 Content-Type 与请求体格式");
  }
}

export function notFound(what: string): never {
  throw new AppError("NOT_FOUND", `${what}不存在`, "可能已被删除，请返回列表刷新");
}
