import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Bot,
  CheckCircle2,
  FileText,
  Gauge,
  Layers,
  LineChart,
  Radar,
  ShieldCheck,
  Sparkles,
  Target,
  Wallet,
} from "lucide-react";
import { DISCLAIMER_ZH } from "@/lib/constants";

const CAPABILITIES = [
  {
    icon: Radar,
    title: "信息 → 判断",
    desc: "真实 ETF 行情、利率、汇率、宏观指标与本地资讯进入同一套分析；每个数字标注日期与口径，缺失就说缺失。",
    points: ["AkShare / 东方财富 / FRED", "宏观与市场状态评分", "新闻只做解释，不做预测"],
  },
  {
    icon: BarChart3,
    title: "策略 → 配置",
    desc: "风险平价、均值方差、Black-Litterman 三套战略引擎，叠加动量/趋势战术倾斜，再经约束投影得到目标权重。",
    points: ["单只 ETF / 权益 / 海外 / 卫星上限", "现金下限与换手上限", "目标权重可回溯到每只 ETF"],
  },
  {
    icon: ShieldCheck,
    title: "风险 → 行动",
    desc: "VaR/CVaR、历史压力情景、最大回撤、相关性与风险预算；再用应急金、教育金、养老与负债把配置落到现金流。",
    points: ["95% / 99% VaR 与 CVaR", "2015 / 2018 / 2020 / 2022 压力窗口", "目标缺口与建议月供"],
  },
  {
    icon: Bot,
    title: "多智能体 → 可审计",
    desc: "规划、数据、宏观、组合、风险、目标、组合经理与审查员分工协作；LLM 只解读，不计算，不编造数字。",
    points: ["工具调用与执行轨迹", "审查员检查越界与一致性", "无 Key 时自动切换规则智能体"],
  },
];

const FLOW = [
  { step: "01", title: "录入持仓与目标", desc: "ETF/现金、房产、负债、收入、风险画像与目标" },
  { step: "02", title: "拉取真实数据", desc: "复权行情、利率汇率、宏观指标，缓存到本机" },
  { step: "03", title: "战略 + 战术", desc: "风险平价 / MVO / BL + 动量趋势 + 约束投影" },
  { step: "04", title: "风险与回测", desc: "VaR、压力测试、有效前沿、月度再平衡回测" },
  { step: "05", title: "建议与研报", desc: "ETF 落地方案、执行清单、HTML / PDF 研报" },
];

const METRICS = [
  { label: "资产类别", value: "8", hint: "现金 / 债券 / 权益 / 黄金 / 海外 / 卫星" },
  { label: "战略引擎", value: "3", hint: "风险平价 · 均值方差 · Black-Litterman" },
  { label: "回测策略", value: "6", hint: "含 60/40、等权与集成策略" },
  { label: "智能体角色", value: "8", hint: "规划到审查的完整轨迹" },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-ink-200/70 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink-950 text-sm font-bold text-brand-300">衡</span>
            <span className="leading-tight">
              <span className="block text-sm font-semibold tracking-tight text-ink-950">知衡 FinScope</span>
              <span className="block text-[10px] tracking-wide text-ink-400">个人资产配置智能体</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-6 text-xs text-ink-600 md:flex" aria-label="主导航">
            <a href="#capability" className="hover:text-ink-950">核心能力</a>
            <a href="#flow" className="hover:text-ink-950">工作流</a>
            <a href="#compliance" className="hover:text-ink-950">建议边界</a>
          </nav>
          <Link href="/console" className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-ink-950 px-3.5 text-xs font-medium text-white transition hover:bg-ink-800">
            打开工作台
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      </header>

      <main id="main">
        <section className="relative overflow-hidden">
          <div className="mx-auto grid max-w-6xl gap-10 px-5 pb-16 pt-14 lg:grid-cols-[1.05fr_0.95fr] lg:pt-20">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-[11px] font-medium text-brand-800">
                <Sparkles className="h-3.5 w-3.5" />
                真实数据 · 可解释量化 · 多智能体审计
              </div>
              <h1 className="mt-5 text-4xl font-semibold leading-[1.12] tracking-tight text-ink-950 sm:text-5xl">
                看得懂市场，
                <br />
                配得清自己的资产。
              </h1>
              <p className="mt-5 max-w-xl text-sm leading-relaxed text-ink-600">
                FinScope 把「公开市场信息」与「你的持仓、负债、目标」放在同一套约束下，用风险平价、均值方差、Black-Litterman 与风险模型给出
                <b className="text-ink-900"> 资产大类 + 策略 + ETF 落地 </b>
                的配置建议，并生成可追溯的研报。
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link href="/console" className="inline-flex h-11 items-center gap-2 rounded-xl bg-ink-950 px-5 text-sm font-medium text-white shadow-sm transition hover:bg-ink-800">
                  进入工作台 <ArrowRight className="h-4 w-4" />
                </Link>
                <Link href="/console/analysis" className="inline-flex h-11 items-center gap-2 rounded-xl border border-ink-200 bg-white px-5 text-sm font-medium text-ink-800 transition hover:border-ink-300 hover:bg-ink-50">
                  <BarChart3 className="h-4 w-4" /> 先看一次配置分析
                </Link>
              </div>
              <div className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-ink-500">
                <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-brand-600" />无需登录</span>
                <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-brand-600" />数据保存在本机</span>
                <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-brand-600" />断网可演示</span>
                <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-brand-600" />不推荐个股</span>
              </div>
            </div>

            <div className="relative">
              <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-br from-brand-100/60 via-sky-100/40 to-transparent blur-2xl" />
              <div className="overflow-hidden rounded-3xl border border-ink-200/80 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.12)]">
                <div className="flex items-center justify-between border-b border-ink-100 bg-ink-950 px-5 py-3.5 text-white">
                  <div>
                    <p className="text-[9px] uppercase tracking-[0.18em] text-brand-300">Decision Cockpit</p>
                    <p className="text-sm font-semibold">中性震荡 · 40.4 / 100</p>
                  </div>
                  <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] text-white/70">风险预算</span>
                </div>
                <div className="grid grid-cols-3 gap-px bg-ink-100">
                  {[
                    { label: "目标收益", value: "9.4%" },
                    { label: "目标波动", value: "9.4%" },
                    { label: "VaR 95%/月", value: "4.0%" },
                  ].map((item) => (
                    <div key={item.label} className="bg-white px-3 py-3">
                      <p className="text-[9px] uppercase tracking-wide text-ink-400">{item.label}</p>
                      <p className="tabular mt-1 text-base font-semibold text-ink-950">{item.value}</p>
                    </div>
                  ))}
                </div>
                <div className="space-y-3 px-5 py-4">
                  {[
                    { label: "中国权益", current: 57, target: 34.7, color: "#12b886" },
                    { label: "现金管理", current: 10, target: 15, color: "#94a3b8" },
                    { label: "中国债券", current: 12, target: 19.8, color: "#38bdf8" },
                    { label: "黄金", current: 8, target: 17.2, color: "#eab308" },
                  ].map((item) => (
                    <div key={item.label}>
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-ink-600">{item.label}</span>
                        <span className="tabular text-ink-400">{item.current}% → <b className="text-ink-900">{item.target}%</b></span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-100">
                        <div className="h-full rounded-full" style={{ width: `${item.target}%`, background: item.color }} />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="border-t border-ink-100 bg-ink-50/60 px-5 py-3 text-[10px] leading-relaxed text-ink-500">
                  目标权重由三套战略引擎集成，再经单只 ETF / 权益 / 海外 / 卫星上限与现金下限投影。所有数字来自本地量化引擎。
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-ink-200/60 bg-white/60">
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-px bg-ink-200/50 sm:grid-cols-4">
            {METRICS.map((item) => (
              <div key={item.label} className="bg-white px-5 py-5">
                <p className="text-[10px] uppercase tracking-[0.14em] text-ink-400">{item.label}</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight text-ink-950">{item.value}</p>
                <p className="mt-1 text-[10px] leading-relaxed text-ink-500">{item.hint}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="capability" className="mx-auto max-w-6xl px-5 py-16">
          <div className="max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-600">What it actually does</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-ink-950">不是聊天框，而是一条可验证的决策链</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-600">
              从信息采集到配置输出，每一步都有数据、公式与证据。模型负责解释，量化引擎负责计算，审查员负责挑错。
            </p>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {CAPABILITIES.map((item) => (
              <div key={item.title} className="rounded-2xl border border-ink-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><item.icon className="h-4 w-4" /></span>
                  <h3 className="text-sm font-semibold text-ink-950">{item.title}</h3>
                </div>
                <p className="mt-3 text-xs leading-relaxed text-ink-600">{item.desc}</p>
                <ul className="mt-3 space-y-1.5">
                  {item.points.map((point) => (
                    <li key={point} className="flex items-start gap-1.5 text-[11px] text-ink-500">
                      <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-brand-500" />
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section id="flow" className="border-y border-ink-200/60 bg-ink-950 py-16 text-white">
          <div className="mx-auto max-w-6xl px-5">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-300">Workflow</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight">五步从信息走到配置</h2>
              </div>
              <p className="max-w-md text-[11px] leading-relaxed text-white/55">
                演示时可以先在设置页刷新行情，再运行一次配置分析，最后启动多智能体生成研报。首次拉取约 30–60 秒，之后走本地缓存。
              </p>
            </div>
            <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {FLOW.map((item) => (
                <div key={item.step} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-[10px] font-semibold tracking-[0.16em] text-brand-300">{item.step}</p>
                  <p className="mt-2 text-sm font-medium">{item.title}</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-white/55">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-16">
          <div className="grid gap-4 lg:grid-cols-3">
            {[
              { icon: Wallet, title: "先照镜子", desc: "持仓、负债、收入、目标与风险画像；房产/保险计入总资产，但不强制再平衡。" },
              { icon: LineChart, title: "再做配置", desc: "三套战略引擎 + 战术倾斜 + 约束投影；目标权重与交易清单逐条可解释。" },
              { icon: FileText, title: "最后留痕", desc: "Agent 执行轨迹、HTML/PDF 研报、历史运行记录；所有数字可回到数据与公式。" },
            ].map((item) => (
              <div key={item.title} className="rounded-2xl border border-ink-200/80 bg-white p-5">
                <item.icon className="h-5 w-5 text-brand-600" />
                <h3 className="mt-3 text-sm font-semibold text-ink-950">{item.title}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-600">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="compliance" className="mx-auto max-w-6xl px-5 pb-20">
          <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-900"><ShieldCheck className="h-4 w-4" />建议边界</div>
            <p className="mt-2 text-xs leading-relaxed text-amber-800">
              本工具提供资产大类、策略权重、ETF/基金筛选与再平衡步骤；不推荐个股，不给目标价、止损位或买卖点，不承诺收益。
              所有回测、VaR 与压力测试均基于历史样本与假设，不代表未来。投资有风险，决策前请核对数据并咨询持牌专业人士。
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-amber-700">{DISCLAIMER_ZH}</p>
          </div>
        </section>
      </main>

      <footer className="border-t border-ink-200/70 bg-white/60">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-[11px] text-ink-400">
          <span>知衡 FinScope · 个人资产配置智能体 · 2026 软工实践周</span>
          <span className="inline-flex items-center gap-1.5"><Gauge className="h-3.5 w-3.5" />本地优先 · 可解释 · 可审计</span>
        </div>
      </footer>
    </div>
  );
}
