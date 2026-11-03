import { describe, expect, it } from "vitest";
import { clusterArticles } from "@/lib/rules/cluster";
import type { ClusterInput } from "@/lib/rules/cluster";

const now = Date.now();
const hoursAgo = (hours: number) => new Date(now - hours * 3600_000);
const macroTopic = {
  slug: "company-hengqi",
  name: "恒启科技",
  score: 1,
  kind: "company" as const,
};

function article(partial: Partial<ClusterInput> & { title: string; summary: string }): ClusterInput {
  return {
    publishedAt: hoursAgo(1),
    sourceId: "s-demo",
    sourceName: "示例来源",
    sourceCredibility: 3,
    topics: [macroTopic],
    ...partial,
  };
}

describe("实体级聚类", () => {
  it("标题用词不同、但共享强实体且事件类型一致时合并，并标记 ENTITY 规则", () => {
    const a = article({
      title: "恒启科技获海外客户大额订单",
      summary: "示例消息称该公司已拿下海外客户订单，金额未披露。",
      eventType: "company_event",
      entities: [
        { name: "恒启科技", type: "ORG" },
        { name: "订单", type: "INDICATOR" },
      ],
      sourceId: "s1",
    });
    const b = article({
      title: "公司公告：海外合作未达披露标准",
      summary: "示例公告说明该合作规模较小，未达到临时公告披露标准。",
      eventType: "company_event",
      entities: [
        { name: "恒启科技", type: "ORG" },
        { name: "订单", type: "INDICATOR" },
      ],
      sourceId: "s2",
    });
    const clusters = clusterArticles([a, b]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].articleCount).toBe(2);
    expect(clusters[0].explain.rule).toBe("ENTITY");
    expect(clusters[0].explain.sharedEntities).toContain("恒启科技");
    expect(clusters[0].eventType).toBe("company_event");
    expect(clusters[0].entities.map((entity) => entity.name)).toContain("恒启科技");
  });

  it("传闻与带澄清/否认的公司事件可以按实体合并", () => {
    const rumor = article({
      title: "传恒启科技将获大额订单，内部人士称很快公布",
      summary: "示例传闻称订单金额可能超过 10 亿元。",
      eventType: "rumor",
      entities: [{ name: "恒启科技", type: "ORG" }],
      claims: [{ text: "传恒启科技将获大额订单", kind: "claim" }],
      sourceId: "s1",
      sourceCredibility: 1,
    });
    const denial = article({
      title: "澄清公告：相关合作传闻不实",
      summary: "示例公告称公司未签署所称订单，提醒以公告为准。",
      eventType: "company_event",
      entities: [{ name: "恒启科技", type: "ORG" }],
      claims: [{ text: "公司澄清相关传闻不实", kind: "denial" }],
      sourceId: "s2",
      sourceCredibility: 5,
    });
    const clusters = clusterArticles([rumor, denial]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].explain.rule).toBe("ENTITY");
    expect(clusters[0].eventType).toBe("company_event");
  });

  it("共享实体但事件类型不同、也没有澄清关系时不合并", () => {
    const macro = article({
      title: "宏观数据发布：服务业贡献提升",
      summary: "示例统计局数据显示服务业贡献提升。",
      eventType: "macro_data",
      entities: [{ name: "恒启科技", type: "ORG" }],
      sourceId: "s1",
    });
    const company = article({
      title: "恒启科技发布年度经营简报",
      summary: "示例公告披露年度经营情况。",
      eventType: "company_event",
      entities: [{ name: "恒启科技", type: "ORG" }],
      sourceId: "s2",
    });
    const clusters = clusterArticles([macro, company]);
    expect(clusters).toHaveLength(2);
  });

  it("实体重合度低于阈值时不因单个共享实体合并", () => {
    const a = article({
      title: "恒启科技获海外订单",
      summary: "示例消息称公司拿下海外订单。",
      eventType: "company_event",
      entities: [
        { name: "恒启科技", type: "ORG" },
        { name: "云枢半导体", type: "ORG" },
        { name: "硅料", type: "PRODUCT" },
      ],
      sourceId: "s1",
    });
    const b = article({
      title: "云枢半导体发布年度财报",
      summary: "示例公告披露营收与研发投入。",
      eventType: "company_event",
      entities: [
        { name: "恒启科技", type: "ORG" },
        { name: "光伏组件", type: "PRODUCT" },
        { name: "原油", type: "PRODUCT" },
      ],
      sourceId: "s2",
    });
    const clusters = clusterArticles([a, b]);
    expect(clusters).toHaveLength(2);
  });

  it("实体抽取为空时保持原有文本相似度行为", () => {
    const a = article({
      title: "统计局：三季度 GDP 同比增长 4.8%，服务业贡献提升",
      summary: "示例统计局发布三季度 GDP 数据，服务业贡献提升。",
      eventType: "macro_data",
      entities: [],
      sourceId: "s1",
    });
    const b = article({
      title: "三季度 GDP 数据发布：统计局称服务业贡献提升",
      summary: "示例机构点评统计局发布的三季度 GDP 数据。",
      eventType: "macro_data",
      entities: [],
      sourceId: "s2",
    });
    const clusters = clusterArticles([a, b]);
    expect(clusters).toHaveLength(1);
    expect(["TITLE", "JACCARD", "COSINE"]).toContain(clusters[0].explain.rule);
  });
});
