(() => {
  const cv = document.getElementById("cv");
  const ctx = cv.getContext("2d");
  const msg = document.getElementById("msg");
  const okEl = document.getElementById("ok");
  const noEl = document.getElementById("no");
  const stEl = document.getElementById("st");
  let ok=0,no=0,st=0;
  let answer = "DB";

  function rnd(a,b){ return a + Math.random()*(b-a); }
  function clear(){
    ctx.clearRect(0,0,cv.width,cv.height);
    ctx.fillStyle = "#0f1621"; ctx.fillRect(0,0,cv.width,cv.height);
  }
  function line(x1,y1,x2,y2,c="#223048"){
    ctx.strokeStyle=c; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
  }
  function drawSeries(points){
    // grid
    for(let i=0;i<=10;i++){
      const y = 20 + i*(cv.height-40)/10;
      line(20,y,cv.width-20,y);
    }
    for(let i=0;i<=12;i++){
      const x = 20 + i*(cv.width-40)/12;
      line(x,20,x,cv.height-20);
    }

    // normalize
    const min = Math.min(...points), max = Math.max(...points);
    const pad = (max-min)*0.15 + 1e-6;
    const lo = min - pad, hi = max + pad;

    ctx.strokeStyle = "#6ee7ff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach((v,i)=>{
      const x = 20 + i*(cv.width-40)/(points.length-1);
      const y = 20 + (hi - v)*(cv.height-40)/(hi-lo);
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });
    ctx.stroke();

    // markers
    ctx.fillStyle="#e6eef8";
    for(let i=0;i<points.length;i+=6){
      const v=points[i];
      const x = 20 + i*(cv.width-40)/(points.length-1);
      const y = 20 + (hi - v)*(cv.height-40)/(hi-lo);
      ctx.beginPath(); ctx.arc(x,y,3,0,Math.PI*2); ctx.fill();
    }
  }

  function genPattern(kind){
    const n = 60;
    const base = 100;
    const arr = [];
    if(kind==="DB"){ // double bottom
      for(let i=0;i<n;i++){
        let v = base + Math.sin(i/8)*2 + rnd(-1.2,1.2);
        if(i>10 && i<20) v -= (1 - Math.abs(i-15)/5)*14;
        if(i>30 && i<40) v -= (1 - Math.abs(i-35)/5)*14;
        if(i>40) v += (i-40)*0.9;
        arr.push(v);
      }
      return arr;
    }
    if(kind==="DT"){ // double top
      for(let i=0;i<n;i++){
        let v = base + Math.sin(i/8)*2 + rnd(-1.2,1.2);
        if(i>10 && i<20) v += (1 - Math.abs(i-15)/5)*14;
        if(i>30 && i<40) v += (1 - Math.abs(i-35)/5)*14;
        if(i>40) v -= (i-40)*0.9;
        arr.push(v);
      }
      return arr;
    }
    if(kind==="TRI"){ // triangle squeeze
      for(let i=0;i<n;i++){
        const amp = Math.max(0.5, 16 - i*0.22);
        let v = base + Math.sin(i/3.2)*amp + rnd(-1.0,1.0);
        if(i>42) v += (i-42)*1.2;
        arr.push(v);
      }
      return arr;
    }
    // FLAG (bull flag-ish)
    for(let i=0;i<n;i++){
      let v = base + rnd(-1.0,1.0);
      if(i<18) v += i*1.4;           // pole
      else if(i<42) v += 25 - (i-18)*0.4 + Math.sin(i/2.2)*3; // flag
      else v += 15 + (i-42)*1.2;     // breakout
      arr.push(v);
    }
    return arr;
  }

  function newQ(){
    clear();
    msg.textContent = "정답을 선택하십시오.";
    const kinds = ["DB","DT","TRI","FLAG"];
    answer = kinds[Math.floor(Math.random()*kinds.length)];
    drawSeries(genPattern(answer));
  }

  function pick(a){
    if(a===answer){
      ok++; st++;
      msg.textContent = "정답입니다.";
    } else {
      no++; st=0;
      msg.textContent = "오답입니다.";
    }
    okEl.textContent=ok;
    noEl.textContent=no;
    stEl.textContent=st;
    setTimeout(newQ, 650);
  }

  document.getElementById("btnNew").addEventListener("click", newQ);
  document.querySelectorAll("button[data-a]").forEach(b => {
    b.addEventListener("click", () => pick(b.dataset.a));
  });

  newQ();
})();