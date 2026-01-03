// Cloudflare Pages Function: /api/market
// 목적: 홈 화면 상단에 지수/환율 값을 '바로' 표시 (클릭 강요 없음)
// 소스: Yahoo Finance 공개 quote JSON (키 필요 없음)
// 프론트: Naver 링크는 원문 확인용으로 유지

const SYMBOLS = [
  '^KS11',     // KOSPI
  '^KQ11',     // KOSDAQ
  'USDKRW=X',  // USD/KRW
  '^DJI',      // Dow Jones
  '^IXIC',     // Nasdaq Composite
  '^GSPC'      // S&P 500
];

const KEY_BY_SYMBOL = {
  '^KS11': 'kospi',
  '^KQ11': 'kosdaq',
  'USDKRW=X': 'usdkrw',
  '^DJI': 'dow',
  '^IXIC': 'nasdaq',
  '^GSPC': 'sp500'
};

function unixToIso(sec){
  if(!sec || typeof sec !== 'number') return null;
  try{
    return new Date(sec * 1000).toISOString();
  }catch(_){
    return null;
  }
}

async function fetchYahooQuote(){
  const symbols = encodeURIComponent(SYMBOLS.join(','));
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}`;
  const r = await fetch(url, {
    headers: {
      'accept': 'application/json,text/plain,*/*',
      'user-agent': 'Mozilla/5.0 (compatible; JooLabBigData/1.0)'
    }
  });
  if(!r.ok){
    throw new Error(`yahoo_quote_http_${r.status}`);
  }
  const j = await r.json();
  const result = (j && j.quoteResponse && Array.isArray(j.quoteResponse.result)) ? j.quoteResponse.result : [];
  const items = {};
  for(const row of result){
    const sym = row && row.symbol ? String(row.symbol) : '';
    const key = KEY_BY_SYMBOL[sym];
    if(!key) continue;
    items[key] = {
      symbol: sym,
      price: row.regularMarketPrice ?? null,
      change: row.regularMarketChange ?? null,
      pct: row.regularMarketChangePercent ?? null,
      time: unixToIso(row.regularMarketTime ?? null)
    };
  }
  return items;
}

export async function onRequest(){
  try{
    const items = await fetchYahooQuote();
    const body = JSON.stringify({
      ok: true,
      updated_at: new Date().toISOString(),
      items
    });

    return new Response(body, {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        // Pages Functions cache (edge)
        'cache-control': 'public, max-age=0, s-maxage=30, stale-while-revalidate=120'
      }
    });
  }catch(e){
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
