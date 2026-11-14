#!/usr/bin/env python3
"""Generate README SVGs (hero, proof, how) from web/public/data. Stdlib only.
Run from anywhere: python3 assets/readme/src/build_assets.py"""
import json, math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "assets" / "readme"
DATA = ROOT / "web" / "public" / "data"
region = next(r for r in json.load(open(DATA / "regions.json"))["regions"] if r["id"] == "central-asia")
meta = json.load(open(DATA / "meta.json"))
v = meta["validation"]
naive_pct = round((v["naive_break_2012"]["jump_ratio"] - 1) * 100)
harm_pct = round((v["harmonized_break_2012"]["jump_ratio"] - 1) * 100)

THEMES = {
    "dark": dict(bg="#0e1217", panel="#161c24", line="#2a333f", fg="#f3efe8", muted="#97a3b0",
                 ember="#ff7a2e", harm="#fee838", grid="#242d38"),
    "light": dict(bg="#f7f4ee", panel="#ffffff", line="#d9d3c7", fg="#16191d", muted="#58626d",
                  ember="#c2410c", harm="#00336f", grid="#e4ded2"),
}
FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"
MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"

# cividis anchors (matplotlib)
CIV = [(0, (0, 34, 78)), (.25, (53, 69, 108)), (.5, (124, 123, 120)), (.75, (188, 175, 111)), (1, (254, 232, 56))]
def civ(x):
    x = max(0.0, min(1.0, x))
    for (a, ca), (b, cb) in zip(CIV, CIV[1:]):
        if x <= b:
            f = (x - a) / (b - a)
            return "#%02x%02x%02x" % tuple(round(ca[i] + (cb[i] - ca[i]) * f) for i in range(3))
    return "#fee838"

def head(w, h, title, desc, th):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" '
            f'role="img" aria-labelledby="t d"><title id="t">{title}</title><desc id="d">{desc}</desc>'
            f'<rect width="{w}" height="{h}" rx="24" fill="{th["bg"]}"/>')

def mark(cx, cy, s, th):
    # orbit arc + ember dot (same idea as the app brand mark)
    r = 30 * s
    return (f'<g><path d="M {cx - r:.1f} {cy + r * .35:.1f} A {r:.1f} {r:.1f} 0 1 1 {cx + r * .9:.1f} {cy + r * .55:.1f}" '
            f'fill="none" stroke="{th["fg"]}" stroke-width="{3.5 * s:.1f}" stroke-linecap="round"/>'
            f'<circle cx="{cx + r * .9:.1f}" cy="{cy + r * .55:.1f}" r="{7 * s:.1f}" fill="{th["ember"]}"/></g>')

def hero(name, th):
    W, H = 1200, 440
    s = head(W, H, "FireChronicle", "FireChronicle: one fire history, before and after MODIS. A real burning calendar of Central Asia, "
             "27 years by 12 months, harmonized MODIS and VIIRS.", th)
    s += mark(112, 130, 1.5, th)
    s += f'<text x="176" y="150" font-family="{FONT}" font-size="64" font-weight="800" letter-spacing="1" fill="{th["fg"]}">FireChronicle</text>'
    s += f'<text x="60" y="244" font-family="{FONT}" font-size="40" font-weight="700" fill="{th["fg"]}">One fire history,</text>'
    s += f'<text x="60" y="292" font-family="{FONT}" font-size="40" font-weight="700" fill="{th["ember"]}">before and after MODIS.</text>'
    s += f'<text x="60" y="344" font-family="{FONT}" font-size="22" fill="{th["muted"]}">MODIS + VIIRS on one scale, Central Asia, 2000 to today.</text>'
    s += f'<text x="60" y="386" font-family="{MONO}" font-size="18" fill="{th["muted"]}">Space Apps 2026 · Deep Space AI</text>'
    # calendar
    ts, hv = region["t"], region["harm"]
    byt = {t: x for t, x in zip(ts, hv)}
    vals = sorted(x for x in hv if x)
    hi = vals[int(len(vals) * 0.97)]
    x0, y0, cw, ch, gap = 740, 52, 28, 11, 3
    for yi in range(27):
        for m in range(12):
            t = yi * 12 + m
            x, y = x0 + m * (cw + gap), y0 + yi * (ch + gap)
            val = byt.get(t)
            if val is None:
                s += f'<rect x="{x}" y="{y}" width="{cw}" height="{ch}" rx="2" fill="none" stroke="{th["line"]}" stroke-width="1"/>'
            else:
                s += f'<rect x="{x}" y="{y}" width="{cw}" height="{ch}" rx="2" fill="{civ(math.sqrt(val / hi))}"/>'
    for m, l in enumerate("JFMAMJJASOND"):
        s += f'<text x="{x0 + m * (cw + gap) + cw / 2}" y="{y0 - 12}" text-anchor="middle" font-family="{MONO}" font-size="16" fill="{th["muted"]}">{l}</text>'
    for yi, lab in ((0, "2000"), (13, "2013"), (26, "2026")):
        s += f'<text x="{x0 - 12}" y="{y0 + yi * (ch + gap) + 10}" text-anchor="end" font-family="{MONO}" font-size="16" fill="{th["muted"]}">{lab}</text>'
    s += '</svg>'
    (OUT / f"hero-{name}.svg").write_text(s)

def annual():
    a = {}
    for t, n, h in zip(region["t"], region["naive"], region["harm"]):
        y = 2000 + t // 12
        a.setdefault(y, [0, 0]); a[y][0] += n or 0; a[y][1] += h or 0
    return {y: a[y] for y in range(2001, 2026)}

def proof(name, th):
    W, H = 1200, 700
    s = head(W, H, "Naive stitching reverses the trend",
             f"Annual fire detections in Central Asia, 2001 to 2025. Naive stitching shows +{naive_pct}% after 2012, harmonized and MODIS-only show {harm_pct}%.", th)
    # headline stats
    s += f'<text x="60" y="84" font-family="{FONT}" font-size="26" font-weight="600" fill="{th["muted"]}">Central Asia, active fires per year</text>'
    s += f'<text x="60" y="152" font-family="{FONT}" font-size="52" font-weight="800" fill="{th["ember"]}">Naive stitching +{naive_pct}%</text>'
    s += f'<line x1="60" y1="138" x2="600" y2="138" stroke="{th["ember"]}" stroke-width="5"/>'
    s += f'<text x="660" y="152" font-family="{FONT}" font-size="52" font-weight="800" fill="{th["harm"]}">Harmonized −{abs(harm_pct)}%</text>'
    s += f'<text x="60" y="190" font-family="{FONT}" font-size="22" fill="{th["muted"]}">wrong: reverses the trend</text>'
    s += f'<text x="660" y="190" font-family="{FONT}" font-size="22" fill="{th["muted"]}">matches MODIS alone</text>'
    a = annual()
    px0, px1, py0, py1 = 130, 1130, 240, 610
    ymax = 250000
    X = lambda y: px0 + (y - 2001) / 24 * (px1 - px0)
    Y = lambda val: py1 - val / ymax * (py1 - py0)
    for g in (0, 100000, 200000):
        s += f'<line x1="{px0}" y1="{Y(g)}" x2="{px1}" y2="{Y(g)}" stroke="{th["grid"]}" stroke-width="2"/>'
        lab = "0" if g == 0 else f"{g // 1000}k"
        s += f'<text x="{px0 - 14}" y="{Y(g) + 7}" text-anchor="end" font-family="{MONO}" font-size="20" fill="{th["muted"]}">{lab}</text>'
    for y in (2001, 2006, 2012, 2018, 2025):
        s += f'<text x="{X(y)}" y="{py1 + 34}" text-anchor="middle" font-family="{MONO}" font-size="20" fill="{th["muted"]}">{y}</text>'
    # 2012 marker
    s += f'<line x1="{X(2012)}" y1="{py0 - 6}" x2="{X(2012)}" y2="{py1}" stroke="{th["muted"]}" stroke-width="2" stroke-dasharray="6 6"/>'
    s += f'<text x="{X(2012) - 12}" y="{py0 + 18}" text-anchor="end" font-family="{FONT}" font-size="20" fill="{th["fg"]}">VIIRS S-NPP starts</text>'
    def line(i, col, w):
        d = " ".join(("M" if k == 0 else "L") + f"{X(y):.1f} {Y(a[y][i]):.1f}" for k, y in enumerate(a))
        return f'<path d="{d}" fill="none" stroke="{col}" stroke-width="{w}" stroke-linejoin="round" stroke-linecap="round"/>'
    s += line(1, th["harm"], 6) + line(0, th["ember"], 6)
    s += f'<circle cx="{X(2017)}" cy="{Y(a[2017][0])}" r="7" fill="{th["ember"]}"/>'
    s += f'<text x="{X(2017) + 16}" y="{Y(a[2017][0]) + 8}" font-family="{FONT}" font-size="22" font-weight="700" fill="{th["ember"]}">naive</text>'
    s += f'<text x="{X(2017) + 16}" y="{Y(a[2017][1]) - 14}" font-family="{FONT}" font-size="22" font-weight="700" fill="{th["harm"]}">harmonized</text>'
    s += f'<text x="{px1}" y="{H - 24}" text-anchor="end" font-family="{MONO}" font-size="18" fill="{th["muted"]}">MODIS-equivalent detections, annual totals</text>'
    s += '</svg>'
    (OUT / f"proof-{name}.svg").write_text(s)

def how(name, th):
    W, H = 1200, 560
    s = head(W, H, "How FireChronicle works",
             "Pipeline: NASA FIRMS, clean, H3 grid, calibrate, pooled estimate, static web app.", th)
    steps = [
        ("1", "NASA FIRMS", ["MODIS + 3× VIIRS", "6.3 M raw rows"]),
        ("2", "Clean", ["vegetation fires only", "confidence filter,", "static sources out"]),
        ("3", "H3 grid", ["resolution 5, ~253 km²", "monthly counts"]),
        ("4", "Calibrate", ["k per country × month", "shrunk, SP years only"]),
        ("5", "Pooled estimate", ["(M + ΣV) / (1 + Σk)", "MODIS-equivalent"]),
        ("6", "Static web app", ["calendar, map,", "CSV downloads"]),
    ]
    cw, chh, gx = 330, 190, 55
    xs = [50 + i * (cw + gx) for i in range(3)]
    ys = [60, 310]
    for i, (n, t, lines) in enumerate(steps):
        x, y = xs[i % 3], ys[i // 3]
        last = i == 5
        s += f'<rect x="{x}" y="{y}" width="{cw}" height="{chh}" rx="16" fill="{th["panel"]}" stroke="{th["ember"] if last else th["line"]}" stroke-width="{3 if last else 2}"/>'
        s += f'<circle cx="{x + 40}" cy="{y + 44}" r="20" fill="{th["ember"]}"/>'
        s += f'<text x="{x + 40}" y="{y + 52}" text-anchor="middle" font-family="{FONT}" font-size="24" font-weight="800" fill="{"#0e1217" if name == "dark" else "#ffffff"}">{n}</text>'
        s += f'<text x="{x + 76}" y="{y + 54}" font-family="{FONT}" font-size="28" font-weight="700" fill="{th["fg"]}">{t}</text>'
        for k, l in enumerate(lines):
            fam = MONO if i == 4 and k == 0 else FONT
            s += f'<text x="{x + 28}" y="{y + 102 + k * 30}" font-family="{fam}" font-size="22" fill="{th["muted"] if not (i == 4 and k == 0) else th["fg"]}">{l}</text>'
    for r in (0, 1):
        for c in (0, 1):
            ax = xs[c] + cw + 12; ay = ys[r] + chh / 2
            s += f'<path d="M{ax} {ay} L{ax + gx - 24} {ay} M{ax + gx - 36} {ay - 10} L{ax + gx - 24} {ay} L{ax + gx - 36} {ay + 10}" fill="none" stroke="{th["muted"]}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'
    # wrap connector from step 3 down to step 4
    ex, ey = xs[2] + cw / 2, ys[0] + chh + 6
    s += (f'<path d="M{ex} {ey} L{ex} {ey + 24} L{xs[0] + cw / 2} {ey + 24} L{xs[0] + cw / 2} {ys[1] - 14} '
          f'M{xs[0] + cw / 2 - 10} {ys[1] - 26} L{xs[0] + cw / 2} {ys[1] - 14} L{xs[0] + cw / 2 + 10} {ys[1] - 26}" '
          f'fill="none" stroke="{th["muted"]}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>')
    s += '</svg>'
    (OUT / f"how-{name}.svg").write_text(s)

for n, th in THEMES.items():
    hero(n, th); proof(n, th); how(n, th)
print("ok", naive_pct, harm_pct)
