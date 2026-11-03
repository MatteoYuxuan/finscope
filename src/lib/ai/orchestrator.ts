/**
 * AI Orchestrator：所有结构化 LLM 任务的统一入口。
 *
 * 一次调用依次经过：
 *  1) 解析模式（设置页的 mock / llm）；
 *  2) 命中缓存 → 直接返回（meta.mode = llm，cached = true）；
 *  3) 调 runTask（内部已做 schema 校验与合规后置校验）；
 *  4) 业务级后置校验 validate（如引用 id 必须属于该事件），失败则降级；
 *  5) 成功结果写缓存，最后写一条 AiRun 审计。
 *
 * 这样业务代码只关心“任务 + 输入 + 降级函数”，不再各自处理重试、缓存与日志。
 */
import type { z } from "zod";
import type { LLMMode } from "@/lib/types/domain";
import { runTask } from "@/lib/llm/provider";
import { getRuntimeLlmConfig } from "@/lib/llm/config-store";
import type { LLMRunMeta, LLMTask } from "@/lib/llm/types";
import { getLLMMode } from "@/lib/services/settings";
import { hashPayload, readAiCache, writeAiCache } from "./cache";
import { logAiRun } from "./log";

export interface RunStructuredOptions<T> {
  task: LLMTask;
  schema: z.ZodType<T>;
  /** 任务输入；会参与缓存 key 的哈希，必须可 JSON 序列化 */
  payload: unknown;
  /** 规则模板：mock 模式、未配置、超时、schema 不符、越界时使用 */
  fallback: () => T;
  mode?: LLMMode;
  /** > 0 时启用缓存；只缓存成功结果 */
  cacheTtlMs?: number;
  ref?: { type: string; id: string };
  /** 业务级校验/裁剪，抛错即降级 */
  validate?: (data: T) => T;
  history?: { role: "user" | "assistant"; content: string }[];
}

export interface StructuredResult<T> {
  data: T;
  meta: LLMRunMeta;
  cached: boolean;
}

export async function runStructured<T>(
  options: RunStructuredOptions<T>,
): Promise<StructuredResult<T>> {
  const started = Date.now();
  const mode: LLMMode = options.mode ?? (await getLLMMode());
  const config = mode === "llm" ? await getRuntimeLlmConfig() : null;
  const payloadHash = hashPayload({
    task: options.task,
    payload: options.payload,
    model: config?.model ?? null,
  });
  const ttlMs = Math.max(0, options.cacheTtlMs ?? 0);
  const cacheKey = ttlMs > 0 && config ? `${options.task}:${payloadHash}` : null;

  if (mode === "llm" && cacheKey) {
    const cached = await readAiCache<T>(cacheKey);
    if (cached) {
      await logAiRun({
        task: options.task,
        mode: "llm",
        model: cached.model,
        status: "cache",
        latencyMs: Date.now() - started,
        payloadHash,
        cacheHit: true,
        refType: options.ref?.type,
        refId: options.ref?.id,
      });
      return {
        data: cached.data,
        meta: { mode: "llm", model: cached.model, latencyMs: 0, degraded: false },
        cached: true,
      };
    }
  }

  const result = await runTask<T>({
    task: options.task,
    mode,
    payload: options.payload,
    schema: options.schema,
    fallback: options.fallback,
    history: options.history,
  });

  let data = result.data;
  let meta = result.meta;

  if (meta.mode === "llm" && options.validate) {
    try {
      data = options.validate(data);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      data = options.fallback();
      meta = {
        ...meta,
        mode: "fallback",
        degraded: true,
        reason: `输出未通过业务校验：${reason}`,
      };
    }
  }

  if (meta.mode === "llm" && cacheKey) {
    await writeAiCache({
      key: cacheKey,
      task: options.task,
      output: data,
      mode: "llm",
      model: meta.model,
      ttlMs,
    });
  }

  await logAiRun({
    task: options.task,
    mode: meta.mode,
    model: meta.model,
    status: meta.mode === "llm" ? "ok" : meta.mode === "mock" ? "mock" : "fallback",
    latencyMs: meta.latencyMs || Date.now() - started,
    payloadHash,
    cacheHit: false,
    error: meta.reason,
    refType: options.ref?.type,
    refId: options.ref?.id,
  });

  return { data, meta, cached: false };
}
