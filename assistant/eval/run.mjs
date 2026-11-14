// Sequential eval of golden.json against the deployed worker.
// Usage: node eval/run.mjs [--url <worker-url>] [--modes vector,hybrid]
// Needs GEMINI_API_KEY and DEBUG_TOKEN in ../.env (never printed).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../scripts/env.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const env = loadEnv();
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const URL_ = arg("url", "https://firechronicle-assistant.firechronicle-assistant.workers.dev");
const MODES = arg("modes", "vector,hybrid").split(",");
const gold = JSON.parse(readFileSync(join(here, "..", "golden.json"), "utf8")).items;
const CHAIN = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash-lite", "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-2.5-flash"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ask(q, mode) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`${URL_}/ask`, {
      signal: AbortSignal.timeout(60000),
      method: "POST",
      headers: { "content-type": "application/json", "x-debug-token": env.DEBUG_TOKEN, "x-retrieval-mode": mode },
      body: JSON.stringify({ q, lang: "en" }),
    }).catch(() => ({ status: 503 }));
    if (r.status === 200) return r.json();
    if (r.status === 503 && !r.json) { await sleep(2000); continue; }
    if (r.status === 503 || r.status === 500) { await sleep(3000); continue; }
    return { error: `http ${r.status}` };
  }
  return { error: "unavailable" };
}

async function judge(item, answer, context, answeredBy) {
  const prompt = `CONTEXT:\n${context}\n\nQUESTION: ${item.q}\nEXPECTED: ${item.expect}\nANSWER: ${answer}\n\nQ1: Is every claim in ANSWER supported by CONTEXT? (supported: true/false)\nQ2: Does ANSWER answer QUESTION correctly per EXPECTED? (correct: true/false)\nReply as JSON.`;
  for (const model of CHAIN.filter((m) => m !== answeredBy)) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST", signal: AbortSignal.timeout(30000), headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 600, responseMimeType: "application/json", responseSchema: { type: "OBJECT", properties: { supported: { type: "BOOLEAN" }, correct: { type: "BOOLEAN" } }, required: ["supported", "correct"] } },
      }),
    }).catch(() => ({ status: 0 }));
    if (r.status !== 200) continue;
    try {
      const t = (await r.json()).candidates[0].content.parts.map((p) => p.text).join("");
      const j = JSON.parse(t);
      return { supported: !!j.supported, correct: !!j.correct, model };
    } catch { /* next model */ }
  }
  return { supported: null, correct: null, model: null };
}

const NOT_IN_BASE = /not in the (firechronicle )?knowledge base|нет в базе знаний|дар пойгоҳи дониш/i;
const trapCheck = {
  4: (a) => /10\.5067\/VIIRS\/VJ114IMG\.002/i.test(a) && !/VNP14IMG\.002|VJ214IMG\.002/i.test(a),
  5: (a) => /^\W*no\b/i.test(a) && !NOT_IN_BASE.test(a) && /VJ114IMG/i.test(a) && /NOAA-21/i.test(a),
  6: (a) => /MCD14ML/.test(a) && /MCD14DL/.test(a) && /near[- ]real[- ]time|NRT/i.test(a),
};

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(0)}% (${n}/${d})` : "n/a");
const summary = {};
const sections = [];
mkdirSync(join(here, "raw"), { recursive: true });

for (const mode of MODES) {
  const rows = [];
  for (const item of gold) {
    const t0 = Date.now();
    const res = await ask(item.q, mode);
    const dbg = res.debug ?? {};
    const retrieved = dbg.retrieved ?? [];
    const row = { id: item.id, kind: item.kind, q: item.q, refused: res.refused ?? null, reason: res.reason ?? null, model: res.model ?? null, answer: res.answer ?? res.error ?? "", chat_calls: dbg.chat_calls ?? null, maxSim: dbg.maxSim ?? null, ms: Date.now() - t0 };
    row.hit = item.evidence ? retrieved.some((c) => c.text.includes(item.evidence)) : null;
    if (item.kind === "crash") row.honest = row.refused === true || NOT_IN_BASE.test(row.answer);
    else row.falseRefusal = row.refused === true;
    if (item.kind === "trap" && trapCheck[item.id]) row.trapOk = !row.refused && trapCheck[item.id](row.answer);
    if (!row.refused && item.kind !== "crash") {
      const j = await judge(item, row.answer, retrieved.map((c) => c.text).join("\n---\n"), row.model);
      Object.assign(row, { faithful: j.supported, correct: j.correct, judge: j.model });
    } else if (!row.refused) {
      const j = await judge(item, row.answer, retrieved.map((c) => c.text).join("\n---\n"), row.model);
      Object.assign(row, { faithful: j.supported, judge: j.model });
    }
    rows.push(row);
    console.log(`${mode} #${item.id} ${item.kind} refused=${row.refused} reason=${row.reason} hit=${row.hit} model=${row.model}`);
    await sleep(1500);
  }
  writeFileSync(join(here, "raw", `${mode}.json`), JSON.stringify(rows, null, 1));
  const facts = rows.filter((r) => r.kind !== "crash");
  const crash = rows.filter((r) => r.kind === "crash");
  const answered = rows.filter((r) => r.faithful !== undefined && r.faithful !== null);
  const s = {
    hit: [facts.filter((r) => r.hit).length, facts.length],
    crash: [crash.filter((r) => r.honest).length, crash.length],
    falseRef: facts.filter((r) => r.falseRefusal).length,
    faith: [answered.filter((r) => r.faithful).length, answered.length],
    correct: [facts.filter((r) => r.correct).length, facts.filter((r) => !r.refused).length],
    traps: [rows.filter((r) => r.trapOk).length, Object.keys(trapCheck).length],
    noChatOutOfScope: rows.filter((r) => r.reason === "out_of_scope").map((r) => r.id),
  };
  summary[mode] = s;
  const esc = (t) => String(t).replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 140);
  sections.push(`## Mode: ${mode}\n\n| id | kind | refused | reason | hit | faithful | correct | trap | answered by | judge | maxSim | answer |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n` +
    rows.map((r) => `| ${r.id} | ${r.kind} | ${r.refused} | ${r.reason ?? ""} | ${r.hit ?? ""} | ${r.faithful ?? ""} | ${r.correct ?? ""} | ${r.trapOk ?? ""} | ${r.model ?? ""} | ${r.judge ?? ""} | ${r.maxSim ?? ""} | ${esc(r.answer)} |`).join("\n"));
}

const unjudged = Object.fromEntries(Object.keys(summary).map((m) => [m, 0]));
const head = `# FireChronicle assistant eval\n\nGenerated ${new Date().toISOString()}. Worker: ${URL_}\n\n| mode | hit rate | crash honesty | false refusals | faithfulness | correct (answered facts) | look-alike traps |\n|---|---|---|---|---|---|---|\n` +
  Object.entries(summary).map(([m, s]) => `| ${m} | ${pct(...s.hit)} | ${pct(...s.crash)} | ${s.falseRef} | ${pct(...s.faith)} | ${pct(...s.correct)} | ${s.traps[0]}/${s.traps[1]} |`).join("\n");
writeFileSync(join(here, "report.md"), `${head}\n\n${sections.join("\n\n")}\n`);
console.log(head);
