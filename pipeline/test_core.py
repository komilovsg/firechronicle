import numpy as np

from core import harmonize, month_index, month_label, pettitt, regression_metrics, shrunk_ratio


def test_month_index_roundtrip():
    assert month_index(2000, 1) == 0
    assert month_index(2012, 1) == 144
    assert month_index(2026, 11) == 322
    assert month_label(322) == "2026-11"
    assert month_label(10) == "2000-11"


def test_shrunk_ratio_limits():
    # lots of data -> raw ratio; no data -> prior
    r = shrunk_ratio(np.array([7000.0, 0.0]), np.array([1000.0, 0.0]), prior=5.0, strength=30)
    assert abs(r[0] - 7.0) < 0.07
    assert r[1] == 5.0


def test_harmonize_modis_only_is_identity():
    m = np.array([0.0, 3.0, 10.0])
    on = np.array([True, True, True])
    h, _ = harmonize(m, {"snpp": np.zeros(3)}, {"snpp": np.full(3, 7.0)}, on, {"snpp": np.zeros(3, bool)})
    assert np.allclose(h, m)


def test_harmonize_viirs_only_rescales():
    off = np.zeros(2, bool)
    h, _ = harmonize(np.zeros(2), {"n20": np.array([70.0, 14.0])}, {"n20": np.full(2, 7.0)}, off, {"n20": np.ones(2, bool)})
    assert np.allclose(h, [10.0, 2.0])


def test_harmonize_unbiased_on_simulated_overlap():
    rng = np.random.default_rng(0)
    mu = rng.uniform(0.5, 30, 20000)
    k1, k2 = 7.0, 6.0
    m = rng.poisson(mu)
    v1 = rng.poisson(k1 * mu)
    v2 = rng.poisson(k2 * mu)
    on = np.ones_like(mu, bool)
    h, _ = harmonize(m, {"a": v1, "b": v2}, {"a": np.full_like(mu, k1), "b": np.full_like(mu, k2)}, on, {"a": on, "b": on})
    assert abs(h.sum() / mu.sum() - 1) < 0.01
    # pooled estimate must be less noisy than MODIS alone
    assert np.var(h - mu) < np.var(m - mu) / 5


def test_partial_month_sensor_does_not_bias():
    # S-NPP saw 2 of 14 days: its 2-day count must be weighted, not treated as a full window
    mu = np.array([100.0])
    m = mu
    v_full = 7 * mu
    v_part = 7 * mu * (2 / 14)
    h, _ = harmonize(m, {"n20": v_full, "snpp": v_part}, {"n20": np.array([7.0]), "snpp": np.array([7.0])},
                     np.array([1.0]), {"n20": np.array([1.0]), "snpp": np.array([2 / 14])})
    assert abs(h[0] - 100.0) < 1e-9


def test_no_sensor_on_gives_zero():
    off = np.zeros(1, bool)
    h, den = harmonize(np.array([5.0]), {"a": np.array([9.0])}, {"a": np.array([7.0])}, off, {"a": off})
    assert h[0] == 0 and den[0] == 0


def test_pettitt_finds_step_and_ignores_noise():
    rng = np.random.default_rng(1)
    step = np.r_[rng.normal(0, 1, 100), rng.normal(2, 1, 100)]
    t, p = pettitt(step)
    assert 95 <= t <= 105 and p < 0.001
    _, p_noise = pettitt(rng.normal(0, 1, 200))
    assert p_noise > 0.05


def test_regression_metrics():
    m = regression_metrics([2, 4, 6], [2, 4, 6])
    assert m["bias_pct"] == 0 and m["mae"] == 0 and m["r2"] == 1.0
