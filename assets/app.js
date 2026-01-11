(function(){
  const byId = (id)=>document.getElementById(id);
  const qsa = (sel)=>Array.from(document.querySelectorAll(sel));

  function setActiveNav(){
    const path = window.location.pathname;
    qsa('[data-nav]').forEach(a=>{
      const key = a.getAttribute('data-nav');
      const map = {
        notice: /^\/notice\/?/,
        news: /^\/news\/?/,
        strong: /^\/strong\/?/,
        training: /^\/training\/?/,
        data: /^\/data\/?/,
        subscribe: /^\/subscribe\/?/,
        account: /^\/account\/?/,
        ops: /^\/ops\/?/,
        home: /^\/$/,
      };
      const re = map[key];
      if(re && re.test(path)) a.classList.add('active');
    });
  }

  function setHeroStatus({updatedText='', statusText='', statusKind=''}={}){
    const upd = byId('badge-upd');
    const st = byId('badge-status');
    if(upd) upd.textContent = updatedText;
    if(st){
      st.textContent = statusText;
      st.classList.remove('ok','live','missing','wait');
      st.classList.add(statusKind);
    }
  }

  async function fetchJSON(url){
    const r = await fetch(url, {cache:'no-store'});
    if(!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.json();
  }

  // ==============================
  // Market strip (Home)
  // ==============================
  function fmtNum(n, digits=2){
    if(n===null || n===undefined || n==='' || Number.isNaN(Number(n))) return '-';
    const x = Number(n);
    // Int-like values (indices) -> keep 2 decimals if needed
    return x.toLocaleString(undefined, {maximumFractionDigits: digits, minimumFractionDigits: (Math.abs(x) < 10 ? 2 : 0)});
  }

  function fmtChg(chg, pct){
    if(chg===null || chg===undefined || pct===null || pct===undefined) return '';
    const s1 = (Number(chg) >= 0 ? '+' : '') + fmtNum(chg, 2);
    const s2 = (Number(pct) >= 0 ? '+' : '') + fmtNum(pct, 2) + '%';
    return `${s1} (${s2})`;
  }

  async function hydrateMarketStrip(){
    const strip = byId('market-strip');
    if(!strip) return;
    try{
      const data = await fetchJSON('/api/market');
      const updated = data.updated_at || data.updated || data.time || '-';
      const items = data.items || data.data || {};

      // update header badge if still '-' (do not overwrite news badge later)
      const upd = byId('badge-upd');
      if(upd && upd.textContent === 'UPD: -' && updated !== '-') upd.textContent = `UPD: ${fmtTime(updated)}`;

      const keys = ['kospi','kosdaq','usdkrw','dow','nasdaq','sp500'];
      keys.forEach(k=>{
        const it = items[k] || {};
        const v = byId(`mval-${k}`);
        const c = byId(`mchg-${k}`);
        if(v) v.textContent = (it.price!==undefined && it.price!==null) ? fmtNum(it.price, 2) : '-';
        if(c) c.textContent = fmtChg(it.change, it.pct);
      });
    }catch(e){
      // keep placeholders
    }
  }

  function fmtTime(t){
    if(!t) return '-';
    const s = String(t);
    return s.length>24 ? s.slice(0,19).replace('T',' ') : s;
  }

  function escapeHtml(str){
    return String(str)
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'","&#039;");
  }

  async function hydrateNewsPreview(){
    const box = byId('news-preview');
    if(!box) return;
    try{
      const data = await fetchJSON('/news/latest.json');
      const updated = data.updated_at || data.updated || data.update || '-';
      const count = (data.items && data.items.length) ? data.items.length : (data.count||'-');
      setHeroStatus({
        updatedText: `UPD: ${fmtTime(updated)}`,
        statusText: `OK · ${count}건`,
        statusKind: 'ok'
      });
      const items = (data.items||[]).slice(0,8);
      box.innerHTML = items.map(it=>{
        const title = it.title || it.headline || '(제목 없음)';
        const press = it.press || it.source || '';
        const time = it.time || it.published_at || it.published || '';
        const link = it.link || it.url || '#';
        return `
          <div class="item">
            <div>
              <a class="title" href="${link}" target="_blank" rel="noopener">${escapeHtml(title)}</a>
              <div class="meta">${escapeHtml(press)} · ${escapeHtml(time)}</div>
            </div>
            <div class="right">원문</div>
          </div>
        `;
      }).join('');
      const kUpd = byId('kpi-upd');
      const kCnt = byId('kpi-news');
      if(kUpd) kUpd.textContent = fmtTime(updated);
      if(kCnt) kCnt.textContent = String(count);
    }catch(e){
      setHeroStatus({updatedText:'UPD: -', statusText:'MISSING', statusKind:'missing'});
      box.innerHTML = `
        <div class="card">
          <div class="card-top">
            <h3>뉴스 프리뷰</h3>
            <span class="badge missing">MISSING</span>
          </div>
          <p>/news/latest.json 연결이 아직 없거나 차단되었습니다.</p>
          <div class="card-cta"><a href="/news/">뉴스센터로 이동</a></div>
        </div>
      `;
    }
  }

  async function hydrateNewsCenter(){
    const list = byId('news-list');
    if(!list) return;
    try{
      const data = await fetchJSON('/news/latest.json');
      const updated = data.updated_at || data.updated || data.update || '-';
      const items = (data.items||[]);
      const info = byId('news-info');
      if(info) info.textContent = `업데이트: ${fmtTime(updated)} · 수집: ${items.length}건`;
      list.innerHTML = items.slice(0,50).map(it=>{
        const title = it.title || it.headline || '(제목 없음)';
        const press = it.press || it.source || '';
        const time = it.time || it.published_at || it.published || '';
        const link = it.link || it.url || '#';
        return `
          <div class="item">
            <div>
              <a class="title" href="${link}" target="_blank" rel="noopener">${escapeHtml(title)}</a>
              <div class="meta">${escapeHtml(press)} · ${escapeHtml(time)}</div>
            </div>
            <div class="right">원문</div>
          </div>
        `;
      }).join('');
      setHeroStatus({updatedText:`UPD: ${fmtTime(updated)}`, statusText:`OK · ${items.length}건`, statusKind:'ok'});
    }catch(e){
      const info = byId('news-info');
      if(info) info.textContent = '연결 실패: /news/latest.json';
      list.innerHTML = `
        <div class="card">
          <div class="card-top">
            <h3>데이터 연결 실패</h3>
            <span class="badge missing">MISSING</span>
          </div>
          <p>/news/latest.json 파일이 없거나 접근이 불가합니다. (정적 업로드 기반이라 파일이 갱신되면 자동 반영됩니다.)</p>
        </div>
      `;
      setHeroStatus({updatedText:'UPD: -', statusText:'MISSING', statusKind:'missing'});
    }
  }

  function initTickerSearch(){
    const input = byId('ticker-input');
    const btn = byId('ticker-btn');
    if(!input || !btn) return;

    function go(){
      const v = (input.value||'').trim();
      if(!v) return;
      window.location.href = `/data/analysis/?q=${encodeURIComponent(v)}`;
    }
    btn.addEventListener('click', go);
    input.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') go(); });
  }

  async function hydrateAnalysis(){
    const holder = byId('analysis-holder');
    if(!holder) return;

    const params = new URLSearchParams(window.location.search);
    const q = (params.get('q')||'').trim();
    const qBadge = byId('analysis-q');
    if(qBadge) qBadge.textContent = q ? `TICKER: ${q}` : 'TICKER: -';

    const tabs = qsa('.tab');
    const panes = qsa('.pane');
    function activate(idx){
      tabs.forEach((t,i)=>t.classList.toggle('active', i===idx));
      panes.forEach((p,i)=>p.classList.toggle('active', i===idx));
    }
    tabs.forEach((t,i)=>t.addEventListener('click', ()=>activate(i)));
    activate(0);

    if(!q){
      holder.innerHTML = `
        <div class="card">
          <div class="card-top"><h3>종목을 입력해 주세요</h3><span class="badge live">LIVE</span></div>
          <p>상단 입력창에 티커/종목명을 넣고 “분석하기”를 누르면 이 페이지에서 데이터를 연결합니다.</p>
        </div>
      `;
      return;
    }

    const url = `/data/json/analysis/${encodeURIComponent(q)}.json`;
    try{
      const data = await fetchJSON(url);
      const updated = data.updated_at || data.updated || '-';
      setHeroStatus({updatedText:`UPD: ${fmtTime(updated)}`, statusText:'OK', statusKind:'ok'});
      const k1 = byId('kpi-close');
      const k2 = byId('kpi-tv');
      const k3 = byId('kpi-tv52');
      const k4 = byId('kpi-state');
      if(k1) k1.textContent = data.close ?? '-';
      if(k2) k2.textContent = data.tv_krw_uk ?? data.tv_uk ?? '-';
      if(k3) k3.textContent = data.tv5_20 ?? '-';
      if(k4) k4.textContent = data.state ?? 'OK';
      holder.innerHTML = `
        <div class="card">
          <div class="card-top"><h3>데이터 연결됨</h3><span class="badge ok">OK</span></div>
          <p>현재는 틀 우선 적용 상태입니다. JSON 필드가 채워지는 대로 탭/표/차트가 자동으로 확장됩니다.</p>
          <div class="hr"></div>
          <div class="small">사용 파일: ${escapeHtml(url)}</div>
        </div>
      `;
    }catch(e){
      setHeroStatus({updatedText:'UPD: -', statusText:'MISSING', statusKind:'missing'});
      const k4 = byId('kpi-state');
      if(k4) k4.textContent = 'MISSING';
      holder.innerHTML = `
        <div class="card">
          <div class="card-top"><h3>데이터 파일이 아직 없습니다</h3><span class="badge missing">MISSING</span></div>
          <p>현재는 “틀(디자인/동선)”만 적용되어 있습니다.</p>
          <div class="hr"></div>
          <div class="small">필요 파일: ${escapeHtml(url)}</div>
          <div class="small">정적 업로드 방식이라 위 JSON만 생성/업로드되면 자동으로 채워집니다.</div>
        </div>
      `;
    }
  }

    // ==============================
  // Notice (공지)
  // ==============================
  function kindToBadgeClass(kind){
    const k = (kind||'').toLowerCase();
    if(k==='ok') return 'ok';
    if(k==='live') return 'live';
    if(k==='missing') return 'missing';
    return 'wait';
  }

  function renderNoticeList(items){
    const wrap = byId('notice-items');
    const empty = byId('notice-empty');
    if(!wrap) return;

    const arr = Array.isArray(items) ? items : [];
    if(arr.length === 0){
      wrap.innerHTML = '';
      if(empty) empty.textContent = '등록된 공지가 없습니다.';
      return;
    }
    if(empty) empty.textContent = '';

    const html = arr.slice(0,10).map((it)=>{
      const type = escapeHtml(it.type || '');
      const title = escapeHtml(it.title || '');
      const time = escapeHtml(it.time || '');
      const summary = escapeHtml(it.summary || '');
      const impact = escapeHtml(it.impact || '');
      const rollback = escapeHtml(it.rollback || '');
      const link = (it.link || '').trim();
      const linkHtml = link ? `<a class="btn ghost" href="${escapeHtml(link)}" target="_blank" rel="noopener">원문</a>` : '';
      return `
        <div class="card" style="margin-top:10px;">
          <div class="card-top">
            <h3 style="font-size:16px;">${title}</h3>
            <span class="badge upd">${type || '공지'}</span>
          </div>
          <div class="small" style="margin-top:6px;">${time}</div>
          <div style="margin-top:8px; white-space:pre-wrap;">${summary}</div>
          <div class="hr"></div>
          <div class="small">영향: ${impact || '-'}</div>
          <div class="small">롤백: ${rollback || '-'}</div>
          <div class="card-cta">${linkHtml}</div>
        </div>
      `;
    }).join('');
    wrap.innerHTML = html;
  }

  async function hydrateNotice(){
    // 배지 + 리스트(공지 페이지에서만)
    const hasNotice = !!byId('notice-items') || !!byId('badge-status');
    if(!hasNotice) return;

    try{
      const j = await fetchJSON('/api/notice/latest');
      if(j && j.ok){
        setHeroStatus({
          updatedText: 'UPD: ' + (j.updated_at ? String(j.updated_at).slice(0,19).replace('T',' ') : '-'),
          statusText: j.status_text || '대기',
          statusKind: kindToBadgeClass(j.status_kind || 'wait')
        });
        renderNoticeList(j.items || []);
        return;
      }
    }catch(e){}
    setHeroStatus({ updatedText:'UPD: -', statusText:'MISSING', statusKind:'missing' });
  }

  // ==============================
  // Popup (전역)
  // ==============================
  function isInWindow(startAt, endAt){
    const now = Date.now();
    const s = startAt ? Date.parse(startAt) : null;
    const e = endAt ? Date.parse(endAt) : null;
    if(s && Number.isFinite(s) && now < s) return false;
    if(e && Number.isFinite(e) && now > e) return false;
    return true;
  }

  function ensurePopupDOM(){
    if(byId('jlab-popup')) return;
    const el = document.createElement('div');
    el.id = 'jlab-popup';
    el.innerHTML = `
      <div class="jlab-popup-bg" id="jlab-popup-bg"></div>
      <div class="jlab-popup-card" role="dialog" aria-modal="true">
        <div class="jlab-popup-top">
          <div class="jlab-popup-ttl" id="jlab-popup-ttl">공지</div>
          <button class="jlab-popup-x" id="jlab-popup-x" aria-label="닫기">✕</button>
        </div>
        <div class="jlab-popup-body" id="jlab-popup-body"></div>
        <div class="jlab-popup-actions">
          <a class="btn" id="jlab-popup-link" href="#" target="_blank" rel="noopener" style="display:none;">자세히</a>
          <button class="btn ghost" id="jlab-popup-close">닫기</button>
        </div>
      </div>
    `;
    document.body.appendChild(el);

    const close = ()=>{
      const wrap = byId('jlab-popup');
      if(wrap) wrap.style.display = 'none';
    };
    byId('jlab-popup-bg')?.addEventListener('click', close);
    byId('jlab-popup-x')?.addEventListener('click', close);
    byId('jlab-popup-close')?.addEventListener('click', close);
  }

  async function hydratePopup(){
    try{
      const j = await fetchJSON('/api/popup/config');
      if(!j || !j.ok || !j.enabled) return;
      if(!isInWindow(j.start_at, j.end_at)) return;

      const hours = Number.isFinite(Number(j.dismiss_hours)) ? Number(j.dismiss_hours) : 24;
      const key = 'jlab_popup_dismiss_until';
      const until = Number(localStorage.getItem(key) || '0');
      if(until && Date.now() < until) return;

      ensurePopupDOM();
      const wrap = byId('jlab-popup');
      const ttl = byId('jlab-popup-ttl');
      const body = byId('jlab-popup-body');
      const link = byId('jlab-popup-link');

      if(ttl) ttl.textContent = j.title || '공지';
      if(body) body.textContent = j.body || '';

      const url = (j.link_url || '').trim();
      const txt = (j.link_text || '자세히').trim();
      if(url){
        link.style.display = '';
        link.href = url;
        link.textContent = txt;
      }else{
        link.style.display = 'none';
      }

      // 닫기 시 다시 안보기 처리
      const closeBtns = [byId('jlab-popup-bg'), byId('jlab-popup-x'), byId('jlab-popup-close')];
      closeBtns.forEach(btn=>{
        btn && btn.addEventListener('click', ()=>{
          try{
            localStorage.setItem(key, String(Date.now() + hours*60*60*1000));
          }catch(e){}
        }, { once:true });
      });

      if(wrap) wrap.style.display = 'flex';
    }catch(e){}
  }

  window.hydrateNotice = hydrateNotice;
  window.hydratePopup = hydratePopup;

document.addEventListener('DOMContentLoaded', ()=>{
    setActiveNav();
    initTickerSearch();
    hydrateMarketStrip();
    hydrateNewsPreview();
    hydrateNewsCenter();
    hydrateAnalysis();
    hydrateNotice();
    hydratePopup();

    // soft refresh
    setInterval(()=>{ hydrateMarketStrip(); }, 60*1000);
  });
})();