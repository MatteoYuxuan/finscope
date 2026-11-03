/**
 * 演示数据集（全部虚构）。
 * 说明：
 * - 来源、机构、公司、人物、数字均为编造，仅用于功能演示；
 * - 原文链接使用 .invalid 保留域名，明确不可访问，避免伪造真实外链；
 * - minutesAgo 用于把发布时间锚定到“当前时间之前”，保证每次演示都有新鲜感。
 */

export interface DemoSource {
  key: string;
  name: string;
  kind: "RSS" | "JSON" | "MANUAL";
  url: string | null;
  credibility: number;
  topicHint: string | null;
  enabled: boolean;
}

export interface DemoArticle {
  key: string;
  sourceKey: string;
  title: string;
  summary: string;
  content: string;
  url: string | null;
  minutesAgo: number;
  region: string;
  currency: string | null;
  topicSlugs: string[];
}

export interface DemoTopic {
  slug: string;
  name: string;
  kind: "industry" | "macro" | "fx" | "policy" | "company" | "commodity";
  keywords: string[];
  color: string;
  followed: boolean;
  sortOrder: number;
}

export const DEMO_TOPICS: DemoTopic[] = [
  {
    slug: "macro-cn",
    name: "中国宏观",
    kind: "macro",
    keywords: ["GDP", "PMI", "社融", "CPI", "经济", "消费", "出口", "统计局"],
    color: "#7c3aed",
    followed: true,
    sortOrder: 1,
  },
  {
    slug: "macro-rate",
    name: "利率与货币政策",
    kind: "macro",
    keywords: ["利率", "LPR", "降准", "降息", "央行", "MLF", "流动性", "美元指数"],
    color: "#4f46e5",
    followed: true,
    sortOrder: 2,
  },
  {
    slug: "industry-semi",
    name: "半导体",
    kind: "industry",
    keywords: ["半导体", "芯片", "晶圆", "存储", "设备", "光刻"],
    color: "#2563eb",
    followed: true,
    sortOrder: 3,
  },
  {
    slug: "industry-newenergy",
    name: "新能源",
    kind: "industry",
    keywords: ["新能源", "光伏", "储能", "锂电", "组件", "排产"],
    color: "#16a34a",
    followed: true,
    sortOrder: 4,
  },
  {
    slug: "fx-usdcny",
    name: "人民币汇率",
    kind: "fx",
    keywords: ["汇率", "人民币", "美元", "离岸", "中间价", "结汇"],
    color: "#0891b2",
    followed: true,
    sortOrder: 5,
  },
  {
    slug: "policy-reg",
    name: "金融监管",
    kind: "policy",
    keywords: ["监管", "指引", "条例", "合规", "处罚", "备案", "信息披露"],
    color: "#059669",
    followed: true,
    sortOrder: 6,
  },
  {
    slug: "company-hengqi",
    name: "恒启科技",
    kind: "company",
    keywords: ["恒启科技", "恒启", "增资", "产线"],
    color: "#ea580c",
    followed: false,
    sortOrder: 7,
  },
  {
    slug: "company-yunshu",
    name: "云枢半导体",
    kind: "company",
    keywords: ["云枢", "云枢半导体", "设备招标"],
    color: "#f97316",
    followed: false,
    sortOrder: 8,
  },
  {
    slug: "commodity-oil",
    name: "原油与大宗",
    kind: "commodity",
    keywords: ["原油", "油价", "OPEC", "化工", "大宗"],
    color: "#a16207",
    followed: false,
    sortOrder: 9,
  },
];

export const DEMO_SOURCES: DemoSource[] = [
  {
    key: "macro-watch",
    name: "宏观观察站（示例）",
    kind: "JSON",
    url: "https://demo.invalid/feed/macro.json",
    credibility: 4,
    topicHint: "macro-cn",
    enabled: true,
  },
  {
    key: "industry-brief",
    name: "行业前沿简报（示例）",
    kind: "RSS",
    url: "https://demo.invalid/feed/industry.xml",
    credibility: 4,
    topicHint: "industry-semi",
    enabled: true,
  },
  {
    key: "fx-express",
    name: "跨境汇率快讯（示例）",
    kind: "RSS",
    url: "https://demo.invalid/feed/fx.xml",
    credibility: 3,
    topicHint: "fx-usdcny",
    enabled: true,
  },
  {
    key: "regulator",
    name: "监管政策发布（示例）",
    kind: "JSON",
    url: "https://demo.invalid/feed/policy.json",
    credibility: 5,
    topicHint: "policy-reg",
    enabled: true,
  },
  {
    key: "company-wire",
    name: "公司公告聚合（示例）",
    kind: "RSS",
    url: "https://demo.invalid/feed/company.xml",
    credibility: 3,
    topicHint: "company-hengqi",
    enabled: true,
  },
  {
    key: "gossip",
    name: "市井财经爆料（示例）",
    kind: "MANUAL",
    url: null,
    credibility: 1,
    topicHint: null,
    enabled: true,
  },
  {
    key: "econ-reference",
    name: "经济参考速递（示例）",
    kind: "JSON",
    url: "https://demo.invalid/feed/reference.json",
    credibility: 3,
    topicHint: "macro-cn",
    enabled: true,
  },
  {
    key: "overseas-wire",
    name: "海外财经连线（示例）",
    kind: "RSS",
    url: "https://demo.invalid/feed/overseas.xml",
    credibility: 2,
    topicHint: "company-hengqi",
    enabled: true,
  },
  {
    key: "policy-weekly",
    name: "监管观察周报（示例）",
    kind: "JSON",
    url: "https://demo.invalid/feed/policy-weekly.json",
    credibility: 3,
    topicHint: "policy-reg",
    enabled: true,
  },
];

const LONG = (text: string) => text;

export const DEMO_ARTICLES: DemoArticle[] = [
  {
    key: "a01",
    sourceKey: "macro-watch",
    title: "统计局：三季度 GDP 同比增长 4.8%，服务业贡献提升",
    summary:
      "示例统计局发布三季度 GDP 数据：同比增长 4.8%，服务业增加值同比增长 5.2%，对经济增长贡献率超过六成。",
    content: LONG(
      "示例数据：三季度国内生产总值同比增长 4.8%，环比增长 1.1%。分产业看，第一产业增长 3.4%，第二产业增长 4.1%，第三产业增长 5.2%。" +
        "服务业中，信息传输、软件和信息技术服务业增加值同比增长 9.6%，接触型服务业继续恢复。统计局在解读中提到，消费对经济增长的贡献率较上半年有所回升，但外部需求仍存在不确定性。" +
        "上述数字为示例数据，不代表任何真实统计结果。",
    ),
    url: "https://demo.invalid/news/a01",
    minutesAgo: 180,
    region: "CN",
    currency: "CNY",
    topicSlugs: ["macro-cn"],
  },
  {
    key: "a02",
    sourceKey: "macro-watch",
    title: "统计局解读三季度 GDP 数据：服务业贡献提升，三个结构性变化",
    summary:
      "示例统计局解读三季度 GDP 数据时提到，服务业贡献提升、高技术制造业投资保持两位数增长、民间投资增速回升，是本期数据的三个结构性变化。",
    content: LONG(
      "示例解读文章把三季度数据归纳为三个结构性变化：一是服务业增加值占 GDP 比重继续上升；二是高技术制造业投资同比增长 11.3%，快于全部固定资产投资；" +
        "三是民间投资增速由负转正。文章同时提示，房地产相关投资仍在调整，地方财政收支压力需要持续观察。" +
        "文章强调，单季数据存在波动，不宜用一个月或一个季度的变化外推全年趋势。以上为示例内容。",
    ),
    url: "https://demo.invalid/news/a02",
    minutesAgo: 150,
    region: "CN",
    currency: "CNY",
    topicSlugs: ["macro-cn"],
  },
  {
    key: "a03",
    sourceKey: "macro-watch",
    title: "三季度 GDP 数据发布：统计局称服务业贡献提升、消费拉动增强",
    summary:
      "示例机构点评统计局发布的三季度 GDP 数据：服务业贡献提升，消费对增长的拉动较上半年增强，出口相关产业链景气度出现分化，需结合后续订单数据观察。",
    content: LONG(
      "示例机构在点评中表示，三季度最终消费支出对经济增长的贡献率约为 58%，较上半年提高；货物和服务净出口的贡献率有所回落。" +
        "分行业看，与出口关联度较高的部分制造业订单增速放缓，而内需相关的服务消费、线上零售保持韧性。" +
        "该机构提示，季度贡献率是核算结果，受基数和价格因素影响，不宜简单线性外推。以上为示例内容。",
    ),
    url: "https://demo.invalid/news/a03",
    minutesAgo: 120,
    region: "CN",
    currency: "CNY",
    topicSlugs: ["macro-cn", "macro-rate"],
  },
  {
    key: "a04",
    sourceKey: "industry-brief",
    title: "国内晶圆厂设备招标回暖，国产设备中标占比继续上升",
    summary:
      "示例行业简报统计，近两个月国内多条晶圆产线启动设备招标，刻蚀、薄膜沉积等环节的国产设备中标占比提升至约三成。",
    content: LONG(
      "示例简报根据公开招标信息统计，近两个月国内共有 6 条晶圆产线启动设备招标，涉及刻蚀、薄膜沉积、清洗与量测环节。" +
        "其中，国产设备在清洗与部分刻蚀环节的中标占比提升至约 30%，薄膜沉积环节仍以进口设备为主。" +
        "简报提醒，中标到验收通常存在 6–18 个月的时间差，招标数据不等于当期收入。以上为示例内容，不构成对任何公司的评价。",
    ),
    url: "https://demo.invalid/news/a04",
    minutesAgo: 300,
    region: "CN",
    currency: "CNY",
    topicSlugs: ["industry-semi", "company-yunshu"],
  },
  {
    key: "a05",
    sourceKey: "industry-brief",
    title: "光伏组件排产环比回升，产业链价格趋稳",
    summary:
      "示例调研显示，10 月光伏组件排产环比提升约 8%，硅料与硅片价格连续两周持平，部分辅材价格小幅上行。",
    content: LONG(
      "示例调研覆盖 12 家组件企业，10 月排产合计环比提升约 8%，其中头部企业开工率维持在七成以上。" +
        "价格方面，硅料与硅片报价连续两周持平，电池片价格小幅回落，光伏玻璃等辅材价格略有上行。" +
        "调研提示，排产回升部分来自季节性因素，行业库存仍处于较高水平，价格能否持续企稳取决于后续需求。以上为示例内容。",
    ),
    url: "https://demo.invalid/news/a05",
    minutesAgo: 360,
    region: "CN",
    currency: "CNY",
    topicSlugs: ["industry-newenergy"],
  },
  {
    key: "a06",
    sourceKey: "company-wire",
    title: "恒启科技：拟对子公司增资 3.2 亿元，用于产线扩建",
    summary:
      "示例公告显示，恒启科技拟以自有资金对全资子公司增资 3.2 亿元，用于新增两条精密结构件产线，建设周期预计 18 个月。",
    content: LONG(
      "示例公告称，公司拟以自有资金 3.2 亿元对全资子公司恒启精密增资，资金主要用于新增两条精密结构件产线及配套厂房改造，建设周期预计 18 个月。" +
        "公告同时提示，项目尚需履行备案程序，达产时间与产能利用率存在不确定性，新增产能可能面临下游需求波动风险。" +
        "以上公司名称、金额与项目均为示例，仅用于展示公告类资讯的解析流程。",
    ),
    url: "https://demo.invalid/news/a06",
    minutesAgo: 420,
    region: "CN",
    currency: "CNY",
    topicSlugs: ["company-hengqi", "industry-semi"],
  },
  {
    key: "a07",
    sourceKey: "company-wire",
    title: "云枢半导体：上半年营收 12.6 亿元，研发投入占比 18%",
    summary:
      "示例财报显示，云枢半导体上半年营收 12.6 亿元，同比增长 21%；研发投入 2.27 亿元，占营收比例 18%，设备类收入占比提升。",
    content: LONG(
      "示例财报显示，云枢半导体上半年实现营业收入 12.6 亿元，同比增长 21%；归母净利润 1.1 亿元，同比增长 9%。" +
        "分产品看，刻蚀设备收入占比提升至 46%，量测设备收入占比 18%。研发投入 2.27 亿元，占营业收入 18%，同比提高 2 个百分点。" +
        "公司在风险提示中提到，客户集中度较高，前五大客户收入占比超过六成。以上数据均为示例。",
    ),
    url: "https://demo.invalid/news/a07",
    minutesAgo: 480,
    region: "CN",
    currency: "CNY",
    topicSlugs: ["company-yunshu", "industry-semi"],
  },
  {
    key: "a08",
    sourceKey: "fx-express",
    title: "离岸人民币兑美元一度升破 7.10，成交放量",
    summary:
      "示例行情显示，离岸人民币兑美元盘中一度升破 7.10，日内波幅扩大，主要期限掉期点小幅下行。",
    content: LONG(
      "示例行情：离岸人民币兑美元盘中最高触及 7.096，随后回落至 7.11 附近，日内波幅约 180 点，成交较前一交易日放量。" +
        "交易员表示，月末结汇需求与企业套保盘是主要推动因素，短期走势仍受美元指数与国内经济数据影响。" +
        "以上报价为示例数据，不是实时行情，也不构成任何交易建议。",
    ),
    url: "https://demo.invalid/news/a08",
    minutesAgo: 90,
    region: "CN",
    currency: "USD",
    topicSlugs: ["fx-usdcny"],
  },
  {
    key: "a09",
    sourceKey: "fx-express",
    title: "美元指数回落至 103 附近，非美货币普遍走强",
    summary:
      "示例数据显示，美元指数回落至 103.2 附近，欧元、日元等非美货币对美元小幅走强，市场关注后续通胀数据。",
    content: LONG(
      "示例数据显示，美元指数最新报 103.2，较前一交易日下跌 0.4%。欧元兑美元升至 1.09 上方，美元兑日元回落至 149 附近。" +
        "市场参与者表示，近期公布的就业数据低于预期，是美元走弱的原因之一；后续通胀数据可能影响对利率路径的预期。" +
        "以上为示例数据，不构成对汇率走势的预测。",
    ),
    url: "https://demo.invalid/news/a09",
    minutesAgo: 240,
    region: "US",
    currency: "USD",
    topicSlugs: ["fx-usdcny", "macro-rate"],
  },
  {
    key: "a10",
    sourceKey: "regulator",
    title: "某监管部门就《金融产品信息披露指引》公开征求意见",
    summary:
      "示例征求意见稿要求金融机构在销售环节明示产品费用、风险等级与历史业绩口径，意见反馈期为一个月。",
    content: LONG(
      "示例征求意见稿提出，金融机构在销售金融产品时，应以显著方式披露产品类型、风险等级、费用构成、历史业绩的计算口径与区间。" +
        "对于结构性产品，还需披露收益触发条件与最不利情形。意见反馈期为一个月，后续将结合反馈修改完善。" +
        "以上文件名称与条款均为示例，仅用于展示政策类资讯的归集与主题追踪。",
    ),
    url: "https://demo.invalid/news/a10",
    minutesAgo: 600,
    region: "CN",
    currency: "CNY",
    topicSlugs: ["policy-reg"],
  },
  {
    key: "a11",
    sourceKey: "regulator",
    title: "《金融产品信息披露指引》征求意见：费用与风险等级需在销售环节明示",
    summary:
      "示例梳理显示，征求意见稿的核心要求集中在费用披露、风险等级匹配、历史业绩口径三个方面，并设置了过渡期安排。",
    content: LONG(
      "示例梳理把征求意见稿的要点归为三类：一是费用披露，要求列明管理费、销售服务费等各项费用的计算方式；" +
        "二是风险等级，要求与投资者风险承受能力评估结果相匹配；三是历史业绩，要求同时展示不同持有期限的区间收益，并注明“历史业绩不代表未来表现”。" +
        "文件设置的过渡期安排为 6 个月，存量产品需在过渡期内完成披露口径调整。以上为示例内容。",
    ),
    url: "https://demo.invalid/news/a11",
    minutesAgo: 540,
    region: "CN",
    currency: "CNY",
    topicSlugs: ["policy-reg"],
  },
  {
    key: "a12",
    sourceKey: "gossip",
    title: "传恒启科技将获大额订单，内部人士称“很快公布”",
    summary: "网传恒启科技即将获得某海外客户大额订单，消息未获公司确认，也未披露金额与交付周期。",
    content: LONG("据传，恒启科技即将获得某海外客户的大额订单，内部人士称“很快公布”。截至发稿，公司未发布任何公告，消息真实性无法核实。"),
    url: null,
    minutesAgo: 60,
    region: "CN",
    currency: "CNY",
    topicSlugs: ["company-hengqi"],
  },
  {
    key: "a13",
    sourceKey: "macro-watch",
    title: "统计局解读三季度 GDP 数据：三个结构性变化值得关注（转载）",
    summary:
      "转载稿与原文内容基本一致，仅调整了标题与配图，未增加新的数据或观点。",
    content: LONG(
      "本文为转载稿，内容与《统计局解读三季度数据：三个结构性变化值得关注》基本一致，仅调整标题与配图。" +
        "转载方未补充新的数据来源。以上为示例内容，用于展示“重复资讯”的识别与合并。",
    ),
    url: "https://demo.invalid/news/a13",
    minutesAgo: 100,
    region: "CN",
    currency: "CNY",
    topicSlugs: ["macro-cn"],
  },
  {
    key: "a14",
    sourceKey: "industry-brief",
    title: "原油价格波动加大，化工企业成本端承压",
    summary:
      "示例简报显示，近一周原油价格振幅超过 6%，部分化工企业上调产品报价以传导成本，但下游接受度有限。",
    content: LONG(
      "示例简报显示，近一周原油价格振幅超过 6%，石脑油、乙烯等基础化工原料价格随之波动。" +
        "部分化工企业已上调产品报价，但下游织造、包装企业接受度有限，提价传导并不顺畅。" +
        "简报提示，成本端波动对不同环节的影响存在差异，需结合企业库存与定价机制具体分析。以上为示例内容。",
    ),
    url: "https://demo.invalid/news/a14",
    minutesAgo: 720,
    region: "CN",
    currency: "CNY",
    topicSlugs: ["commodity-oil", "industry-newenergy"],
  },
  {
    key: "a15",
    sourceKey: "econ-reference",
    title: "券商测算：三季度消费对 GDP 增长贡献率约 55%",
    summary:
      "示例券商研报测算，三季度最终消费支出对 GDP 增长的贡献率约 55%，较该机构此前估算下调 3 个百分点，主要因净出口拖累减弱。",
    content: LONG(
      "示例研报测算，三季度最终消费支出对经济增长的贡献率约为 55%，资本形成总额贡献率约 32%，货物和服务净出口贡献率约 13%。" +
        "报告称，本次测算对居民消费支出口径做了调整，与统计部门公布的核算结果可能存在差异。" +
        "报告提示，贡献率是支出法核算结果，不同机构在口径与季调方法上不一致，不宜直接比较。以上为示例内容。",
    ),
    url: "https://demo.invalid/news/a15",
    minutesAgo: 110,
    region: "CN",
    currency: "CNY",
    topicSlugs: ["macro-cn"],
  },
  {
    key: "a16",
    sourceKey: "overseas-wire",
    title: "海外媒体：恒启科技或获 12 亿元订单，公司尚未回应",
    summary:
      "示例海外财经媒体报道，恒启科技可能获得某海外客户约 12 亿元精密结构件订单，交付周期或延续至明年；报道援引未具名人士，公司尚未回应。",
    content: LONG(
      "示例报道称，恒启科技接近获得某海外客户价值约 12 亿元的精密结构件订单，若落地将超过公司上一年度营收的三成。" +
        "报道援引两名未具名人士，称订单细节仍在谈判中，交付周期可能延续至明年。" +
        "截至发稿，恒启科技未就上述消息发布公告或回应，订单金额与交付安排均未获证实。以上为示例内容，不构成对公司的评价。",
    ),
    url: "https://demo.invalid/news/a16",
    minutesAgo: 45,
    region: "CN",
    currency: "CNY",
    topicSlugs: ["company-hengqi", "industry-semi"],
  },
  {
    key: "a17",
    sourceKey: "company-wire",
    title: "恒启科技澄清：未获 12 亿元订单，相关传闻不实",
    summary:
      "示例公告显示，恒启科技就海外媒体传闻发布澄清公告，称公司未签署所称 12 亿元订单，相关金额与交付安排均不属实，提醒投资者以公告为准。",
    content: LONG(
      "示例公告称，公司关注到部分海外媒体关于“恒启科技或获 12 亿元订单”的报道。经核实，公司未与所称客户签署相关订单，报道中的金额、交付周期与客户信息均不属实。" +
        "公司提醒投资者，重大事项以指定信息披露媒体公告为准，请勿轻信传闻。" +
        "公告同时说明，公司日常经营与在手订单情况请以定期报告为准。以上为示例内容。",
    ),
    url: "https://demo.invalid/news/a17",
    minutesAgo: 20,
    region: "CN",
    currency: "CNY",
    topicSlugs: ["company-hengqi"],
  },
  {
    key: "a18",
    sourceKey: "policy-weekly",
    title: "《金融产品信息披露指引》过渡期或为 12 个月，业内称准备时间紧张",
    summary:
      "示例行业周报称，征求意见稿拟设置 12 个月过渡期，较部分机构预期的 6 个月更长，但销售系统改造与历史业绩回溯仍需提前准备。",
    content: LONG(
      "示例行业周报梳理称，征求意见稿拟设置 12 个月过渡期，存量产品需在过渡期内完成信息披露口径调整。" +
        "部分机构此前按 6 个月准备系统改造，认为 12 个月更从容；也有机构提示，历史业绩回溯与风险等级重评工作量较大，实际准备时间仍然紧张。" +
        "报道同时提到，最终过渡期以正式发布文件为准。以上为示例内容。",
    ),
    url: "https://demo.invalid/news/a18",
    minutesAgo: 500,
    region: "CN",
    currency: "CNY",
    topicSlugs: ["policy-reg"],
  },
];

export const DEMO_ARTICLES_BY_SOURCE = new Map<string, DemoArticle[]>();
for (const article of DEMO_ARTICLES) {
  const list = DEMO_ARTICLES_BY_SOURCE.get(article.sourceKey) ?? [];
  list.push(article);
  DEMO_ARTICLES_BY_SOURCE.set(article.sourceKey, list);
}
