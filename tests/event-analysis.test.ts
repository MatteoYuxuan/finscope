import { describe, expect, it } from "vitest";
import {
  buildRuleEventAnalysis,
  normalizeAnalysisArticleIds,
  type AnalysisArticleInput,
} from "@/lib/rules/event-analysis";
import type { ArticleClaim, ArticleEventType, ExtractedEntity, KeyNumber } from "@/lib/types/domain";

function article(overrides: Partial<AnalysisArticleInput> & { id: string }): AnalysisArticleInput {
  return {
    id: overrides.id,
    title: overrides.title ?? `报道 ${overrides.id}`,
    summary: overrides.summary ?? "材料摘要",
    publishedAt: overrides.publishedAt ?? "2026-10-30T02:00:00.000Z",
    url: overrides.url ?? "https://demo.invalid/a",
    sourceName: overrides.sourceName ?? "示例来源",
    sourceCredibility: overrides.sourceCredibility ?? 4,
    qualityScore: overrides.qualityScore ?? 80,
    eventType: (overrides.eventType ?? "macro_data") as ArticleEventType,
    entities: (overrides.entities ?? []) as ExtractedEntity[],
    keyNumbers: (overrides.keyNumbers ?? []) as KeyNumber[],
    claims: (overrides.claims ?? []) as ArticleClaim[],
    topics: overrides.topics ?? [],
  };
}

function number(label: string, value: number, unit: string, context?: string): KeyNumber {
  return { label, value, unit, ...(context ? { context } : {}) };
}

describe("事件级规则分析", () => {
  it("同一指标不同来源的数值差异会形成“数据口径”分歧", () => {
    const analysis = buildRuleEventAnalysis({
      eventTitle: "三季度 GDP 数据发布",
      articles: [
        article({
          id: "a1",
          sourceName: "宏观观察站",
          keyNumbers: [number("贡献率", 58, "%", "最终消费支出贡献率约为 58%")],
          claims: [{ kind: "fact", text: "统计局发布三季度数据" }],
        }),
        article({
          id: "a2",
          sourceName: "经济参考速递",
          keyNumbers: [number("贡献率", 55, "%", "券商测算贡献率约 55%")],
          claims: [{ kind: "estimate", text: "券商测算贡献率约 55%" }],
        }),
      ],
    });

    expect(analysis.disagreements).toHaveLength(1);
    expect(analysis.disagreements[0].nature).toBe("数据口径");
    expect(analysis.disagreements[0].positions).toHaveLength(2);
    expect(analysis.disagreements[0].positions.map((item) => item.stance).join("|")).toContain("58%");
    expect(analysis.disagreements[0].positions.map((item) => item.stance).join("|")).toContain("55%");
  });

  it("过渡期长度差异会形成“时间安排”分歧", () => {
    const analysis = buildRuleEventAnalysis({
      eventTitle: "信息披露指引过渡期",
      articles: [
        article({
          id: "p1",
          sourceName: "监管政策发布",
          eventType: "policy",
          keyNumbers: [number("过渡期", 6, "个月")],
        }),
        article({
          id: "p2",
          sourceName: "监管观察周报",
          eventType: "policy",
          keyNumbers: [number("过渡期", 12, "个月")],
        }),
      ],
    });

    expect(analysis.disagreements).toHaveLength(1);
    expect(analysis.disagreements[0].nature).toBe("时间安排");
    expect(analysis.disagreements[0].topic).toContain("过渡期");
  });

  it("传闻与澄清会形成事实描述分歧，并保留原文引用", () => {
    const analysis = buildRuleEventAnalysis({
      eventTitle: "恒启科技订单传闻",
      articles: [
        article({
          id: "r1",
          sourceName: "市井财经爆料",
          sourceCredibility: 1,
          eventType: "rumor",
          claims: [{ kind: "claim", text: "据传恒启科技将获大额订单。" }],
        }),
        article({
          id: "r2",
          sourceName: "公司公告聚合",
          sourceCredibility: 5,
          eventType: "company_event",
          claims: [{ kind: "denial", text: "恒启科技澄清：未获 12 亿元订单，相关传闻不实。" }],
        }),
      ],
    });

    expect(analysis.disagreements).toHaveLength(1);
    expect(analysis.disagreements[0].topic).toBe("传闻与澄清");
    expect(analysis.disagreements[0].nature).toBe("事实描述");
    expect(analysis.disagreements[0].positions).toHaveLength(2);
    expect(analysis.disagreements[0].positions[1].quote).toContain("澄清");
  });

  it("单篇报道不会制造分歧，时间线与信息缺口仍然生成", () => {
    const analysis = buildRuleEventAnalysis({
      eventTitle: "单篇公司公告",
      articles: [
        article({
          id: "s1",
          eventType: "company_event",
          keyNumbers: [number("营收", 12.6, "亿元")],
          claims: [{ kind: "fact", text: "公司披露上半年营收 12.6 亿元。" }],
        }),
      ],
    });

    expect(analysis.disagreements).toHaveLength(0);
    expect(analysis.timeline).toHaveLength(1);
    expect(analysis.gaps.length).toBeGreaterThan(0);
    expect(analysis.confidenceNote).toContain("不代表事实认定");
  });

  it("清洗模型输出：剔除事件外文章 id，并丢弃不足两个立场的分歧", () => {
    const base = buildRuleEventAnalysis({
      eventTitle: "清洗测试",
      articles: [article({ id: "a1" }), article({ id: "a2" })],
    });

    const normalized = normalizeAnalysisArticleIds(
      {
        ...base,
        consensus: [{ point: "共同提到 GDP", articleIds: ["a1", "outside"] }],
        disagreements: [
          {
            topic: "假分歧",
            nature: "数据口径",
            positions: [
              { stance: "来源甲 58%", articleIds: ["a1"], sourceNames: ["来源甲"] },
              { stance: "来源乙 55%", articleIds: ["outside"], sourceNames: ["来源乙"] },
            ],
          },
        ],
        timeline: [
          { at: "2026-10-30T02:00:00.000Z", label: "节点一", articleId: "a1" },
          { at: "not-a-date", label: "坏节点" },
        ],
      },
      new Set(["a1", "a2"]),
    );

    expect(normalized.consensus[0].articleIds).toEqual(["a1"]);
    expect(normalized.disagreements).toHaveLength(0);
    expect(normalized.timeline).toHaveLength(1);
    expect(normalized.timeline[0].articleId).toBe("a1");
  });
});
