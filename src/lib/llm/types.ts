import type { LLMMode } from "@/lib/types/domain";

/** LLM 任务类型：每种任务都有固定的输入/输出 schema，前端可解释展示 */
export type LLMTask =
  | "article_extract"
  | "event_analysis"
  | "topic_digest"
  | "visual_select"
  | "event_summary"
  | "cluster_explain"
  | "brief_narrative"
  | "checkup_narrative"
  | "chat";

export interface LLMRunMeta {
  mode: LLMMode;
  model: string | null;
  latencyMs: number;
  degraded: boolean;
  reason?: string;
}

export interface LLMRunResult<T> {
  data: T;
  meta: LLMRunMeta;
}

export interface LLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

export class LlmError extends Error {
  readonly code:
    | "NO_CONFIG"
    | "HTTP_ERROR"
    | "TIMEOUT"
    | "BAD_JSON"
    | "BAD_SHAPE"
    | "EMPTY"
    | "TRUNCATED";

  constructor(code: LlmError["code"], message: string) {
    super(message);
    this.name = "LlmError";
    this.code = code;
  }
}

/** 去掉模型偶尔包裹的 ```json 代码围栏 */
export function stripCodeFence(raw: string): string {
  const text = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  if (fence) return fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
}
