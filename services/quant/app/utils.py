"""Small serialization helpers (NumPy/Pandas -> JSON-native types)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

import numpy as np
import pandas as pd


def to_native(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return float(value)
    if isinstance(value, (np.bool_,)):
        return bool(value)
    if isinstance(value, np.ndarray):
        return [to_native(item) for item in value.tolist()]
    if isinstance(value, (pd.Series,)):
        return {str(k): to_native(v) for k, v in value.items()}
    if isinstance(value, (pd.DataFrame,)):
        return {str(k): to_native(v) for k, v in value.to_dict("list").items()}
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(k): to_native(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [to_native(item) for item in value]
    return value
