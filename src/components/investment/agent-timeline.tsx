"use client";

import { Bot, CheckCircle2, FileText, Gauge, LineChart as LineIcon, Radar, ShieldCheck, Sparkles, Wallet } from "lucide-react";
import { Badge, Card, CardHead } from "@/components/ui";
import type { AgentStep } from "@/lib/types/investment";

const ROLE_ICON: Record<string, typeof Bot> = {
  Planner: Sparkles,
  "Data & Quant": LineIcon,
  "Macro Analyst": Radar,
  "Portfolio Analyst": Wallet,
  "Risk Manager": ShieldCheck,
  "Goal Planner": Gauge,
  "Portfolio Manager": Bot,
  "Risk Critic": CheckCircle2,
  "Report Writer": FileText,
};

const TYPE_TONE: Record<string, "brand" | "info" | "warn" | "neutral" | "danger"> = {
  plan: "neutral",
  tool: "info",
  analysis: "brand",
  synthesis: "brand",
  reflection: "warn",
  artifact: "info",
};

export function AgentTimeline({ steps, mode, model }: { steps: AgentStep[]; mode?: string; model?: string | null }) {
  return (
    <Card>
      <CardHead
        title="智能体执行轨迹"
        desc="每个角色只读取确定性结果，数字由量化引擎产出；审查员在最后检查越界与一致性。"
        right={
          <div className="flex items-center gap-2">
            <Badge tone={mode === "llm" ? "brand" : "warn"}>{mode === "llm" ? "LLM 多智能体" : mode === "fallback" ? "LLM 失败 · 规则兜底" : "规则智能体"}</Badge>
            {model ? <span className="text-[10px] text-ink-400">{model}</span> : null}
          </div>
        }
      />
      <ol className="relative space-y-0 px-5 py-4">
        {steps.map((step, index) => {
          const Icon = ROLE_ICON[step.role] ?? Bot;
          const tone = TYPE_TONE[step.type] ?? "neutral";
          return (
            <li key={step.id ?? `${step.seq}-${index}`} className="relative flex gap-3 pb-5 last:pb-0">
              {index < steps.length - 1 ? <span className="absolute left-[15px] top-8 h-[calc(100%-1rem)] w-px bg-ink-100" aria-hidden /> : null}
              <span className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-ink-200 bg-white text-ink-500">
                <Icon className="h-3.5 w-3.5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-semibold text-ink-900">{step.role}</span>
                  <Badge tone={tone}>{step.type}</Badge>
                  {step.tool_name ? <span className="text-[10px] text-ink-400">tool: {step.tool_name}</span> : null}
                  {step.latency_ms ? <span className="text-[10px] text-ink-400">{step.latency_ms}ms</span> : null}
                </div>
                <p className="mt-1 text-xs font-medium text-ink-700">{step.title}</p>
                {step.detail ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[11px] text-ink-400 hover:text-ink-600">查看输出</summary>
                    <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-ink-50/80 p-2.5 text-[11px] leading-relaxed text-ink-600">{step.detail}</pre>
                  </details>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
