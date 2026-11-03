import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "知衡 FinScope · 个人资产配置智能体",
    template: "%s · 知衡 FinScope",
  },
  description:
    "把真实 ETF 行情、宏观、利率汇率与你的持仓、负债、目标放进同一套约束，用风险平价、均值方差、Black-Litterman 与多智能体给出资产配置建议、风险分析和可追溯研报。",
  keywords: ["资产配置", "ETF", "风险平价", "Black-Litterman", "VaR", "个人理财", "智能体", "软件工程实践"],
  applicationName: "知衡 FinScope",
  authors: [{ name: "知衡 FinScope 团队" }],
  openGraph: {
    title: "知衡 FinScope · 个人资产配置智能体",
    description: "从信息到配置：真实数据、可解释量化、多智能体审计与 PDF 研报。",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b1220",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:shadow-lg"
        >
          跳到主要内容
        </a>
        {children}
      </body>
    </html>
  );
}
