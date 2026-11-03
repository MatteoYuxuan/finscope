"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Download, ExternalLink, FileText, History, RefreshCw } from "lucide-react";
import { Badge, Button, Card, CardHead, EmptyState, ErrorBanner, SectionHeading, SkeletonBlock } from "@/components/ui";
import { apiGet, errorText } from "@/lib/client/api";
import type { AgentRunSummary } from "@/lib/types/investment";

interface ReportItem {
  id: string;
  run_id?: string | null;
  title: string;
  created_at: string;
  pdf_path?: string | null;
}

export default function ReportsPage() {
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [runs, setRuns] = useState<AgentRunSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [reportResponse, runResponse] = await Promise.all([
        apiGet<{ items: ReportItem[] }>("/api/reports"),
        apiGet<AgentRunSummary[]>("/api/agent/runs"),
      ]);
      setReports(reportResponse.data.items);
      setRuns(runResponse.data);
      if (!selected && reportResponse.data.items[0]) setSelected(reportResponse.data.items[0].id);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div>
      <SectionHeading
        eyebrow="Reports & Audit"
        title="研报与记录"
        desc="每次多智能体运行都会生成 HTML / PDF 研报，并保留执行轨迹。报告中的数字全部来自量化引擎。"
        right={<Button size="sm" variant="secondary" onClick={load} loading={loading}><RefreshCw className="h-3.5 w-3.5" />刷新</Button>}
      />
      {error ? <div className="mb-3"><ErrorBanner message={error} onRetry={load} /></div> : null}

      <div className="grid gap-3 lg:grid-cols-[320px_1fr]">
        <Card>
          <CardHead title="报告列表" desc={`${reports.length} 份报告`} right={<History className="h-4 w-4 text-ink-400" />} />
          <div className="max-h-[560px] overflow-auto p-2">
            {loading && reports.length === 0 ? <SkeletonBlock lines={6} /> : null}
            {!loading && reports.length === 0 ? <EmptyState title="还没有报告" desc="到「智能决策」运行一次分析，系统会自动生成 HTML / PDF 研报。" icon={<FileText className="h-5 w-5" />} /> : null}
            {reports.map((report) => (
              <button key={report.id} onClick={() => setSelected(report.id)} className={`mb-1 w-full rounded-xl px-3 py-2.5 text-left transition ${selected === report.id ? "bg-brand-50 ring-1 ring-brand-200" : "hover:bg-ink-50"}`}>
                <p className="text-[11px] font-medium text-ink-800">{report.title}</p>
                <p className="mt-0.5 text-[10px] text-ink-400">{new Date(report.created_at).toLocaleString("zh-CN")}</p>
                <div className="mt-1 flex gap-1">
                  <Badge tone="neutral">HTML</Badge>
                  {report.pdf_path ? <Badge tone="brand">PDF</Badge> : null}
                </div>
              </button>
            ))}
          </div>
        </Card>

        <div className="space-y-3">
          {selected ? (
            <Card>
              <CardHead
                title="报告预览"
                desc="可直接打印为 PDF；也可下载服务端生成的 PDF。"
                right={
                  <div className="flex gap-2">
                    <a href={`/api/reports/${selected}`} target="_blank" rel="noreferrer"><Button size="sm" variant="secondary"><ExternalLink className="h-3.5 w-3.5" />新窗口</Button></a>
                    <a href={`/api/reports/${selected}/pdf`}><Button size="sm"><Download className="h-3.5 w-3.5" />下载 PDF</Button></a>
                  </div>
                }
              />
              <div className="bg-ink-50/50 p-2">
                <iframe title="report" src={`/api/reports/${selected}`} className="h-[640px] w-full rounded-xl border border-ink-200 bg-white" />
              </div>
            </Card>
          ) : (
            <Card><EmptyState title="选择一份报告" desc="左侧列表中的报告会在这里预览。" icon={<FileText className="h-5 w-5" />} /></Card>
          )}

          <Card>
            <CardHead title="最近运行记录" desc="包含 LLM / 规则模式与任务描述。" right={<History className="h-4 w-4 text-ink-400" />} />
            <div className="divide-y divide-ink-50">
              {runs.slice(0, 8).map((run) => (
                <Link key={run.id} href="/console/agent" className="flex items-center justify-between px-5 py-3 hover:bg-ink-50/60">
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-medium text-ink-800">{run.task}</p>
                    <p className="text-[10px] text-ink-400">{new Date(run.created_at).toLocaleString("zh-CN")} · {run.mode}</p>
                  </div>
                  <Badge tone={run.status === "done" ? "brand" : "warn"}>{run.status}</Badge>
                </Link>
              ))}
              {runs.length === 0 ? <p className="px-5 py-5 text-xs text-ink-400">暂无运行记录</p> : null}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
