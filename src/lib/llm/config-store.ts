import { prisma } from "@/lib/db";
import { resolveLlmConfig } from "./openai-compat";
import type { LLMConfig } from "./types";

/**
 * 运行时 LLM 配置：优先读取「设置」页保存的值，其次回退到环境变量。
 * 这样用户可以在界面里直接接入任意 OpenAI 兼容服务，而不必改 .env 重启。
 */
export async function getRuntimeLlmConfig(): Promise<LLMConfig | null> {
  let stored: Record<string, string> = {};
  try {
    const rows = await prisma.setting.findMany({
      where: { key: { in: ["llm.baseUrl", "llm.apiKey", "llm.model"] } },
    });
    stored = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  } catch {
    // 数据库尚未初始化时仍允许使用环境变量
    stored = {};
  }

  const baseUrl = (stored["llm.baseUrl"] || process.env.LLM_BASE_URL || "").trim().replace(/\/+$/, "");
  const apiKey = (stored["llm.apiKey"] || process.env.LLM_API_KEY || "").trim();
  const model = (stored["llm.model"] || process.env.LLM_MODEL || "").trim();
  if (!baseUrl || !apiKey || !model) return null;

  // 思考型模型（如 DeepSeek flash）响应可能需要 20–40 秒，默认给足 45 秒。
  const timeout = Number(process.env.LLM_TIMEOUT_MS ?? 45_000);
  return {
    baseUrl,
    apiKey,
    model,
    timeoutMs: Number.isFinite(timeout) && timeout > 1000 ? timeout : 45_000,
  };
}

export async function describeRuntimeLlm() {
  const envConfig = resolveLlmConfig();
  const runtime = await getRuntimeLlmConfig();
  return {
    configured: Boolean(runtime),
    source: runtime ? (envConfig && envConfig.apiKey === runtime.apiKey ? "env" : "settings") : "none",
    baseUrl: runtime?.baseUrl ?? "",
    model: runtime?.model ?? "",
    hasApiKey: Boolean(runtime?.apiKey),
    timeoutMs: runtime?.timeoutMs ?? 45_000,
  };
}
