"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Save, Trash2, Wallet, Target, Landmark, SlidersHorizontal, ArrowRight } from "lucide-react";
import { Badge, Button, Card, CardHead, ErrorBanner, Field, InfoNote, Input, SectionHeading, Select, StatCard } from "@/components/ui";
import { apiGet, apiSend, errorText } from "@/lib/client/api";
import type { PortfolioAsset, PortfolioGoal, PortfolioLiability, PortfolioPayload } from "@/lib/types/investment";

const ASSET_CLASSES = [
  { value: "CASH", label: "现金管理" },
  { value: "CN_BOND", label: "中国债券" },
  { value: "CN_EQUITY", label: "中国权益" },
  { value: "HK_EQUITY", label: "港股权益" },
  { value: "US_EQUITY", label: "海外权益" },
  { value: "GOLD", label: "黄金" },
  { value: "COMMODITY", label: "商品" },
  { value: "SATELLITE", label: "行业卫星" },
  { value: "REAL_ESTATE", label: "房产" },
  { value: "INSURANCE", label: "保险" },
  { value: "OTHER", label: "其他" },
] as const;

const ETF_OPTIONS = [
  ["510300", "沪深300ETF", "CN_EQUITY"], ["510500", "中证500ETF", "CN_EQUITY"], ["512100", "中证1000ETF", "CN_EQUITY"],
  ["588000", "科创50ETF", "CN_EQUITY"], ["159915", "创业板ETF", "CN_EQUITY"], ["510880", "红利ETF", "CN_EQUITY"],
  ["512890", "红利低波ETF", "CN_EQUITY"], ["511010", "国债ETF", "CN_BOND"], ["511260", "十年国债ETF", "CN_BOND"],
  ["511360", "短融ETF", "CN_BOND"], ["511880", "银华日利ETF", "CASH"], ["511990", "华宝添益ETF", "CASH"],
  ["518880", "黄金ETF", "GOLD"], ["513100", "纳指ETF", "US_EQUITY"], ["513500", "标普500ETF", "US_EQUITY"],
  ["513130", "恒生科技ETF", "HK_EQUITY"], ["513050", "中概互联网ETF", "HK_EQUITY"], ["512480", "半导体ETF", "SATELLITE"],
  ["515030", "新能源车ETF", "SATELLITE"], ["512170", "医疗ETF", "SATELLITE"], ["159928", "消费ETF", "SATELLITE"],
] as const;

const GOAL_TYPES = [
  { value: "EMERGENCY", label: "应急金" },
  { value: "EDUCATION", label: "教育金" },
  { value: "RETIREMENT", label: "养老" },
  { value: "HOUSE", label: "购房" },
  { value: "OTHER", label: "其他" },
] as const;

const money = (value: number) => {
  if (Math.abs(value) >= 1e8) return `${(value / 1e8).toFixed(2)} 亿`;
  if (Math.abs(value) >= 1e4) return `${(value / 1e4).toFixed(1)} 万`;
  return Math.round(value).toLocaleString("zh-CN");
};

export default function PortfolioPage() {
  const [data, setData] = useState<PortfolioPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const response = await apiGet<PortfolioPayload>("/api/portfolio");
        setData(response.data);
      } catch (cause) {
        setError(errorText(cause));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const totals = useMemo(() => {
    if (!data) return { assets: 0, liabilities: 0, net: 0, investable: 0, nonInvestable: 0 };
    const assets = data.assets.reduce((sum, item) => sum + (Number(item.marketValue) || 0), 0);
    const liabilities = data.liabilities.reduce((sum, item) => sum + (Number(item.balance) || 0), 0);
    const nonInvestable = data.assets.filter((item) => ["REAL_ESTATE", "INSURANCE", "OTHER"].includes(item.assetClass)).reduce((sum, item) => sum + (Number(item.marketValue) || 0), 0);
    return { assets, liabilities, net: assets - liabilities, investable: assets - nonInvestable, nonInvestable };
  }, [data]);

  function updateAsset(index: number, patch: Partial<PortfolioAsset>) {
    if (!data) return;
    setData({ ...data, assets: data.assets.map((item, i) => (i === index ? { ...item, ...patch } : item)) });
  }
  function updateLiability(index: number, patch: Partial<PortfolioLiability>) {
    if (!data) return;
    setData({ ...data, liabilities: data.liabilities.map((item, i) => (i === index ? { ...item, ...patch } : item)) });
  }
  function updateGoal(index: number, patch: Partial<PortfolioGoal>) {
    if (!data) return;
    setData({ ...data, goals: data.goals.map((item, i) => (i === index ? { ...item, ...patch } : item)) });
  }
  function applyCode(index: number, code: string) {
    const found = ETF_OPTIONS.find((item) => item[0] === code);
    updateAsset(index, found ? { code, name: found[1], assetClass: found[2] } : { code });
  }

  async function save() {
    if (!data) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await apiSend<PortfolioPayload>("/api/portfolio", "PUT", data);
      setData(response.data);
      setNotice("已保存。下一步可运行配置分析或多智能体决策。");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSaving(false);
    }
  }

  if (loading && !data) {
    return <div className="py-20 text-center text-sm text-ink-400">加载持仓与目标…</div>;
  }
  if (!data) {
    return <ErrorBanner message={error || "加载失败"} />;
  }

  return (
    <div>
      <SectionHeading
        eyebrow="Portfolio Input"
        title="持仓与目标"
        desc="录入真实持仓、负债、收入与目标。系统只把可识别的 ETF/现金纳入优化；房产、保险等计入总资产但不强制再平衡。"
        right={
          <>
            <Link href="/console/analysis"><Button variant="secondary" size="sm">配置分析 <ArrowRight className="h-3.5 w-3.5" /></Button></Link>
            <Button size="sm" onClick={save} loading={saving}><Save className="h-3.5 w-3.5" />保存</Button>
          </>
        }
      />

      {error ? <div className="mb-3"><ErrorBanner message={error} onRetry={() => void save()} /></div> : null}
      {notice ? <p className="mb-3 rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2 text-xs text-brand-800">{notice}</p> : null}

      <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="总资产" value={`${money(totals.assets)} 元`} hint={`${data.assets.length} 条持仓`} />
        <StatCard label="可投资资产" value={`${money(totals.investable)} 元`} hint="ETF/现金，进入优化" tone="brand" />
        <StatCard label="总负债" value={`${money(totals.liabilities)} 元`} hint={`${data.liabilities.length} 条负债`} tone={totals.liabilities > totals.assets * 0.5 ? "warn" : "neutral"} />
        <StatCard label="净资产" value={`${money(totals.net)} 元`} hint={`非可投资 ${money(totals.nonInvestable)} 元`} />
      </div>

      <div className="space-y-3">
        <Card>
          <CardHead
            title="持仓"
            desc="代码可填 ETF 代码；无法识别的代码会计入非可投资资产，不进入优化。"
            right={<Button variant="secondary" size="sm" onClick={() => setData({ ...data, assets: [...data.assets, { name: "新持仓", code: "", assetClass: "CN_EQUITY", marketValue: 0, currency: "CNY" }] })}><Plus className="h-3.5 w-3.5" />添加</Button>}
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-xs">
              <thead>
                <tr className="border-b border-ink-100 text-left text-[10px] uppercase tracking-wide text-ink-400">
                  <th className="px-4 py-2 font-medium">代码</th>
                  <th className="px-3 py-2 font-medium">名称</th>
                  <th className="px-3 py-2 font-medium">资产类别</th>
                  <th className="px-3 py-2 text-right font-medium">市值（元）</th>
                  <th className="px-3 py-2 text-right font-medium">成本/份额</th>
                  <th className="px-3 py-2 text-right font-medium">占比</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {data.assets.map((asset, index) => (
                  <tr key={asset.id ?? index} className="border-b border-ink-50 last:border-0">
                    <td className="px-4 py-2">
                      {["REAL_ESTATE", "INSURANCE", "OTHER"].includes(asset.assetClass) ? (
                        <span className="inline-flex h-8 items-center px-2 text-[11px] text-ink-400" title="非可投资资产，不进入优化">—</span>
                      ) : (
                        <Input value={asset.code ?? ""} onChange={(event) => applyCode(index, event.target.value)} placeholder="510300" className="h-8 w-24 font-mono text-[11px]" list="etf-options" />
                      )}
                    </td>
                    <td className="px-3 py-2"><Input value={asset.name} onChange={(event) => updateAsset(index, { name: event.target.value })} className="h-8 min-w-[120px]" /></td>
                    <td className="px-3 py-2">
                      <Select value={asset.assetClass} onChange={(event) => updateAsset(index, { assetClass: event.target.value as PortfolioAsset["assetClass"] })} className="h-8 min-w-[110px]">
                        {ASSET_CLASSES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                      </Select>
                    </td>
                    <td className="px-3 py-2"><Input type="number" value={asset.marketValue} onChange={(event) => updateAsset(index, { marketValue: Number(event.target.value) })} className="h-8 w-28 text-right tabular" /></td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <Input type="number" value={asset.costBasis ?? ""} onChange={(event) => updateAsset(index, { costBasis: event.target.value ? Number(event.target.value) : null })} placeholder="成本" className="h-8 w-20 text-right text-[11px]" />
                        <Input type="number" value={asset.quantity ?? ""} onChange={(event) => updateAsset(index, { quantity: event.target.value ? Number(event.target.value) : null })} placeholder="份额" className="h-8 w-20 text-right text-[11px]" />
                      </div>
                    </td>
                    <td className="tabular px-3 py-2 text-right text-ink-500">{totals.assets > 0 ? `${((asset.marketValue / totals.assets) * 100).toFixed(1)}%` : "—"}</td>
                    <td className="px-4 py-2 text-right">
                      <button onClick={() => setData({ ...data, assets: data.assets.filter((_, i) => i !== index) })} className="rounded-lg p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-600" aria-label="删除"><Trash2 className="h-3.5 w-3.5" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <datalist id="etf-options">
            {ETF_OPTIONS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </datalist>
        </Card>

        <div className="grid gap-3 lg:grid-cols-2">
          <Card>
            <CardHead title="负债" desc="高成本负债会优先进入建议。" right={<Button variant="secondary" size="sm" onClick={() => setData({ ...data, liabilities: [...data.liabilities, { name: "新负债", category: "OTHER", balance: 0, rate: 0, monthlyPayment: 0 }] })}><Plus className="h-3.5 w-3.5" />添加</Button>} />
            <div className="divide-y divide-ink-50">
              {data.liabilities.map((item, index) => (
                <div key={item.id ?? index} className="grid grid-cols-12 gap-2 px-4 py-2.5">
                  <Input value={item.name} onChange={(event) => updateLiability(index, { name: event.target.value })} className="col-span-4 h-8" placeholder="名称" />
                  <Input type="number" value={item.balance} onChange={(event) => updateLiability(index, { balance: Number(event.target.value) })} className="col-span-3 h-8 text-right" placeholder="余额" />
                  <Input type="number" value={item.rate} onChange={(event) => updateLiability(index, { rate: Number(event.target.value) })} className="col-span-2 h-8 text-right" placeholder="利率%" />
                  <Input type="number" value={item.monthlyPayment} onChange={(event) => updateLiability(index, { monthlyPayment: Number(event.target.value) })} className="col-span-2 h-8 text-right" placeholder="月供" />
                  <button onClick={() => setData({ ...data, liabilities: data.liabilities.filter((_, i) => i !== index) })} className="col-span-1 flex items-center justify-center text-ink-400 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              ))}
              {data.liabilities.length === 0 ? <p className="px-4 py-5 text-xs text-ink-400">暂无负债</p> : null}
            </div>
          </Card>

          <Card>
            <CardHead title="收入与风险画像" desc="用于目标规划、应急金与权益区间。" right={<Badge tone="brand">风险分 {data.profile.riskScore}</Badge>} />
            <div className="grid grid-cols-2 gap-3 px-4 py-4">
              <Field label="月收入（元）"><Input type="number" value={data.profile.monthlyIncome} onChange={(event) => setData({ ...data, profile: { ...data.profile, monthlyIncome: Number(event.target.value) } })} /></Field>
              <Field label="月必要支出（元）"><Input type="number" value={data.profile.monthlyExpense} onChange={(event) => setData({ ...data, profile: { ...data.profile, monthlyExpense: Number(event.target.value) } })} /></Field>
              <Field label="月可投资（元）"><Input type="number" value={data.profile.monthlyInvestable} onChange={(event) => setData({ ...data, profile: { ...data.profile, monthlyInvestable: Number(event.target.value) } })} /></Field>
              <Field label="风险承受分（0–100）"><Input type="number" min={0} max={100} value={data.profile.riskScore} onChange={(event) => setData({ ...data, profile: { ...data.profile, riskScore: Number(event.target.value) } })} /></Field>
              <Field label="当前年龄"><Input type="number" value={data.profile.currentAge ?? ""} onChange={(event) => setData({ ...data, profile: { ...data.profile, currentAge: event.target.value ? Number(event.target.value) : null } })} /></Field>
              <Field label="计划退休年龄"><Input type="number" value={data.profile.retirementAge ?? ""} onChange={(event) => setData({ ...data, profile: { ...data.profile, retirementAge: event.target.value ? Number(event.target.value) : null } })} /></Field>
              <Field label="风险档位">
                <Select value={data.profile.riskBand} onChange={(event) => setData({ ...data, profile: { ...data.profile, riskBand: event.target.value as PortfolioPayload["profile"]["riskBand"] } })}>
                  <option value="CONSERVATIVE">保守</option><option value="STEADY">稳健</option><option value="BALANCED">平衡</option><option value="GROWTH">成长</option><option value="AGGRESSIVE">进取</option>
                </Select>
              </Field>
              <Field label="可承受最大回撤"><Input type="number" step="0.01" value={data.profile.maxDrawdown} onChange={(event) => setData({ ...data, profile: { ...data.profile, maxDrawdown: Number(event.target.value) } })} /></Field>
            </div>
          </Card>
        </div>

        <Card>
          <CardHead title="目标" desc="应急金、教育金、养老、购房；系统会计算未来成本、月供与成功概率。" right={<Button variant="secondary" size="sm" onClick={() => setData({ ...data, goals: [...data.goals, { name: "新目标", type: "OTHER", targetAmount: 0, currentAmount: 0, years: 5, monthlyContribution: 0, priority: "medium", inflation: 0.025, expectedReturn: 0.05, volatility: 0.1 }] })}><Plus className="h-3.5 w-3.5" />添加</Button>} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-xs">
              <thead>
                <tr className="border-b border-ink-100 text-left text-[10px] uppercase tracking-wide text-ink-400">
                  <th className="px-4 py-2 font-medium">目标</th><th className="px-3 py-2 font-medium">类型</th><th className="px-3 py-2 text-right font-medium">目标金额</th><th className="px-3 py-2 text-right font-medium">已准备</th><th className="px-3 py-2 text-right font-medium">年数</th><th className="px-3 py-2 text-right font-medium">月供</th><th className="px-3 py-2 font-medium">优先级</th><th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {data.goals.map((goal, index) => (
                  <tr key={goal.id ?? index} className="border-b border-ink-50 last:border-0">
                    <td className="px-4 py-2"><Input value={goal.name} onChange={(event) => updateGoal(index, { name: event.target.value })} className="h-8 min-w-[100px]" /></td>
                    <td className="px-3 py-2"><Select value={goal.type} onChange={(event) => updateGoal(index, { type: event.target.value as PortfolioGoal["type"] })} className="h-8 min-w-[90px]">{GOAL_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></td>
                    <td className="px-3 py-2"><Input type="number" value={goal.targetAmount} onChange={(event) => updateGoal(index, { targetAmount: Number(event.target.value) })} className="h-8 w-24 text-right" /></td>
                    <td className="px-3 py-2"><Input type="number" value={goal.currentAmount} onChange={(event) => updateGoal(index, { currentAmount: Number(event.target.value) })} className="h-8 w-24 text-right" /></td>
                    <td className="px-3 py-2"><Input type="number" value={goal.years ?? ""} onChange={(event) => updateGoal(index, { years: event.target.value ? Number(event.target.value) : null })} className="h-8 w-16 text-right" /></td>
                    <td className="px-3 py-2"><Input type="number" value={goal.monthlyContribution} onChange={(event) => updateGoal(index, { monthlyContribution: Number(event.target.value) })} className="h-8 w-20 text-right" /></td>
                    <td className="px-3 py-2"><Select value={goal.priority} onChange={(event) => updateGoal(index, { priority: event.target.value as PortfolioGoal["priority"] })} className="h-8 w-20"><option value="high">高</option><option value="medium">中</option><option value="low">低</option></Select></td>
                    <td className="px-4 py-2 text-right"><button onClick={() => setData({ ...data, goals: data.goals.filter((_, i) => i !== index) })} className="rounded-lg p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHead title="约束条件（高级）" desc="约束会直接进入优化器；不填则使用稳健默认值。" right={<SlidersHorizontal className="h-4 w-4 text-ink-400" />} />
          <div className="grid grid-cols-2 gap-3 px-4 py-4 sm:grid-cols-3 lg:grid-cols-6">
            <Field label="单只 ETF 上限"><Input type="number" step="0.05" value={data.profile.constraints.max_single_etf} onChange={(event) => setData({ ...data, profile: { ...data.profile, constraints: { ...data.profile.constraints, max_single_etf: Number(event.target.value) } } })} /></Field>
            <Field label="权益上限"><Input type="number" step="0.05" value={data.profile.constraints.max_equity} onChange={(event) => setData({ ...data, profile: { ...data.profile, constraints: { ...data.profile.constraints, max_equity: Number(event.target.value) } } })} /></Field>
            <Field label="海外上限"><Input type="number" step="0.05" value={data.profile.constraints.max_overseas} onChange={(event) => setData({ ...data, profile: { ...data.profile, constraints: { ...data.profile.constraints, max_overseas: Number(event.target.value) } } })} /></Field>
            <Field label="卫星上限"><Input type="number" step="0.05" value={data.profile.constraints.max_satellite} onChange={(event) => setData({ ...data, profile: { ...data.profile, constraints: { ...data.profile.constraints, max_satellite: Number(event.target.value) } } })} /></Field>
            <Field label="现金下限"><Input type="number" step="0.01" value={data.profile.constraints.min_cash} onChange={(event) => setData({ ...data, profile: { ...data.profile, constraints: { ...data.profile.constraints, min_cash: Number(event.target.value) } } })} /></Field>
            <Field label="最大换手"><Input type="number" step="0.05" value={data.profile.constraints.max_turnover} onChange={(event) => setData({ ...data, profile: { ...data.profile, constraints: { ...data.profile.constraints, max_turnover: Number(event.target.value) } } })} /></Field>
          </div>
        </Card>

        <InfoNote tone="warn">
          演示数据为虚构；请勿填入真实身份证、银行卡或券商账号。所有数据只保存在本机 SQLite 与本地 JSON 缓存中。
        </InfoNote>

        <div className="flex justify-end gap-2 pb-4">
          <Link href="/console/analysis"><Button variant="secondary">取消</Button></Link>
          <Button onClick={save} loading={saving}><Save className="h-4 w-4" />保存全部</Button>
        </div>
      </div>
    </div>
  );
}
