"""Curated, investable ETF universe.

Why a curated universe instead of the full market?

* The product gives asset-allocation advice, not stock picking. A stable set of
  liquid, representative ETFs makes the optimisation reproducible and the
  output explainable.
* Every ETF is mapped to an asset class and to a benchmark, so the system can
  separate strategic asset allocation from instrument selection.
* The list is small enough to cache for offline demos, yet covers China equity,
  duration, credit, gold, Hong Kong, US equity and a few satellite sectors.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Literal

AssetClass = Literal[
    "CASH",
    "CN_BOND",
    "CN_EQUITY",
    "HK_EQUITY",
    "US_EQUITY",
    "GOLD",
    "COMMODITY",
    "SATELLITE",
]

CLASS_META: dict[str, dict[str, str]] = {
    "CASH": {"label": "现金管理", "color": "#94a3b8", "group": "防御"},
    "CN_BOND": {"label": "中国债券", "color": "#38bdf8", "group": "防御"},
    "CN_EQUITY": {"label": "中国权益", "color": "#12b886", "group": "增长"},
    "HK_EQUITY": {"label": "港股权益", "color": "#8b5cf6", "group": "增长"},
    "US_EQUITY": {"label": "海外权益", "color": "#f59e0b", "group": "增长"},
    "GOLD": {"label": "黄金", "color": "#eab308", "group": "对冲"},
    "COMMODITY": {"label": "商品", "color": "#a16207", "group": "对冲"},
    "SATELLITE": {"label": "行业卫星", "color": "#ec4899", "group": "卫星"},
}


@dataclass(frozen=True)
class AssetDef:
    code: str
    name: str
    asset_class: AssetClass
    role: Literal["core", "satellite", "defensive", "cash"]
    benchmark: str
    fee: float  # annual management + custody fee, decimal
    note: str
    min_history: str = "2018-01-01"

    def to_dict(self) -> dict:
        data = asdict(self)
        data["class_label"] = CLASS_META[self.asset_class]["label"]
        data["class_color"] = CLASS_META[self.asset_class]["color"]
        return data


# ETF codes verified against Eastmoney / AkShare on 2026-11-02.
UNIVERSE: tuple[AssetDef, ...] = (
    # Cash management
    AssetDef("511880", "银华日利ETF", "CASH", "cash", "000001", 0.0030, "场内货币基金，T+0 可用"),
    AssetDef("511990", "华宝添益ETF", "CASH", "cash", "000001", 0.0030, "场内货币基金，流动性好"),
    # China duration / credit
    AssetDef("511010", "国债ETF", "CN_BOND", "defensive", "H11001", 0.0020, "5 年期国债，利率敞口"),
    AssetDef("511260", "十年国债ETF", "CN_BOND", "defensive", "H11001", 0.0020, "长久期国债，久期约 8 年"),
    AssetDef("511360", "短融ETF", "CN_BOND", "defensive", "H11001", 0.0020, "短久期信用债，波动较低"),
    # China broad equity
    AssetDef("510300", "沪深300ETF", "CN_EQUITY", "core", "000300", 0.0050, "A 股大盘核心宽基"),
    AssetDef("510500", "中证500ETF", "CN_EQUITY", "core", "000905", 0.0050, "A 股中盘宽基"),
    AssetDef("512100", "中证1000ETF", "CN_EQUITY", "core", "000852", 0.0050, "A 股小盘宽基"),
    AssetDef("588000", "科创50ETF", "CN_EQUITY", "satellite", "000688", 0.0050, "科创板硬科技，高波动"),
    AssetDef("159915", "创业板ETF", "CN_EQUITY", "core", "399006", 0.0050, "成长风格宽基"),
    AssetDef("510880", "红利ETF", "CN_EQUITY", "core", "000015", 0.0050, "高股息价值风格"),
    AssetDef("512890", "红利低波ETF", "CN_EQUITY", "core", "H30269", 0.0050, "红利 + 低波动因子"),
    # Satellite sectors
    AssetDef("512480", "半导体ETF", "SATELLITE", "satellite", "931865", 0.0050, "半导体产业链"),
    AssetDef("515030", "新能源车ETF", "SATELLITE", "satellite", "930997", 0.0050, "新能源车产业链"),
    AssetDef("512170", "医疗ETF", "SATELLITE", "satellite", "399989", 0.0050, "医疗健康"),
    AssetDef("159928", "消费ETF", "SATELLITE", "satellite", "000932", 0.0050, "主要消费"),
    AssetDef("512660", "军工ETF", "SATELLITE", "satellite", "399967", 0.0050, "国防军工"),
    # Gold / commodity
    AssetDef("518880", "黄金ETF", "GOLD", "defensive", "AU9999", 0.0050, "实物黄金，人民币计价"),
    AssetDef("159985", "豆粕ETF", "COMMODITY", "satellite", "000001", 0.0060, "农产品商品敞口"),
    # Hong Kong / US
    AssetDef("513130", "恒生科技ETF", "HK_EQUITY", "core", "HSTECH", 0.0060, "港股科技龙头"),
    AssetDef("513050", "中概互联网ETF", "HK_EQUITY", "satellite", "HSCEI", 0.0060, "中概互联网"),
    AssetDef("513100", "纳指ETF", "US_EQUITY", "core", ".IXIC", 0.0060, "纳斯达克 100"),
    AssetDef("513500", "标普500ETF", "US_EQUITY", "core", ".INX", 0.0060, "标普 500"),
)

BY_CODE: dict[str, AssetDef] = {item.code: item for item in UNIVERSE}

# Benchmark indices used for regime detection and tracking-error checks.
BENCHMARKS = {
    "000300": "沪深300",
    "000905": "中证500",
    "000852": "中证1000",
    "399006": "创业板指",
    "000688": "科创50",
    "000015": "上证红利",
    "H11001": "中债总财富(总值)指数",
    "AU9999": "上海金",
}

CLASS_ORDER = ["CASH", "CN_BOND", "CN_EQUITY", "HK_EQUITY", "US_EQUITY", "GOLD", "COMMODITY", "SATELLITE"]

# Default strategic policy ranges. Tactical/optimiser output is always projected
# into these ranges before being shown to the user.
DEFAULT_CLASS_BOUNDS: dict[str, tuple[float, float]] = {
    # Cash is a policy buffer, not a return-seeking asset. Keeping the cap tight
    # prevents a low-volatility money-market ETF from dominating risk parity.
    "CASH": (0.03, 0.15),
    "CN_BOND": (0.05, 0.55),
    "CN_EQUITY": (0.10, 0.60),
    "HK_EQUITY": (0.00, 0.20),
    "US_EQUITY": (0.00, 0.25),
    "GOLD": (0.00, 0.20),
    "COMMODITY": (0.00, 0.10),
    "SATELLITE": (0.00, 0.20),
}
