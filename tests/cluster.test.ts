import { describe, expect, it } from "vitest";
import { clusterArticles, contentHashOf } from "@/lib/rules/cluster";
import type { ClusterInput } from "@/lib/rules/cluster";

const now = Date.now();
const hoursAgo = (hours: number) => new Date(now - hours * 3600_000);

function article(partial: Partial<ClusterInput> & { title: string; summary: string }): ClusterInput {
  return {
    publishedAt: hoursAgo(1),
    sourceId: "s-demo",
    sourceName: "演示来源",
    sourceCredibility: 4,
    topics: [{ slug: "macro-cn", name: "中国宏观", score: 1, kind: "macro" }],
    ...partial,
  };
}

describe("资讯聚类", () => {
  const gdpA = article({
    title: "统计局：三季度 GDP 同比增长 4.8%，服务业贡献提升",
    summary: "示例统计局发布三季度 GDP 数据：同比增长 4.8%，服务业增加值同比增长 5.2%，对经济增长贡献率超过六成。",
    publishedAt: hoursAgo(3),
    sourceId: "s1",
  });
  const gdpB = article({
    title: "统计局解读三季度 GDP 数据：服务业贡献提升，三个结构性变化",
    summary: "示例统计局解读三季度 GDP 数据：服务业贡献提升、高技术制造业投资保持两位数增长、民间投资增速回升。",
    publishedAt: hoursAgo(2),
    sourceId: "s2",
  });
  const unrelated = article({
    title: "某新能源车企发布新车型，续航提升至 800 公里",
    summary: "示例车企发布新车型，官方称续航提升至 800 公里，预计明年交付。",
    publishedAt: hoursAgo(1),
    sourceId: "s3",
    topics: [{ slug: "industry-newenergy", name: "新能源", score: 1, kind: "industry" }],
  });

  it("同一事件的多篇报道合并为一个簇", () => {
    const clusters = clusterArticles([gdpA, gdpB, unrelated]);
    expect(clusters).toHaveLength(2);
    const merged = clusters.find((cluster) => cluster.articleCount === 2);
    expect(merged).toBeDefined();
    expect(merged?.memberIndexes.sort()).toEqual([0, 1]);
    expect(merged?.sourceCount).toBe(2);
  });

  it("事件摘要包含共同关键词，且给出可解释的相似度规则", () => {
    const clusters = clusterArticles([gdpA, gdpB]);
    const [cluster] = clusters;
    expect(["TITLE", "JACCARD", "COSINE", "ENTITY"]).toContain(cluster.explain.rule);
    expect(cluster.explain.sharedKeywords.length).toBeGreaterThan(0);
    expect(cluster.explain.similarity).toBeGreaterThanOrEqual(0.42);
    expect(cluster.explain.timeGapHours).toBeGreaterThanOrEqual(0);
    expect(cluster.explain.timeGapHours).toBeLessThanOrEqual(3);
    expect(cluster.title.length).toBeGreaterThan(0);
  });

  it("不同主题、不同时间的资讯不会误合并", () => {
    const farAway = article({
      title: "统计局：三季度 GDP 同比增长 4.8%，服务业贡献提升",
      summary: gdpA.summary,
      publishedAt: hoursAgo(24 * 7),
      sourceId: "s9",
    });
    const clusters = clusterArticles([gdpA, farAway]);
    expect(clusters).toHaveLength(2);
  });

  it("同一篇资讯重复导入时合并为一簇", () => {
    const duplicate: ClusterInput = { ...gdpA, sourceId: "s1" };
    const clusters = clusterArticles([gdpA, duplicate]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].articleCount).toBe(2);
  });

  it("内容指纹与日期、来源、归一化标题相关，可用于入库去重", () => {
    const base = { title: "统计局：三季度 GDP 增长 4.8%", publishedAt: hoursAgo(2), sourceId: "s1" };
    const same = contentHashOf(base);
    expect(contentHashOf({ ...base })).toBe(same);
    expect(contentHashOf({ ...base, sourceId: "s2" })).not.toBe(same);
    expect(contentHashOf({ ...base, title: "统计局：三季度GDP增长4.8%！" })).toBe(same);
    expect(contentHashOf({ ...base, publishedAt: hoursAgo(30) })).not.toBe(same);
  });

  it("空输入返回空数组", () => {
    expect(clusterArticles([])).toEqual([]);
  });
});
