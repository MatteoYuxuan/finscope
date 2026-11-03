import { describe, expect, it } from "vitest";
import { rankPassages, toCitations } from "@/lib/llm/retrieve";
import type { Passage } from "@/lib/llm/retrieve";

const passages: Passage[] = [
  {
    id: "article:semi",
    type: "article",
    label: "半导体出口数据",
    text: "示例资讯：半导体出口连续三个月回升，设备与材料环节的订单同步改善。",
    meta: { sourceName: "行业前沿简报" },
  },
  {
    id: "article:estate",
    type: "article",
    label: "房地产市场运行",
    text: "示例资讯：房地产市场销售面积同比继续回落，部分城市库存去化周期拉长。",
    meta: { sourceName: "宏观观察站" },
  },
  {
    id: "asset:1",
    type: "asset",
    label: "美股科技 ETF",
    text: "资产条目：美股科技 ETF，类别基金，币种 USD，金额 8000。",
  },
];

describe("BM25 检索", () => {
  it("查询词命中哪条，哪条排第一", () => {
    const ranked = rankPassages("半导体 出口", passages);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0].passage.id).toBe("article:semi");
    expect(ranked[0].matchedTerms.length).toBeGreaterThan(0);
  });

  it("返回条数受 topK 限制", () => {
    const ranked = rankPassages("示例", passages, 2);
    expect(ranked.length).toBeLessThanOrEqual(2);
  });

  it("无命中词或空文档时返回空数组", () => {
    expect(rankPassages("完全不相关的词汇xyz", passages)).toEqual([]);
    expect(rankPassages("半导体", [])).toEqual([]);
    expect(rankPassages("", passages)).toEqual([]);
  });

  it("引用编号从 1 开始，并携带摘要", () => {
    const citations = toCitations(rankPassages("半导体", passages));
    expect(citations[0].label).toMatch(/^1\. /);
    expect(citations[0].snippet?.length).toBeGreaterThan(0);
    expect(citations[0].type).toBe("article");
  });
});
