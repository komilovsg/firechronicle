import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFactsDocs } from "../src/facts.ts";
import { applyFacts, getLiveFacts, LIVE_URLS, CHECK_EVERY_MS } from "../src/live.ts";
import { findUnverifiedNumbers } from "../src/prompt.ts";
import { applyNavKeywords, validateNav } from "../src/nav.ts";
import { tokenize } from "../src/tokenize.ts";
import type { Chunk } from "../src/retrieve.ts";

// Small deterministic fixture: one region, Nov 2000 .. Nov 2026
function fixture(scale = 1, through = "2026-11-14") {
  const t: number[] = [], harm: number[] = [];
  for (let k = 10; k <= 322; k++) { t.push(k); harm.push(Math.round(((k * 37) % 101 + 5) * scale)); }
  const meta = { generated_at: "g" + scale, data_through: through, t_first: 10, t_last: 322, validation: { cv: {} }, calibration: {}, cleaning: { type0_removed_pct: 2.9 } };
  return { meta, regions: [{ id: "TJK", name: "Tajikistan", t, harm }], partial: null };
}

describe("buildFactsDocs", () => {
  it("is deterministic", () => {
    const f = fixture();
    expect(buildFactsDocs(f.meta, f.regions, f.partial)).toEqual(buildFactsDocs(f.meta, f.regions, f.partial));
  });
  it("matches snapshot", () => {
    const f = fixture();
    expect(buildFactsDocs(f.meta, f.regions, f.partial)).toMatchSnapshot();
  });
  it("adds data-through sentence and omits missing fields", () => {
    const f = fixture();
    const docs = buildFactsDocs(f.meta, f.regions, f.partial);
    const reg = docs.find((d) => d.docId === "regions")!;
    expect(reg.text).toContain("Data through 2026-11-14.");
    expect(reg.section).toBe("Tajikistan (TJK)");
    expect(docs.find((d) => d.docId === "validation")!.text).not.toMatch(/Cross-validation/);
  });
});

const base = (text: string): Chunk => ({ id: 1, doc: "regions", title: "T", section: "Tajikistan (TJK)", url: "u", text, embedding: [1, 2, 3], tokens: tokenize(text), ...({ live: true } as object) });

describe("applyFacts", () => {
  it("replaces text and tokens, keeps embeddings, skips unknown sections and static chunks", () => {
    const f = fixture(2);
    const chunks = [
      base("old text 99999"),
      { ...base("other"), section: "Narnia (NAR)" },
      { ...base("static"), doc: "method", section: "Tajikistan (TJK)", live: undefined } as Chunk,
    ];
    const out = applyFacts(chunks, f);
    expect(out[0].text).toContain("Tajikistan");
    expect(out[0].tokens).toEqual(tokenize(out[0].text));
    expect(out[0].tokens).not.toContain("99999");
    expect(out[0].embedding).toEqual([1, 2, 3]);
    expect(out[1].text).toBe("other");
    expect(out[2].text).toBe("static");
  });
});

describe("number check uses live text", () => {
  it("live number passes, baked-only number fails after replacement", () => {
    const oldF = fixture(1), newF = fixture(3);
    const oldText = buildFactsDocs(oldF.meta, oldF.regions, null).find((d) => d.docId === "regions")!.text;
    const newText = buildFactsDocs(newF.meta, newF.regions, null).find((d) => d.docId === "regions")!.text;
    const med = (t: string) => t.match(/Median annual harmonized total in Tajikistan for 2001-2025: ([\d ]+) MODIS/)![1];
    const oldMed = med(oldText), newMed = med(newText);
    expect(oldMed).not.toBe(newMed);
    expect(findUnverifiedNumbers(`The median is ${newMed}.`, newText)).toEqual([]);
    expect(findUnverifiedNumbers(`The median is ${oldMed}.`, newText)).not.toEqual([]);
  });
});

function fakeKV() {
  const m = new Map<string, string>();
  return { get: async (k: string, t?: string) => (m.has(k) ? (t === "json" ? JSON.parse(m.get(k)!) : m.get(k)) : null), put: async (k: string, v: string) => { m.set(k, v); } } as unknown as KVNamespace;
}
const stubFetch = (data: ReturnType<typeof fixture> | null, partial404 = true) =>
  vi.stubGlobal("fetch", async (url: string) => {
    if (!data) throw new Error("network");
    if (url === LIVE_URLS.meta) return new Response(JSON.stringify(data.meta));
    if (url === LIVE_URLS.regions) return new Response(JSON.stringify({ regions: data.regions }));
    if (url === LIVE_URLS.partial) return partial404 ? new Response("", { status: 404 }) : new Response(JSON.stringify(data.partial));
    throw new Error("unexpected url " + url);
  });

describe("getLiveFacts", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("falls back to baked, then goes live, then reuses the cached copy when the fetch fails", async () => {
    const kv = fakeKV();
    stubFetch(null);
    const a = await getLiveFacts(kv, 1_000);
    expect(a.data).toBeNull(); expect(a.status.source).toBe("baked"); expect(a.stale).toBe(true);

    stubFetch(fixture(1));
    const b = await getLiveFacts(kv, 2_000);
    expect(b.status.source).toBe("live"); expect(b.status.generated_at).toBe("g1"); expect(b.data?.regions.length).toBe(1);

    stubFetch(null);
    const c = await getLiveFacts(kv, 2_000 + CHECK_EVERY_MS + 1);
    expect(c.status.source).toBe("live"); expect(c.stale).toBe(true); expect(c.data?.meta.generated_at).toBe("g1");
  });
  it("rejects malformed live data", async () => {
    const kv = fakeKV();
    vi.stubGlobal("fetch", async (url: string) => (url === LIVE_URLS.meta ? new Response("{}") : new Response(JSON.stringify({ regions: "x" }))));
    const r = await getLiveFacts(kv, 10 * CHECK_EVERY_MS);
    expect(r.data).toBeNull();
  });
});

describe("nav keyword pass", () => {
  it("fills mode and compare when the model left them out", () => {
    expect(applyNavKeywords("show Kazakhstan 2015 to 2020 swipe", { area: "KAZ", yearFrom: 2015, yearTo: 2020 })).toEqual({ area: "KAZ", yearFrom: 2015, yearTo: 2020, mode: "swipe" });
    expect(applyNavKeywords("Kazakhstan versus Uzbekistan", { area: "KAZ" })).toEqual({ area: "KAZ", compare: "UZB" });
    expect(applyNavKeywords("Kyrgyzstan compare with Central Asia naive", { area: "KGZ" })).toEqual({ area: "KGZ", compare: "central-asia", mode: "naive" });
    expect(applyNavKeywords("Tajikistan raw MODIS", { area: "TJK" })?.mode).toBe("modis");
    expect(applyNavKeywords("raw VIIRS only", null)).toEqual({ mode: "viirs" });
    expect(applyNavKeywords("harmonized TJK against AFG", { area: "TJK" })).toEqual({ area: "TJK", mode: "harm", compare: "AFG" });
  });
  it("never overrides model values and drops invalid compare", () => {
    expect(applyNavKeywords("KAZ swipe", { area: "KAZ", mode: "naive" })?.mode).toBe("naive");
    expect(applyNavKeywords("Kazakhstan vs Kazakhstan", { area: "KAZ" })).toEqual({ area: "KAZ" });
    expect(applyNavKeywords("Kazakhstan vs Mars", { area: "KAZ" })).toEqual({ area: "KAZ" });
  });
  it("returns null when nothing is found", () => {
    expect(applyNavKeywords("what is the weather", null)).toBeNull();
    expect(validateNav({})).toBeNull();
  });
});
