# sp500-news — feed público de notícias para o S&P500 Terminal

Coletor 24/7 de notícias que podem impactar o índice S&P 500. Roda no GitHub Actions
a cada 30 minutos e publica `news_report.json`, consumido pelo app **S&P500 Terminal**
diretamente do navegador (via `raw.githubusercontent.com`, com CORS liberado).

## O que coleta

Últimas 24 horas, mais recentes no topo, sem repetição, em 4 frentes:

- **S&P 500 / Mercado** — Wall Street, Nasdaq, Dow, equities
- **Petróleo** — Brent, WTI, OPEC, preços de energia
- **Guerra / Geopolítica** — Irã, Israel, Ucrânia, Rússia, Oriente Médio, Ormuz
- **EUA / Macro** — Fed, inflação, CPI, juros, tarifas, emprego

Fontes confiáveis via Google News RSS (Reuters, CNBC, Bloomberg, AP, WSJ…) + CNBC direto.

Cada manchete recebe um **impacto direcional** heurístico sobre o índice
(📈 favorece alta · 📉 pressiona baixa · ➖ neutro): petróleo em alta e escalada
militar pesam para baixo (risco/custo); corte de juros e trégua, para cima.

## Arquivos

| Arquivo | O quê |
|---|---|
| `news-lib.js` | Coleta, parse RSS, dedupe, categorização e impacto. Sem dependências. |
| `news.js` | Runner do cron: coleta → marca novas (vs `news_seen.json`) → grava `news_report.json`. |
| `news_report.json` | **Saída pública** consumida pelo app. `{ geradoEm, total, porCategoria, balancoImpacto, itens[] }`. |
| `news_seen.json` | Memória de manchetes já vistas (poda 48h) para marcar o que é novo. |

## Conteúdo

Somente manchetes públicas, nomes de fontes, horários e o rótulo de impacto.
**Nenhum dado pessoal, de carteira ou de trading.** Por isso o repositório é público.

Rodar manual: `node news.js`. Disparar o workflow: `gh workflow run news.yml --repo CissaD/sp500-news`.
