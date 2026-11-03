"use client";

import { cn } from "@/lib/client/api";
import { DISCLAIMER_ZH } from "@/lib/constants";
import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

/* ---------------------------------- Button --------------------------------- */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-ink-950 text-white hover:bg-ink-800 disabled:bg-ink-400 shadow-sm shadow-ink-950/10",
  secondary:
    "bg-white text-ink-800 border border-ink-200 hover:border-ink-300 hover:bg-ink-50 disabled:text-ink-400",
  ghost: "text-ink-600 hover:bg-ink-100 hover:text-ink-900 disabled:text-ink-400",
  danger: "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-xl font-medium transition-colors",
        "disabled:cursor-not-allowed",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : null}
      {children}
    </button>
  );
}

/* ----------------------------------- Card ---------------------------------- */

export function Card({
  className,
  children,
  as: Tag = "section",
}: {
  className?: string;
  children: ReactNode;
  as?: "section" | "div" | "article";
}) {
  return (
    <Tag className={cn("rounded-2xl border border-ink-200/80 bg-white/90 shadow-[0_1px_2px_rgba(15,23,42,0.04)]", className)}>
      {children}
    </Tag>
  );
}

export function CardHead({
  title,
  desc,
  right,
  className,
}: {
  title: ReactNode;
  desc?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 px-5 py-4", className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight text-ink-900">{title}</h2>
        {desc ? <p className="mt-1 text-xs leading-relaxed text-ink-500">{desc}</p> : null}
      </div>
      {right ? <div className="flex shrink-0 items-center gap-2">{right}</div> : null}
    </div>
  );
}

/* ---------------------------------- Badge ---------------------------------- */

const BADGE_TONES = {
  neutral: "bg-ink-100 text-ink-600 border-ink-200",
  brand: "bg-brand-50 text-brand-700 border-brand-200",
  info: "bg-sky-50 text-sky-700 border-sky-200",
  warn: "bg-amber-50 text-amber-700 border-amber-200",
  danger: "bg-red-50 text-red-700 border-red-200",
  dark: "bg-ink-900 text-white border-ink-900",
} as const;

export type BadgeTone = keyof typeof BADGE_TONES;

export function Badge({
  children,
  tone = "neutral",
  className,
  title,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4",
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function ModeBadge({ mode }: { mode?: "mock" | "llm" | "fallback" | string }) {
  const tone: BadgeTone = mode === "llm" ? "brand" : mode === "fallback" ? "warn" : "neutral";
  const label = mode === "llm" ? "模型整理" : mode === "fallback" ? "规则兜底" : "规则整理";
  return (
    <Badge tone={tone} title="规则模式不依赖外部接口，可离线使用；配置模型后会自动升级">
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </Badge>
  );
}


/* --------------------------------- StatCard -------------------------------- */

export function StatCard({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "neutral" | "brand" | "warn" | "danger";
}) {
  const valueTone =
    tone === "danger" ? "text-red-600" : tone === "warn" ? "text-amber-600" : tone === "brand" ? "text-brand-700" : "text-ink-950";
  return (
    <div className="rounded-2xl border border-ink-200/80 bg-white/90 px-4 py-3.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-500">{label}</p>
      <p className={cn("tabular mt-1.5 text-xl font-semibold tracking-tight", valueTone)}>{value}</p>
      {hint ? <p className="mt-1 text-[11px] leading-relaxed text-ink-400">{hint}</p> : null}
    </div>
  );
}

/* --------------------------------- Fields ---------------------------------- */

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 flex items-center gap-1 text-xs font-medium text-ink-700">
        {label}
        {required ? <span className="text-red-500">*</span> : null}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block text-[11px] text-red-600">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-[11px] text-ink-400">{hint}</span>
      ) : null}
    </label>
  );
}

const CONTROL =
  "w-full rounded-xl border border-ink-200 bg-white px-3 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-ink-50";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(CONTROL, "h-10", className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(CONTROL, "h-10 appearance-none pr-8", className)} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(CONTROL, "min-h-[92px] py-2 leading-relaxed", className)} {...props} />;
}

/* -------------------------------- Feedback --------------------------------- */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-ink-100", className)} aria-hidden />;
}

export function SkeletonBlock({ lines = 4, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-2.5 p-5", className)} aria-label="加载中">
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton key={index} className={cn("h-3.5", index === 0 ? "w-1/3" : index % 2 ? "w-11/12" : "w-full")} />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  desc,
  action,
  icon,
}: {
  title: string;
  desc?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-2xl bg-ink-100 text-ink-400">
        {icon ?? "◌"}
      </div>
      <p className="text-sm font-medium text-ink-800">{title}</p>
      {desc ? <p className="max-w-md text-xs leading-relaxed text-ink-500">{desc}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
      <span className="leading-relaxed">⚠ {message}</span>
      {onRetry ? (
        <button onClick={onRetry} className="rounded-lg border border-red-200 bg-white px-2.5 py-1 font-medium hover:bg-red-100">
          重试
        </button>
      ) : null}
    </div>
  );
}

export function InfoNote({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  return (
    <div
      className={cn(
        "rounded-xl border px-3.5 py-2.5 text-[11px] leading-relaxed",
        tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-sky-100 bg-sky-50/70 text-sky-800",
      )}
    >
      {children}
    </div>
  );
}

/* -------------------------------- Disclaimer ------------------------------- */

export function DisclaimerBar({ className }: { className?: string }) {
  return (
    <p className={cn("rounded-xl border border-ink-200/70 bg-ink-50/80 px-3.5 py-2.5 text-[11px] leading-relaxed text-ink-500", className)}>
      <span className="font-medium text-ink-600">免责声明：</span>
      {DISCLAIMER_ZH}
    </p>
  );
}

/* --------------------------------- Section --------------------------------- */

export function SectionHeading({
  eyebrow,
  title,
  desc,
  right,
}: {
  eyebrow?: string;
  title: string;
  desc?: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow ? <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-600">{eyebrow}</p> : null}
        <h1 className="text-xl font-semibold tracking-tight text-ink-950">{title}</h1>
        {desc ? <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-500">{desc}</p> : null}
      </div>
      {right ? <div className="flex flex-wrap items-center gap-2">{right}</div> : null}
    </div>
  );
}

export function Progress({
  value,
  tone = "brand",
}: {
  value: number;
  tone?: "brand" | "warn" | "danger" | "ink" | "info";
}) {
  const color =
    tone === "danger"
      ? "bg-red-500"
      : tone === "warn"
        ? "bg-amber-500"
        : tone === "ink"
          ? "bg-ink-700"
          : tone === "info"
            ? "bg-sky-500"
            : "bg-brand-500";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
      <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}
