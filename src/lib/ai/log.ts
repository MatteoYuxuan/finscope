/**
 * AI 调用审计：每次结构化任务写一条 AiRun。
 * 审计失败不能影响业务，因此所有异常都在这里吞掉并只打印警告。
 */
import { prisma } from "@/lib/db";

export interface AiRunLogInput {
  task: string;
  mode: string;
  model?: string | null;
  status: "ok" | "cache" | "mock" | "fallback" | "error";
  latencyMs: number;
  payloadHash?: string | null;
  cacheHit?: boolean;
  error?: string | null;
  refType?: string | null;
  refId?: string | null;
}

export async function logAiRun(entry: AiRunLogInput): Promise<void> {
  try {
    await prisma.aiRun.create({
      data: {
        task: entry.task,
        mode: entry.mode,
        model: entry.model ?? null,
        status: entry.status,
        latencyMs: Math.max(0, Math.round(entry.latencyMs)),
        payloadHash: entry.payloadHash ?? null,
        cacheHit: entry.cacheHit ?? false,
        error: entry.error ? entry.error.slice(0, 500) : null,
        refType: entry.refType ?? null,
        refId: entry.refId ?? null,
      },
    });
  } catch (error) {
    console.warn("[ai-log] 审计日志写入失败", error);
  }
}

export async function listAiRuns(limit = 50) {
  return prisma.aiRun.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(200, limit)),
    select: {
      id: true,
      task: true,
      mode: true,
      model: true,
      status: true,
      latencyMs: true,
      cacheHit: true,
      error: true,
      refType: true,
      refId: true,
      createdAt: true,
    },
  });
}

export async function aiRunStats(): Promise<{
  total: number;
  byStatus: Record<string, number>;
  byTask: Record<string, number>;
  fallbackRate: number;
  cacheHitRate: number;
  avgLatencyMs: number;
}> {
  const rows = await prisma.aiRun.findMany({
    select: { task: true, status: true, cacheHit: true, latencyMs: true },
  });
  const byStatus: Record<string, number> = {};
  const byTask: Record<string, number> = {};
  let latency = 0;
  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    byTask[row.task] = (byTask[row.task] ?? 0) + 1;
    latency += row.latencyMs;
  }
  const total = rows.length;
  const fallback = (byStatus.fallback ?? 0) + (byStatus.error ?? 0);
  const cacheHits = (byStatus.cache ?? 0) + rows.filter((row) => row.cacheHit).length;
  return {
    total,
    byStatus,
    byTask,
    fallbackRate: total === 0 ? 0 : fallback / total,
    cacheHitRate: total === 0 ? 0 : Math.min(1, cacheHits / total),
    avgLatencyMs: total === 0 ? 0 : Math.round(latency / total),
  };
}
