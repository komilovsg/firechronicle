"""Core math for MODIS/VIIRS hotspot harmonization. numpy only, no I/O.

Model
-----
For a stratum s (country x calendar month) and a VIIRS sensor v, the monthly
VIIRS count is modelled as V ~ Poisson(k_vs * mu), where mu is the expected
MODIS (Terra+Aqua) count. The maximum-likelihood estimate of k is the ratio of
sums over the overlap period. We shrink it toward the sensor's global ratio so
sparse strata stay stable (empirical-Bayes style pseudo-counts).

With MODIS M ~ Poisson(mu) and each available VIIRS sensor V_v ~ Poisson(k_v mu),
the minimum-variance unbiased linear combination of the per-sensor estimates
(M, V_v / k_v) has weights proportional to (1, k_v), which reduces to

    harm = (M + sum_v V_v) / (1 + sum_v k_v)

where the sums run only over sensors that were observing in that month.
Before VIIRS existed this is just M; after MODIS ends it is sum V / sum k.
"""
from __future__ import annotations

import numpy as np

MONTH0_YEAR = 2000


def month_index(year, month):
    """t = (year-2000)*12 + (month-1); works on scalars and numpy arrays."""
    return (np.asarray(year) - MONTH0_YEAR) * 12 + (np.asarray(month) - 1)


def month_label(t: int) -> str:
    return f"{MONTH0_YEAR + t // 12}-{t % 12 + 1:02d}"


def shrunk_ratio(num: np.ndarray, den: np.ndarray, prior: float, strength: float) -> np.ndarray:
    """(sum num + strength*prior) / (sum den + strength), elementwise over strata.

    strength is in units of the denominator (pseudo-detections of MODIS).
    Strata with no data return the prior.
    """
    num = np.asarray(num, dtype=float)
    den = np.asarray(den, dtype=float)
    return (num + strength * prior) / (den + strength)


def harmonize(modis, viirs: dict, k: dict, modis_on, viirs_on: dict):
    """Pooled inverse-variance estimate in MODIS-equivalent units.

    modis: MODIS count per row (already Terra->Terra+Aqua corrected where needed)
    viirs: {sensor: counts per row}; k: {sensor: ratio per row}
    modis_on / viirs_on: share of the month's window the sensor was observing
    (0..1; bool works too). A sensor that saw only part of the window gets
    proportionally less weight, so a 2-day month cannot drag the estimate down.
    Returns (harm, info) where info = sum of weights (MODIS 1, VIIRS k) of observing sensors.
    """
    modis = np.asarray(modis, dtype=float)
    m_on = np.asarray(modis_on, dtype=float)
    num = np.where(m_on > 0, modis, 0.0)
    den = m_on.copy()
    for s, v in viirs.items():
        on = np.asarray(viirs_on[s], dtype=float)
        num = num + np.where(on > 0, np.asarray(v, dtype=float), 0.0)
        den = den + k[s] * on
    harm = np.divide(num, den, out=np.zeros_like(num), where=den > 0)
    return harm, den


def pettitt(x) -> tuple[int, float]:
    """Pettitt change-point test. Returns (change index, approximate two-sided p).

    K = max |U_t|, U_t = sum_{i<=t} sum_{j>t} sign(x_j - x_i);
    p ~= 2 exp(-6 K^2 / (n^3 + n^2)).
    """
    x = np.asarray(x, dtype=float)
    n = len(x)
    sgn = np.sign(x[None, :] - x[:, None])  # [i, j] = sign(x_j - x_i)
    # U_t = sum over i<=t, j>t
    cum = np.cumsum(sgn, axis=0)  # rows summed up to i
    u = np.array([cum[t, t + 1 :].sum() for t in range(n - 1)])
    t_star = int(np.argmax(np.abs(u)))
    k_stat = float(np.abs(u[t_star]))
    p = min(1.0, 2.0 * np.exp(-6.0 * k_stat**2 / (n**3 + n**2)))
    return t_star, p


def deseasonalize_log(series: np.ndarray, months: np.ndarray) -> np.ndarray:
    """log1p(x) minus the mean of its calendar month, for break tests."""
    y = np.log1p(np.asarray(series, dtype=float))
    out = y.copy()
    for m in range(12):
        sel = months % 12 == m
        if sel.any():
            out[sel] = y[sel] - y[sel].mean()
    return out


def regression_metrics(pred, actual) -> dict:
    pred = np.asarray(pred, dtype=float)
    actual = np.asarray(actual, dtype=float)
    err = pred - actual
    ss_res = float((err**2).sum())
    ss_tot = float(((actual - actual.mean()) ** 2).sum())
    return {
        "bias_pct": round(100.0 * err.sum() / actual.sum(), 2) if actual.sum() else None,
        "mae": round(float(np.abs(err).mean()), 2),
        "r2": round(1.0 - ss_res / ss_tot, 3) if ss_tot else None,
        "n": int(len(actual)),
    }
