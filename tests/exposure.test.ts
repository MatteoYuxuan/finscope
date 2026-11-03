import { describe, expect, it } from "vitest";
import { mapExposure } from "@/lib/rules/exposure";
import type { AssetLike, TopicLike } from "@/lib/types/domain";

const assets: AssetLike[] = [
  { id: "a1", name: "美股科技 ETF", category: "FUND", currency: "USD", amount: 8000, industry: "科技" },
  { id: "a2", name: "工资卡活期", category: "CASH", currency: "CNY", amount: 10000 },
  { id: "a3", name: "半导体主题基金", category: "FUND", currency: "CNY", amount: 5000, industry: "半导体" },
];

const fxTopic: TopicLike = {
  id: "t1",
  slug: "fx-usdcny",
  name: "人民币汇率",
  kind: "fx",
  keywords: ["美元", "汇率"],
  color: "#0ea5e9",
};

const semiTopic: TopicLike = {
  id: "t2",
  slug: "industry-semi",
  name: "半导体",
  kind: "industry",
  keywords: ["半导体", "芯片"],
  color: "#6366f1",
};

describe("情报与资产关联", () => {
  it("汇率主题只匹配外币资产", () => {
    const exposure = mapExposure(assets, [fxTopic]);
    expect(exposure).toHaveLength(1);
    expect(exposure[0].matchedAssets.map((asset) => asset.id)).toEqual(["a1"]);
    // 总资产 = 8000 美元 × 7.15 + 10000 + 5000 = 72200 元
    expect(exposure[0].exposureShare).toBeCloseTo(57200 / 72200, 4);
  });

  it("行业主题按资产行业标签匹配", () => {
    const exposure = mapExposure(assets, [semiTopic]);
    const ids = exposure[0].matchedAssets.map((asset) => asset.id);
    expect(ids).toContain("a3");
    expect(exposure[0].note).toContain("粗粒度");
  });

  it("多主题按暴露占比降序排列", () => {
    const exposure = mapExposure(assets, [fxTopic, semiTopic]);
    expect(exposure.length).toBe(2);
    expect(exposure[0].exposureShare).toBeGreaterThanOrEqual(exposure[1].exposureShare);
  });

  it("没有匹配资产的主题不会出现在结果里", () => {
    const unrelated: TopicLike = {
      id: "t3",
      slug: "commodity-oil",
      name: "原油",
      kind: "commodity",
      keywords: ["原油", "油价"],
    };
    expect(mapExposure(assets, [unrelated])).toEqual([]);
  });

  it("资产为空时暴露占比为 0，不产生 NaN", () => {
    const exposure = mapExposure([], [fxTopic]);
    expect(exposure).toEqual([]);
  });
});
