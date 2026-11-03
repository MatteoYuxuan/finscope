/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // 本项目未安装 ESLint，构建期跳过 lint；类型检查由 `npm run typecheck` 单独把关。
  eslint: { ignoreDuringBuilds: true },
  // 说明：本作品全部数据本地 Mock/SQLite，无需远程图片域名白名单
  images: { unoptimized: true },
};

export default nextConfig;
