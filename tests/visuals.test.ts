import { describe, expect, it } from "vitest";
import { DISCLAIMER_ZH } from "@/lib/constants";
import { liabilityMix, computePortfolioMetrics } from "@/lib/rules/metrics";
import type { AssetLike, LiabilityLike } from "@/lib/types/domain";
import {
  buildEventCandidates,
  buildExposureCandidates,
  buildIntelCandidates,
  buildPortfolioCandidates,
  buildTopicCandidates,
  clampSelectionCount,
  describeCandidates,
} from "@/lib/visuals/catalog";
import { mockVisualSelect } from "@/lib/llm/mock";

const assets: AssetLike[] = [
  { name: "工资卡活期", category: "CASH", currency: "CNY", amount: 10000, liquidity: "HIGH" },
  { name: "沪深300指数基金", category: "STOCK", currency: "CNY", amount: 20000, industry: "宽基指数" },
  { name: "美股科技ETF", category: "FUND", currency: "USD", amount: 1000, industry: "科技", maturityMonths: 60 },
];
const liabilities: LiabilityLike[] = [
  { name: "消费分期", category: "CONSUMER_LOAN", currency: "CNY", amount: 5000, interestRate: 9.5, monthlyPayment: 500, remainingMonths: 10 },
];

const metrics = computePortfolioMetrics({ assets, liabilities, monthlySpend: 5000 });
const portfolioCandidates = buildPortfolioCandidates({
  metrics,
  liabilityMix: liabilityMix(liabilities),
  findings: [
    {
      id: "CONCENTRATION_CATEGORY",
      level: "risk",
      title: "类别集中度偏高",
      detail: "权益类资产占比超过参考区间。",
      evidence: "topCategoryShare = 73.1%",
      todo: "核对是否需要分散到其他类别",
    },
  ],
});

describe("chart spec 候选（资产结构）", () => {
  it("生成占比、流动性、期限、指标与风险矩阵等候选", () => {
    const ids = portfolioCandidates.map((item) => item.id);
    expect(ids).toContain("pf-category");
    expect(ids).toContain("pf-currency");
    expect(ids).toContain("pf-structure");
    expect(ids).toContain("pf-risk-matrix");
    expect(ids).toContain("pf-findings");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("每个 spec 有标题、数据来源与免责声明，数值可追溯到聚合结果", () => {
    for (const candidate of portfolioCandidates) {
      expect(candidate.spec.title.length).toBeGreaterThan(0);
      expect(candidate.spec.source.length).toBeGreaterThan(0);
      expect(candidate.spec.disclaimer).toBe(DISCLAIMER_ZH);
      expect(candidate.rationale.length).toBeGreaterThan(0);
    }
    const category = portfolioCandidates.find((item) => item.id === "pf-category");
    const total = (category?.spec.points ?? []).reduce((sum, point) => sum + point.value, 0);
    expect(total).toBeCloseTo(metrics.totalAssetsCny, 2);
  });

  it("结构指标图只输出百分比且不混入金额", () => {
    const structure = portfolioCandidates.find((item) => item.id === "pf-structure");
    expect(structure?.spec.unit).toBe("%");
    for (const point of structure?.spec.points ?? []) {
      expect(point.value).toBeGreaterThanOrEqual(0);
      expect(point.value).toBeLessThanOrEqual(100);
    }
  });
});

describe("chart spec 候选（情报与事件）", () => {
  const intel = buildIntelCandidates({
    events: [
      { id: "e1", title: "宏观数据发布", eventType: "macro_data", articleCount: 5, sourceCount: 3, credibility: 78, lastSeenAt: "2026-11-01T10:00:00.000Z" },
      { id: "e2", title: "公司澄清传闻", eventType: "company_event", articleCount: 3, sourceCount: 2, credibility: 66, lastSeenAt: "2026-11-02T09:00:00.000Z" },
    ],
    topics: [
      { slug: "macro-cn", name: "中国宏观", articleCount: 6, color: "#12b886" },
      { slug: "industry-semi", name: "半导体", articleCount: 4 },
      { slug: "company-hengqi", name: "恒启科技", articleCount: 3 },
    ],
    sources: [
      { name: "宏观观察站", kind: "RSS", credibility: 4, articleCount: 6, enabled: true, lastStatus: "ok" },
      { name: "市井财经爆料", kind: "MANUAL", credibility: 1, articleCount: 1, enabled: true, lastStatus: "idle" },
    ],
    relations: [{ from: "macro-cn", to: "industry-semi", weight: 3 }],
  });

  it("覆盖主题分布、时间线、来源表与关系图", () => {
    const ids = intel.map((item) => item.id);
    expect(ids).toContain("intel-event-types");
    expect(ids).toContain("intel-topics");
    expect(ids).toContain("intel-sources");
    expect(ids).toContain("intel-relations");
  });

  it("来源表带可信度与条数，且注明来自数据库", () => {
    const sources = intel.find((item) => item.id === "intel-sources");
    expect(sources?.spec.table?.columns.map((column) => column.key)).toContain("credibility");
    expect(sources?.spec.source).toContain("Source");
  });

  it("主题与事件候选都带免责声明", () => {
    const topic = buildTopicCandidates({
      slug: "macro-cn",
      name: "中国宏观",
      eventTypes: [{ type: "macro_data", label: "宏观数据", count: 2 }],
      timeline: [{ date: "2026-11-01", count: 2 }, { date: "2026-11-02", count: 1 }],
      entities: [{ name: "统计局", count: 3 }],
      keyNumbers: [{ label: "GDP增速", value: 4.8, unit: "%", sourceName: "宏观观察站" }],
      gaps: ["存在单一来源报道"],
    });
    expect(topic.map((item) => item.id)).toEqual(expect.arrayContaining(["topic-types", "topic-timeline", "topic-entities", "topic-numbers", "topic-gaps"]));

    const event = buildEventCandidates({
      eventId: "e1",
      eventTitle: "宏观数据发布",
      timeline: [{ at: "2026-11-01T10:00:00.000Z", label: "数据发布" }],
      keyNumbers: [{ label: "GDP增速", value: 4.8, unit: "%", sourceName: "宏观观察站" }],
      articles: [
        { id: "a1", title: "统计局发布数据", sourceName: "宏观观察站", credibility: 4, qualityScore: 80, publishedAt: "2026-11-01T10:00:00.000Z", url: "https://example.com/a1" },
        { id: "a2", title: "券商点评数据", sourceName: "经济参考速递", credibility: 3, qualityScore: 70, publishedAt: "2026-11-01T12:00:00.000Z", url: null },
      ],
    });
    expect(event.map((item) => item.id)).toEqual(expect.arrayContaining(["event-timeline", "event-numbers", "event-sources"]));

    for (const candidate of [...topic, ...event]) {
      expect(candidate.spec.disclaimer).toBe(DISCLAIMER_ZH);
      expect(candidate.spec.citations.length).toBeGreaterThan(0);
    }
  });
});

describe("候选选择与安全边界", () => {
  it("给模型看的候选只包含 id/标题/类型/理由，不含数据", () => {
    const described = describeCandidates(portfolioCandidates);
    expect(described.length).toBe(portfolioCandidates.length);
    for (const item of described) {
      expect(Object.keys(item).sort()).toEqual(["id", "rationale", "title", "type"]);
    }
  });

  it("规则选择优先覆盖不同表达类型且不超过上限", () => {
    const output = mockVisualSelect({ candidates: describeCandidates(portfolioCandidates), context: "资产结构", max: 3 });
    expect(output.selected).toHaveLength(3);
    const types = new Set(
      output.selected.map((item) => portfolioCandidates.find((candidate) => candidate.id === item.candidateId)?.type),
    );
    expect(types.size).toBe(3);
  });

  it("没有候选时返回空选择并给出文字说明", () => {
    const output = mockVisualSelect({ candidates: [], context: "空数据" });
    expect(output.selected).toEqual([]);
    expect(output.note).toContain("文字");
  });

  it("候选数量被限制在 1–6", () => {
    expect(clampSelectionCount(0)).toBe(1);
    expect(clampSelectionCount(3)).toBe(3);
    expect(clampSelectionCount(99)).toBe(6);
    expect(clampSelectionCount("2")).toBe(2);
    expect(clampSelectionCount(-1)).toBe(1);
    expect(clampSelectionCount("abc")).toBe(4);
  });
});

describe("情报 × 资产关联候选", () => {
  it("按暴露占比生成横向条形与明细表，并过滤零暴露", () => {
    const candidates = buildExposureCandidates({
      totalAssetsCny: 50000,
      items: [
        { topicName: "人民币汇率", exposureShare: 0.22, matchedCount: 2, note: "外币计价，汇率折算影响价值" },
        { topicName: "中国宏观", exposureShare: 0.1, matchedCount: 1 },
        { topicName: "无关主题", exposureShare: 0, matchedCount: 0 },
      ],
    });
    const bar = candidates.find((candidate) => candidate.id === "pf-exposure")?.spec;
    expect(bar?.type).toBe("hbar");
    expect(bar?.unit).toBe("%");
    expect(bar?.points?.length).toBe(2);
    expect(bar?.points?.[0].value).toBeCloseTo(22, 1);
    expect(bar?.citations.length).toBeGreaterThan(0);
    expect(bar?.disclaimer).toBeTruthy();

    const table = candidates.find((candidate) => candidate.id === "pf-exposure-detail")?.spec;
    expect(table?.table?.columns.map((column) => column.key)).toEqual(["topic", "share", "matched", "note"]);
    expect(table?.table?.rows.length).toBe(2);
    expect(table?.source).toContain("50,000");
  });

  it("没有暴露数据时不生成图表", () => {
    expect(buildExposureCandidates({ totalAssetsCny: 1000, items: [] })).toEqual([]);
  });
});
