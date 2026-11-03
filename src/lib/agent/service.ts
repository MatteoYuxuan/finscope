import { prisma } from "@/lib/db";
import type { AgentRunResult, AgentRunSummary } from "@/lib/types/investment";

export async function saveAgentRun(result: AgentRunResult): Promise<void> {
  const reportId = result.report?.report_id ?? null;
  await prisma.agentRun.upsert({
    where: { id: result.run_id },
    create: {
      id: result.run_id,
      task: "资产配置分析",
      status: result.status,
      mode: result.mode,
      model: result.model,
      result: JSON.stringify(result),
      reportId,
      finishedAt: new Date(result.finished_at),
    },
    update: {
      status: result.status,
      mode: result.mode,
      model: result.model,
      result: JSON.stringify(result),
      reportId,
      finishedAt: new Date(result.finished_at),
    },
  });

  await prisma.agentStep.deleteMany({ where: { runId: result.run_id } });
  if (result.steps.length > 0) {
    await prisma.agentStep.createMany({
      data: result.steps.map((step) => ({
        id: `${result.run_id}_${step.seq}`,
        runId: result.run_id,
        seq: step.seq,
        role: step.role,
        type: step.type,
        title: step.title,
        detail: step.detail ?? "",
        toolName: step.tool_name ?? null,
        status: step.status,
        latencyMs: step.latency_ms ?? 0,
      })),
    });
  }

  if (result.report) {
    await prisma.report.upsert({
      where: { id: result.report.report_id },
      create: {
        id: result.report.report_id,
        type: "AGENT",
        title: result.report.title,
        markdown: result.report.markdown ?? "",
        payload: JSON.stringify({ runId: result.run_id, pdf: Boolean(result.report.pdf_path), analysis: result.analysis.meta }),
        mode: result.mode,
        citations: JSON.stringify(result.citations ?? []),
        runId: result.run_id,
        kind: "ALLOCATION",
      },
      update: {
        title: result.report.title,
        markdown: result.report.markdown ?? "",
        payload: JSON.stringify({ runId: result.run_id, pdf: Boolean(result.report.pdf_path), analysis: result.analysis.meta }),
        mode: result.mode,
        citations: JSON.stringify(result.citations ?? []),
        runId: result.run_id,
        kind: "ALLOCATION",
      },
    });
  }
}

export async function listAgentRuns(limit = 20): Promise<AgentRunSummary[]> {
  const rows = await prisma.agentRun.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 100),
  });
  return rows.map((row) => ({
    id: row.id,
    created_at: row.createdAt.toISOString(),
    finished_at: row.finishedAt?.toISOString() ?? null,
    task: row.task,
    status: row.status,
    mode: row.mode,
    model: row.model,
    error: row.error,
  }));
}

export async function getAgentRun(id: string): Promise<AgentRunResult | null> {
  const row = await prisma.agentRun.findUnique({
    where: { id },
    include: { steps: { orderBy: { seq: "asc" } } },
  });
  if (!row?.result) return null;
  try {
    const parsed = JSON.parse(row.result) as AgentRunResult;
    parsed.steps = row.steps.map((step) => ({
      id: step.id,
      seq: step.seq,
      role: step.role,
      type: step.type,
      title: step.title,
      detail: step.detail,
      tool_name: step.toolName,
      status: step.status,
      latency_ms: step.latencyMs,
      created_at: step.createdAt.toISOString(),
    }));
    return parsed;
  } catch {
    return null;
  }
}

export async function getLatestAgentRun(): Promise<AgentRunResult | null> {
  const row = await prisma.agentRun.findFirst({
    where: { status: "done" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return row ? getAgentRun(row.id) : null;
}
