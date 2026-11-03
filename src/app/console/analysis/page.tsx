"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Database, Loader2, Play, RefreshCw, ShieldCheck } from "lucide-react";
import { SectionHeading, Button, Card, CardHead, ErrorBanner, Badge, InfoNote, SkeletonBlock } from "@/components/ui";
import { AnalysisView } from "@/components/investment/analysis-view";
import { apiGet, apiSend, errorText } from "@/lib/client/api";
import type { AnalysisResult } from "@/lib/types/investment";

const STAGES = ["读取 ETF 行情与宏观数据", "估计收益、协方差与风险预算", "运行风险平价 / 均值方差 / Black-Litterman", "回测、压力测试与目标规划", "生成目标权重与交易清单"];

export default function AnalysisPage() {
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingLatest, setLoadingLatest] = useState(true);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);

  async function loadLatest() {
    setLoadingLatest(true);
    try {
      const response = await apiGet<{ id: string; createdAt: string; result: AnalysisResult } | null>("/api/analysis/latest");
      setAnalysis(response.data?.result ?? null);
    } catch {
      setAnalysis(null);
    } finally {
      setLoadingLatest(false);
    }
  }

  useEffect(() => {
    void loadLatest();
  }, []);

  useEffect(() => {
    if (!loading) return;
    setStage(0);
    setElapsed(0);
    const started = Date.now();
    const timer = window.setInterval(() => {
      setElapsed(Math.round((Date.now() - started) / 1000));
      setStage((current) => Math.min(current + 1, STAGES.length - 1));
    }, 4500);
    return () => window.clearInterval(timer);
  }, [loading]);

  async function run() {
    setLoading(true);
    setError("");
    try {
      const response = await apiSend<AnalysisResult>("/api/analysis/run", "POST");
      setAnalysis(response.data);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <SectionHeading
        eyebrow="Allocation Engine"
        title="配置分析"
        desc="把真实 ETF 行情、宏观状态、风险预算与你录入的资产放在同一套约束下，输出可执行的配置与再平衡清单。"
        right={
          <>
            {analysis ? <Badge tone="brand">数据截至 {analysis.meta.data_end}</Badge> : null}
            <Button onClick={run} loading={loading} size="sm">
              <Play className="h-3.5 w-3.5" aria-hidden />
              {analysis ? "重新分析" : "运行分析"}
            </Button>
          </>
        }
      />

      {error ? <div className="mb-3"><ErrorBanner message={error} onRetry={run} /></div> : null}

      {loading ? (
        <Card className="mb-3">
          <CardHead title="正在计算" desc="所有数字由量化引擎现场计算；首次拉取行情可能需要 30–60 秒。" right={<span className="tabular text-[11px] text-ink-400">{elapsed}s</span>} />
          <div className="space-y-2.5 px-5 py-5">
            {STAGES.map((item, index) => (
              <div key={item} className="flex items-center gap-2.5 text-xs">
                {index < stage ? <ShieldCheck className="h-3.5 w-3.5 text-brand-600" /> : index === stage ? <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-600" /> : <span className="h-3.5 w-3.5 rounded-full border border-ink-200" />}
                <span className={index <= stage ? "text-ink-800" : "text-ink-400"}>{item}</span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {loadingLatest && !analysis ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Card><SkeletonBlock lines={6} /></Card>
          <Card><SkeletonBlock lines={6} /></Card>
        </div>
      ) : null}

      {!loading && !analysis ? (
        <Card>
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700"><Database className="h-5 w-5" /></span>
            <p className="text-sm font-medium text-ink-800">还没有分析结果</p>
            <p className="max-w-lg text-xs leading-relaxed text-ink-500">
              先确认「持仓与目标」里的 ETF 代码、金额和风险画像，然后运行分析。系统会拉取真实复权行情，计算战略配置、战术倾斜、风险与回测。
            </p>
            <div className="flex gap-2">
              <Link href="/console/portfolio"><Button variant="secondary" size="sm">检查持仓</Button></Link>
              <Button size="sm" onClick={run}><RefreshCw className="h-3.5 w-3.5" />运行分析</Button>
            </div>
          </div>
        </Card>
      ) : null}

      {analysis ? <AnalysisView analysis={analysis} /> : null}

      {analysis ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <InfoNote>
            分析口径：目标权重是「资产大类 + ETF」层面，不是个股买卖点；回测与 VaR 均基于历史样本，不代表未来。
          </InfoNote>
          <Link href="/console/agent" className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-800">
            用多智能体生成完整建议 <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      ) : null}
    </div>
  );
}
