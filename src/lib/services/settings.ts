import { prisma } from "@/lib/db";
import type { LLMMode } from "@/lib/types/domain";

/** 设置项白名单：未列出的 key 一律拒绝写入，避免前端把任意值塞进 Setting 表 */
export const SETTING_KEYS = [
  "llm.mode",
  "llm.baseUrl",
  "llm.apiKey",
  "llm.model",
  "ai.autoAnalyze",
  "ai.maxExtractionsPerRefresh",
  "ai.maxAnalysesPerRefresh",
  "ai.cacheTtlHours",
  "profile.name",
  "profile.monthlySpend",
  "disclaimer.version",
  "demo.seededAt",
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

export const SETTING_LABELS: Record<SettingKey, string> = {
  "llm.mode": "AI 模式",
  "llm.baseUrl": "接口地址（BASE_URL）",
  "llm.apiKey": "API Key",
  "llm.model": "模型名称",
  "ai.autoAnalyze": "刷新时自动用模型深度抽取",
  "ai.maxExtractionsPerRefresh": "每次刷新最多抽取篇数",
  "ai.maxAnalysesPerRefresh": "每次刷新最多分析事件数",
  "ai.cacheTtlHours": "AI 结果缓存时长（小时）",
  "profile.name": "使用者称呼",
  "profile.monthlySpend": "每月必要支出（元）",
  "disclaimer.version": "免责声明版本",
  "demo.seededAt": "示例数据初始化时间",
};

export function defaultSettings(): Record<SettingKey, string> {
  return {
    "llm.mode": process.env.LLM_MODE === "llm" ? "llm" : "mock",
    "llm.baseUrl": process.env.LLM_BASE_URL ?? "",
    "llm.apiKey": "",
    "llm.model": process.env.LLM_MODEL ?? "",
    "ai.autoAnalyze": "true",
    "ai.maxExtractionsPerRefresh": "8",
    "ai.maxAnalysesPerRefresh": "6",
    "ai.cacheTtlHours": "24",
    "profile.name": "本机用户",
    "profile.monthlySpend": "8000",
    "disclaimer.version": "1.0",
    "demo.seededAt": "",
  };
}

export async function getSettingsMap(): Promise<Record<SettingKey, string>> {
  const rows = await prisma.setting.findMany();
  const map = defaultSettings();
  for (const row of rows) {
    if ((SETTING_KEYS as readonly string[]).includes(row.key)) {
      map[row.key as SettingKey] = row.value;
    }
  }
  return map;
}

export async function getSetting(key: SettingKey): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? defaultSettings()[key];
}

export async function getLLMMode(): Promise<"mock" | "llm"> {
  const value = await getSetting("llm.mode");
  return value === "llm" ? "llm" : "mock";
}

export async function getMonthlySpend(): Promise<number | null> {
  const raw = await getSetting("profile.monthlySpend");
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export async function setSettings(entries: Record<string, string | number | boolean>): Promise<Record<string, string>> {
  const updates: { key: string; value: string }[] = [];
  for (const [key, value] of Object.entries(entries)) {
    if (!(SETTING_KEYS as readonly string[]).includes(key)) {
      throw new Error(`未知设置项：${key}`);
    }
    if (key === "llm.mode" && value !== "mock" && value !== "llm") {
      throw new Error("AI 模式只能是 mock 或 llm");
    }
    if (key === "profile.monthlySpend") {
      const number = Number(value);
      if (!Number.isFinite(number) || number < 0) throw new Error("每月必要支出必须是非负数字");
    }
    if (key === "ai.autoAnalyze" && value !== "true" && value !== "false") {
      throw new Error("自动抽取开关只能是 true 或 false");
    }
    if (
      key === "ai.maxExtractionsPerRefresh" ||
      key === "ai.maxAnalysesPerRefresh" ||
      key === "ai.cacheTtlHours"
    ) {
      const number = Number(value);
      const max = key === "ai.cacheTtlHours" ? 168 : 20;
      if (!Number.isInteger(number) || number < 0 || number > max) {
        throw new Error(`${SETTING_LABELS[key]}需为 0–${max} 的整数`);
      }
    }
    updates.push({ key, value: String(value) });
  }

  await prisma.$transaction(
    updates.map((item) =>
      prisma.setting.upsert({
        where: { key: item.key },
        create: { key: item.key, value: item.value },
        update: { value: item.value },
      }),
    ),
  );

  return getSettingsMap();
}

export function modeLabel(mode: LLMMode): string {
  return { mock: "Mock 规则模式", llm: "LLM 模式", fallback: "已降级为规则模板" }[mode];
}

export interface AiSettings {
  autoAnalyze: boolean;
  maxExtractionsPerRefresh: number;
  maxAnalysesPerRefresh: number;
  cacheTtlHours: number;
}

/** AI 管道参数：刷新时自动升级多少篇抽取、分析多少个事件、缓存多久 */
export async function getAiSettings(): Promise<AiSettings> {
  const map = await getSettingsMap();
  const readInt = (key: SettingKey, fallback: number, min: number, max: number): number => {
    const value = Number(map[key]);
    if (!Number.isInteger(value)) return fallback;
    return Math.min(max, Math.max(min, value));
  };
  return {
    autoAnalyze: map["ai.autoAnalyze"] !== "false",
    maxExtractionsPerRefresh: readInt("ai.maxExtractionsPerRefresh", 8, 0, 20),
    maxAnalysesPerRefresh: readInt("ai.maxAnalysesPerRefresh", 6, 0, 20),
    cacheTtlHours: readInt("ai.cacheTtlHours", 24, 0, 168),
  };
}
