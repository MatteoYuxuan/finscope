"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BarChart3,
  Bot,
  FileText,
  LayoutDashboard,
  Menu,
  Radar,
  Settings,
  Wallet,
  X,
} from "lucide-react";
import { cn } from "@/lib/client/api";

const NAV = [
  {
    group: "工作台",
    items: [
      { href: "/console", label: "总览", icon: LayoutDashboard, exact: true },
      { href: "/console/agent", label: "智能决策", icon: Bot },
      { href: "/console/analysis", label: "配置分析", icon: BarChart3 },
    ],
  },
  {
    group: "我的资产",
    items: [
      { href: "/console/portfolio", label: "持仓与目标", icon: Wallet },
      { href: "/console/research", label: "市场与宏观", icon: Radar },
    ],
  },
  {
    group: "产出",
    items: [
      { href: "/console/reports", label: "研报与记录", icon: FileText },
      { href: "/console/settings", label: "设置", icon: Settings },
    ],
  },
];

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const content = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2.5" onClick={() => setOpen(false)}>
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink-950 text-sm font-bold text-brand-300">衡</span>
          <span className="leading-tight">
            <span className="block text-sm font-semibold tracking-tight text-ink-950">知衡 FinScope</span>
            <span className="block text-[10px] text-ink-400">资产配置智能体</span>
          </span>
        </Link>
        <button
          className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 lg:hidden"
          onClick={() => setOpen(false)}
          aria-label="关闭菜单"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <nav className="scroll-thin flex-1 overflow-y-auto px-3 pb-4" aria-label="工作台导航">
        {NAV.map((group) => (
          <div key={group.group} className="mb-4">
            <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">{group.group}</p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(pathname, item.href, item.exact);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] transition",
                        active
                          ? "bg-ink-950 font-medium text-white shadow-sm"
                          : "text-ink-600 hover:bg-ink-100 hover:text-ink-900",
                      )}
                    >
                      <item.icon className={cn("h-4 w-4", active ? "text-brand-300" : "text-ink-400")} aria-hidden />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="space-y-2 border-t border-ink-100 p-3">
        <p className="px-1 text-[10px] leading-relaxed text-ink-400">
          本地优先 · 真实 ETF 行情 + 可解释量化 + 多智能体审计。投资有风险，建议仅供参考。
        </p>
      </div>
    </div>
  );

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-ink-200/70 bg-white/85 backdrop-blur lg:block">
        {content}
      </aside>

      <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-ink-200/70 bg-white/90 px-4 backdrop-blur lg:hidden">
        <button
          className="inline-flex items-center gap-2 rounded-lg border border-ink-200 px-2.5 py-1.5 text-xs text-ink-700"
          onClick={() => setOpen(true)}
          aria-label="打开菜单"
        >
          <Menu className="h-4 w-4" />
          菜单
        </button>
        <span className="text-xs font-semibold text-ink-900">知衡 FinScope</span>
        <span className="w-10" aria-hidden />
      </div>

      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink-950/30 backdrop-blur-sm" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute inset-y-0 left-0 w-64 bg-white shadow-2xl">{content}</div>
        </div>
      ) : null}
    </>
  );
}
