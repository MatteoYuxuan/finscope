"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Clock, FileText, ImagePlus, Loader2, Play, RefreshCw, Sparkles, Upload, X } from "lucide-react";
import { Badge, Button, Card, CardHead, ErrorBanner, InfoNote, SectionHeading, Textarea } from "@/components/ui";
import { AdviceView } from "@/components/investment/advice-view";
import { AnalysisView } from "@/components/investment/analysis-view";
import { AgentTimeline } from "@/components/investment/agent-timeline";
import { apiGet, apiSend, errorText } from "@/lib/client/api";
import type { AgentRunResult, AgentRunSummary } from "@/lib/types/investment";
import { cn } from "@/lib/client/api";

const STAGES = ["规划任务与证据需求", "加载真实行情并运行量化引擎", "宏观 / 组合 / 风险 / 目标并行分析", "组合经理综合建议", "审查员检查越界与一致性", "生成 HTML / PDF 研报"];

type Tab = "advice" | "analysis" | "trace" | "report";

export default function AgentPage() {
  const [task, setTask] = useState("请分析我的资产配置，说明当前市场状态、目标配置、主要风险，并给出未来 3 个月的再平衡步骤。");
  const [useLlm, setUseLlm] = useState(true);
  const [run, setRun] = useState<AgentRunResult | null>(null);
  const [history, setHistory] = useState<AgentRunSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("advice");
  const [imageText, setImageText] = useState("");
  const [imageError, setImageError] = useState("");
  const [imageLoading, setImageLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function loadHistory() {
    try {
      const response = await apiGet<AgentRunSummary[]>("/api/agent/runs");
      setHistory(response.data);
      if (!run && response.data[0]) {
        const latest = await apiGet<AgentRunResult>(`/api/agent/runs/${response.data[0].id}`);
        setRun(latest.data);
      }
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    void loadHistory();
  }, []);

  useEffect(() => {
    if (!loading) return;
    setStage(0);
    setElapsed(0);
    const started = Date.now();
    const timer = window.setInterval(() => {
      setElapsed(Math.round((Date.now() - started) / 1000));
      setStage((current) => Math.min(current + 1, STAGES.length - 1));
    }, 7000);
    return () => window.clearInterval(timer);
  }, [loading]);

  async function start() {
    setLoading(true);
    setError("");
    setImageText("");
    setImageError("");
    try {
      const response = await apiSend<AgentRunResult>("/api/agent/run", "POST", { task, useLlm, includeReport: true });
      setRun(response.data);
      setTab("advice");
      await loadHistory();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  }

  async function loadRun(id: string) {
    setError("");
    try {
      const response = await apiGet<AgentRunResult>(`/api/agent/runs/${id}`);
      setRun(response.data);
      setTab("advice");
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  async function upload(file: File) {
    setImageLoading(true);
    setImageError("");
    setImageText("");
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = () => reject(new Error("读取图片失败"));
        reader.readAsDataURL(file);
      });
      const response = await apiSend<{ ok: boolean; text?: string; error?: string }>("/api/vision/analyze", "POST", {
        imageBase64: base64,
        mime: file.type || "image/png",
        prompt: "请识别这张图片中的持仓/行情/财务信息，并说明它对我的资产配置有什么影响。",
      });
      if (response.data.ok && response.data.text) setImageText(response.data.text);
      else setImageError(response.data.error ?? "视觉模型未返回内容");
    } catch (cause) {
      setImageError(errorText(cause));
    } finally {
      setImageLoading(false);
    }
  }

  return (
    <div>
      <SectionHeading
        eyebrow="Multi-Agent"
        title="智能决策"
        desc="规划、数据、宏观、组合、风险、目标、组合经理与审查员分工协作；每个结论都能回到量化引擎的确定性数字。"
        right={
          <div className="flex items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-[11px] text-ink-600">
              <input type="checkbox" checked={useLlm} onChange={(event) => setUseLlm(event.target.checked)} className="accent-brand-600" />
              使用 LLM
            </label>
            <Button size="sm" onClick={start} loading={loading}>
              <Play className="h-3.5 w-3.5" />
              启动分析
            </Button>
          </div>
        }
      />

      {error ? <div className="mb-3"><ErrorBanner message={error} onRetry={start} /></div> : null}

      <div className="grid gap-3 lg:grid-cols-[1fr_280px]">
        <div className="space-y-3">
          <Card>
            <CardHead title="任务" desc="可以问配置、风险、目标或具体 ETF 的取舍；系统不会给个股买卖点。" right={<Badge tone="brand"><Sparkles className="h-3 w-3" /> Agent</Badge>} />
            <div className="px-5 py-4">
              <Textarea value={task} onChange={(event) => setTask(event.target.value)} rows={3} maxLength={2000} placeholder="例如：我 3 年后要买房，当前权益占比偏高，应该如何调整？" />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-400">
                <span>建议明确：目标、时间、可承受回撤、是否要保留应急金。</span>
                <span className="tabular">{task.length}/2000</span>
              </div>
            </div>
          </Card>

          {loading ? (
            <Card>
              <CardHead title="多智能体运行中" desc="真实数据与量化计算通常需要 20–60 秒；LLM 调用会增加耗时。" right={<span className="tabular text-[11px] text-ink-400">{elapsed}s</span>} />
              <div className="space-y-2.5 px-5 py-5">
                {STAGES.map((item, index) => (
                  <div key={item} className="flex items-center gap-2.5 text-xs">
                    {index < stage ? <Sparkles className="h-3.5 w-3.5 text-brand-600" /> : index === stage ? <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-600" /> : <span className="h-3.5 w-3.5 rounded-full border border-ink-200" />}
                    <span className={index <= stage ? "text-ink-800" : "text-ink-400"}>{item}</span>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}

          {run ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-1 flex-wrap gap-1 rounded-xl border border-ink-200/80 bg-white p-1">
                  {[
                    { key: "advice" as const, label: "投资建议", icon: Bot },
                    { key: "analysis" as const, label: "量化分析", icon: RefreshCw },
                    { key: "trace" as const, label: "执行轨迹", icon: Clock },
                    { key: "report" as const, label: "研报", icon: FileText },
                  ].map((item) => (
                    <button key={item.key} onClick={() => setTab(item.key)} className={cn("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium", tab === item.key ? "bg-ink-950 text-white" : "text-ink-500 hover:bg-ink-100")}>
                      <item.icon className="h-3.5 w-3.5" />
                      {item.label}
                    </button>
                  ))}
                </div>
                <Badge tone={run.mode === "llm" ? "brand" : "warn"}>{run.mode === "llm" ? "LLM 多智能体" : run.mode === "fallback" ? "LLM 失败 · 规则兜底" : "规则智能体"}</Badge>
                {run.model ? <span className="text-[10px] text-ink-400">{run.model}</span> : null}
              </div>

              {tab === "advice" ? <AdviceView advice={run.advice} analysis={run.analysis} /> : null}
              {tab === "analysis" ? <AnalysisView analysis={run.analysis} /> : null}
              {tab === "trace" ? (
                <div className="space-y-3">
                  <AgentTimeline steps={run.steps} mode={run.mode} model={run.model} />
                  <div className="grid gap-3 md:grid-cols-2">
                    {Object.entries(run.memos).filter(([key]) => key !== "manager" && key !== "critic").map(([key, value]) => (
                      <Card key={key}>
                        <CardHead title={{ macro: "宏观备忘录", portfolio: "组合备忘录", risk: "风险备忘录", goal: "目标备忘录" }[key] ?? key} />
                        <p className="whitespace-pre-wrap px-5 py-4 text-[11px] leading-relaxed text-ink-600">{value}</p>
                      </Card>
                    ))}
                  </div>
                </div>
              ) : null}
              {tab === "report" ? (
                <Card>
                  <CardHead title="HTML / PDF 研报" desc="包含配置表、回测图、压力测试、目标规划与免责声明。" right={<FileText className="h-4 w-4 text-brand-600" />} />
                  <div className="flex flex-wrap items-center gap-2 px-5 py-4">
                    {run.report ? (
                      <>
                        <a href={`/api/reports/${run.report.report_id}`} target="_blank" rel="noreferrer"><Button size="sm">打开 HTML 研报</Button></a>
                        <a href={`/api/reports/${run.report.report_id}/pdf`}><Button size="sm" variant="secondary">下载 PDF</Button></a>
                        <span className="text-[11px] text-ink-400">{run.report.report_id}</span>
                      </>
                    ) : (
                      <p className="text-xs text-ink-500">本次运行未生成报告。</p>
                    )}
                  </div>
                  <div className="border-t border-ink-100 px-5 py-4">
                    <p className="text-[11px] leading-relaxed text-ink-500">{run.disclaimer}</p>
                  </div>
                </Card>
              ) : null}
            </>
          ) : !loading ? (
            <Card>
              <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700"><Bot className="h-5 w-5" /></span>
                <p className="text-sm font-medium text-ink-800">还没有运行记录</p>
                <p className="max-w-md text-xs leading-relaxed text-ink-500">点击「启动分析」，系统会先运行真实量化引擎，再让多个角色分别解读，最后由审查员检查合规与数字一致性。</p>
                <Button size="sm" onClick={start}><Play className="h-3.5 w-3.5" />启动分析</Button>
              </div>
            </Card>
          ) : null}
        </div>

        <aside className="space-y-3">
          <Card>
            <CardHead title="图像输入" desc="K 线截图、财报图片、持仓截图；需要视觉模型。" right={<ImagePlus className="h-4 w-4 text-ink-400" />} />
            <div className="px-4 py-4">
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} />
              <button onClick={() => fileRef.current?.click()} className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-ink-300 bg-ink-50/50 px-4 py-6 text-center transition hover:border-brand-300 hover:bg-brand-50/40">
                {imageLoading ? <Loader2 className="h-5 w-5 animate-spin text-brand-600" /> : <Upload className="h-5 w-5 text-ink-400" />}
                <span className="text-xs font-medium text-ink-700">{imageLoading ? "视觉模型分析中…" : "上传图片"}</span>
                <span className="text-[10px] leading-relaxed text-ink-400">未配置视觉模型时会明确提示，不会假装识别</span>
              </button>
              {imageError ? <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-800">{imageError}</p> : null}
              {imageText ? (
                <div className="mt-2 rounded-lg border border-ink-200 bg-white p-2.5">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-ink-500">视觉模型输出</span>
                    <button onClick={() => setImageText("")}><X className="h-3 w-3 text-ink-400" /></button>
                  </div>
                  <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-ink-600">{imageText}</p>
                </div>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHead title="历史运行" desc="保存在本机，可回看轨迹与报告。" right={<Clock className="h-4 w-4 text-ink-400" />} />
            <div className="max-h-[420px] overflow-auto px-3 py-2">
              {history.length === 0 ? <p className="px-2 py-4 text-[11px] text-ink-400">暂无记录</p> : null}
              {history.map((item) => (
                <button key={item.id} onClick={() => void loadRun(item.id)} className={cn("mb-1 w-full rounded-lg px-2.5 py-2 text-left transition hover:bg-ink-50", run?.run_id === item.id && "bg-brand-50")}>
                  <p className="line-clamp-2 text-[11px] font-medium text-ink-700">{item.task}</p>
                  <p className="mt-0.5 text-[10px] text-ink-400">{new Date(item.created_at).toLocaleString("zh-CN")} · {item.mode}</p>
                </button>
              ))}
            </div>
          </Card>

          <InfoNote>
            当前建议边界：资产大类、策略权重、ETF/基金筛选与再平衡；不推荐个股，不给目标价或收益承诺。
          </InfoNote>
        </aside>
      </div>
    </div>
  );
}
