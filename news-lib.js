/**
 * news-lib.js — coleta e classificação de notícias que impactam o xyz:SP500.
 *
 * Fontes CONFIÁVEIS (Google News agrega Reuters/CNBC/Bloomberg/AP/WSJ com carimbo de
 * fonte e horário; CNBC direto entra como reforço de frescor). Filtra últimas 24h,
 * remove repetidas (por título normalizado), classifica em S&P500 / Petróleo / Guerra /
 * EUA e traduz cada manchete em IMPACTO DIRECIONAL sobre o ativo (alta/baixa/neutro),
 * seguindo o princípio de armar os dois lados e deixar a decisão com o usuário.
 *
 * Sem dependências externas (usa https nativo). Exporta coletar() -> Promise<report>.
 */
const https = require("https");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
function get(url, timeoutMs = 12000) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { "User-Agent": UA, "Accept": "application/rss+xml,application/xml,text/xml,*/*" } }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        r.resume(); return resolve(get(r.headers.location, timeoutMs));
      }
      let b = ""; r.on("data", c => b += c); r.on("end", () => resolve({ status: r.statusCode, body: b }));
    });
    req.on("error", () => resolve({ status: 0, body: "" }));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ status: 0, body: "" }); });
  });
}

const gnews = (q) => "https://news.google.com/rss/search?q=" + encodeURIComponent(q + " when:1d") + "&hl=en-US&gl=US&ceid=US:en";

// Cada categoria: rótulo + consulta. A ordem define a prioridade de rotulagem.
const FEEDS = [
  { cat: "guerra",  label: "Guerra / Geopolítica", url: gnews('war OR Iran OR Israel OR Ukraine OR Russia OR "Middle East" OR Hormuz OR conflict OR airstrike OR missile') },
  { cat: "petroleo",label: "Petróleo",             url: gnews("oil price OR crude oil OR Brent OR WTI OR OPEC OR energy prices") },
  { cat: "sp500",   label: "S&P 500 / Mercado",    url: gnews('"S&P 500" OR "stock market" OR "Wall Street" OR Nasdaq OR "Dow Jones" OR equities') },
  { cat: "eua",     label: "EUA / Macro",          url: gnews('"Federal Reserve" OR "US economy" OR inflation OR CPI OR "interest rates" OR tariffs OR "jobs report" OR Trump economy') },
  { cat: "sp500",   label: "CNBC",                 url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114" },
];

/* ------------------------------------------------------------- parsing de RSS */
function decode(s) {
  return (s || "").replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, "").trim();
}
function tag(item, name) {
  const m = item.match(new RegExp("<" + name + "[^>]*>([\\s\\S]*?)</" + name + ">", "i"));
  return m ? decode(m[1]) : "";
}
function parseItems(xml, feed) {
  const out = [];
  const blocks = xml.split(/<item>/i).slice(1);
  for (const b of blocks) {
    const raw = b.split(/<\/item>/i)[0];
    let title = tag(raw, "title");
    if (!title) continue;
    const link = tag(raw, "link");
    const pub = tag(raw, "pubDate");
    let source = tag(raw, "source");
    // Google News põe " - Fonte" no fim do título; separa
    if (!source) { const dash = title.lastIndexOf(" - "); if (dash > 20) { source = title.slice(dash + 3); title = title.slice(0, dash); } }
    const t = pub ? Date.parse(pub) : NaN;
    out.push({ title: title.trim(), link, source: (source || feed.label).trim(), time: isNaN(t) ? null : t, cat: feed.cat });
  }
  return out;
}

/* ------------------------------------------------------------- dedupe e impacto */
function normKey(title) {
  return title.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
}

// Léxico de impacto DIRECIONAL sobre o S&P500 (ativo). Petróleo/juros/guerra sobem -> pressão de baixa.
const BAIXA = ["sell off", "selloff", "sell-off", "tumble", "plunge", "slump", "sink", "slide", "drop", "fall", "crash", "rout", "fear", "recession", "hawkish", "rate hike", "hike rates", "hot inflation", "inflation rises", "sticky inflation", "spike", "surge in oil", "oil jumps", "oil soars", "crude jumps", "tariff", "escalat", "attack", "airstrike", "missile", "strike on", "invasion", "war", "conflict", "sanction", "shutdown", "downgrade", "layoff", "jobless claims rise", "yields rise", "yields jump", "dollar surges"];
const ALTA = ["rally", "rebound", "surge", "soar", "jump", "gain", "climb", "rise", "record high", "all-time high", "beats", "beat estimates", "cools", "cooling", "dovish", "rate cut", "cut rates", "cuts rates", "eases", "optimism", "relief", "ceasefire", "de-escalat", "truce", "deal reached", "oil falls", "oil drops", "crude falls", "inflation cools", "inflation eases", "soft landing", "stimulus"];

function impacto(title, cat) {
  const t = title.toLowerCase();
  let score = 0, hits = [];
  for (const w of BAIXA) if (t.includes(w)) { score -= 1; hits.push(w); }
  for (const w of ALTA) if (t.includes(w)) { score += 1; hits.push(w); }
  // Petróleo em alta e guerra são, por padrão, pressão de baixa para o índice (risco/custo)
  if (cat === "petroleo" && score === 0 && /\b(up|higher|rise|jump|surge|soar|top|climb)\b/.test(t)) score -= 1;
  if (cat === "guerra" && score === 0) score -= 1;
  const dir = score > 0 ? "alta" : score < 0 ? "baixa" : "neutro";
  const texto = dir === "alta" ? "📈 tende a favorecer ALTA do S&P" : dir === "baixa" ? "📉 pressiona o S&P para BAIXO" : "➖ impacto ambíguo/indireto";
  return { dir, texto, forca: Math.min(3, Math.abs(score)) };
}

/* ------------------------------------------------------------- coleta principal */
async function coletar(opts = {}) {
  const cutoff = Date.now() - (opts.horas || 24) * 3600 * 1000;
  const settled = await Promise.all(FEEDS.map(async f => {
    const r = await get(f.url);
    return r.status === 200 ? parseItems(r.body, f) : [];
  }));
  const seen = {}, itens = [];
  for (const arr of settled) {
    for (const it of arr) {
      if (it.time != null && it.time < cutoff) continue;      // só últimas 24h
      const k = normKey(it.title);
      if (!k || seen[k]) continue;                            // não repete
      seen[k] = 1;
      const imp = impacto(it.title, it.cat);
      itens.push({ ...it, key: k, impacto: imp.dir, impactoTexto: imp.texto, forca: imp.forca });
    }
  }
  // ordena por horário desc (mais recentes/últimos minutos no topo); sem horário vai pro fim
  itens.sort((a, b) => (b.time || 0) - (a.time || 0));
  const mostrados = itens.slice(0, 120);
  const porCat = {};
  ["guerra", "petroleo", "sp500", "eua"].forEach(c => porCat[c] = mostrados.filter(i => i.cat === c).length);
  const impacto_ = { alta: mostrados.filter(i => i.impacto === "alta").length, baixa: mostrados.filter(i => i.impacto === "baixa").length, neutro: mostrados.filter(i => i.impacto === "neutro").length };
  return {
    geradoEm: new Date().toISOString(),
    total: mostrados.length,
    totalColetado: itens.length,
    porCategoria: porCat,
    balancoImpacto: impacto_,
    itens: mostrados,
    fontes: FEEDS.map(f => f.label),
  };
}

module.exports = { coletar, impacto, normKey, FEEDS };
