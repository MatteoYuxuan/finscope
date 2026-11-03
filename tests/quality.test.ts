import { describe, expect, it } from "vitest";
import { qualityLevel, scoreQuality } from "@/lib/rules/quality";

const longBody = "示例正文：".repeat(30);

describe("资讯质量分", () => {
  it("来源完整、有链接、有数字、正文充足时得高分", () => {
    const result = scoreQuality({
      title: "统计局：三季度 GDP 同比增长 4.8%",
      summary: longBody,
      url: "https://demo.invalid/a01",
      publishedAt: new Date(),
      sourceCredibility: 4,
    });
    expect(result.score).toBe(90);
    expect(result.flags).not.toContain("RUMOR");
    expect(qualityLevel(result.score).label).toBe("较好");
  });

  it("无链接、正文过短、含据传、无时间、低可信来源 → 0 分并标注全部问题", () => {
    const result = scoreQuality({
      title: "据传某公司将获大额订单",
      summary: "内部人士称很快公布。",
      sourceCredibility: 1,
    });
    expect(result.score).toBe(0);
    expect(result.flags).toEqual(
      expect.arrayContaining(["NO_URL", "TOO_SHORT", "RUMOR", "NO_SOURCE_TIME", "LOW_CREDIBILITY_SOURCE"]),
    );
    expect(qualityLevel(result.score).label).toBe("待核实");
  });

  it("标题党用词单独扣 15 分", () => {
    const clean = scoreQuality({
      title: "某行业发布月度数据",
      summary: longBody,
      url: "https://demo.invalid/a",
      publishedAt: new Date(),
      sourceCredibility: 4,
    });
    const clickbait = scoreQuality({
      title: "震惊！某行业发布月度数据",
      summary: longBody,
      url: "https://demo.invalid/a",
      publishedAt: new Date(),
      sourceCredibility: 4,
    });
    expect(clean.score - clickbait.score).toBe(15);
    expect(clickbait.flags).toContain("CLICKBAIT");
  });

  it("分数始终落在 0–100", () => {
    for (const credibility of [1, 3, 5]) {
      const result = scoreQuality({
        title: "测试标题",
        summary: "短",
        sourceCredibility: credibility,
      });
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    }
  });

  it("质量等级分档：75 / 55 为界", () => {
    expect(qualityLevel(80).label).toBe("较好");
    expect(qualityLevel(60).label).toBe("一般");
    expect(qualityLevel(10).label).toBe("待核实");
  });
});
