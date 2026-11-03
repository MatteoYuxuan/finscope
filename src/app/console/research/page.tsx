"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Gauge, Globe2, Newspaper, Radar, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { Badge, Button, Card, CardHead, ErrorBanner, InfoNote, Progress, SectionHeading, SkeletonBlock } from "@/components/ui";
import { apiGet, apiSend, errorText } from "@/lib/client/api";

interface MacroIndicator {
  key: string;
  label: string;
  value: number;
  unit: string;
  date: string;
  previous: number | null;
  change: number | null;
  source: string;
}
interface MarketOverview {
  as_of: string;
  data_end: string;
  regime: { regime: string; label: string; score: number; signals: { name: string; value: string; impact: number }[] };
  macro: { indicators: MacroIndicator[]; derived: Record<string, number | boolean | null>; note: string };
  momentum: { code: string; name: string; asset_class: string; class_label: string; score: number; mom_12m: number; mom_6m: number; trend: string; volatility: number | null }[];
  quotes: { code: string; name: string; price: number | null; change_pct: number | null; amount: number | null }[];
}
interface NewsItem {
  id: string;
  title: string;
  summary: string;
  source: string;
  published_at: string;
  url: string | null;
  sentiment: string;
}

const pct = (value: number | null | undefined) => (value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)}%`);
const money = (value: number | null | undefined) => {
  if (value === null || value === undefined) return "—";
  if (Math.abs(value) >= 1e8) return `${(value / 1e8).toFixed(2)} 亿`;
  if (Math.abs(value) >= 1e4) return `${(value / 1e4).toFixed(1)} 万`;
  return Math.round(value).toLocaleString("zh-CN");
};

export default function ResearchPage() {
  const [market, setMarket] = useState<MarketOverview | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [newsRefreshing, setNewsRefreshing] = useState(false);
  const [notice, setNotice] = useState("");

  async function load(refresh = false) {
    setLoading(true);
    setError("");
    try {
      const [marketResponse, newsResponse] = await Promise.all([
        apiGet<MarketOverview>(`/api/market/overview${refresh ? "?refresh=1" : ""}`),
        apiGet<NewsItem[]>("/api/news"),
      ]);
      setMarket(marketResponse.data);
      setNews(newsResponse.data);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function refresh() {
    setRefreshing(true);
    setNotice("");
    try {
      await apiSend("/api/market/refresh", "POST");
      await load(true);
      setNotice("行情与宏观缓存已刷新。");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setRefreshing(false);
    }
  }

  async function refreshNews() {
    setNewsRefreshing(true);
    setNotice("");
    try {
      const response = await apiSend<{ results: { source: string; added: number; skipped: number; error?: string }[] }>("/api/news/refresh", "POST");
      const text = response.data.results.map((item) => `${item.source}: 新增 ${item.added} / 跳过 ${item.skipped}${item.error ? `（${item.error}）` : ""}`).join("；");
      setNotice(text || "没有抓到新资讯。");
      await load(false);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setNewsRefreshing(false);
    }
  }

  return (
    <div>
      <SectionHeading
        eyebrow="Market & Macro"
        title="市场与宏观"
        desc="真实 ETF 行情、宏观指标与本地资讯。市场状态用于调整风险预算，不是涨跌预测。"
        right={
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={refreshNews} loading={newsRefreshing}><Newspaper className="h-3.5 w-3.5" />抓取真实资讯</Button>
            <Button size="sm" variant="secondary" onClick={refresh} loading={refreshing}><RefreshCw className="h-3.5 w-3.5" />刷新行情</Button>
          </div>
        }
      />
      {error ? <div className="mb-3"><ErrorBanner message={error} onRetry={() => void load()} /></div> : null}
      {notice ? <p className="mb-3 rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2 text-xs text-brand-800">{notice}</p> : null}

      {loading && !market ? (
        <div className="grid gap-3 lg:grid-cols-3"><Card><SkeletonBlock lines={6} /></Card><Card><SkeletonBlock lines={6} /></Card><Card><SkeletonBlock lines={6} /></Card></div>
      ) : null}

      {market ? (
        <div className="space-y-3">
          <div className="grid gap-3 lg:grid-cols-3">
            <Card className="lg:col-span-2 overflow-hidden">
              <div className="border-b border-ink-100 bg-gradient-to-br from-ink-950 via-ink-900 to-ink-800 px-5 py-5 text-white">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-300">Regime Score</p>
                    <h2 className="mt-1 text-xl font-semibold">{market.regime.label}</h2>
                    <p className="mt-1 text-[11px] text-white/60">数据截至 {market.data_end} · 综合趋势、宽度、波动率与宏观变量</p>
                  </div>
                  <div className="text-right"><p className="tabular text-3xl font-semibold text-brand-300">{market.regime.score}</p><p className="text-[10px] text-white/50">/ 100</p></div>
                </div>
                <div className="mt-3"><Progress value={market.regime.score} tone="brand" /></div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {market.regime.signals.map((signal) => (
                    <span key={signal.name} className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] text-white/75">{signal.name} · {signal.value} <span className={signal.impact > 0 ? "text-brand-300" : "text-red-300"}>{signal.impact > 0 ? "+" : ""}{signal.impact}</span></span>
                  ))}
                </div>
              </div>
              <div className="grid gap-px bg-ink-100 sm:grid-cols-3">
                {[
                  { label: "中国 10Y", value: market.macro.indicators.find((item) => item.key === "cn_10y")?.value, unit: "%" },
                  { label: "美元兑人民币", value: market.macro.indicators.find((item) => item.key === "usdcny")?.value, unit: "" },
                  { label: "VIX", value: market.macro.indicators.find((item) => item.key === "us_vix")?.value, unit: "" },
                ].map((item) => (
                  <div key={item.label} className="bg-white px-4 py-3">
                    <p className="text-[10px] uppercase tracking-wide text-ink-400">{item.label}</p>
                    <p className="tabular mt-1 text-base font-semibold text-ink-950">{item.value ?? "—"}{item.unit}</p>
                  </div>
                ))}
              </div>
            </Card>
            <Card>
              <CardHead title="解读方式" desc="如何把市场状态用进配置。" right={<Gauge className="h-4 w-4 text-ink-400" />} />
              <ul className="space-y-2 px-5 py-4 text-[11px] leading-relaxed text-ink-600">
                <li>• Risk-on：风险预算可略高，但仍受回撤上限约束。</li>
                <li>• Neutral：以战略配置为主，战术倾斜幅度收窄。</li>
                <li>• Risk-off：提高债券/现金/黄金，降低高波动卫星仓。</li>
                <li>• 评分是状态描述，不是买卖信号；不预测点位。</li>
                <li>• 宏观数据存在发布滞后，表格中标注观测日期。</li>
              </ul>
            </Card>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <CardHead title="宏观仪表盘" desc={market.macro.note} right={<Globe2 className="h-4 w-4 text-ink-400" />} />
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-ink-100 text-left text-[10px] uppercase tracking-wide text-ink-400"><th className="px-4 py-2 font-medium">指标</th><th className="px-3 py-2 text-right font-medium">最新</th><th className="px-3 py-2 font-medium">日期</th><th className="px-4 py-2 text-right font-medium">变化</th></tr></thead>
                  <tbody>
                    {market.macro.indicators.map((item) => (
                      <tr key={item.key} className="border-b border-ink-50 last:border-0">
                        <td className="px-4 py-2 text-ink-700">{item.label}</td>
                        <td className="tabular px-3 py-2 text-right">{item.value}{item.unit}</td>
                        <td className="px-3 py-2 text-ink-500">{item.date}</td>
                        <td className={`tabular px-4 py-2 text-right ${item.change !== null && item.change > 0 ? "text-brand-700" : item.change !== null && item.change < 0 ? "text-red-600" : "text-ink-500"}`}>{item.change === null ? "—" : item.change.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card>
              <CardHead title="动量与趋势" desc="12-1 动量、6 个月动量与 200 日均线；用于战术倾斜，不是买卖信号。" right={<Radar className="h-4 w-4 text-ink-400" />} />
              <div className="max-h-[360px] overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-white"><tr className="border-b border-ink-100 text-left text-[10px] uppercase tracking-wide text-ink-400"><th className="px-4 py-2 font-medium">ETF</th><th className="px-3 py-2 text-right font-medium">12M</th><th className="px-3 py-2 font-medium">趋势</th><th className="px-4 py-2 text-right font-medium">评分</th></tr></thead>
                  <tbody>
                    {market.momentum.slice(0, 14).map((item) => (
                      <tr key={item.code} className="border-b border-ink-50 last:border-0">
                        <td className="px-4 py-2"><span className="text-ink-700">{item.name}</span><span className="ml-1 font-mono text-[10px] text-ink-400">{item.code}</span></td>
                        <td className={`tabular px-3 py-2 text-right ${item.mom_12m >= 0 ? "text-brand-700" : "text-red-600"}`}>{pct(item.mom_12m)}</td>
                        <td className="px-3 py-2"><Badge tone={item.trend === "UP" ? "brand" : item.trend === "DOWN" ? "danger" : "neutral"}>{item.trend === "UP" ? <TrendingUp className="h-3 w-3" /> : item.trend === "DOWN" ? <TrendingDown className="h-3 w-3" /> : null}{item.trend === "UP" ? "向上" : item.trend === "DOWN" ? "向下" : "混合"}</Badge></td>
                        <td className="tabular px-4 py-2 text-right">{item.score.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHead title="最新资讯" desc="本地资讯用于解释宏观与行业背景；情绪标签是规则/模型结果，不是事实核查。" right={<Newspaper className="h-4 w-4 text-ink-400" />} />
              <div className="divide-y divide-ink-50">
                {news.slice(0, 10).map((item) => (
                  <div key={item.id} className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={item.sentiment === "positive" ? "brand" : item.sentiment === "negative" ? "danger" : "neutral"}>{item.sentiment === "positive" ? "偏正面" : item.sentiment === "negative" ? "偏负面" : item.sentiment === "mixed" ? "分歧" : "中性"}</Badge>
                      <span className="text-[10px] text-ink-400">{item.source} · {new Date(item.published_at).toLocaleString("zh-CN")}</span>
                    </div>
                    <p className="mt-1 text-xs font-medium leading-relaxed text-ink-800">{item.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-ink-500">{item.summary}</p>
                  </div>
                ))}
              </div>
            </Card>
            <Card>
              <CardHead title="ETF 行情" desc="东方财富实时/延迟快照，仅用于流动性与筛选。" />
              <div className="max-h-[420px] overflow-auto">
                <table className="w-full text-xs">
                  <tbody>
                    {market.quotes.slice(0, 20).map((item) => (
                      <tr key={item.code} className="border-b border-ink-50 last:border-0">
                        <td className="px-4 py-2"><p className="text-ink-700">{item.name}</p><p className="font-mono text-[10px] text-ink-400">{item.code}</p></td>
                        <td className="tabular px-3 py-2 text-right">{item.price ?? "—"}</td>
                        <td className={`tabular px-4 py-2 text-right ${(item.change_pct ?? 0) >= 0 ? "text-brand-700" : "text-red-600"}`}>{item.change_pct === null ? "—" : `${item.change_pct.toFixed(2)}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <InfoNote>数据来自公开接口，可能存在延迟/缺失；页面标注观测日期，不用常识补数字。</InfoNote>
            <Link href="/console/analysis" className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-800">用这些数据做配置分析 <ArrowRight className="h-3 w-3" /></Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
