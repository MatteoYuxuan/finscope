import { describe, expect, it } from "vitest";
import {
  RISK_QUESTIONS,
  RISK_QUESTION_COUNT,
  bandOfScore,
  emptyAnswers,
  scoreRiskProfile,
} from "@/lib/rules/risk-profile";

describe("风险承受能力问卷", () => {
  it("固定 10 题，每题 5 个选项（0–4 分）", () => {
    expect(RISK_QUESTION_COUNT).toBe(10);
    expect(RISK_QUESTIONS).toHaveLength(10);
    for (const question of RISK_QUESTIONS) {
      expect(question.options).toHaveLength(5);
      expect(question.options.map((option) => option.score)).toEqual([0, 1, 2, 3, 4]);
    }
  });

  it("全选最低分 → 0 分，保守型", () => {
    const result = scoreRiskProfile(Array.from({ length: 10 }, () => 0));
    expect(result.score).toBe(0);
    expect(result.band).toBe("CONSERVATIVE");
    expect(result.bandLabel).toBe("保守型");
    expect(result.answered).toBe(10);
  });

  it("全选最高分 → 100 分，进取型", () => {
    const result = scoreRiskProfile(Array.from({ length: 10 }, () => 4));
    expect(result.score).toBe(100);
    expect(result.band).toBe("AGGRESSIVE");
  });

  it("演示问卷 [2,2,3,2,2,2,2,2,2,2] → 53 分，平衡型", () => {
    const result = scoreRiskProfile([2, 2, 3, 2, 2, 2, 2, 2, 2, 2]);
    expect(result.score).toBe(53);
    expect(result.band).toBe("BALANCED");
    expect(result.equityRange).toEqual([0.25, 0.45]);
  });

  it("分档边界：20/40/60/80", () => {
    expect(bandOfScore(19)).toBe("CONSERVATIVE");
    expect(bandOfScore(20)).toBe("STEADY");
    expect(bandOfScore(40)).toBe("BALANCED");
    expect(bandOfScore(60)).toBe("GROWTH");
    expect(bandOfScore(80)).toBe("AGGRESSIVE");
  });

  it("答案数量或取值不合法时抛 RangeError", () => {
    expect(() => scoreRiskProfile([1, 2, 3])).toThrow(RangeError);
    expect(() => scoreRiskProfile(Array.from({ length: 10 }, () => 5))).toThrow(RangeError);
  });

  it("emptyAnswers 返回 10 个 null，供表单初始化", () => {
    const answers = emptyAnswers();
    expect(answers).toHaveLength(10);
    expect(answers.every((item) => item === null)).toBe(true);
  });
});
