import { describe, expect, it } from "vitest";
import { DEMO_FX_RATES } from "@/lib/constants";
import {
  UnknownCurrencyError,
  convertToCny,
  convertToCnyCents,
  describeFxTable,
  fxRate,
  isCurrency,
  sumCnyCents,
} from "@/lib/rules/fx";

describe("演示汇率折算", () => {
  it("人民币不折算，美元按 7.15", () => {
    expect(convertToCny(100, "CNY")).toBe(100);
    expect(convertToCny(100, "USD")).toBe(715);
    expect(fxRate("USD")).toBe(DEMO_FX_RATES.USD);
  });

  it("折算走整数分，结果可复现", () => {
    expect(convertToCnyCents(100, "USD")).toBe(71500);
    expect(convertToCny(0.01, "JPY")).toBe(0);
    expect(convertToCny(1000, "HKD")).toBe(920);
  });

  it("多币种求和：100 美元 + 100 人民币 = 815 元", () => {
    expect(
      sumCnyCents([
        { amount: 100, currency: "USD" },
        { amount: 100, currency: "CNY" },
      ]),
    ).toBe(81500);
  });

  it("未知币种抛 UnknownCurrencyError，而不是静默算错", () => {
    expect(isCurrency("GBP")).toBe(false);
    expect(() => fxRate("GBP")).toThrow(UnknownCurrencyError);
    try {
      convertToCny(100, "GBP");
    } catch (error) {
      expect(error).toBeInstanceOf(UnknownCurrencyError);
      expect((error as UnknownCurrencyError).currency).toBe("GBP");
      expect((error as Error).message).toContain("不支持的币种");
    }
  });

  it("汇率表覆盖五种演示币种", () => {
    expect(describeFxTable()).toHaveLength(5);
  });
});
