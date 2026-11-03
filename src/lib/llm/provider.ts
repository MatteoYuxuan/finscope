import { z } from "zod";
import type { LLMMode } from "@/lib/types/domain";
import { requestJson } from "./openai-compat";
import { getRuntimeLlmConfig } from "./config-store";
import { LlmError, type LLMConfig, type LLMRunMeta, type LLMRunResult, type LLMTask } from "./types";
import { TASK_PROMPTS } from "./prompts";

/**
 * 统一执行入口：
 *   mock  → 直接走规则模板（mode = mock）
 *   llm   → 调接口；任何失败（无配置/超时/非 JSON/字段不符/越界）都降级为模板（mode = fallback）
 * 这样“没有 Key 也能完整演示”，且演示现场网络故障不会白屏。
 */

const ENTITY_TYPES = ["ORG", "PERSON", "LOCATION", "PRODUCT", "INDICATOR", "POLICY"] as const;
const EVENT_TYPES = [
  "macro_data",
  "policy",
  "company_event",
  "market_move",
  "industry_survey",
  "rumor",
  "other",
] as const;
const CLAIM_KINDS = ["fact", "claim", "estimate", "opinion", "denial"] as const;

const ENTITY_SCHEMA = z.object({
  name: z.string().min(1).max(40),
  type: z.enum(ENTITY_TYPES),
  role: z.string().max(20).optional(),
});

const KEY_NUMBER_SCHEMA = z.object({
  label: z.string().min(1).max(30),
  value: z.number().finite(),
  unit: z.string().min(1).max(10),
  period: z.string().max(20).optional(),
  context: z.string().max(120).optional(),
});

const CLAIM_SCHEMA = z.object({
  text: z.string().min(4).max(160),
  kind: z.enum(CLAIM_KINDS),
  sourceName: z.string().max(40).optional(),
});

/** 单篇文章的抽取结果；规则层与 LLM 共用同一契约 */
export const ARTICLE_EXTRACTION_ITEM_SCHEMA = z.object({
  entities: z.array(ENTITY_SCHEMA).max(12),
  eventType: z.enum(EVENT_TYPES),
  keyNumbers: z.array(KEY_NUMBER_SCHEMA).max(8),
  claims: z.array(CLAIM_SCHEMA).max(6),
  regions: z.array(z.string().max(20)).max(5),
  currencies: z.array(z.string().max(10)).max(5),
});

/** 批量抽取：一次最多 4 篇，index 对应输入 articles 的下标 */
export const ARTICLE_EXTRACTION_BATCH_SCHEMA = z.object({
  items: z
    .array(ARTICLE_EXTRACTION_ITEM_SCHEMA.extend({ index: z.number().int().min(0).max(3) }))
    .min(1)
    .max(4),
});

export const EVENT_SUMMARY_SCHEMA = z.object({  title: z.string().min(2).max(120),
  summary: z.string().min(10).max(600),
  themes: z.array(z.string()).max(8),
  industries: z.array(z.string()).max(8),
  regions: z.array(z.string()).max(8),
  currencies: z.array(z.string()).max(8),
});

export const CLUSTER_EXPLAIN_SCHEMA = z.object({
  explanation: z.string().min(10).max(500),
});

const DISAGREEMENT_NATURES = ["数据口径", "事实描述", "时间安排", "因果解释"] as const;

/** 事件级分析：共识 / 分歧 / 时间线 / 数值 / 缺口，全部要求可回溯到文章 id */
export const EVENT_ANALYSIS_SCHEMA = z.object({
  headline: z.string().min(4).max(120),
  consensus: z
    .array(
      z.object({
        point: z.string().min(4).max(160),
        articleIds: z.array(z.string().max(40)).min(1).max(6),
      }),
    )
    .max(4),
  disagreements: z
    .array(
      z.object({
        topic: z.string().min(2).max(60),
        nature: z.enum(DISAGREEMENT_NATURES),
        positions: z
          .array(
            z.object({
              stance: z.string().min(4).max(160),
              articleIds: z.array(z.string().max(40)).min(1).max(6),
              sourceNames: z.array(z.string().max(40)).max(6),
              quote: z.string().max(120).optional(),
            }),
          )
          .min(2)
          .max(4),
      }),
    )
    .max(3),
  timeline: z
    .array(
      z.object({
        at: z.string().min(4).max(40),
        label: z.string().min(2).max(100),
        articleId: z.string().max(40).optional(),
      }),
    )
    .min(1)
    .max(12),
  keyNumbers: z
    .array(
      z.object({
        label: z.string().min(1).max(30),
        value: z.number().finite(),
        unit: z.string().min(1).max(10),
        articleId: z.string().max(40).optional(),
        sourceName: z.string().max(40).optional(),
      }),
    )
    .max(12),
  entities: z.array(z.object({ name: z.string().min(1).max(40), type: z.enum(ENTITY_TYPES) })).max(12),
  gaps: z.array(z.string().min(2).max(120)).max(6),
  impactDims: z.array(z.string().min(1).max(10)).max(6),
  confidenceNote: z.string().min(10).max(220),
  groupingReason: z.string().min(6).max(200).optional(),
});

/** 主题级观察：窗口内事件类型、实体与缺口，供主题页展示 */
export const TOPIC_DIGEST_SCHEMA = z.object({
  summary: z.string().min(20).max(400),
  observations: z.array(z.string().min(4).max(160)).min(1).max(5),
  gaps: z.array(z.string().min(2).max(120)).max(4),
});

export const BRIEF_SCHEMA = z.object({
  headline: z.string().min(4).max(120),
  sections: z
    .array(z.object({ title: z.string().min(1).max(60), body: z.string().min(10).max(1200) }))
    .min(2)
    .max(6),
  todos: z.array(z.string().min(2).max(120)).min(1).max(8),
});

export const CHECKUP_SCHEMA = z.object({
  summary: z.string().min(20).max(800),
  highlights: z.array(z.string().min(2).max(200)).min(1).max(8),
  recommendations: z
    .array(
      z.object({
        title: z.string().min(4).max(80),
        detail: z.string().min(8).max(240),
        priority: z.enum(["high", "medium", "low"]),
      }),
    )
    .min(2)
    .max(5),
});

const ADVICE_ACTIONS = ["BUY", "SELL", "HOLD", "REBALANCE", "WAIT"] as const;
const ADVICE_PRIORITIES = ["high", "medium", "low"] as const;
const ADVICE_CONFIDENCES = ["low", "medium", "high"] as const;
const ADVICE_DIRECTIONS = ["increase", "reduce", "hold"] as const;
const ADVICE_HORIZONS = ["short", "medium", "long"] as const;

const ADVICE_ALLOCATION_SCHEMA = z.object({
  category: z.string().min(1).max(20),
  currentShare: z.number().min(0).max(100),
  targetShare: z.number().min(0).max(100),
  direction: z.enum(ADVICE_DIRECTIONS),
  priority: z.enum(ADVICE_PRIORITIES),
  rationale: z.string().min(4).max(160),
});

const ADVICE_STEP_SCHEMA = z.object({
  step: z.string().min(4).max(160),
  priority: z.enum(ADVICE_PRIORITIES),
  rationale: z.string().min(4).max(160),
});

/** 建议契约：给配置与结构建议，不点名个股、不给目标价、不预测点位 */
export const ADVICE_SCHEMA = z.object({
  action: z.enum(ADVICE_ACTIONS),
  summary: z.string().min(10).max(300),
  allocations: z.array(ADVICE_ALLOCATION_SCHEMA).max(6),
  steps: z.array(ADVICE_STEP_SCHEMA).min(1).max(6),
  risks: z.array(z.string().min(2).max(160)).min(1).max(4),
  confidence: z.enum(ADVICE_CONFIDENCES),
  horizon: z.enum(ADVICE_HORIZONS).optional(),
  scopeNote: z.string().max(200).optional(),
});

export const CHAT_SCHEMA = z.object({
  answer: z.string().min(5).max(3000),
  citedIds: z.array(z.string()).max(8),
  advice: ADVICE_SCHEMA,
  todos: z.array(z.string().min(2).max(120)).max(4).optional(),
  visualCandidateIds: z.array(z.string().max(60)).max(3).optional(),
});

/** 图表选择：模型只返回候选 id 与理由，数据由服务端注入 */
export const VISUAL_SELECTION_SCHEMA = z.object({
  selected: z
    .array(
      z.object({
        candidateId: z.string().min(1).max(60),
        reason: z.string().min(2).max(80),
      }),
    )
    .max(6),
  note: z.string().max(160).optional(),
});

export interface RunTaskOptions<T> {
  task: LLMTask;
  mode: LLMMode | "mock" | "llm";
  payload: unknown;
  schema: z.ZodType<T>;
  fallback: () => T;
  /** 仅问答使用：最近几轮对话，作为真实消息传给模型 */
  history?: { role: "user" | "assistant"; content: string }[];
}

function modeFromSettings(mode: RunTaskOptions<unknown>["mode"]): "mock" | "llm" {
  return mode === "llm" ? "llm" : "mock";
}

export async function runTask<T>(options: RunTaskOptions<T>): Promise<LLMRunResult<T>> {
  const started = Date.now();
  const desired = modeFromSettings(options.mode as never);

  if (desired === "mock") {
    return {
      data: options.fallback(),
      meta: { mode: "mock", model: null, latencyMs: Date.now() - started, degraded: false },
    };
  }

  const config: LLMConfig | null = await getRuntimeLlmConfig();
  if (!config) {
    return {
      data: options.fallback(),
      meta: {
        mode: "fallback",
        model: null,
        latencyMs: Date.now() - started,
        degraded: true,
        reason: "未配置模型接口（设置页填写 BASE_URL / API Key / 模型名，或设置对应的环境变量），已使用规则模板",
      },
    };
  }

  const taskKey = options.task as keyof typeof TASK_PROMPTS;
  try {
    const raw = await requestJson<unknown>(config, taskKey, options.payload, {
      history: options.history,
    });
    const parsed = options.schema.safeParse(raw);
    if (!parsed.success) {
      throw new LlmError("BAD_SHAPE", `LLM 输出字段不符合约定：${parsed.error.issues[0]?.message ?? "未知"}`);
    }
    return {
      data: parsed.data,
      meta: { mode: "llm", model: config.model, latencyMs: Date.now() - started, degraded: false },
    };
  } catch (error) {
    const reason = error instanceof LlmError ? `${error.code}: ${error.message}` : String(error);
    return {
      data: options.fallback(),
      meta: { mode: "fallback", model: config.model, latencyMs: Date.now() - started, degraded: true, reason },
    };
  }
}

export function llmMetaToApi(meta: LLMRunMeta) {
  return {
    mode: meta.mode,
    model: meta.model,
    latencyMs: meta.latencyMs,
    degraded: meta.degraded,
    ...(meta.reason ? { degradeReason: meta.reason } : {}),
  };
}
