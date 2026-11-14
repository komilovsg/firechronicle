// Prints max cosine similarity of every golden question (threshold selection).
import { readFileSync } from "node:fs";
import { loadEnv } from "./env.mjs";
import { retrieve } from "../src/retrieve.ts";
const KEY = loadEnv().GEMINI_API_KEY;
const idx = JSON.parse(readFileSync(new URL("../src/index.json", import.meta.url)));
const gold = JSON.parse(readFileSync(new URL("../golden.json", import.meta.url))).items;
for (const g of gold) {
  const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent", { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": KEY }, body: JSON.stringify({ content: { parts: [{ text: g.q }] }, taskType: "RETRIEVAL_QUERY", outputDimensionality: 768 }) });
  const v = (await r.json()).embedding.values;
  const out = {};
  for (const mode of ["vector", "hybrid"]) {
    const rr = retrieve(g.q, v, idx.chunks, { mode });
    const ev = g.evidence ? rr.hits.some((h) => h.chunk.text.includes(g.evidence)) : null;
    out[mode] = { ev, top: rr.hits.map((h) => h.chunk.id + (h.pinned ? "*" : "")).join(",") };
    out.max = rr.maxSim.toFixed(3);
  }
  console.log(String(g.id).padStart(2), g.kind.padEnd(5), "max", out.max, "vec", out.vector.ev, out.vector.top.padEnd(9), "hyb", out.hybrid.ev, out.hybrid.top);
}
