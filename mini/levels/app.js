(() => {
  const cv = document.getElementById("cv");
  const ctx = cv.getContext("2d");
  const msg = document.getElementById("msg");
  const scoreEl = document.getElementById("score");
  const cntEl = document.getElementById("cnt");
  let pts = [];
  let lines = []; // y values in price scale
  let autoLevels = []; // [support,resistance]
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
    for(let i=0;i<=12;i++){
      const x = 20 + i*(cv.width-40)/12;
      ctx.beginPath(); ctx.moveTo(x,20); ctx.lineTo(x,cv.height-20); ctx.stroke();
    }
  }
  function gen(){
    const n=70; const base=100;
    const a=[];
    let v=base;
    for(let i=0;i<n;i++){
      v += rnd(-2.4,2.4);
      if(i%13===0) v += rnd(-6,6);
      a.push(v);
    }
    return a;
  }
  function minMax(arr){
    let mn=Infinity,mx=-Infinity;
    for(const v of arr){ mn=Math.min(mn,v); mx=Math.max(mx,v); }
    return [mn,mx];
  }
  function toY(v, lo, hi){
    return 20 + (hi - v)*(cv.height-40)/(hi-lo);
  }
  function fromY(y, lo, hi){
    return hi - (y-20)*(hi-lo)/(cv.height-40);
  }
  function draw(){
    clear(); grid();
    const [mn,mx]=minMax(pts);
    const pad=(mx-mn)*0.15+1e-6;
    const lo=mn-pad, hi=mx+pad;

    // line series
    ctx.strokeStyle="#6ee7ff"; ctx.lineWidth=2;
    ctx.beginPath();
    pts.forEach((v,i)=>{
      const x=20 + i*(cv.width-40)/(pts.length-1);
      const y=toY(v,lo,hi);
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });
    ctx.stroke();

    // auto levels
    ctx.strokeStyle="#9bb0c6"; ctx.setLineDash([6,6]);
    autoLevels.forEach((lv,idx)=>{
      const y=toY(lv,lo,hi);
      ctx.beginPath(); ctx.moveTo(20,y); ctx.lineTo(cv.width-20,y); ctx.stroke();
    });
    ctx.setLineDash([]);

    // user lines
    ctx.strokeStyle="#e6eef8"; ctx.lineWidth=2;
    lines.forEach(lv=>{
      const y=toY(lv,lo,hi);
      ctx.beginPath(); ctx.moveTo(20,y); ctx.lineTo(cv.width-20,y); ctx.stroke();
    });

    // score
    cntEl.textContent = String(lines.length);
    if(lines.length===0){ scoreEl.textContent="-"; return; }
    const dists = lines.map(lv => Math.min(...autoLevels.map(al => Math.abs(al-lv))));
    const avg = dists.reduce((a,b)=>a+b,0)/dists.length;
    // convert to score (smaller dist => bigger)
    const span = (mx-mn)+1e-6;
    let score = Math.max(0, 100 - (avg/span)*500);
    score = Math.round(score);
    scoreEl.textContent = String(score);
  }

  function detectLevels(arr){
    // simple: support = 10th percentile, resistance = 90th percentile
    const s=[...arr].sort((a,b)=>a-b);
    const q=(p)=> s[Math.floor((s.length-1)*p)];
    return [q(0.12), q(0.88)];
  }

  function newChart(){
    pts = gen();
    autoLevels = detectLevels(pts);
    lines = [];
    msg.textContent="차트를 클릭해 선을 찍으십시오(2개까지).";
    draw();
  }

  cv.addEventListener("click", (e)=>{
    if(lines.length>=2){ msg.textContent="선은 최대 2개입니다. 새 차트 또는 초기화를 사용하십시오."; return; }
    const r=cv.getBoundingClientRect();
    const y = (e.clientY - r.top) * (cv.height / r.height);
    const [mn,mx]=minMax(pts);
    const pad=(mx-mn)*0.15+1e-6;
    const lo=mn-pad, hi=mx+pad;
    const lv = fromY(y, lo, hi);
    lines.push(lv);
    draw();
  });

  document.getElementById("btnNew").addEventListener("click", newChart);
  document.getElementById("btnReset").addEventListener("click", ()=>{ lines=[]; draw(); });

  newChart();
})();