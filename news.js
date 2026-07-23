#!/usr/bin/env node
/**
 * news.js — runner de nuvem (GitHub Actions, a cada 30 min).
 *
 * Coleta as notícias (news-lib.js), marca cada manchete como NOVA se ainda não foi
 * vista (persistido em news_seen.json, commitado de volta), e grava news_report.json.
 * O arquivo é servido publicamente por raw.githubusercontent.com com CORS liberado,
 * então o app S&P500 Terminal o consome direto do navegador, 24/7, sem servidor local.
 *
 * Sem dependências externas.
 */
const fs = require("fs");
const path = require("path");
const { coletar, normKey } = require("./news-lib.js");

const DIR = __dirname;
const SEEN = path.join(DIR, "news_seen.json");
const OUT = path.join(DIR, "news_report.json");

function loadSeen() {
  try { const o = JSON.parse(fs.readFileSync(SEEN, "utf8")); return o && o.seen ? o.seen : {}; } catch (_) { return {}; }
}
function saveSeen(seen) {
  const cut = Date.now() - 48 * 3600 * 1000, out = {};
  for (const k of Object.keys(seen)) if (seen[k] > cut) out[k] = seen[k];
  fs.writeFileSync(SEEN, JSON.stringify({ seen: out }));
}

(async () => {
  const rep = await coletar({ horas: 24 });
  const seen = loadSeen(), now = Date.now();
  rep.itens.forEach((it) => { const k = it.key || normKey(it.title); it.nova = !seen[k]; seen[k] = it.time || now; });
  rep.novas = rep.itens.filter((i) => i.nova).length;
  rep.fonte = "cloud";
  saveSeen(seen);
  fs.writeFileSync(OUT, JSON.stringify(rep));
  console.log("[news-cloud] " + rep.total + " itens (" + rep.novas + " novas) · " +
    "impacto alta=" + rep.balancoImpacto.alta + " baixa=" + rep.balancoImpacto.baixa + " neutro=" + rep.balancoImpacto.neutro);
})().catch((e) => { console.error("[news-cloud] falha:", e.message); process.exit(1); });
