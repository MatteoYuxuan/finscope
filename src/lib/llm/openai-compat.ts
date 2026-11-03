import { LlmError, stripCodeFence, type LLMConfig } from "./types";
import { SYSTEM_PROMPT, buildUserPrompt, TASK_PROMPTS } from "./prompts";

/**
 * OpenAI 兼容接口（/chat/completions）。
 *
 * 已按 DeepSeek 官方文档适配（2026-11）：
 * - base_url 可以是 `https://api.deepseek.com`（也接受带 /v1 的写法）；
 * - 模型名为 `deepseek-flash` 或 `deepseek-v4-pro`；
 * - 官方默认开启思考模式（thinking enabled / effort=high），思考内容走
 *   `message.reasoning_content`，正文在 `message.content`；只给很小的
 *   max_tokens 时会出现“只有推理、没有正文”的空响应；
 * - 结构化输出用 `response_format: { type: "json_object" }`，并在提示词里
 *   明确出现 “JSON” 字样（DeepSeek 的硬性要求）；
 * - 思考模式下 temperature 不生效，因此只在关闭思考时发送。
 *
 * 同时兼容其它网关：若对方不认识 thinking / reasoning_effort / response_format，
 * 会自动去掉这些扩展参数重试一次，保证“换个模型服务也能用”。
 */

const DEFAULT_TIMEOUT_MS = 45_000;

/** 每个任务的输出预算：报告类给足，问答适中，聚类解释最短 */
const TASK_MAX_TOKENS: Record<keyof typeof TASK_PROMPTS, number> = {
  article_extract: 2600,
  event_analysis: 3200,
  topic_digest: 1400,
  visual_select: 900,
  event_summary: 1400,
  cluster_explain: 900,
  brief_narrative: 3600,
  checkup_narrative: 2200,
  chat: 3000,
};

/**
 * 各任务的推理设置。
 * - 结构化任务关闭思考：更快、更稳定，JSON 不会先被推理吃掉预算；
 * - 问答开启思考但把 effort 压到 low：兼顾解释质量与等待时间。
 */
const TASK_TUNING: Record<
  keyof typeof TASK_PROMPTS,
  { thinking: boolean; reasoningEffort?: "low" | "high" | "max" }
> = {
  article_extract: { thinking: false },
  event_analysis: { thinking: false },
  topic_digest: { thinking: false },
  visual_select: { thinking: false },
  event_summary: { thinking: false },
  cluster_explain: { thinking: false },
  brief_narrative: { thinking: false },
  checkup_narrative: { thinking: false },
  chat: { thinking: true, reasoningEffort: "low" },
};

export function resolveLlmConfig(env: NodeJS.ProcessEnv = process.env): LLMConfig | null {
  const baseUrl = (env.LLM_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const apiKey = (env.LLM_API_KEY ?? "").trim();
  const model = (env.LLM_MODEL ?? "").trim();
  if (!baseUrl || !apiKey || !model) return null;
  const timeout = Number(env.LLM_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  return {
    baseUrl,
    apiKey,
    model,
    timeoutMs: Number.isFinite(timeout) && timeout > 1000 ? timeout : DEFAULT_TIMEOUT_MS,
  };
}

export interface RawCompletion {
  content: string;
  reasoning?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  finishReason?: string | null;
  model?: string | null;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  /** 要求服务端返回合法 JSON（DeepSeek 的 json_object 模式） */
  jsonMode?: boolean;
  /** true=显式开启思考，false=显式关闭；undefined=交给服务端默认值 */
  thinking?: boolean;
  reasoningEffort?: "low" | "high" | "max";
  timeoutMs?: number;
}

type MessageContent = string | { type?: string; text?: string }[] | null | undefined;

interface ChoiceShape {
  message?: {
    content?: MessageContent;
    reasoning_content?: string | null;
    refusal?: string | null;
  };
  text?: string;
  finish_reason?: string | null;
}

interface CompletionShape {
  model?: string;
  choices?: ChoiceShape[];
  usage?: RawCompletion["usage"];
  output_text?: string;
  error?: { message?: string; type?: string; code?: string | number };
}

function contentToText(content: MessageContent): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part.text === "string" ? part.text : ""))
      .join("");
  }
  return "";
}

function emptyReason(json: CompletionShape, choice: ChoiceShape | undefined): string {
  const finish = choice?.finish_reason ?? "未知";
  const completionTokens = json.usage?.completion_tokens;
  const hasReasoning = Boolean(choice?.message?.reasoning_content?.trim());
  const parts = [`finish_reason=${finish}`];
  if (typeof completionTokens === "number") parts.push(`completion_tokens=${completionTokens}`);
  if (hasReasoning) {
    parts.push(
      typeof completionTokens === "number"
        ? `响应里只有 reasoning_content（推理已用掉 ${completionTokens} token，尚未开始写正文）`
        : "响应里只有 reasoning_content，没有最终 content",
    );
  }
  if (choice?.message?.refusal) parts.push(`模型拒绝回答：${choice.message.refusal.slice(0, 80)}`);
  return parts.join("，");
}

/** 网关是否可能不认识这些扩展参数（DeepSeek 专有 / 新版 OpenAI 参数） */
const EXTENSION_PARAM_PATTERN =
  /(thinking|reasoning_effort|response_format|json_object|unsupported|unknown|invalid[_ ]?param|extra[_ ]?field)/i;

function buildBody(
  config: LLMConfig,
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  options: ChatOptions,
  extras: boolean,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    stream: false,
    max_tokens: options.maxTokens ?? 900,
  };

  if (extras) {
    if (options.jsonMode) body.response_format = { type: "json_object" };
    if (options.thinking !== undefined) body.thinking = { type: options.thinking ? "enabled" : "disabled" };
    if (options.thinking !== false && options.reasoningEffort) {
      body.reasoning_effort = options.reasoningEffort;
    }
  }

  // DeepSeek 在思考模式下会忽略 temperature；关闭思考时才发送，语义更准确。
  if (!extras || options.thinking === false || options.thinking === undefined) {
    body.temperature = options.temperature ?? 0.2;
  }

  return body;
}

async function postCompletion(
  config: LLMConfig,
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  options: ChatOptions,
  extras: boolean,
): Promise<RawCompletion> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? config.timeoutMs;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(buildBody(config, messages, options, extras)),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const message = `LLM 接口返回 ${response.status}：${body.slice(0, 240) || response.statusText}`;
      // 网关不认识扩展参数时，去掉它们再试一次；其它 4xx/5xx 直接报错。
      if (response.status === 400 && extras && EXTENSION_PARAM_PATTERN.test(body)) {
        return postCompletion(config, messages, options, false);
      }
      throw new LlmError("HTTP_ERROR", message);
    }

    const json = (await response.json()) as CompletionShape;

    // 少数网关会用 200 包一层错误对象
    if (json.error?.message) {
      throw new LlmError("HTTP_ERROR", `接口返回错误：${json.error.message.slice(0, 200)}`);
    }

    const choice = json.choices?.[0];
    const content =
      contentToText(choice?.message?.content) ||
      (typeof choice?.text === "string" ? choice.text : "") ||
      (typeof json.output_text === "string" ? json.output_text : "");

    if (choice?.finish_reason === "length" && content.trim()) {
      throw new LlmError("TRUNCATED", `输出未在 max_tokens 内完成（${emptyReason(json, choice)}）`);
    }
    if (choice?.finish_reason === "content_filter") {
      throw new LlmError("HTTP_ERROR", "输出被服务端内容安全策略拦截，请调整问法后重试。");
    }
    if (choice?.finish_reason === "insufficient_system_resource") {
      throw new LlmError("HTTP_ERROR", "服务端资源不足，本次生成被中断，请稍后重试。");
    }

    if (!content.trim()) {
      throw new LlmError("EMPTY", `模型没有产出正文（${emptyReason(json, choice)}）`);
    }

    return {
      content,
      reasoning: choice?.message?.reasoning_content ?? undefined,
      usage: json.usage,
      finishReason: choice?.finish_reason ?? null,
      model: json.model ?? config.model,
    };
  } catch (error) {
    if (error instanceof LlmError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new LlmError("TIMEOUT", `LLM 请求超时（${timeoutMs}ms）`);
    }
    throw new LlmError("HTTP_ERROR", error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }
}

export async function requestChatCompletion(
  config: LLMConfig,
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  options: ChatOptions = {},
): Promise<RawCompletion> {
  return postCompletion(config, messages, options, true);
}

/**
 * 让模型产出 JSON，并解析；解析失败抛 BAD_JSON 由上层降级。
 * 空内容/被截断时自动用 2 倍预算重试一次——思考型模型常把预算消耗在推理上，
 * 重试能救回一部分；仍失败则把更具体的原因抛给界面。
 */
export async function requestJson<T>(
  config: LLMConfig,
  task: keyof typeof TASK_PROMPTS,
  payload: unknown,
  extra: { history?: { role: "user" | "assistant"; content: string }[] } = {},
): Promise<T> {
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: SYSTEM_PROMPT },
    // 多轮追问：把最近对话作为真实消息传入，模型更容易理解“那我的房贷呢”这类指代。
    ...(extra.history ?? []).slice(-8),
    { role: "user", content: buildUserPrompt(task, payload) },
  ];
  const budget = TASK_MAX_TOKENS[task] ?? 900;
  const tuning = TASK_TUNING[task] ?? { thinking: false };

  const call = (maxTokens: number) =>
    requestChatCompletion(config, messages, {
      maxTokens,
      jsonMode: true,
      temperature: 0.2,
      thinking: tuning.thinking,
      reasoningEffort: tuning.reasoningEffort,
      // 思考模式需要更长的等待时间；单次请求最多 90 秒。
      timeoutMs: Math.max(config.timeoutMs, tuning.thinking ? 60_000 : 45_000),
    });

  let raw: RawCompletion;
  try {
    raw = await call(budget);
  } catch (error) {
    const retryable = error instanceof LlmError && (error.code === "EMPTY" || error.code === "TRUNCATED");
    if (!retryable) throw error;
    raw = await call(Math.min(budget * 2, 8192));
  }

  const cleaned = stripCodeFence(raw.content);
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // JSON 模式下个别网关会把非法 JSON 替换成空白；这里再清一次注释/尾逗号后重试解析。
    const repaired = cleaned
      .replace(/^\uFEFF/, "")
      .replace(/,\s*([}\]])/g, "$1")
      .trim();
    try {
      return JSON.parse(repaired) as T;
    } catch {
      throw new LlmError("BAD_JSON", `LLM 输出不是合法 JSON：${cleaned.slice(0, 160)}`);
    }
  }
}
