import { describe, expect, it } from "vitest";
import {
  centsToYuan,
  clamp,
  formatCny,
  formatCompactYuan,
  formatPercent,
  formatYuan,
  parseAmount,
  round2,
  safeCents,
  toCents,
} from "@/lib/rules/money";

describe("整数分运算", () => {
  it("把元转换成整数分，避免浮点误差", () => {
    expect(toCents(12.34)).toBe(1234);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(centsToYuan(12345)).toBe(123.45);
  });

  it("遇到非有限数字抛 AMOUNT_NOT_FINITE", () => {
    expect(() => toCents(Number.NaN)).toThrow("AMOUNT_NOT_FINITE");
    expect(() => toCents(Number.POSITIVE_INFINITY)).toThrow("AMOUNT_NOT_FINITE");
  });

  it("超出安全整数范围抛 AMOUNT_OVERFLOW", () => {
    expect(() => toCents(1e16)).toThrow("AMOUNT_OVERFLOW");
  });

  it("safeCents 在异常时返回 0，不污染聚合结果", () => {
    expect(safeCents(Number.NaN)).toBe(0);
    expect(safeCents(99.9)).toBe(9990);
  });

  it("round2 四舍五入到两位小数", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.675)).toBe(2.68);
  });
});

describe("金额输入解析", () => {
  it("支持千分位、货币符号、中文单位与全角数字", () => {
    expect(parseAmount("1,234.56")).toBe(1234.56);
    expect(parseAmount("¥1234")).toBe(1234);
    expect(parseAmount("1234元")).toBe(1234);
    expect(parseAmount("1.2万")).toBe(12000);
    expect(parseAmount("3亿")).toBe(300000000);
    expect(parseAmount("１２３４")).toBe(1234);
    expect(parseAmount(" 12,345 元 ")).toBe(12345);
  });

  it("允许负数（用于演示错误数据校验），非法输入返回 null", () => {
    expect(parseAmount("-500")).toBe(-500);
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("1.2.3")).toBeNull();
    expect(parseAmount(null)).toBeNull();
  });

  it("数字输入统一保留两位小数", () => {
    expect(parseAmount(1234.567)).toBe(1234.57);
    expect(parseAmount(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("金额展示", () => {
  it("千分位与紧凑单位", () => {
    expect(formatYuan(1234567.891)).toBe("1,234,567.89");
    expect(formatCompactYuan(12500)).toBe("1.25 万");
    expect(formatCompactYuan(320000000)).toBe("3.2 亿");
    expect(formatCompactYuan(999)).toBe("999");
    expect(formatCny(12500)).toBe("1.25 万元");
  });

  it("百分比遇到 null 显示破折号，不显示 NaN", () => {
    expect(formatPercent(0.4261)).toBe("42.6%");
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(Number.NaN)).toBe("—");
  });

  it("clamp 限制区间", () => {
    expect(clamp(1.5, 0, 1)).toBe(1);
    expect(clamp(-1, 0, 1)).toBe(0);
  });
});
