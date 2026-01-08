(() => {
  const cv = document.getElementById("cv");
  const ctx = cv.getContext("2d");
  const msg = document.getElementById("msg");
  const scoreEl = document.getElementById("score");
  const okEl = document.getElementById("ok");
  const noEl = document.getElementById("no");

  let series = [];
  let t = 0;
  let timer = null;
  let targetAt = null;  // index when breakout happens
  let targetType = null; // BUY or SELL
  let armed = false;
  let t0 = 0;
  let score=0, ok=0, no=0;

  function rnd(a,b){ return a + Math.random()*(b-a); }
  function clear(){
    ctx.clearRect(0,0,cv.width,cv.height);
    ctx.fillStyle="#0f1621"; ctx.fillRect(0,0,cv.width,cv.height);
  }
  function grid(){
    ctx.strokeStyle="#223048"; ctx.lineWidth=1;
    for(let i=0;i<=10;i++){
      const y = 20 + i*(cv.height-40)/10;
      ctx.beginPath(); ctx.moveTo(20,y); ctx.lineTo(cv.width-20,y); ctx.stroke();
    }
  }
  function minMax(arr){
    let mn=Infinity,mx=-Infinity;
    for(const v of arr){ mn=Math.min(mn,v); mx=Math.max(mx,v); }
    return [mn,mx];
  }
  function toY(v, lo, hi){
    return 20 + (hi - v)*(cv.height-40)/(hi-lo);
  }
  function draw(){
    clear(); grid();
    const shown = series.slice(0, t);
    if(shown.length<2) return;
    const [mn,mx] = minMax(shown);
    const pad = (mx-mn)*0.2 + 1e-6;
    const lo = mn-pad, hi = mx+pad;

    ctx.strokeStyle="#6ee7ff"; ctx.lineWidth=2;
    ctx.beginPath();
    shown.forEach((v,i)=>{
      const x = 20 + i*(cv.width-40)/(series.length-1);
      const y = toY(v, lo, hi);
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });
    ctx.stroke();

    // draw trigger line (prev high/low)
    if(t>15){
      const look = shown.slice(Math.max(0, t-15), t-1);
      const prevHigh = Math.max(...look);
      const prevLow = Math.min(...look);
      ctx.strokeStyle="#9bb0c6"; ctx.setLineDash([6,6]);
      let y = toY(targetType==="BUY"?prevHigh:prevLow, lo, hi);
      ctx.beginPath(); ctx.moveTo(20,y); ctx.lineTo(cv.width-20,y); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function build(){
    const n = 80;
    let v = 100;
    const arr=[];
    for(let i=0;i<n;i++){
      v += rnd(-1.4,1.4);
      if(i===30) v += rnd(-8,8);
      arr.push(v);
    }
    // choose target: breakout above prev high or breakdown below prev low
    targetAt = 35 + Math.floor(Math.random()*25);
    targetType = Math.random() < 0.5 ? "BUY" : "SELL";
    // enforce breakout
    for(let i=targetAt; i<Math.min(n, targetAt+5); i++){
      if(targetType==="BUY") arr[i] += 6 + (i-targetAt)*1.2;
      else arr[i] -= 6 + (i-targetAt)*1.2;
    }
    return arr;
  }

  function start(){
    stop();
    series = build();
    t = 0;
    armed = false;
    msg.textContent = "진행 중입니다. 조건이 나오면 눌러야 합니다.";
    timer = setInterval(()=>{
      t++;
      if(t>=series.length){ stop(); msg.textContent="종료입니다. 다시 시작하십시오."; return; }

      // arm trigger shortly before target
      if(t === targetAt-1){
        armed = true;
        t0 = performance.now();
        msg.textContent = (targetType==="BUY" ? "돌파 매수 조건입니다. 매수 누르십시오." : "이탈 매도 조건입니다. 매도 누르십시오.");
      }

      // auto fail if not pressed within 2.2s after arm
      if(armed && performance.now() - t0 > 2200){
        armed = false;
        no++;
        noEl.textContent = String(no);
        msg.textContent = "늦었습니다(오답).";
      }

      draw();
    }, 180);
  }

  function stop(){
    if(timer){ clearInterval(timer); timer=null; }
  }

  function hit(type){
    if(!timer){ return; }
    if(!armed){
      no++; noEl.textContent=String(no);
      msg.textContent="타이밍이 아닙니다(오답).";
      return;
    }
    const dt = performance.now() - t0;
    armed = false;
    if(type===targetType){
      ok++; okEl.textContent=String(ok);
      // score: faster is better
      const s = Math.max(0, Math.round(1200 - dt));
      score += s;
      scoreEl.textContent = String(score);
      msg.textContent = `정답입니다. 반응시간 ${Math.round(dt)}ms`;
    } else {
      no++; noEl.textContent=String(no);
      msg.textContent = "오답입니다.";
    }
  }

  document.getElementById("btnStart").addEventListener("click", start);
  document.getElementById("btnReset").addEventListener("click", ()=>{ stop(); score=0; ok=0; no=0; scoreEl.textContent="0"; okEl.textContent="0"; noEl.textContent="0"; msg.textContent="리셋 완료. 시작을 누르십시오."; clear(); grid(); });
  document.getElementById("btnBuy").addEventListener("click", ()=>hit("BUY"));
  document.getElementById("btnSell").addEventListener("click", ()=>hit("SELL"));

  clear(); grid();
})();