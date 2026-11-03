import { describe, expect, it } from "vitest";
import {
  classifyEventType,
  extractArticle,
  extractEntities,
  extractKeyNumbers,
  inferCurrency,
  inferRegion,
  indicatorKeyOf,
} from "@/lib/rules/extract";
import type { ArticleClaim } from "@/lib/types/domain";

describe("文章级结构化抽取", () => {
  it("事件类型按标题识别，且澄清稿不会误判成传闻", () => {
    expect(classifyEventType("统计局：三季度 GDP 同比增长 4.8%")).toBe("macro_data");
    expect(classifyEventType("《金融产品信息披露指引》公开征求意见")).toBe("policy");
    expect(classifyEventType("恒启科技：拟对子公司增资 3.2 亿元")).toBe("company_event");
    expect(classifyEventType("传恒启科技将获大额订单，内部人士称“很快公布”")).toBe("rumor");
    expect(classifyEventType("恒启科技澄清：未获 12 亿元订单，相关传闻不实")).toBe(
      "company_event",
    );
    expect(classifyEventType("离岸人民币兑美元一度升破 7.10")).toBe("market_move");
    expect(classifyEventType("光伏组件排产环比回升，产业链价格趋稳")).toBe(
      "industry_survey",
    );
  });

  it("抽取公司、政策文件与指标实体，并剔除“网传”等前缀噪声", () => {
    const entities = extractEntities(
      "网传恒启科技将获订单。监管部门就《金融产品信息披露指引》公开征求意见，涉及营收与净利润。",
    );
    const names = entities.map((entity) => entity.name);
    expect(names).toContain("恒启科技");
    expect(names).toContain("金融产品信息披露指引");
    expect(names).toContain("营收");
    expect(names).not.toContain("网传恒启科技");
    const policy = entities.find((entity) => entity.name === "金融产品信息披露指引");
    expect(policy?.type).toBe("POLICY");
  });

  it("抽取关键数值，保留数值、单位与所在句子", () => {
    const numbers = extractKeyNumbers(
      "示例公告显示，公司拟对全资子公司增资 3.2 亿元，建设周期预计 18 个月，研发投入占比 18%。",
    );
    const amount = numbers.find((item) => item.value === 3.2 && item.unit === "亿元");
    expect(amount).toBeDefined();
    expect(amount?.context).toContain("增资");
    expect(numbers.some((item) => item.value === 18 && item.unit === "个月")).toBe(true);
    expect(numbers.some((item) => item.value === 18 && item.unit === "%")).toBe(true);
  });

  it("按句子给主张分类：事实、测算、传闻、澄清", () => {
    const result = extractArticle({
      title: "恒启科技澄清：未获 12 亿元订单，相关传闻不实",
      summary: "公司公告称相关金额不属实。券商测算订单影响约 12 亿元。",
      content:
        "据传恒启科技将获海外大额订单，内部人士称很快公布。公司澄清公告称未签署相关订单，传闻不实。",
    });
    const kinds = result.claims.map((claim: ArticleClaim) => claim.kind);
    expect(kinds).toContain("denial");
    expect(kinds).toContain("claim");
    expect(kinds).toContain("estimate");
    expect(result.eventType).toBe("company_event");
    expect(result.claims.every((claim) => claim.text.length <= 160)).toBe(true);
  });

  it("推断地区与币种", () => {
    expect(inferRegion("美联储宣布维持利率不变")).toBe("US");
    expect(inferRegion("欧元区通胀回落")).toBe("EU");
    expect(inferRegion("日本央行调整收益率曲线")).toBe("JP");
    expect(inferRegion("香港恒生指数收涨")).toBe("HK");
    expect(inferRegion("人民币中间价上调")).toBe("CN");
    expect(inferRegion("某公司发布新品")).toBe("GLOBAL");

    expect(inferCurrency("美元指数回落")).toBe("USD");
    expect(inferCurrency("人民币兑美元升值")).toBe("USD");
    expect(inferCurrency("公司发布新品")).toBeNull();
  });

  it("指标键把不同措辞归一到同一个可比较维度", () => {
    expect(indicatorKeyOf("最终消费支出贡献率", "对 GDP 增长的贡献")).toBe("贡献率");
    expect(indicatorKeyOf("过渡期安排", "存量产品")).toBe("过渡期");
    expect(indicatorKeyOf("订单金额", "海外客户")).toBe("订单金额");
    expect(indicatorKeyOf("营业收入", "上半年")).toBe("营收");
    expect(indicatorKeyOf("某个没有指标含义的词")).toBeNull();
  });

  it("抽取结果不包含买卖建议或涨跌预测", () => {
    const result = extractArticle({
      title: "券商点评：三季度 GDP 数据",
      summary: "分析师认为数据好于预期，建议关注相关板块。",
    });
    expect(result.claims.map((claim) => claim.text).join(" ")).not.toMatch(
      /建议买入|建议卖出|目标价|必涨/,
    );
    expect(result.entities.length).toBeLessThanOrEqual(12);
    expect(result.keyNumbers.length).toBeLessThanOrEqual(8);
    expect(result.claims.length).toBeLessThanOrEqual(6);
  });
});
