/**
 * news-lib.js — coleta e classificação de notícias que impactam o xyz:SP500.
 *
 * Fontes CONFIÁVEIS, diretas dos publishers (funcionam tanto de IP residencial quanto
 * de datacenter/GitHub Actions — ao contrário do Google News, que bloqueia datacenter):
 * CNBC (várias seções), MarketWatch, Yahoo Finance, Investing, OilPrice, Al Jazeera,
 * The Guardian e NYT. O Google News entra como BÔNUS (só rende em IP residencial).
 *
 * Cada notícia é classificada POR PALAVRA-CHAVE do próprio título em S&P500 / Petróleo /
 * Guerra / EUA (não pela fonte), filtra últimas 24h, remove repetidas (título normalizado),
 * ordena por mais recente e traduz a manchete em IMPACTO DIRECIONAL sobre o índice.
 *
 * Feeds "amplos" (mundo/negócios genéricos) só entram se a manchete casar com um tema
 * relevante — assim não poluímos com esporte/cultura.
 *
 * Sem dependências externas. Exporta coletar() -> Promise<report>.
 */
const https = require("https");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
function get(url, timeoutMs = 11000, depth = 0) {
  return new Promise((resolve) => {
    let req;
    try {
      req = https.get(url, { headers: { "User-Agent": UA, "Accept": "application/rss+xml,application/xml,text/xml,*/*" } }, (r) => {
        if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && depth < 4) {
          r.resume(); return resolve(get(r.headers.location, timeoutMs, depth + 1));
        }
        let b = ""; r.on("data", c => b += c); r.on("end", () => resolve({ status: r.statusCode, body: b }));
      });
    } catch (_) { return resolve({ status: 0, body: "" }); }
    req.on("error", () => resolve({ status: 0, body: "" }));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ status: 0, body: "" }); });
  });
}

const gnews = (q) => "https://news.google.com/rss/search?q=" + encodeURIComponent(q + " when:1d") + "&hl=en-US&gl=US&ceid=US:en";
const cnbc = (id) => "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=" + id;

// broad:true => feed genérico; só mantém itens que casam com algum tema relevante.
const FEEDS = [
  // --- finanças / mercado (mantém tudo) ---
  { url: cnbc("100003114"), name: "CNBC", hint: "sp500", broad: false },
  { url: cnbc("10000664"),  name: "CNBC", hint: "sp500", broad: false },
  { url: cnbc("20910258"),  name: "CNBC", hint: "eua",   broad: false },
  { url: cnbc("19836768"),  name: "CNBC", hint: "petroleo", broad: false },
  { url: cnbc("15839135"),  name: "CNBC", hint: "sp500", broad: false },
  { url: "https://feeds.marketwatch.com/marketwatch/topstories/", name: "MarketWatch", hint: "sp500", broad: false },
  { url: "https://feeds.marketwatch.com/marketwatch/realtimeheadlines/", name: "MarketWatch", hint: "sp500", broad: false },
  { url: "https://finance.yahoo.com/news/rssindex", name: "Yahoo Finance", hint: "sp500", broad: false },
  { url: "https://www.investing.com/rss/news.rss", name: "Investing.com", hint: "sp500", broad: false },
  { url: "https://oilprice.com/rss/main", name: "OilPrice", hint: "petroleo", broad: false },
  // --- amplos (só o que casar com tema) ---
  { url: "https://www.aljazeera.com/xml/rss/all.xml", name: "Al Jazeera", hint: "guerra", broad: true },
  { url: "https://www.theguardian.com/world/rss", name: "The Guardian", hint: "guerra", broad: true },
  { url: "https://www.theguardian.com/business/rss", name: "The Guardian", hint: "sp500", broad: true },
  { url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml", name: "NYT", hint: "guerra", broad: true },
  { url: "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml", name: "NYT", hint: "sp500", broad: true },
  // --- Google News (bônus residencial; vazio em datacenter, sem problema) ---
  { url: gnews('war OR Iran OR Israel OR Ukraine OR Russia OR "Middle East" OR Hormuz OR airstrike'), name: "Google News", hint: "guerra", broad: false, gn: true },
  { url: gnews("oil price OR crude oil OR Brent OR WTI OR OPEC"), name: "Google News", hint: "petroleo", broad: false, gn: true },
  { url: gnews('"S&P 500" OR "stock market" OR "Wall Street" OR Nasdaq OR "Dow Jones"'), name: "Google News", hint: "sp500", broad: false, gn: true },
  { url: gnews('"Federal Reserve" OR inflation OR CPI OR "interest rates" OR tariffs OR "jobs report"'), name: "Google News", hint: "eua", broad: false, gn: true },
];

/* ------------------------------------------------------------- classificação por tema */
const KW = {
  petroleo: ["oil", "crude", "brent", "wti", "opec", "barrel", "gasoline", "diesel", "petroleum", "refinery", "refiner", "energy price"],
  guerra: ["war", "iran", "israel", "gaza", "hamas", "hezbollah", "houthi", "ukraine", "russia", "putin", "missile", "airstrike", "air strike", "attack", "military", "troops", "nato", "invasion", "ceasefire", "hormuz", "red sea", "nuclear", "sanction", "conflict", "tanker", "warship", "drone strike", "middle east"],
  eua: ["fed", "federal reserve", "powell", "inflation", "cpi", "ppi", "interest rate", "rate cut", "rate hike", "tariff", "treasury", "yield", "payroll", "jobless", "unemployment", "gdp", "recession", "white house", "congress", "tax bill", "shutdown", "fomc"],
  sp500: ["s&p", "s&p 500", "stock", "nasdaq", "dow", "wall street", "equities", "shares", "earnings", "stocks", "index", "etf", "futures", "rally", "selloff", "nvidia", "apple", "tesla", "megacap"],
};
const PRIOR = ["guerra", "petroleo", "eua", "sp500"];
function classify(title) {
  const t = " " + title.toLowerCase() + " ";
  let best = null, bestN = 0;
  for (const cat of PRIOR) {
    let n = 0;
    for (const w of KW[cat]) if (t.includes(w)) n++;
    if (n > bestN) { bestN = n; best = cat; }
  }
  return best;   // null se nada casar
}

/* ------------------------------------------------------------- parsing de RSS */
function decode(s) {
  return (s || "").replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, "").trim();
}
function field(item, name) {
  const m = item.match(new RegExp("<" + name + "[^>]*>([\\s\\S]*?)</" + name + ">", "i"));
  return m ? decode(m[1]) : "";
}
function parseItems(xml, feed) {
  const out = [];
  const blocks = xml.split(/<item[ >]/i).slice(1);
  for (const b of blocks.slice(0, 40)) {
    const raw = b.split(/<\/item>/i)[0];
    let title = field(raw, "title");
    if (!title || title.length < 12) continue;
    const link = field(raw, "link") || (raw.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1] || "";
    const pub = field(raw, "pubDate") || field(raw, "dc:date") || field(raw, "published") || field(raw, "updated");
    let source = field(raw, "source");
    if (!source && feed.gn) { const dash = title.lastIndexOf(" - "); if (dash > 20) { source = title.slice(dash + 3); title = title.slice(0, dash); } }
    let t = pub ? Date.parse(pub) : NaN;
    if (!isNaN(t) && t > Date.now()) t = Date.now();          // notícia não vem do futuro (feeds com TZ adiantado)
    out.push({ title: title.trim(), link: (link || "").trim(), source: (source || "").trim(), time: isNaN(t) ? null : t, feed });
  }
  return out;
}

/* ------------------------------------------------------------- dedupe e impacto */
function normKey(title) {
  return title.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
}
const BAIXA = ["sell off", "selloff", "sell-off", "tumble", "plunge", "slump", "sink", "slide", "drop", "fall", "crash", "rout", "fear", "recession", "hawkish", "rate hike", "hike rates", "hot inflation", "inflation rises", "sticky inflation", "spike", "surge in oil", "oil jumps", "oil soars", "crude jumps", "oil rises", "oil climbs", "tariff", "escalat", "attack", "airstrike", "missile", "strike on", "invasion", "war", "conflict", "sanction", "shutdown", "downgrade", "layoff", "jobless claims rise", "yields rise", "yields jump", "dollar surges", "warns", "slashes", "cuts forecast"];
const ALTA = ["rally", "rebound", "surge", "soar", "jump", "gain", "climb", "rise", "record high", "all-time high", "beats", "beat estimates", "cools", "cooling", "dovish", "rate cut", "cut rates", "cuts rates", "eases", "optimism", "relief", "ceasefire", "de-escalat", "truce", "deal reached", "oil falls", "oil drops", "crude falls", "inflation cools", "inflation eases", "soft landing", "stimulus", "upgraded", "tops estimates"];
function impacto(title, cat) {
  const t = title.toLowerCase();
  let score = 0;
  for (const w of BAIXA) if (t.includes(w)) score -= 1;
  for (const w of ALTA) if (t.includes(w)) score += 1;
  if (cat === "petroleo" && score === 0 && /\b(up|higher|rise|jump|surge|soar|top|climb|gain)\b/.test(t)) score -= 1;
  if (cat === "guerra" && score === 0) score -= 1;
  const dir = score > 0 ? "alta" : score < 0 ? "baixa" : "neutro";
  return { dir, forca: Math.min(3, Math.abs(score)) };
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
      if (it.time != null && it.time < cutoff) continue;      // só últimas 24h (sem data: mantém)
      let cat = classify(it.title);
      if (!cat) { if (it.feed.broad) continue; cat = it.feed.hint; }  // feed amplo sem tema => descarta
      const k = normKey(it.title);
      if (!k || seen[k]) continue;                            // não repete
      seen[k] = 1;
      const imp = impacto(it.title, cat);
      itens.push({
        title: it.title, link: it.link, source: it.source || it.feed.name || "—", time: it.time,
        cat, key: k, impacto: imp.dir,
        impactoTexto: imp.dir === "alta" ? "📈 tende a favorecer ALTA do S&P" : imp.dir === "baixa" ? "📉 pressiona o S&P para BAIXO" : "➖ impacto ambíguo/indireto",
        forca: imp.forca,
      });
    }
  }
  itens.sort((a, b) => (b.time || 0) - (a.time || 0));
  const mostrados = itens.slice(0, 120);
  const porCat = {};
  ["guerra", "petroleo", "sp500", "eua"].forEach(c => porCat[c] = mostrados.filter(i => i.cat === c).length);
  const bal = { alta: mostrados.filter(i => i.impacto === "alta").length, baixa: mostrados.filter(i => i.impacto === "baixa").length, neutro: mostrados.filter(i => i.impacto === "neutro").length };
  return {
    geradoEm: new Date().toISOString(),
    total: mostrados.length,
    totalColetado: itens.length,
    porCategoria: porCat,
    balancoImpacto: bal,
    itens: mostrados,
    fontes: ["CNBC", "MarketWatch", "Yahoo Finance", "Investing.com", "OilPrice", "Al Jazeera", "The Guardian", "NYT", "Google News"],
  };
}

module.exports = { coletar, impacto, classify, normKey, FEEDS };
