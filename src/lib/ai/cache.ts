/**
 * AI 输出缓存：把“同一任务 + 同一输入 + 同一模型”的结果复用，减少重复调用与等待。
 *
 * 取舍：
 * - 只缓存通过 Zod 校验的成功结果，降级/错误不写缓存，避免一次网络抖动长期污染结果；
 * - key = sha256(稳定序列化后的 {task,payload,model})，与对象键顺序无关；
 * - 过期判断放在读取时，读取到过期行顺手删除，无需定时任务。
 */
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}

export function hashPayload(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export interface CachedOutput<T> {
  data: T;
  mode: string;
  model: string | null;
  createdAt: Date;
}

export async function readAiCache<T>(key: string): Promise<CachedOutput<T> | null> {
  try {
    const row = await prisma.aiCache.findUnique({ where: { key } });
    if (!row) return null;
    if (row.expiresAt.getTime() <= Date.now()) {
      await prisma.aiCache.deleteMany({ where: { key } });
      return null;
    }
    return {
      data: JSON.parse(row.output) as T,
      mode: row.mode,
      model: row.model,
      createdAt: row.createdAt,
    };
  } catch (error) {
    console.warn("[ai-cache] 读取失败，按未命中处理", error);
    return null;
  }
}

export async function writeAiCache(input: {
  key: string;
  task: string;
  output: unknown;
  mode: string;
  model: string | null;
  ttlMs: number;
}): Promise<void> {
  if (input.ttlMs <= 0) return;
  const expiresAt = new Date(Date.now() + input.ttlMs);
  try {
    await prisma.aiCache.upsert({
      where: { key: input.key },
      create: {
        key: input.key,
        task: input.task,
        output: JSON.stringify(input.output),
        mode: input.mode,
        model: input.model,
        expiresAt,
      },
      update: {
        output: JSON.stringify(input.output),
        mode: input.mode,
        model: input.model,
        createdAt: new Date(),
        expiresAt,
      },
    });
  } catch (error) {
    console.warn("[ai-cache] 写入失败，忽略本次缓存", error);
  }
}

export async function clearAiCache(): Promise<number> {
  const result = await prisma.aiCache.deleteMany({});
  return result.count;
}

export async function pruneAiCache(): Promise<number> {
  const result = await prisma.aiCache.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  return result.count;
}
