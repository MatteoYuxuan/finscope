import { prisma } from "../src/lib/db";
import { seedDemoData } from "../src/lib/services/seed";

/**
 * 演示数据种子脚本。
 * 运行：npm run db:seed
 * 全部为虚构数据（公司、机构、金额均为示例），不包含任何真实客户信息。
 */
async function main() {
  const startedAt = Date.now();
  console.log("[seed] 开始写入虚构演示数据…");
  const result = await seedDemoData();
  console.log("[seed] 结果：", JSON.stringify(result, null, 2));
  console.log(`[seed] 完成，用时 ${Date.now() - startedAt} ms`);
  console.log("[seed] 提示：如需从零重建，先运行 npm run db:reset。");
}

main()
  .catch((error) => {
    console.error("[seed] 失败：", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
