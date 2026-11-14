// Builds src/index.json: parses corpus, adds a validation doc from meta.json,
// embeds every chunk and stores BM25 tokens. Run locally: npm run build-index
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./env.mjs";
import { tokenize } from "../src/tokenize.ts";
import { buildFactsDocs } from "../src/facts.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = loadEnv().GEMINI_API_KEY;
if (!KEY) { console.error("GEMINI_API_KEY missing in ../.env"); process.exit(1); }

function parseDoc(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error("no front matter");
  const meta = {};
  for (const line of m[1].split("\n")) {
    const k = line.match(/^([a-z_]+):\s*(.*)$/);
    if (k) meta[k[1]] = k[2].trim();
  }
  const sections = [];
  for (const part of m[2].split(/^## /m).slice(1)) {
    const nl = part.indexOf("\n");
    sections.push({ section: part.slice(0, nl).trim(), content: part.slice(nl + 1).trim() });
  }
  return { meta, sections };
}

const docs = [];
const dir = join(root, "corpus");
for (const f of readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
  const d = parseDoc(readFileSync(join(dir, f), "utf8"));
  if (d.meta.status === "archived") continue;
  docs.push(d);
}


const chunks = [];
let id = 1;
for (const d of docs) {
  for (const s of d.sections) {
    const text = `[${d.meta.title} | ${s.section}]\n${s.content}`;
    chunks.push({ id: id++, doc: d.meta.id, title: d.meta.title, section: s.section, url: d.meta.url, text });
  }
}
// data-derived chunks: same generator the Worker uses at runtime
const dataDir = join(root, "..", "web", "public", "data");
const meta = JSON.parse(readFileSync(join(dataDir, "meta.json"), "utf8"));
const regions = JSON.parse(readFileSync(join(dataDir, "regions.json"), "utf8")).regions;
let partial = null;
try { partial = JSON.parse(readFileSync(join(dataDir, "partial.json"), "utf8")); } catch { /* optional */ }
for (const f of buildFactsDocs(meta, regions, partial)) {
  chunks.push({ id: id++, doc: f.docId, title: f.title, section: f.section, url: f.url, text: f.text, live: true });
}
console.log(`docs=${docs.length} chunks=${chunks.length}`);

async function embedBatch(texts) {
  const body = { requests: texts.map((t) => ({ model: "models/gemini-embedding-001", content: { parts: [{ text: t }] }, taskType: "RETRIEVAL_DOCUMENT", outputDimensionality: 768 })) };
  for (let attempt = 0; attempt < 8; attempt++) {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents", {
      method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": KEY }, body: JSON.stringify(body),
    });
    if (r.status === 429 || r.status >= 500) { const wait = 2000 * 2 ** attempt; console.log(`embed ${r.status}, retry in ${wait}ms`); await new Promise((s) => setTimeout(s, wait)); continue; }
    if (!r.ok) throw new Error(`embed failed: ${r.status}`);
    return (await r.json()).embeddings.map((e) => e.values);
  }
  throw new Error("embed: out of retries");
}

const B = 20;
for (let i = 0; i < chunks.length; i += B) {
  const vecs = await embedBatch(chunks.slice(i, i + B).map((c) => c.text));
  vecs.forEach((v, j) => { chunks[i + j].embedding = v.map((x) => Math.round(x * 1e5) / 1e5); });
}
for (const c of chunks) c.tokens = tokenize(c.text);

const version = createHash("sha256").update(JSON.stringify(chunks.map((c) => c.text))).digest("hex").slice(0, 10);
writeFileSync(join(root, "src", "index.json"), JSON.stringify({ version, facts_generated_at: meta.generated_at, facts_data_through: meta.data_through, model: "gemini-embedding-001", dim: 768, chunks }));
console.log(`wrote src/index.json version=${version}`);
