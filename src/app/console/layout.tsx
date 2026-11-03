import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Sidebar } from "@/components/console/sidebar";
import { DISCLAIMER_ZH } from "@/lib/constants";

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen lg:pl-60">
      <Sidebar />
      <div className="mx-auto max-w-6xl px-4 pb-16 pt-4 sm:px-6 lg:pt-7">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-ink-200/70 pb-3 text-[11px] text-ink-500">
          <span className="leading-relaxed">
            工作台 · 数据保存在本机 <span className="text-ink-400">workspace</span>
          </span>
          <Link href="/" className="inline-flex items-center gap-1 text-ink-600 hover:text-ink-900">
            返回首页
            <ArrowUpRight className="h-3 w-3" aria-hidden />
          </Link>
        </div>

        <main id="main">{children}</main>

        <footer className="mt-10 border-t border-ink-200/70 pt-4">
          <p className="text-[11px] leading-relaxed text-ink-400">{DISCLAIMER_ZH}</p>
        </footer>
      </div>
    </div>
  );
}
