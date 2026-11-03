"use client";

import { AlertTriangle, CircleAlert, Info } from "lucide-react";
import { cn } from "@/lib/client/api";
import type { Finding, FindingLevel } from "@/lib/types/domain";

const LEVEL_META: Record<FindingLevel, { label: string; tone: string; ring: string; icon: typeof Info }> = {
  risk: { label: "重点", tone: "text-red-700", ring: "border-red-200 bg-red-50/60", icon: CircleAlert },
  warn: { label: "关注", tone: "text-amber-700", ring: "border-amber-200 bg-amber-50/60", icon: AlertTriangle },
  info: { label: "提示", tone: "text-sky-700", ring: "border-sky-200 bg-sky-50/60", icon: Info },
};

export function FindingCard({ finding, compact = false }: { finding: Finding; compact?: boolean }) {
  const meta = LEVEL_META[finding.level] ?? LEVEL_META.info;
  const Icon = meta.icon;
  return (
    <li className={cn("rounded-xl border px-3.5 py-3", meta.ring)}>
      <div className="flex items-start gap-2.5">
        <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", meta.tone)} aria-hidden />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[13px] font-semibold text-ink-900">{finding.title}</p>
            <span className={cn("rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] font-medium", meta.tone)}>{meta.label}</span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-600">{finding.detail}</p>
          {!compact ? (
            <>
              <p className="mt-1.5 rounded-lg bg-white/70 px-2 py-1 font-mono text-[10px] leading-relaxed text-ink-500">
                证据：{finding.evidence}
              </p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-ink-700">
                <span className="font-medium">待办：</span>
                {finding.todo}
              </p>
            </>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function FindingList({ findings, compact = false }: { findings: Finding[]; compact?: boolean }) {
  if (findings.length === 0) {
    return <p className="rounded-xl border border-ink-200 bg-white px-4 py-6 text-center text-xs text-ink-400">暂无提示项</p>;
  }
  return (
    <ul className="space-y-2">
      {findings.map((finding) => (
        <FindingCard key={finding.id} finding={finding} compact={compact} />
      ))}
    </ul>
  );
}

export function LevelSummary({ counts }: { counts: Record<FindingLevel, number> }) {
  const items: { key: FindingLevel; label: string; className: string }[] = [
    { key: "risk", label: "重点", className: "bg-red-50 text-red-700 border-red-200" },
    { key: "warn", label: "关注", className: "bg-amber-50 text-amber-700 border-amber-200" },
    { key: "info", label: "提示", className: "bg-sky-50 text-sky-700 border-sky-200" },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span key={item.key} className={cn("rounded-full border px-2.5 py-0.5 text-[11px]", item.className)}>
          {item.label} {counts[item.key] ?? 0}
        </span>
      ))}
    </div>
  );
}
