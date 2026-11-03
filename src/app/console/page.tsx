"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Bot, BrainCircuit, Gauge, LineChart, Radar, ShieldCheck, Sparkles, Target, TrendingUp, Wallet } from "lucide-react";
import { Badge, Button, Card, CardHead, InfoNote, Progress, SectionHeading, SkeletonBlock, StatCard } from "@/components/ui";
import { apiGet } from "@/lib/client/api";
import type { AgentRunResult, AgentRunSummary, AnalysisResult, PortfolioPayload } from "@/lib/types/investment";

interface MarketOverview {
  as_of: string;
  data_end: string;
  regime: { regime: string; label: string; score: number; signals: { name: string; value: string; impact: number }[] };
  macro: { indicators: { key: string; label: string; value: number; unit: string; date: string; change: number | null }[] };
  momentum: { code: string; name: string; score: number; trend: string; mom_12m: number }[];
}

interface NewsItem {
  id: string;
  title: string;
  summary: string;
  source: string;
  published_at: string;
  sentiment: string;
}

const money = (value: number) => {
  if (Math.abs(value) >= 1e8) return `${(value / 1e8).toFixed(2)} 亿`;
  if (Math.abs(value) >= 1e4) return `${(value / 1e4).toFixed(1)} 万`;
  return Math.round(value).toLocaleString("zh-CN");
};
const pct = (value: number | null | undefined) => (value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)}%`);

export default function ConsoleOverviewPage() {
  const [portfolio, setPortfolio] = useState<PortfolioPayload | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [agent, setAgent] = useState<AgentRunResult | null>(null);
  const [market, setMarket] = useState<MarketOverview | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const results = await Promise.allSettled([
        apiGet<PortfolioPayload>("/api/portfolio"),
        apiGet<{ id: string; createdAt: string; result: AnalysisResult } | null>("/api/analysis/latest"),
        apiGet<AgentRunSummary[]>("/api/agent/runs"),
        apiGet<MarketOverview>("/api/market/overview"),
        apiGet<NewsItem[]>("/api/news"),
      ]);
      if (results[0].status === "fulfilled") setPortfolio(results[0].value.data);
      if (results[1].status === "fulfilled") setAnalysis(results[1].value.data?.result ?? null);
      if (results[2].status === "fulfilled" && results[2].value.data[0]) {
        try {
          const latest = await apiGet<AgentRunResult>(`/api/agent/runs/${results[2].value.data[0].id}`);
          setAgent(latest.data);
        } catch {
          setAgent(null);
        }
      }
      if (results[3].status === "fulfilled") setMarket(results[3].value.data);
      if (results[4].status === "fulfilled") setNews(results[4].value.data);
      setLoading(false);
    })();
  }, []);

  const totals = portfolio
    ? {
        assets: portfolio.assets.reduce((sum, item) => sum + item.marketValue, 0),
        liabilities: portfolio.liabilities.reduce((sum, item) => sum + item.balance, 0),
        investable: portfolio.assets.filter((item) => !["REAL_ESTATE", "INSURANCE", "OTHER"].includes(item.assetClass)).reduce((sum, item) => sum + item.marketValue, 0),
        cash: portfolio.assets.filter((item) => item.assetClass === "CASH").reduce((sum, item) => sum + item.marketValue, 0),
      }
    : null;
  const netWorth = totals ? totals.assets - totals.liabilities : 0;
  const emergencyMonths = totals && portfolio?.profile.monthlyExpense ? totals.cash / portfolio.profile.monthlyExpense : null;
  const regime = analysis?.market.regime ?? market?.regime;
  const latestNews = news.slice(0, 4);
  const macro = (analysis?.market.macro.indicators ?? market?.macro.indicators ?? []).slice(0, 6);

  return (
    <div>
      <SectionHeading
        eyebrow="Decision Cockpit"
        title="总览"
        desc="一屏回答：市场处在什么状态、我的钱分布是否合理、下一步最该做什么。"
        right={
          <>
            <Link href="/console/portfolio"><Button variant="secondary" size="sm"><Wallet className="h-3.5 w-3.5" />持仓</Button></Link>
            <Link href="/console/agent"><Button size="sm"><Bot className="h-3.5 w-3.5" />启动智能决策</Button></Link>
          </>
        }
      />

      {loading && !portfolio ? (
        <div className="grid gap-3 md:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Card key={i}><SkeletonBlock lines={3} /></Card>)}</div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="净资产" value={`${money(netWorth)} 元`} hint={`总资产 ${money(totals?.assets ?? 0)}`} />
            <StatCard label="可投资资产" value={`${money(totals?.investable ?? 0)} 元`} hint="ETF/现金，进入优化" tone="brand" />
            <StatCard label="总负债" value={`${money(totals?.liabilities ?? 0)} 元`} hint={totals && totals.assets > 0 ? `负债率 ${pct(totals.liabilities / totals.assets)}` : "—"} tone={totals && totals.liabilities > totals.assets * 0.5 ? "warn" : "neutral"} />
            <StatCard label="应急金月数" value={emergencyMonths === null ? "未设置" : `${emergencyMonths.toFixed(1)} 个月`} hint="现金 / 月必要支出" tone={emergencyMonths !== null && emergencyMonths < 3 ? "danger" : "brand"} />
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            <Card className="lg:col-span-2 overflow-hidden">
              <div className="border-b border-ink-100 bg-gradient-to-br from-ink-950 via-ink-900 to-ink-800 px-5 py-5 text-white">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-300">Market Regime</p>
                    <h2 className="mt-1 text-xl font-semibold tracking-tight">{regime?.label ?? "等待市场数据"}</h2>
                    <p className="mt-1 text-[11px] text-white/60">综合趋势、宽度、波动率、利率、汇率与 VIX；不是涨跌预测。</p>
                  </div>
                  <div className="text-right">
                    <p className="tabular text-3xl font-semibold text-brand-300">{regime?.score ?? "—"}</p>
                    <p className="text-[10px] text-white/50">/ 100 风险偏好</p>
                  </div>
                </div>
                <div className="mt-3"><Progress value={regime?.score ?? 0} tone="brand" /></div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(regime?.signals ?? []).slice(0, 5).map((signal) => (
                    <span key={signal.name} className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] text-white/75">{signal.name} · {signal.value}</span>
                  ))}
                </div>
              </div>
              <div className="grid gap-px bg-ink-100 sm:grid-cols-3">
                <MiniMetric label="最新分析" value={analysis ? analysis.meta.data_end : "未运行"} hint={analysis ? `${analysis.meta.universe} 个资产` : "去配置分析页运行"} />
                <MiniMetric label="目标预期收益" value={analysis ? pct(analysis.target.expected_return) : "—"} hint="历史估计，非承诺" />
                <MiniMetric label="最新建议" value={agent ? (agent.advice.confidence === "high" ? "高置信" : agent.advice.confidence === "medium" ? "中等置信" : "低置信") : "未生成"} hint={agent ? new Date(agent.finished_at).toLocaleDateString("zh-CN") : "去智能决策页运行"} />
              </div>
            </Card>

            <Card>
              <CardHead title="下一步" desc="按优先级执行，不要一次改完。" right={<Sparkles className="h-4 w-4 text-brand-600" />} />
              <div className="space-y-2 px-4 py-4">
                {(agent?.advice.actions ?? analysisTargetActions(analysis)).slice(0, 4).map((item, index) => (
                  <div key={index} className="rounded-xl border border-ink-100 bg-ink-50/50 px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ink-900 text-[10px] font-semibold text-white">{index + 1}</span>
                      <span className="text-[11px] font-medium leading-snug text-ink-800">{item.action}</span>
                    </div>
                    <p className="mt-1 text-[10px] leading-relaxed text-ink-500">{item.rationale}</p>
                  </div>
                ))}
                {!agent && !analysis ? (
                  <div className="px-1 py-6 text-center text-xs text-ink-400">
                    还没有分析结论。<br />先检查持仓，再运行配置分析。
                  </div>
                ) : null}
                <Link href="/console/agent" className="mt-1 flex items-center justify-center gap-1 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-[11px] font-medium text-brand-800 hover:bg-brand-100">
                  生成完整投资建议 <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </Card>
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            <Card>
              <CardHead title="配置偏离" desc="最新分析：当前 vs 目标大类权重。" right={<Gauge className="h-4 w-4 text-ink-400" />} />
              <div className="space-y-2 px-4 py-4">
                {analysis ? analysis.target.class_weights.map((item) => {
                  const current = analysis.portfolio.current_class_weights.find((row) => row.key === item.key)?.weight ?? 0;
                  const delta = item.weight - current;
                  return (
                    <div key={item.key}>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="flex items-center gap-1.5 text-ink-700"><span className="h-2 w-2 rounded-full" style={{ background: item.color }} />{item.label}</span>
                        <span className="tabular text-ink-500">{pct(current)} → <b className={delta > 0 ? "text-brand-700" : delta < 0 ? "text-red-600" : "text-ink-700"}>{pct(item.weight)}</b></span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-100">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(100, item.weight * 100)}%`, background: item.color }} />
                      </div>
                    </div>
                  );
                }) : <p className="py-5 text-center text-xs text-ink-400">运行配置分析后显示</p>}
              </div>
            </Card>

            <Card>
              <CardHead title="宏观仪表盘" desc="每个指标标注实际观测日期。" right={<Radar className="h-4 w-4 text-ink-400" />} />
              <div className="divide-y divide-ink-50">
                {macro.length ? macro.map((item) => (
                  <div key={item.key} className="flex items-center justify-between px-4 py-2">
                    <span className="text-[11px] text-ink-600">{item.label}</span>
                    <span className="tabular text-[11px] font-medium text-ink-900">{item.value}{item.unit}<span className="ml-1 text-[9px] font-normal text-ink-400">{item.date.slice(0, 7)}</span></span>
                  </div>
                )) : <p className="px-4 py-5 text-xs text-ink-400">宏观数据加载中或暂不可用</p>}
              </div>
            </Card>

            <Card>
              <CardHead title="市场情报" desc="本地资讯与事件，用于解释而不是预测。" right={<LineChart className="h-4 w-4 text-ink-400" />} />
              <div className="divide-y divide-ink-50">
                {latestNews.length ? latestNews.map((item) => (
                  <div key={item.id} className="px-4 py-2.5">
                    <p className="line-clamp-2 text-[11px] font-medium leading-snug text-ink-800">{item.title}</p>
                    <p className="mt-0.5 text-[10px] text-ink-400">{item.source} · {new Date(item.published_at).toLocaleDateString("zh-CN")}</p>
                  </div>
                )) : <p className="px-4 py-5 text-xs text-ink-400">暂无资讯</p>}
              </div>
            </Card>
          </div>

          {agent ? (
            <Card className="mt-3">
              <CardHead title="最新智能决策" desc={`${agent.advice.regime?.label ?? ""} · ${new Date(agent.finished_at).toLocaleString("zh-CN")}`} right={<Badge tone={agent.mode === "llm" ? "brand" : "warn"}>{agent.mode === "llm" ? "LLM 多智能体" : agent.mode === "fallback" ? "规则兜底" : "规则智能体"}</Badge>} />
              <div className="px-5 py-4">
                <p className="text-sm font-medium leading-relaxed text-ink-900">{agent.advice.summary}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {agent.advice.allocation.filter((item) => Math.abs(item.delta) >= 0.02).slice(0, 5).map((item) => (
                    <Badge key={item.asset_class} tone={item.delta > 0 ? "brand" : "danger"}>{item.label} {item.delta > 0 ? "+" : ""}{pct(item.delta)}</Badge>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link href="/console/agent"><Button size="sm" variant="secondary"><BrainCircuit className="h-3.5 w-3.5" />查看完整轨迹</Button></Link>
                  {agent.report ? <a href={`/api/reports/${agent.report.report_id}`} target="_blank" rel="noreferrer"><Button size="sm" variant="secondary">打开研报</Button></a> : null}
                </div>
              </div>
            </Card>
          ) : null}

          <div className="mt-3"><InfoNote>本工具提供资产配置与结构建议，不推荐个股、不给目标价或收益承诺。历史回测与 VaR 不代表未来。</InfoNote></div>
        </>
      )}
    </div>
  );
}

function MiniMetric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="bg-white px-4 py-3">
      <p className="text-[10px] uppercase tracking-wide text-ink-400">{label}</p>
      <p className="tabular mt-1 text-sm font-semibold text-ink-950">{value}</p>
      <p className="text-[10px] text-ink-400">{hint}</p>
    </div>
  );
}

function analysisTargetActions(analysis: AnalysisResult | null): { action: string; rationale: string }[] {
  if (!analysis) return [];
  const changes = analysis.target.class_weights
    .map((item) => ({ item, current: analysis.portfolio.current_class_weights.find((row) => row.key === item.key)?.weight ?? 0 }))
    .filter(({ item, current }) => Math.abs(item.weight - current) >= 0.03)
    .sort((a, b) => Math.abs(b.item.weight - b.current) - Math.abs(a.item.weight - a.current))
    .slice(0, 3);
  return changes.map(({ item, current }) => ({
    action: `${item.weight > current ? "提高" : "降低"}「${item.label}」至 ${pct(item.weight)}`,
    rationale: `当前 ${pct(current)}，偏离 ${pct(Math.abs(item.weight - current))}；由战略配置与约束共同决定。`,
  }));
}
