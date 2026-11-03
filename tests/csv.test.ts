import { describe, expect, it } from "vitest";
import { parseAssetCsv } from "@/lib/rules/csv";

const CSV = `name,category,currency,amount,institution,industry,liquidity,maturityMonths,note
工资卡活期,现金,人民币,12000,示例银行,,HIGH,,
指数基金,基金,CNY,30000,,宽基指数,MEDIUM,,
一年期定存,存款,CNY,60000,示例银行,,LOW,8,示例
坏数据,现金,CNY,-500,,,,
`;

describe("资产 CSV 导入", () => {
  const parsed = parseAssetCsv(CSV);

  it("识别全部列，无缺列", () => {
    expect(parsed.missingColumns).toEqual([]);
    expect(parsed.totalCount).toBe(4);
    expect(parsed.validCount).toBe(3);
    expect(parsed.invalidCount).toBe(1);
  });

  it("中文类别 / 币种 / 流动性别名可归一化", () => {
    const first = parsed.rows[0].value;
    expect(first?.category).toBe("CASH");
    expect(first?.currency).toBe("CNY");
    expect(first?.liquidity).toBe("HIGH");
    expect(first?.amount).toBe(12000);
  });

  it("坏行不阻塞好行，错误信息带行号与原因", () => {
    const bad = parsed.rows.find((row) => row.value === null);
    expect(bad).toBeDefined();
    expect(bad?.line).toBe(5);
    expect(bad?.errors.join("")).toMatch(/金额/);
  });

  it("缺列时给出明确提示，且整表不可导入", () => {
    const broken = parseAssetCsv("title,amount\n某资产,100\n");
    expect(broken.missingColumns.length).toBeGreaterThan(0);
    expect(broken.validCount).toBe(0);
  });

  it("空文件返回全部缺列而不是抛错", () => {
    const empty = parseAssetCsv("");
    expect(empty.missingColumns.length).toBeGreaterThan(0);
    expect(empty.rows).toEqual([]);
  });

  it("数字带千分位与货币符号仍可解析", () => {
    const result = parseAssetCsv(
      "name,category,currency,amount\n现金A,现金,CNY,\"12,000\"\n现金B,现金,CNY,\"¥3,000\"\n",
    );
    expect(result.validCount).toBe(2);
    expect(result.rows[1].value?.amount).toBe(3000);
  });

  it("支持 BOM 开头的文件（Excel 导出常见）", () => {
    const result = parseAssetCsv(`\uFEFF${CSV}`);
    expect(result.missingColumns).toEqual([]);
    expect(result.validCount).toBe(3);
  });
});
