function fmtAmount(x){
  if (!isFinite(x)) return "-";
  const n = Number(x);
  return snapToTick(n).toLocaleString("ko-KR") + "원";
}
function fmtPrice(x){
  if (!isFinite(x)) return "-";
  const n = Number(x);
  // 실전처럼: 가격은 원 단위 정수로 고정(소수점 제거)
  return Math.round(n).toLocaleString("ko-KR") + "원";
}

function normalizeOHLCV(rows){
  // 실전처럼: OHLC는 원 단위 정수로 정리 (소수점 제거)
  return rows.map(r=>{
    const o = snapToTick(Number(r.open));
    const h = snapToTick(Number(r.high));
    const l = snapToTick(Number(r.low));
    const c = snapToTick(Number(r.close));
    return {...r, open:o, high:h, low:l, close:c};
  });
}

function snapToTick(price){
  // KRX 호가단위(일반) 기준 스냅
  const p = Math.round(Number(price)||0);
  let tick = 1;
  if (p < 1000) tick = 1;
  else if (p < 5000) tick = 5;
  else if (p < 10000) tick = 10;
  else if (p < 50000) tick = 50;
  else if (p < 100000) tick = 100;
  else if (p < 500000) tick = 500;
  else tick = 1000;
  return Math.round(p / tick) * tick;
}




// Backward compat (older calls)
function fmtWon(x){ return fmtAmount(x); }
function fmtMoney(n){
  const v = Number(n)||0;
  return v.toLocaleString("ko-KR", {minimumFractionDigits:0, maximumFractionDigits:3});
}


// ==============================
// Bankroll persistence (누적 자본)
const BANKROLL_KEY = "JOOLAB_CHART_GAME_BANKROLL_V1";

function loadBankroll(fallback){
  try{
    const raw = localStorage.getItem(BANKROLL_KEY);
    if (raw == null) return fallback;
    const v = Number(raw);
    return (isFinite(v) && v >= 0) ? v : fallback;
  }catch(e){
    return fallback;
  }
}

function saveBankroll(v){
  try{
    const n = Number(v);
    if (isFinite(n) && n >= 0) localStorage.setItem(BANKROLL_KEY, String(Math.floor(n)));
  }catch(e){}
}

function resetBankrollToInitial(initialCash){
  try{
    localStorage.setItem(BANKROLL_KEY, String(Math.floor(initialCash)));
  }catch(e){}
}


/* JOOLAB Chart Game v0 (턴제 70턴 / 단일종목 / 올랜덤)
   - 데이터: /data/universe.json + /data/{ticker}.csv
   - 체결: 현재 종가(Close) 즉시 체결
   - 수수료/세금: OFF
*/
const CFG = Object.freeze({
  TURNS: 70,
  HISTORY_BARS: 80,
  START_CASH: 10_000_000,
  NEED_EXTRA_BAR_FOR_NEXT_OPEN: 1,
});

const $ = (sel) => document.querySelector(sel);

function fmtNum(x){
  if (!isFinite(x)) return "-";
  return x.toLocaleString("ko-KR");
}
function fmtPct(x){
  if (!isFinite(x)) return "-";
  const p = x*100;
  return (p>=0?"+":"") + p.toFixed(2) + "%";
}

const LS_KEY = "joolab_chart_game_records_v1";

function loadRecords(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  }catch(_e){
    return [];
  }
}
function saveRecords(arr){
  try{ localStorage.setItem(LS_KEY, JSON.stringify(arr)); }catch(_e){}
}
function addRecord(rec){
  const arr = loadRecords();
  arr.push(rec);
  saveRecords(arr.slice(-200));
  return arr;
}
function calcStats(arr){
  const n = arr.length;
  if (!n) return {n:0, cumPnl:0, avgRet:0, winRate:0, best:0, worst:0};
  let cumPnl=0, sumRet=0, win=0, best=-Infinity, worst=Infinity;
  for (const r of arr){
    const pnl = Number(r.pnl||0);
    const ret = Number(r.ret||0);
    if (!isFinite(pnl) || !isFinite(ret)) continue;
    cumPnl += pnl;
    sumRet += ret;
    if (pnl > 0) win += 1;
    best = Math.max(best, ret);
    worst = Math.min(worst, ret);
  }
  return {
    n,
    cumPnl,
    avgRet: sumRet / n,
    winRate: n ? (win / n) : 0,
    best: isFinite(best) ? best : 0,
    worst: isFinite(worst) ? worst : 0
  };
}
function updateRecordsUI(){
  const arr = loadRecords();
  const st = calcStats(arr);

  const badge = document.getElementById("recBadge");
  if (badge) badge.textContent = `${st.n} games`;

  const cumEl = document.getElementById("recCumPnl");
  const avgEl = document.getElementById("recAvgRet");
  const winEl = document.getElementById("recWinRate");
  const bwEl = document.getElementById("recBestWorst");
  if (cumEl) cumEl.textContent = fmtWon(st.cumPnl);
  if (avgEl) avgEl.textContent = fmtPct(st.avgRet);
  if (winEl) winEl.textContent = (st.n ? (st.winRate*100).toFixed(1) : "0.0") + "%";
  if (bwEl) bwEl.textContent = `${fmtPct(st.best)} / ${fmtPct(st.worst)}`;

  const tbody = document.getElementById("recBody");
  if (tbody){
    tbody.innerHTML = "";
    const recent = arr.slice().reverse().slice(0,10);
    for (let i=0;i<recent.length;i++){
      const r = recent[i];
      const tr = document.createElement("tr");
      const cells = [
        String(recent.length - i),
        r.tickerLabel || "-",
        (r.startDate && r.endDate) ? `${r.startDate}~${r.endDate}` : "-",
        isFinite(r.equity) ? Math.round(r.equity).toLocaleString("ko-KR") : "-",
        isFinite(r.ret) ? fmtPct(r.ret) : "-",
        isFinite(r.mdd) ? fmtPct(r.mdd) : "-",
        isFinite(r.trades) ? String(r.trades) : "0",
      ];
      for (let j=0;j<cells.length;j++){
        const td = document.createElement("td");
        td.textContent = cells[j];
        if (j === 3) td.classList.add("mono");
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }
}
function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

async function fetchText(url){
  const r = await fetch(url, {cache:"no-store"});
  if (!r.ok) throw new Error(`FETCH_FAIL ${url} (${r.status})`);
  return await r.text();
}
async function fetchJSON(url){
  const r = await fetch(url, {cache:"no-store"});
  if (!r.ok) throw new Error(`FETCH_FAIL ${url} (${r.status})`);
  return await r.json();
}

function parseCSV(csvText){
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error("CSV_EMPTY");
  const header = lines[0].split(",").map(s=>s.trim().toLowerCase());
  const idx = (name)=>header.indexOf(name);
  const idDate = idx("date"), idO=idx("open"), idH=idx("high"), idL=idx("low"), idC=idx("close"), idV=idx("volume");
  if ([idDate,idO,idH,idL,idC,idV].some(i=>i<0)) throw new Error("CSV_HEADER_INVALID");
  const rows = [];
  for (let i=1;i<lines.length;i++){
    const parts = lines[i].split(",");
    if (parts.length < header.length) continue;
    const date = parts[idDate].trim();
    const o = parseFloat(parts[idO]);
    const h = parseFloat(parts[idH]);
    const l = parseFloat(parts[idL]);
    const c = parseFloat(parts[idC]);
    const v = parseFloat(parts[idV]);
    if (!date || !isFinite(o+h+l+c+v)) continue;
    rows.push({date, open:o, high:h, low:l, close:c, volume:v});
  }
  // ensure chronological
  rows.sort((a,b)=> a.date.localeCompare(b.date));
  return rows;
}

function computeSMA(bars, period){
  const n = bars.length;
  const out = new Array(n).fill(null);
  let sum = 0;
  for (let i=0;i<n;i++){
    const c = Number(bars[i].close);
    if (!isFinite(c)) { sum = 0; continue; }
    sum += c;
    if (i >= period) {
      const prev = Number(bars[i - period].close);
      if (isFinite(prev)) sum -= prev;
    }
    if (i >= period - 1){
      out[i] = sum / period;
    }
  }
  return out;
}

/* simple candlestick renderer */
function drawChart(canvas, bars, viewStart, viewEnd, pendingInfo){
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0,0,W,H);

  // background grid
  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(0,0,0,0)";
  ctx.fillRect(0,0,W,H);

  const pad = 44;
  const padB = 26;
  const innerW = W - pad*2;
  const innerH = H - pad - padB;

  const view = bars.slice(viewStart, viewEnd);
  if (view.length < 5){
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "14px system-ui";
    ctx.fillText("데이터가 부족합니다.", pad, pad+20);
    return;
  }
  let lo = Infinity, hi = -Infinity;
  let volMax = 1;
  for (const b of view){
    lo = Math.min(lo, b.low);
    hi = Math.max(hi, b.high);
    volMax = Math.max(volMax, b.volume);
  }
  const y = (p)=> pad + (hi - p) / (hi - lo) * (innerH*0.72);
  const yVolTop = pad + innerH*0.74;
  const yVolBot = pad + innerH;
  const xStep = innerW / (view.length - 1);
  const candleW = Math.max(3, Math.min(10, xStep*0.55));

  // grid lines
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.lineWidth = 1;
  for (let i=0;i<=5;i++){
    const yy = pad + (innerH*0.72) * (i/5);
    ctx.beginPath();
    ctx.moveTo(pad, yy);
    ctx.lineTo(W-pad, yy);
    ctx.stroke();
  }
  for (let i=0;i<=6;i++){
    const xx = pad + innerW * (i/6);
    ctx.beginPath();
    ctx.moveTo(xx, pad);
    ctx.lineTo(xx, yVolBot);
    ctx.stroke();
  }

  // y labels
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
  for (let i=0;i<=4;i++){
    const p = lo + (hi-lo) * (i/4);
    const yy = y(p);
    ctx.fillText(p.toFixed(0), 10, yy+4);
  }

  // draw volumes
  for (let i=0;i<view.length;i++){
    const b = view[i];
    const xx = pad + i*xStep;
    const vh = (b.volume/volMax) * (yVolBot - yVolTop);
    ctx.fillStyle = (b.close >= b.open) ? "rgba(255,92,122,0.55)" : "rgba(102,170,255,0.55)";
    ctx.fillRect(xx - candleW/2, yVolBot - vh, candleW, vh);
  }

  // draw candles
  for (let i=0;i<view.length;i++){
    const b = view[i];
    const xx = pad + i*xStep;
    const up = b.close >= b.open;
    const col = up ? "rgba(255,92,122,0.95)" : "rgba(102,170,255,0.95)";
    const wickCol = up ? "rgba(255,92,122,0.65)" : "rgba(102,170,255,0.65)";
    // wick
    ctx.strokeStyle = wickCol;
    ctx.beginPath();
    ctx.moveTo(xx, y(b.high));
    ctx.lineTo(xx, y(b.low));
    ctx.stroke();

    // body
    const yO = y(b.open);
    const yC = y(b.close);
    const top = Math.min(yO, yC);
    const bot = Math.max(yO, yC);
    const h = Math.max(2, bot-top);
    ctx.fillStyle = col;
    ctx.fillRect(xx - candleW/2, top, candleW, h);
  }


  // moving averages (SMA 5/20/60/120)
  const ma5 = computeSMA(bars, 5);
  const ma20 = computeSMA(bars, 20);
  const ma60 = computeSMA(bars, 60);
  const ma120 = computeSMA(bars, 120);
  const maDefs = [
    {p:5, a:ma5, c:"rgba(255,209,102,0.95)"},
    {p:20, a:ma20, c:"rgba(102,255,204,0.95)"},
    {p:60, a:ma60, c:"rgba(191,128,255,0.95)"},
    {p:120, a:ma120, c:"rgba(255,255,255,0.85)"},
  ];

  ctx.lineWidth = 1.6;
  for (const d of maDefs){
    ctx.strokeStyle = d.c;
    ctx.beginPath();
    let started = false;
    for (let gi=viewStart; gi<viewEnd; gi++){
      const v = d.a[gi];
      if (v == null || !isFinite(v)){
        started = false;
        continue;
      }
      const local = gi - viewStart;
      const xx = pad + local*xStep;
      const yy = y(v);
      if (!started){
        ctx.moveTo(xx, yy);
        started = true;
      } else {
        ctx.lineTo(xx, yy);
      }
    }
    ctx.stroke();
  }

  // MA legend
  ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
  let lx = pad + 6;
  let ly = pad + 14;
  for (const d of maDefs){
    ctx.strokeStyle = d.c;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(lx+18, ly);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.fillText(`MA${d.p}`, lx+24, ly+4);
    ly += 16;
  }
  ctx.lineWidth = 1.6;

  // x labels (sparse)
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
  const step = Math.max(10, Math.floor(view.length/6));
  for (let i=0;i<view.length;i+=step){
    const b = view[i];
    const xx = pad + i*xStep;
    ctx.fillText(b.date.slice(2).replaceAll("-","."), xx-22, H-10);
  }

  // pending order marker
  if (pendingInfo && pendingInfo.showAtIndex != null){
    const i = pendingInfo.showAtIndex;
    if (i >= viewStart && i < viewEnd){
      const local = i - viewStart;
      const xx = pad + local*xStep;
      ctx.strokeStyle = "rgba(255,209,102,0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(xx, pad);
      ctx.lineTo(xx, yVolBot);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
  }
}

function setStatus(msg){
  $("#status").textContent = msg || "";
}

function rngPick(arr){
  return arr[Math.floor(Math.random()*arr.length)];
}

function validateSliceLen(total){
  const need = CFG.HISTORY_BARS + CFG.TURNS + CFG.NEED_EXTRA_BAR_FOR_NEXT_OPEN;
  return total >= need + 10;
}

function pickRandomSlice(total){
  const need = CFG.HISTORY_BARS + CFG.TURNS + CFG.NEED_EXTRA_BAR_FOR_NEXT_OPEN;
  const maxStart = total - need;
  const start = Math.floor(Math.random() * (maxStart+1));
  return {start, end: start + need};
}

function calcEquity(state, price){
  return state.cash + state.shares * price;
}

function resetState(){
  return {
    cash: CFG.START_CASH,
    shares: 0,    avgCost: 0,
    realizedPnl: 0,
    pending: null, // {side:"BUY"|"SELL", qty:int}
    turn: 0, // 0..TURNS
    done: false,
    hasTraded: false,
    logs: [],
  };
}

function applyPendingAtNextOpen(state, bar, turnNo){
  if (!state.pending) return;
  const {side, qty, pct} = state.pending;
  const px = bar.close;
  const date = bar.date;

  if (side === "BUY"){
    let buyQty = qty;
    if ((!buyQty || buyQty <= 0) && isFinite(pct) && pct > 0){
      const spend = state.cash * pct;
      buyQty = Math.floor(spend / px);
    }
    if (!buyQty || buyQty <= 0){
      state.logs.push({
        turn: turnNo,
        date,
        side: "매수(실패)",
        qty: 0,
        price: px,
        amount: 0,
        cash: state.cash,
        shares: state.shares,
        equity: null,
        note: "현금 부족",
      });
      state.pending = null;
      return;
    }

    const cost = buyQty * px;
    if (cost <= state.cash){
      const prevVal = state.shares * state.avgCost;
      const newShares = state.shares + buyQty;
      const newVal = prevVal + cost;
      state.avgCost = newVal / newShares;
      state.shares = newShares;
      state.cash -= cost;
      state.logs.push({
        turn: turnNo,
        date,
        side: "매수",
        qty: buyQty,
        price: px,
        amount: cost,
        cash: state.cash,
        shares: state.shares,
        equity: null,
        note: "",
      });
    } else {
      state.logs.push({
        turn: turnNo,
        date,
        side: "매수(실패)",
        qty: buyQty,
        price: px,
        amount: buyQty*px,
        cash: state.cash,
        shares: state.shares,
        equity: null,
        note: "현금 부족",
      });
    }
  } else if (side === "SELL"){
    let sellQty = qty;
    if ((!sellQty || sellQty <= 0) && isFinite(pct) && pct > 0){
      sellQty = Math.floor(state.shares * pct);
    }
    sellQty = Math.min(sellQty || 0, state.shares);
    if (!sellQty || sellQty <= 0){
      state.logs.push({
        turn: turnNo,
        date,
        side: "매도(실패)",
        qty: 0,
        price: px,
        amount: 0,
        cash: state.cash,
        shares: state.shares,
        equity: null,
        note: "보유 없음 또는 수량 0",
      });
      state.pending = null;
      return;
    }
    // qty 우선, 없으면 pct(보유수량 비중)로 계산
    // 아래는 sellQty 기준으로 진행
    
    if (sellQty > 0){
      const proceeds = sellQty * px;
      state.cash += proceeds;
      const pnl = (px - state.avgCost) * sellQty;
      state.realizedPnl += pnl;
      state.shares -= sellQty;
      if (state.shares === 0) state.avgCost = 0;
      state.logs.push({
        turn: turnNo,
        date,
        side: "매도",
        qty: sellQty,
        price: px,
        amount: proceeds,
        cash: state.cash,
        shares: state.shares,
        equity: null,
        note: "",
      });
    } else {
      state.logs.push({
        turn: turnNo,
        date,
        side: "매도(실패)",
        qty: 0,
        price: px,
        amount: 0,
        cash: state.cash,
        shares: state.shares,
        equity: null,
        note: "보유 없음",
      });
    }
  }
  state.pending = null;
}


function updateUI(model){
  const {meta, bars, slice, revealEnd, state} = model;
  $("#tickerName").textContent = (state.done ? `${meta.name} (${meta.ticker})` : "??? (랜덤 종목)");
  $("#metaLine").textContent = `턴제 70턴 · 체결: 현재 종가 · 올랜덤(종목+구간)`;

  const lastBar = bars[revealEnd-1];
  const lastClose = lastBar ? lastBar.close : NaN;
  const equity = calcEquity(state, lastClose);
  const pnl = equity - CFG.START_CASH;
  const pnlPct = pnl / CFG.START_CASH;

  $("#turnBadge").textContent = `TURN ${state.turn}/${CFG.TURNS}`;
  $("#kCash").textContent = fmtWon(state.cash);
  $("#kShares").textContent = fmtNum(state.shares) + "주";
  $("#kAvg").textContent = state.shares>0 ? fmtWon(state.avgCost) : "-";
  $("#kEquity").textContent = fmtWon(equity);
  $("#kPnl").textContent = fmtAmount(pnl) + " (" + fmtPct(pnlPct) + ")";
  $("#kPnl").className = "v " + (pnl>=0 ? "good" : "bad");

  $("#kPrice").textContent = isFinite(lastClose) ? fmtWon(lastClose) : "-";
  $("#kDate").textContent = lastBar ? lastBar.date : "-";

  // pending info
  const pend = state.pending;
  $("#pendingLine").textContent = pend ? `즉시 주문: ${pend.side==="BUY" ? ("매수 " + (pend.pct ? Math.round(pend.pct*100) + "%(현금)" : (pend.qty + "주"))) : ("매도 " + (pend.qty + "주"))} (현재 종가 즉시 체결)` : "즉시 주문: 없음";

  // buttons
  const disabled = state.done;
  $("#btnBuy").disabled = disabled;
  $("#btnSell").disabled = disabled;
  $("#btnHold").disabled = disabled;
  $("#btnNext").disabled = disabled;
  $("#qty").disabled = disabled;

  // log table
  const tbody = $("#logBody");
  tbody.innerHTML = "";
  const logs = state.logs.slice().reverse().slice(0, 50);
  for (const row of logs){
    const tr = document.createElement("tr");
    const cells = [
      row.turn,
      row.date,
      row.side,
      row.qty,
      row.price ? Math.round(row.price) : "",
      row.amount ? Math.round(row.amount) : "",
      Math.round(row.cash),
      row.shares,
      row.note || "",
    ];
    for (let i=0;i<cells.length;i++){
      const td = document.createElement("td");
      td.textContent = String(cells[i]);
      if ([4,5,6].includes(i)) td.classList.add("mono");
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  // chart
  const canvas = $("#chart");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  const pendingMarkerIndex = state.pending ? (revealEnd) : null; // next day to execute is at revealEnd (not yet revealed)
  drawChart(canvas, bars, slice.start, revealEnd, {showAtIndex: pendingMarkerIndex});
  // trading enable/disable
  const closed = !!model.state.done;
  const bBuy = $("#btnBuy"); const bSell = $("#btnSell"); const bHold = $("#btnHold"); const bNext = $("#btnNext"); const bClose = document.getElementById("btnClose");
  if (bBuy) bBuy.disabled = closed;
  if (bSell) bSell.disabled = closed;
  if (bHold) bHold.disabled = false;
  if (bClose) bClose.disabled = closed || (model.state.shares > 0);
document.querySelectorAll(".pctBtn").forEach((el)=>{ el.disabled = closed; el.classList.toggle("disabled", closed); });
  const qtyEl = document.getElementById("qty");
  if (qtyEl) qtyEl.disabled = closed;

  if (bClose){ bClose.title = (model.state.shares>0) ? "보유수량이 0주일 때만 정산 가능합니다." : "게임 종료 후 정산"; }

}

function buildModel(meta, bars, slice){
  // initial reveal
  const revealEnd = slice.start + CFG.HISTORY_BARS;
  return {
    meta, bars, slice,
    revealEnd,
    state: resetState(),
    maxEquity: CFG.START_CASH,
    mdd: 0,
  };
}

function recalcRisk(model){
  const last = model.bars[model.revealEnd-1];
  const px = last ? last.close : NaN;
  const equity = calcEquity(model.state, px);
  model.maxEquity = Math.max(model.maxEquity, equity);
  const dd = (equity - model.maxEquity) / model.maxEquity; // negative
  model.mdd = Math.min(model.mdd, dd);
  $("#riskLine").textContent = `최대낙폭(MDD): ${fmtPct(model.mdd)} · 실현손익: ${fmtWon(model.state.realizedPnl)}`;
}

function endGame(model){
  model.state.done = true;
  const last = model.bars[model.revealEnd-1];
  const px = last ? last.close : NaN;
  const equity = calcEquity(model.state, px);
  const pnl = equity - CFG.START_CASH;
  const pnlPct = pnl / CFG.START_CASH;

  setStatus(`게임 종료입니다. 종목 ${model.meta.name}(${model.meta.ticker}) · 총자산 ${fmtWon(equity)} · 손익 ${fmtAmount(pnl)} (${fmtPct(pnlPct)}) · MDD ${fmtPct(model.mdd)} 입니다.`);

  const trades = model.state.logs.filter(x => x && (x.side === "매수" || x.side === "매도")).length;
  const startDate = (model.bars[model.slice.start] && model.bars[model.slice.start].date) ? model.bars[model.slice.start].date : "";
  const endDate = (model.bars[model.revealEnd-1] && model.bars[model.revealEnd-1].date) ? model.bars[model.revealEnd-1].date : "";
  const rec = {
    ts: Date.now(),
    ticker: model.meta.ticker,
    tickerLabel: `${model.meta.name}(${model.meta.ticker})`,
    startDate,
    endDate,
    equity,
    pnl,
    ret: pnlPct,
    mdd: model.mdd,
    trades,
  };
  addRecord(rec);
  updateRecordsUI();
}


function getQty(){
  const v = parseInt($("#qty").value, 10);
  if (!isFinite(v) || v <= 0) return 0;
  return v;
}




function applyOrderAtCurrentCloseQty(model, side, qty){// bankroll guard
  if (model.state.cash <= 0 && model.state.shares <= 0){
    setStatus("자본이 0원입니다. '자본 리셋'을 눌러 재시작하십시오.");
    const rb = document.getElementById("resetBankrollBtn");
    if (rb) rb.classList.add("pulse");
    return;
  }

  if (!model || !model.state || model.state.done) return;
  const s = (String(side||"BUY").toUpperCase()==="SELL") ? "SELL" : "BUY";
  const q = Math.floor(Number(qty));
  if (!isFinite(q) || q <= 0){
    setStatus("수량이 1주 이상이어야 합니다.");
    return;
  }

  const last = model.bars[model.revealEnd-1];
  if (!last || !isFinite(last.close) || last.close <= 0){
    setStatus("현재 종가 정보를 찾을 수 없습니다.");
    return;
  }

  const px = snapToTick(last.close);
  const date = last.date;
  const turnNo = model.state.turn;

  if (s === "BUY"){
    const maxQty = Math.floor(model.state.cash / px);
    const buyQty = Math.min(q, maxQty);
    if (!buyQty || buyQty <= 0){
      model.state.logs.push({
        turn: turnNo,
        date,
        side: "매수(실패)",
        qty: 0,
        price: px,
        amount: 0,
        cash: model.state.cash,
        shares: model.state.shares,
        equity: null,
        note: "현금 부족 또는 수량 0",
      });
      setStatus("매수 실패 (현금 부족)");
      updateUI(model);
      return;
    }
    const cost = buyQty * px;

    const prevVal = model.state.avgCost * model.state.shares;
    const newShares = model.state.shares + buyQty;
    const newVal = prevVal + cost;
    model.state.avgCost = snapToTick(newVal / newShares);
    model.state.shares = newShares;
    model.state.cash -= cost;

    saveBankroll(model.state.cash);
    model.state.logs.push({
      turn: turnNo,
      date,
      side: "매수",
      qty: buyQty,
      price: px,
      amount: cost,
      cash: model.state.cash,
      shares: model.state.shares,
      equity: null,
      note: "현재 종가 즉시 체결(수량)",
    });

    model.state.hasTraded = true;

    setStatus(`매수 체결 완료 (현재 종가 ${buyQty}주)`);
    updateUI(model);
    return;
  }

  // SELL
  const sellQty = Math.min(q, model.state.shares);
  if (!sellQty || sellQty <= 0){
    model.state.logs.push({
      turn: turnNo,
      date,
      side: "매도(실패)",
      qty: 0,
      price: px,
      amount: 0,
      cash: model.state.cash,
      shares: model.state.shares,
      equity: null,
      note: "보유 없음 또는 수량 0",
    });
    setStatus("매도 실패 (보유 없음)");
    updateUI(model);
    return;
  }

  const proceeds = sellQty * px;
  model.state.cash += proceeds;

  saveBankroll(model.state.cash);
  const pnl = (px - model.state.avgCost) * sellQty;
  model.state.realizedPnl += pnl;

  model.state.shares -= sellQty;
  if (model.state.shares === 0) model.state.avgCost = 0;

  model.state.logs.push({
    turn: turnNo,
    date,
    side: "매도",
    qty: sellQty,
    price: px,
    amount: proceeds,
    cash: model.state.cash,
    shares: model.state.shares,
    equity: null,
    note: "현재 종가 즉시 체결(수량)",
  });

  model.state.hasTraded = true;

  setStatus(`매도 체결 완료 (현재 종가 ${sellQty}주)`);
  updateUI(model);
}

function applyOrderAtCurrentClose(model, side, pct){// bankroll guard
  if (model.state.cash <= 0 && model.state.shares <= 0){
    setStatus("자본이 0원입니다. '자본 리셋'을 눌러 재시작하십시오.");
    const rb = document.getElementById("resetBankrollBtn");
    if (rb) rb.classList.add("pulse");
    return;
  }

  if (!model || !model.state || model.state.done) return;
  const p = Number(pct);
  const s = (String(side||"BUY").toUpperCase()==="SELL") ? "SELL" : "BUY";
  if (!isFinite(p) || p <= 0){
    setStatus("비중 값이 올바르지 않습니다.");
    return;
  }

  const last = model.bars[model.revealEnd-1];
  if (!last || !isFinite(last.close) || last.close <= 0){
    setStatus("현재 종가 정보를 찾을 수 없습니다.");
    return;
  }

  const px = snapToTick(last.close);
  const date = last.date;
  const turnNo = model.state.turn;

  if (s === "BUY"){
    const spend = model.state.cash * p;
    const buyQty = Math.floor(spend / px);
    if (!buyQty || buyQty <= 0){
      model.state.logs.push({
        turn: turnNo,
        date,
        side: "매수(실패)",
        qty: 0,
        price: px,
        amount: 0,
        cash: model.state.cash,
        shares: model.state.shares,
        equity: null,
        note: "현금 부족 또는 수량 0",
      });
      setStatus(`매수 ${Math.round(p*100)}% 실패 (현재 종가 기준 0주)`);
      updateUI(model);
      return;
    }
    const cost = buyQty * px;
    if (cost > model.state.cash){
      model.state.logs.push({
        turn: turnNo,
        date,
        side: "매수(실패)",
        qty: 0,
        price: px,
        amount: 0,
        cash: model.state.cash,
        shares: model.state.shares,
        equity: null,
        note: "현금 부족",
      });
      setStatus(`매수 ${Math.round(p*100)}% 실패 (현금 부족)`);
      updateUI(model);
      return;
    }

    const prevVal = model.state.avgCost * model.state.shares;
    const newShares = model.state.shares + buyQty;
    const newVal = prevVal + cost;
    model.state.avgCost = newVal / newShares;
    model.state.shares = newShares;
    model.state.cash -= cost;

    saveBankroll(model.state.cash);
    model.state.logs.push({
      turn: turnNo,
      date,
      side: "매수",
      qty: buyQty,
      price: px,
      amount: cost,
      cash: model.state.cash,
      shares: model.state.shares,
      equity: null,
      note: "현재 종가 즉시 체결",
    });

    setStatus(`매수 ${Math.round(p*100)}% 체결 완료 (현재 종가 ${buyQty}주)`);
    updateUI(model);
    return;
  }

  // SELL
  const sellQty = Math.floor(model.state.shares * p);
  if (!sellQty || sellQty <= 0){
    model.state.logs.push({
      turn: turnNo,
      date,
      side: "매도(실패)",
      qty: 0,
      price: px,
      amount: 0,
      cash: model.state.cash,
      shares: model.state.shares,
      equity: null,
      note: "보유 없음 또는 수량 0",
    });
    setStatus(`매도 ${Math.round(p*100)}% 실패 (보유수량 0 또는 0주)`);
    updateUI(model);
    return;
  }

  const sellQtyCap = Math.min(sellQty, model.state.shares);
  const proceeds = sellQtyCap * px;
  model.state.cash += proceeds;

  saveBankroll(model.state.cash);
  const pnl = (px - model.state.avgCost) * sellQtyCap;
  model.state.realizedPnl += pnl;

  model.state.shares -= sellQtyCap;
  if (model.state.shares === 0) model.state.avgCost = 0;

  model.state.logs.push({
    turn: turnNo,
    date,
    side: "매도",
    qty: sellQtyCap,
    price: px,
    amount: proceeds,
    cash: model.state.cash,
    shares: model.state.shares,
    equity: null,
    note: "현재 종가 즉시 체결",
  });

  setStatus(`매도 ${Math.round(p*100)}% 체결 완료 (현재 종가 ${sellQtyCap}주)`);
  updateUI(model);
  // auto settle when fully liquidated
  if (model.state.shares === 0 && model.state.hasTraded && !model.state.done){
    // next tick to ensure UI reflects final state
    setTimeout(()=> endGameAndShowResult(model), 0);
    return;
  }

}


function placeOrderPct(model, pct, side){if (!model || model.state.done) return;

  const p = Number(pct);
  if (!isFinite(p) || p <= 0){
    setStatus("비중 값이 올바르지 않습니다.");
    return;
  }
  const s = (String(side||"BUY").toUpperCase()==="SELL") ? "SELL" : "BUY";

  // preview qty at current revealed close
  const last = model.bars[model.revealEnd-1];
  const estPx = last ? last.close : NaN;
  let estQty = 0;
  if (isFinite(estPx) && estPx > 0){
    if (s === "BUY"){
      const spend = model.state.cash * p;
      estQty = Math.floor(spend / estPx);
    } else {
      estQty = Math.floor(model.state.shares * p);
    }
  }
  const qtyEl = document.getElementById("qty");
  if (qtyEl) qtyEl.value = String(estQty);

  // 즉시 체결: 현재 종가 기준 (즉시 없음)
  applyOrderAtCurrentClose(model, s, p);
}


function placeOrder(model, side){if (!model || model.state.done) return;
  const qty = getQty();
  if (qty <= 0){
    setStatus("수량이 1주 이상이어야 합니다.");
    return;
  }
  // 즉시 체결: 현재 종가 기준 (즉시 없음)
  applyOrderAtCurrentCloseQty(model, side, qty);
}




function showModal(){
  const m = document.getElementById("resultModal");
  if (m) m.classList.remove("hidden");
}
function hideModal(){
  const m = document.getElementById("resultModal");
  if (m) m.classList.add("hidden");
}

function currentEquity(model){
  const last = model.bars[model.revealEnd-1];
  const px = (last && isFinite(last.close)) ? last.close : 0;
  return model.state.cash + model.state.shares * px;
}

function endGameAndShowResult(model){
  if (model.state.shares > 0){
    setStatus("보유수량이 남아있습니다. 전량 매도 후 정산하십시오.");
    return;
  }

  if (!model || !model.state || model.state.done) return;

  // lock
  model.state.done = true;

  const last = model.bars[model.revealEnd-1];
  const px = (last && isFinite(last.close)) ? last.close : 0;
  const eq = model.state.cash + model.state.shares * px;
  const startDate = model.bars && model.bars.length ? model.bars[0].date : "-";
  const endDate = last ? last.date : "-";
  const sym = model.symbol || model.ticker || model.name || "-";

  const profit = eq - model.state.startCash;
  const profitPct = model.state.startCash > 0 ? (profit / model.state.startCash * 100) : 0;

  // build trade list (latest first, max 20)
  const logs = (model.state.logs || []).slice().reverse().slice(0, 20);
  let logHtml = "";
  if (logs.length){
    logHtml += '<div class="hr"></div><div><span class="badge">최근 거래 20개</span></div>';
    logs.forEach(r=>{
      const side = r.side || "";
      const d = r.date || "";
      const q = (r.qty!=null) ? Number(r.qty).toLocaleString("ko-KR") : "-";
      const p = (r.price!=null) ? fmtPrice(r.price) : "-";
      logHtml += `<div class="kv"><b>${d} · ${side}</b><span>${q}주 @ ${p}</span></div>`;
    });
  }

  const body = document.getElementById("resultBody");
  if (body){
    body.innerHTML = `
      <div><span class="badge">종목</span><b>${sym}</b></div>
      <div class="kv"><b>기간</b><span>${startDate} ~ ${endDate}</span></div>
      <div class="kv"><b>마지막 종가</b><span>${fmtPrice(px)}</span></div>
      <div class="hr"></div>
      <div class="kv"><b>시작자본</b><span>${fmtAmount(model.state.startCash)}</span></div>
      <div class="kv"><b>현금</b><span>${fmtAmount(model.state.cash)}</span></div>
      <div class="kv"><b>보유주식</b><span>${fmtMoney(model.state.shares)}주</span></div>
      <div class="kv"><b>최종자산</b><span><b>${fmtAmount(eq)}</b></span></div>
      <div class="kv"><b>손익</b><span>${fmtAmount(profit)} (${profitPct.toFixed(2)}%)</span></div>
      ${logHtml}
    `;
  }

  // On OK: commit bankroll = final equity, then start new game
  const ok = document.getElementById("btnResultOk");
  if (ok){
    ok.onclick = () => {
      resetBankrollToInitial(eq); // bankroll becomes final equity
      hideModal();
      location.reload();
    };
  }

  showModal();
  setStatus("게임 종료. 최종 결과를 확인하십시오.");
  updateUI(model);
}

function stepNextDay(model){
  // new turn: market open  if (model.state.done) return;

  // next day index to reveal/execute
  const nextIndex = model.revealEnd;
  const sliceEnd = model.slice.end;

  // apply pending at next day's open (using nextIndex bar)
  if (nextIndex < sliceEnd){
    const nextBar = model.bars[nextIndex];
    /* pending disabled: applyPendingAtNextOpen skipped */
}

  // reveal next bar (advance 1 day)
  model.revealEnd = Math.min(model.revealEnd + 1, sliceEnd);
  model.state.turn += 1;

  // update equity for logs
  const last = model.bars[model.revealEnd-1];
  const px = last ? last.close : NaN;
  const equity = calcEquity(model.state, px);
  if (model.state.logs.length){
    model.state.logs[model.state.logs.length-1].equity = equity;
  }

  // risk
  recalcRisk(model);

  // finish?
  if (model.state.turn >= CFG.TURNS || model.revealEnd >= sliceEnd){
    endGame(model);
  } else {
    setStatus("");
  }
  updateUI(model);
}

async function newGame(){
  setStatus("랜덤 종목/구간을 불러오는 중입니다…");
  try{
    const uni = await fetchJSON("./data/universe.json");
    const pick = rngPick(uni);
    const csv = await fetchText(`./data/${pick.ticker}.csv`);
    const bars = parseCSV(csv);

    if (!validateSliceLen(bars.length)){
      throw new Error("DATA_TOO_SHORT");
    }
    const slice = pickRandomSlice(bars.length);
    // ensure slice indices align to end
    const meta = {ticker: pick.ticker, name: pick.name};
    window.__MODEL = buildModel(meta, bars, slice);
    recalcRisk(window.__MODEL);
    setStatus("시작되었습니다. 매수/매도/관망 후 현재로 진행하십시오.");
    updateUI(window.__MODEL);
  }catch(e){
    console.error(e);
    setStatus("데이터 로딩 실패입니다. /data/universe.json 및 /data/{ticker}.csv 구성을 확인하십시오.");
  }
}

function bind(){
  $("#btnNew").addEventListener("click", ()=> newGame());
  $("#btnNext").addEventListener("click", ()=> stepNextDay(window.__MODEL));
  $("#btnBuy").addEventListener("click", ()=> placeOrder(window.__MODEL, "BUY"));
  $("#btnSell").addEventListener("click", ()=> placeOrder(window.__MODEL, "SELL"));
  $("#btnHold").addEventListener("click", ()=> {
    setStatus("관망 선택됨. 다음 턴으로 넘어가십시오.");
  });
  $("#btnClose").addEventListener("click", ()=> closeMarket(window.__MODEL));

  document.querySelectorAll(".pctBtn").forEach((btn)=>{
    btn.addEventListener("click", ()=>{
      placeOrderPct(window.__MODEL, btn.getAttribute("data-pct"), btn.getAttribute("data-side"));
    });
  });

  const logBtn = document.getElementById("btnLogToggle");
  if (logBtn){
    logBtn.addEventListener("click", ()=>{ document.body.classList.toggle("log-open"); });
  }
  const recBtn = document.getElementById("btnRecToggle");
  if (recBtn){
    recBtn.addEventListener("click", ()=>{ document.body.classList.toggle("rec-open"); });
  }
  const recClear = document.getElementById("btnRecClear");
  if (recClear){
    recClear.addEventListener("click", ()=>{
      if (confirm("누적 기록을 모두 삭제하시겠습니까?")){
        try{ localStorage.removeItem(LS_KEY); }catch(_e){}
        updateRecordsUI();
      }
    });
  }
  const resetBtn = document.getElementById("resetBankrollBtn");
  if (resetBtn){
    resetBtn.addEventListener("click", () => {
      resetBankrollToInitial(10000000);
      location.reload();
    });
  }

}



window.addEventListener("DOMContentLoaded", async ()=>{
  bind();
  await newGame();
  const qtyEl = document.getElementById("qty");
  if (qtyEl) qtyEl.value = "0";
  updateRecordsUI();
});
