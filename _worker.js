// Cloudflare Pages (Direct Upload compatible) Worker
// 목적: 홈 상단 지수/환율이 '-'가 아니라 실제 값으로 표시되도록 /api/market 제공
// 배경: Pages Direct Upload(Zip 업로드)에서는 /functions 가 실행되지 않을 수 있어 _worker.js 로 처리합니다.

const UA = 'Mozilla/5.0 (compatible; JooLabBigData/1.0)';

function toNum(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/,/g, '').trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

async function fetchText(url) {
  const r = await fetch(url, {
    headers: {
      'user-agent': UA,
      'accept': 'text/html,application/json,text/plain,*/*',
      'accept-language': 'en-US,en;q=0.9,ko;q=0.8'
    }
  });
  if (!r.ok) throw new Error(`http_${r.status}`);
  return await r.text();
}

async function fetchJSON(url) {
  const r = await fetch(url, {
    headers: {
      'user-agent': UA,
      'accept': 'application/json,text/plain,*/*',
      'accept-language': 'en-US,en;q=0.9,ko;q=0.8'
    }
  });
  if (!r.ok) throw new Error(`http_${r.status}`);
  return await r.json();
}

function computeAbsChangeFromPct(price, pct) {
  if (price === null || pct === null) return null;
  const p = pct / 100;
  if (1 + p === 0) return null;
  return price - (price / (1 + p));
}

function parseKrxIndex(html, label) {
  const re = new RegExp(`\\b${label}\\b\\s*([0-9][0-9,]*\\.?[0-9]*)\\s*\\(([-+][0-9.]+)%\\)`, 'i');
  const m = html.match(re);
  if (!m) return null;
  const price = toNum(m[1]);
  const pct = toNum(m[2]);
  const change = computeAbsChangeFromPct(price, pct);
  return { price, change, pct, time: null, symbol: label };
}

async function fetchKrxMain() {
  const html = await fetchText('https://data.krx.co.kr/contents/MDC/MAIN/main/index.cmd?locale=en');
  return {
    kospi: parseKrxIndex(html, 'KOSPI'),
    kosdaq: parseKrxIndex(html, 'KOSDAQ')
  };
}

function parseStooqQuote(html) {
  // Stooq quote pages tend to contain compact fields like:
  //   Last4309.63
  //   Change+95.46 (+2.27%)
  // We parse both, tolerating optional whitespace/newlines.
  const lastM = html.match(/Last\s*([0-9][0-9,]*\.?[0-9]*)/i);
  const chgM = html.match(/Change\s*([+-]?[0-9][0-9,]*\.?[0-9]*)\s*\(\s*([+-]?[0-9][0-9,]*\.?[0-9]*)%\s*\)/i);

  if (!lastM) return null;

  const price = toNum(lastM[1]);
  let change = null;
  let pct = null;

  if (chgM) {
    change = toNum(chgM[1]);
    pct = toNum(chgM[2]);
  } else {
    // fallback: sometimes only percent is present; try to recover
    const pctOnly = html.match(/\(\s*([+-]?[0-9][0-9,]*\.?[0-9]*)%\s*\)/i);
    if (pctOnly) {
      pct = toNum(pctOnly[1]);
      change = computeAbsChangeFromPct(price, pct);
    }
  }

  if (pct === null || pct === undefined) return null;

  return { price, change, pct, time: null };
}

async function fetchStooq(sym) {
  const s = String(sym).toLowerCase();
  const url = `https://stooq.com/q/?s=${encodeURIComponent(s)}`;
  const html = await fetchText(url);
  return parseStooqQuote(html);
}

async function fetchYahooChart(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`;
  const j = await fetchJSON(url);
  const r = j && j.chart && j.chart.result && j.chart.result[0] ? j.chart.result[0] : null;
  const meta = r && r.meta ? r.meta : null;
  if (!meta) return null;

  const priceRaw = meta.regularMarketPrice ?? null;
  const prevRaw = meta.previousClose ?? null;
  const changeRaw = (priceRaw !== null && prevRaw !== null) ? (priceRaw - prevRaw) : (meta.regularMarketChange ?? null);
  const pctRaw = meta.regularMarketChangePercent ?? ((changeRaw !== null && prevRaw) ? (changeRaw / prevRaw) * 100 : null);
  const time = meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null;

  return {
    price: toNum(priceRaw),
    change: toNum(changeRaw),
    pct: toNum(pctRaw),
    time
  };
}

function withMeta(item, symbol) {
  if (!item) return null;
  return {
    symbol,
    price: item.price,
    change: item.change,
    pct: item.pct,
    time: item.time
  };
}

async function buildMarketItems() {
  const items = {};

  // 1) KR 지수: KRX 메인 페이지에서 파싱
  let krx = null;
  try { krx = await fetchKrxMain(); } catch (_) { krx = null; }
  if (krx && krx.kospi) items.kospi = withMeta(krx.kospi, 'KOSPI');
  if (krx && krx.kosdaq) items.kosdaq = withMeta(krx.kosdaq, 'KOSDAQ');

  // 2) 누락 시 폴백
  if (!items.kospi) {
    try {
      const st = await fetchStooq('^KOSPI');
      if (st) items.kospi = withMeta(st, '^KOSPI');
    } catch (_) {}
  }
  if (!items.kosdaq) {
    try {
      const yh = await fetchYahooChart('^KQ11');
      if (yh) items.kosdaq = withMeta(yh, '^KQ11');
    } catch (_) {}
  }

  // 3) 환율 + 미국지수: Stooq 우선, 실패 시 Yahoo 폴백
  const tasks = [
    ['usdkrw', 'usdkrw', 'USDKRW'],
    ['dow', '^dji', '^DJI'],
    ['nasdaq', '^ndq', '^NDQ'],
    ['sp500', '^spx', '^SPX']
  ];

  await Promise.all(tasks.map(async ([key, stSym, label]) => {
    try {
      const st = await fetchStooq(stSym);
      if (st) {
        items[key] = withMeta(st, label);
        return;
      }
    } catch (_) {}

    try {
      const map = { dow: '^DJI', nasdaq: '^IXIC', sp500: '^GSPC', usdkrw: 'USDKRW=X' };
      const yh = await fetchYahooChart(map[key]);
      if (yh) items[key] = withMeta(yh, map[key]);
    } catch (_) {}
  }));

  return items;
}

async function handleMarket() {
  const items = await buildMarketItems();
  const ok = Object.keys(items).length > 0;
  const body = JSON.stringify({
    ok,
    updated_at: new Date().toISOString(),
    items
  });

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': ok ? 'public, max-age=0, s-maxage=30, stale-while-revalidate=120' : 'no-store'
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/market') {
      try {
        return await handleMarket();
      } catch (e) {
        const body = JSON.stringify({
          ok: false,
          updated_at: new Date().toISOString(),
          error: String(e && e.message ? e.message : e),
          items: {}
        });
        return new Response(body, {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store'
          }
        });
      }
    }

    // Static assets passthrough
    if (env && env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      return env.ASSETS.fetch(request);
    }
    return fetch(request);
  }
};
