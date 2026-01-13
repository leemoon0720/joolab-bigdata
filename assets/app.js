(function(){
  const byId = (id)=>document.getElementById(id);
  const qsa = (sel)=>Array.from(document.querySelectorAll(sel));
  // HTML escape (XSS-safe)
  function esc(v){
    const str = (v === null || v === undefined) ? '' : String(v);
    return str.replace(/[&<>"'`]/g, (ch)=>({
      '&':'&amp;',
      '<':'&lt;',
      '>':'&gt;',
      '"':'&quot;',
      "'":'&#39;',
      '`':'&#96;'
    }[ch]));
  }


  function setActiveNav(){
    const path = window.location.pathname;
    qsa('[data-nav]').forEach(a=>{
      const key = a.getAttribute('data-nav');
            const map = {
        notice: /^\/notice\/?/,
        news: /^\/news\/?/,
        data: /^\/data\/?/,
        sample: /^\/sample\/?/,
        performance: /^\/performance\/?/,
        chartgame: /^\/(training\/game|training|game)\/?/,
        meme: /^\/meme\/?/,
        subscribe: /^\/subscribe\/?/,
        account: /^\/account\/?/,
        ops: /^\/ops\/?/,
        home: /^\/$/,
      };
      const re = map[key];
      if(re && re.test(path)) a.classList.add('active');
    });
  }


  // ==============================
  // Auth / Plan helpers
  // ==============================
  function getPlanLabelForEmail(email){
    try{ return localStorage.getItem("jlab_plan_"+email) || "미구독"; }catch(e){ return "미구독"; }
  }
  function hasUSAccessByPlanLabel(plan){
    const s = String(plan||"");
    return (s.indexOf("89,000")>=0) || (s.indexOf("200,000")>=0) || (/\bPRO\b/i.test(s)) || (/\bVIP\b/i.test(s));
  }
  async function fetchMeSafe(){
    try{
      const me = await fetchJSON('/api/auth/me');
      if(me && me.ok && me.user && me.user.email) return me;
    }catch(e){}
    return null;
  }

  // ==============================
  // Topbar nav standardization
  // ==============================
  function renderTopNav(){
    const nav = document.querySelector('.topbar .nav');
    if(!nav) return;

    const items = [
      {key:'notice', label:'공지사항', href:'/notice/'},
      {key:'news', label:'뉴스센터', href:'/news/'},
      {key:'data', label:'빅데이터', href:'/data/'},
      {key:'sample', label:'샘플자료실', href:'/sample/'},
      {key:'performance', label:'성과표', href:'/performance/'},
      {key:'chartgame', label:'차트게임', href:'/training/game/'},
      {key:'meme', label:'유머', href:'/meme/'},
      {key:'subscribe', label:'구독', href:'/subscribe/'},
      {key:'account', label:'회원', href:'/account/'},
      {key:'ops', label:'운영센터', href:'/ops/', adminOnly:true},
    ];

    nav.innerHTML = items.map(it=>{
      return `<a href="${it.href}" data-nav="${it.key}" ${it.adminOnly?'data-admin-only="1"':''}>${it.label}</a>`;
    }).join('');
  }

  async function enhanceTopNavWithAuth(){
    // 기본: 운영센터 숨김
    qsa('[data-admin-only="1"]').forEach(a=>a.style.display='none');

    const me = await fetchMeSafe();
    if(!me) return;

    const email = me.user.email;
    const role = me.user.role || 'user';
    const isAdmin = /admin/i.test(role);

    // 운영센터: 관리자만
    if(isAdmin){
      qsa('[data-admin-only="1"]').forEach(a=>a.style.display='');
    }

    // 회원 옆에 이메일 표시
    const aAccount = document.querySelector('[data-nav="account"]');
    if(aAccount && !byId('nav-user-email')){
      const span = document.createElement('span');
      span.id = 'nav-user-email';
      span.className = 'nav-user';
      span.innerHTML = `<span class="dot"></span><span>${esc(email)}</span>`;
      aAccount.insertAdjacentElement('afterend', span);
    }
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
  function getAuthToken(){
    try{
      return localStorage.getItem("jlab_token") || localStorage.getItem("joolab_token") || "";
    }catch(e){
      return "";
    }
  }

  function authHeaders(extra){
    const t = getAuthToken();
    const h = Object.assign({}, extra || {});
    if(t) h["Authorization"] = "Bearer " + t;
    return h;
  }

  async function fetchJSON(url){
    const r = await fetch(url, {cache:'no-store', credentials:'include', headers: authHeaders()});
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
      let items = (data.items||[]);
      const sp = new URLSearchParams(window.location.search);
      const tag = (sp.get('tag')||'').trim();
      if(tag){ items = items.filter(it=> (it.keywords_hit||[]).includes(tag)); }
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


  function fmtYYMMDD(){
    const d = new Date();
    const yy = String(d.getFullYear()).slice(2);
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    return `${yy}${mm}${dd}`;
  }

  function guessDateKey(name){
    const m = String(name||'').match(/(\d{6})/);
    return m ? m[1] : fmtYYMMDD();
  }
  async function postJSON(url, body){
    const r = await fetch(url, {
      method:'POST',
      credentials:'include',
      headers: authHeaders({'content-type':'application/json; charset=utf-8'}),
      body: JSON.stringify(body||{})
    });
    if(!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.json();
  }



  function bindDeleteDelegation(container, onDeleted){
    if(!container || container.dataset && container.dataset.jlabDeleteBound === '1') return;
    if(container.dataset) container.dataset.jlabDeleteBound = '1';

    container.addEventListener('click', async (e)=>{
      const t = e.target;
      if(!t) return;
      if(t.getAttribute && t.getAttribute('data-act') === 'post-delete'){
        e.preventDefault();
        const id = t.getAttribute('data-id') || '';
        if(!id) return;
        const ok = confirm('삭제하시겠습니까?');
        if(!ok) return;

        t.disabled = true;
        try{
          const res = await postJSON('/api/posts/delete', {id});
          if(res && res.ok){
            if(typeof onDeleted === 'function') await onDeleted();
          }else{
            alert('삭제 실패: ' + (res.error||''));
          }
        }catch(err){
          alert('삭제 실패');
        }finally{
          t.disabled = false;
        }
      }
    });
  }

  function renderMetaItem(meta, opts){
    opts = (opts && typeof opts === 'object') ? opts : {};
    const title = meta.title || '(제목 없음)';
    const sub = `${meta.region||''} · ${meta.category||''} · ${fmtTime(meta.created_at||'')}${locked ? ' · 🔒Pro+' : ''}`;
    const thumb = (meta && meta.thumb) ? String(meta.thumb) : '';
    const canDelete = !!opts.canDelete;
    const showActions = !!opts.showActions;
    const locked = !!opts.locked;

    return `
      <div class="item ${locked?'is-locked':''}">
        <div>
          <div class="title">${esc(title)}</div>
          <div class="meta">${esc(sub)}</div>
        </div>
        <div class="right">
          ${thumb ? `<img class="mini-thumb" src="${esc(thumb)}" alt="thumb">` : ``}
          ${showActions && canDelete ? `<button class="mini-action danger" type="button" data-act="post-delete" data-id="${esc(meta.id||'')}">삭제</button>` : ``}
          <a href="${locked?'/subscribe/':(`/post/?id=${encodeURIComponent(meta.id)}`)}">${locked?'구독 필요':'보기'}</a>
        </div>
      </div>
    `;
  }

  function applyChipToggle(groupSel, onAttr, onValue){
    qsa(groupSel).forEach(btn=>{
      const v = btn.getAttribute(onAttr);
      const on = v === onValue;
      btn.classList.toggle('is-on', on);
    });
  }

  async function hydrateHomeDashboard(){
    // News preview
    const homeNews = byId('home-news');
    if(homeNews){
      try{
        const data = await fetchJSON('/news/latest.json');
        const items = (data.items||[]).slice(0,5);
        const upd = data.updated_at || data.updated || data.update || '-';
        const meta = byId('home-news-meta');
        const badge = byId('home-news-upd');
        const bNews = byId('home-badge-news');
        if(meta) meta.textContent = `업데이트: ${fmtTime(upd)} · ${items.length}건 표시`;
        if(badge) badge.textContent = `UPD: ${fmtTime(upd)}`;
        if(bNews) bNews.textContent = `NEWS: ${fmtTime(upd)}`;

        homeNews.innerHTML = items.map(it=>{
          const title = it.title || it.headline || '(제목 없음)';
          const press = it.press || it.source || '';
          const time = it.time || it.published_at || it.published || '';
          const link = it.link || it.url || '#';
          return `
            <div class="item">
              <div>
                <div class="title">${esc(title)}</div>
                <div class="meta">${esc(press)} · ${esc(fmtTime(time))}</div>
              </div>
              <div class="right"><a href="${esc(link)}" target="_blank" rel="noopener">링크</a></div>
            </div>
          `;
        }).join('');

        // Themes (keywords_hit)
        const box = byId('home-themes');
        if(box){
          const cnt = {};
          (data.items||[]).forEach(it=>{
            (it.keywords_hit||[]).forEach(k=>{
              if(!k) return;
              cnt[k] = (cnt[k]||0) + 1;
            });
          });
          const top = Object.entries(cnt).sort((a,b)=>b[1]-a[1]).slice(0,12);
          box.innerHTML = top.map(([k,n])=>`<a class="chip" href="/news/?tag=${encodeURIComponent(k)}">${esc(k)} <span style="opacity:.65;">${n}</span></a>`).join('');
        }
      }catch(e){
        homeNews.innerHTML = `<div class="item"><div><div class="title">뉴스 데이터를 불러오지 못했습니다.</div><div class="meta">/news/latest.json 확인</div></div></div>`;
      }
    }

    
    // Bigdata latest (Strong/Accum/Suspicious combined)
    const homeBD = byId('home-bigdata');
    if(homeBD){
      try{
        const me = await fetchMeSafe();
        const email = me?.user?.email || '';
        const plan = email ? getPlanLabelForEmail(email) : '미구독';
        const usOk = hasUSAccessByPlanLabel(plan);

        const cats = ['strong','accum','suspicious'];
        const bags = await Promise.all(cats.map(async c=>{
          try{
            const j = await fetchJSON(`/api/posts/list?category=${encodeURIComponent(c)}&region=ALL&limit=30`);
            return (j.items||[]);
          }catch(e){
            return [];
          }
        }));
        let items = bags.flat();
        // dedupe by id
        const seen = new Set();
        items = items.filter(x=>{
          const id = x && x.id;
          if(!id) return false;
          if(seen.has(id)) return false;
          seen.add(id);
          return true;
        });

        items.sort((a,b)=> String(b.created_ts||'').localeCompare(String(a.created_ts||'')));

        const total = items.length;
        const showN = Math.min(12, total);
        const show = items.slice(0, showN);

        const b = byId('home-badge-bigdata');
        if(b){
          const upd = show[0]?.created_at || items[0]?.created_at || '';
          b.textContent = upd ? `BIGDATA: ${fmtTime(upd)}` : 'BIGDATA: -';
        }

        if(!showN){
          homeBD.innerHTML = `<div class="item"><div><div class="title">업로드된 글이 없습니다.</div><div class="meta">관리자 업로드 후 표시됩니다.</div></div></div>`;
          return;
        }

        homeBD.innerHTML = show.map(meta=>{
          const locked = (meta && meta.region === 'US') && (!usOk);
          return renderMetaItem(meta, {locked});
        }).join('') + `<div class="small" style="margin-top:10px;">최근 ${showN}개 표시 · 전체 ${total}개</div>`;
      }catch(e){
        homeBD.innerHTML = `<div class="item"><div><div class="title">빅데이터를 불러오지 못했습니다.</div><div class="meta">KV 설정 확인</div></div></div>`;
      }
    }

    // Perf list (3)
 (3)
    const homePerf = byId('home-perf');
    if(homePerf){
      try{
        const j = await fetchJSON('/api/posts/list?category=perf&region=ALL&limit=3');
        const items = (j.items||[]);
        const badge = byId('home-perf-badge');
        if(badge) badge.textContent = `${items.length}개`;
        homePerf.innerHTML = items.length ? items.map(renderMetaItem).join('') : `<div class="item"><div><div class="title">성과표가 없습니다.</div><div class="meta">업로드 후 목록에 누적됩니다.</div></div></div>`;
      }catch(e){
        homePerf.innerHTML = `<div class="item"><div><div class="title">성과표를 불러오지 못했습니다.</div><div class="meta">KV 설정 확인</div></div></div>`;
      }
    }

    // YouTube latest
    const yt = byId('home-youtube');
    if(yt){
      try{
        const j = await fetchJSON('/api/youtube/latest');
        if(j && j.ok){
          yt.innerHTML = `
            <a href="${esc(j.url||'#')}" target="_blank" rel="noopener" style="display:flex; gap:12px; align-items:center; text-decoration:none;">
              <img class="yt-thumb" src="${esc(j.thumb||'')}" alt="thumb">
              <div class="yt-meta">
                <div class="yt-title">${esc(j.title||'')}</div>
                <div class="yt-sub">${esc(fmtTime(j.published_at||''))}</div>
              </div>
            </a>
          `;
        }else{
          yt.innerHTML = `<div class="small">유튜브 최신 영상 데이터를 불러오지 못했습니다.</div>`;
        }
      }catch(e){
        yt.innerHTML = `<div class="small">유튜브 최신 영상 데이터를 불러오지 못했습니다.</div>`;
      }
    }
  }

  function detectIsAdmin(me){
    try{
      return me && me.ok && me.user && (me.user.role === 'admin');
    }catch(e){
      return false;
    }
  }

  async function hydrateBigdataCenter(){
    const list = byId('bd-list');
    if(!list) return;

    let isAdmin = false;
    let meEmail = '';
    let meRole = 'user';
    let mePlan = '미구독';
    let usOk = false;

    // default state
    let region = 'KR';
    let cat = 'accum';

    const btnsRegion = qsa('[data-bd-region]');
    const btnsCat = qsa('[data-bd-cat]');

    function setRegion(v){
      // 해외(US)는 89,000원 이상(미국지표 포함)만
      if(v === 'US' && !usOk){
        // 버튼 상태 복구
        btnsRegion.forEach(b=>b.classList.toggle('is-on', b.getAttribute('data-bd-region')===region));
        list.innerHTML = `<div class="item"><div><div class="title">해외(미국지표) 권한이 없습니다.</div><div class="meta">Pro(89,000원) 이상부터 해외(US) 열람이 가능합니다.</div></div><div class="right"><a href="/subscribe/">구독 페이지로</a></div></div>`;
        return;
      }
      region = v;
      btnsRegion.forEach(b=>b.classList.toggle('is-on', b.getAttribute('data-bd-region')===region));
      load();
    }
    function setCat(v){
      cat = v;
      btnsCat.forEach(b=>b.classList.toggle('is-on', b.getAttribute('data-bd-cat')===cat));
      load();
    }

    btnsRegion.forEach(b=>b.addEventListener('click', ()=>setRegion(b.getAttribute('data-bd-region'))));
    btnsCat.forEach(b=>b.addEventListener('click', ()=>setCat(b.getAttribute('data-bd-cat'))));

    async function load(){
      if(region === 'US' && !usOk){
        list.innerHTML = `<div class="item"><div><div class="title">해외(미국지표) 권한이 없습니다.</div><div class="meta">Pro(89,000원) 이상부터 해외(US) 열람이 가능합니다.</div></div><div class="right"><a href="/subscribe/">구독 페이지로</a></div></div>`;
        const upd = byId('bd-badge-upd');
        const cnt = byId('bd-badge-count');
        if(upd) upd.textContent = `UPD: -`;
        if(cnt) cnt.textContent = `0개`;
        return;
      }
      list.innerHTML = `<div class="small">로딩 중...</div>`;
      try{
        const j = await fetchJSON(`/api/posts/list?category=${encodeURIComponent(cat)}&region=${encodeURIComponent(region)}&limit=50`);
        const items = (j.items||[]);
        const upd = byId('bd-badge-upd');
        const cnt = byId('bd-badge-count');
        if(upd) upd.textContent = `UPD: ${fmtTime(j.updated_at||'')}`;
        if(cnt) cnt.textContent = `${items.length}개`;
        list.innerHTML = items.length ? items.map(m=>renderMetaItem(m,{showActions:isAdmin,canDelete:isAdmin})).join('') : `<div class="item"><div><div class="title">게시글이 없습니다.</div><div class="meta">관리자 업로드 후 표시됩니다.</div></div></div>`;
      }catch(e){
        list.innerHTML = `<div class="item"><div><div class="title">목록을 불러오지 못했습니다.</div><div class="meta">KV 설정 확인</div></div></div>`;
      }
    }

    // admin upload UI
    try{
      const me = await fetchJSON('/api/auth/me');
      meEmail = me?.user?.email || '';
      meRole = me?.user?.role || 'user';
      mePlan = meEmail ? getPlanLabelForEmail(meEmail) : '미구독';
      usOk = hasUSAccessByPlanLabel(mePlan) || detectIsAdmin(me);
      isAdmin = detectIsAdmin(me);
      const box = byId('bd-admin-actions');
      if(box) box.style.display = isAdmin ? '' : 'none';
      if(isAdmin){
        bindBigdataUpload(()=>({category: cat, region}));
        bindDeleteDelegation(list, load);
      }
    }catch(e){}

    load();
  }


  
  async function hydrateSampleRoom(){
    const list = byId('sample-list');
    if(!list) return;

    let cat = 'accum';
    let region = 'KR';

    const btnCat = qsa('[data-sample-cat]');
    const btnReg = qsa('[data-sample-region]');

    function setCat(v){
      cat = v;
      btnCat.forEach(b=>b.classList.toggle('is-on', b.getAttribute('data-sample-cat')===cat));
      load();
    }
    function setRegion(v){
      region = v;
      btnReg.forEach(b=>b.classList.toggle('is-on', b.getAttribute('data-sample-region')===region));
      load();
    }

    btnCat.forEach(b=>b.addEventListener('click', ()=>setCat(b.getAttribute('data-sample-cat'))));
    btnReg.forEach(b=>b.addEventListener('click', ()=>setRegion(b.getAttribute('data-sample-region'))));

    async function load(){
      list.innerHTML = `<div class="small">로딩 중...</div>`;
      try{
        const j = await fetchJSON(`/api/posts/list?category=${encodeURIComponent(cat)}&region=${encodeURIComponent(region)}&limit=30&sample=1`);
        const items = (j.items||[]);
        const upd = byId('sample-badge-upd');
        const cnt = byId('sample-badge-count');
        if(upd) upd.textContent = `UPD: ${fmtTime(j.updated_at||'')}`;
        if(cnt) cnt.textContent = `${items.length}개`;
        list.innerHTML = items.length ? items.map(renderMetaItem).join('') : `<div class="item"><div><div class="title">샘플이 없습니다.</div><div class="meta">관리자가 업로드 시 ‘샘플 공개’를 체크하면 여기에 노출됩니다.</div></div></div>`;
      }catch(e){
        list.innerHTML = `<div class="item"><div><div class="title">샘플을 불러오지 못했습니다.</div><div class="meta">KV 설정 확인</div></div></div>`;
      }
    }

    load();
  }

async function hydrateCategoryPage(){
    const list = byId('cat-list');
    if(!list) return;
    const cat = (window.__CAT_KEY__ || '').trim();
    if(!cat) return;

    let region = 'KR';
    const btns = qsa('[data-cat-region]');
    btns.forEach(b=>b.addEventListener('click', ()=>{
      region = b.getAttribute('data-cat-region') || 'KR';
      btns.forEach(x=>x.classList.toggle('is-on', x.getAttribute('data-cat-region')===region));
      load();
    }));

    async function load(){
      list.innerHTML = `<div class="small">로딩 중...</div>`;
      try{
        const j = await fetchJSON(`/api/posts/list?category=${encodeURIComponent(cat)}&region=${encodeURIComponent(region)}&limit=80`);
        const items = (j.items||[]);
        const upd = byId('cat-badge-upd');
        const cnt = byId('cat-badge-count');
        if(upd) upd.textContent = `UPD: ${fmtTime(j.updated_at||'')}`;
        if(cnt) cnt.textContent = `${items.length}개`;
        list.innerHTML = items.length ? items.map(renderMetaItem).join('') : `<div class="item"><div><div class="title">게시글이 없습니다.</div><div class="meta">관리자 업로드 후 표시됩니다.</div></div></div>`;
      }catch(e){
        list.innerHTML = `<div class="item"><div><div class="title">목록을 불러오지 못했습니다.</div><div class="meta">KV 설정 확인</div></div></div>`;
      }
    }

    try{
      const me = await fetchJSON('/api/auth/me');
      const isAdmin = detectIsAdmin(me);
      const box = byId('cat-admin-actions');
      if(box) box.style.display = isAdmin ? '' : 'none';
      if(isAdmin){
        bindCategoryUpload(cat, ()=>({category: cat, region}));
      }
    }catch(e){}

    load();
  }

  function bindCategoryUpload(catKey, getState){
    const btn = byId('cat-btn-upload');
    const file = byId('cat-file');
    const titleInput = byId('cat-title');
    if(!btn || !file) return;

    btn.addEventListener('click', ()=> file.click());
    file.addEventListener('change', async ()=>{
      const f = file.files && file.files[0];
      if(!f) return;
      btn.disabled = true;
      btn.textContent = '업로드 중...';

      try{
        const rows = await parseFileToRows(f);
        const date_key = guessDateKey(f.name);
        const st = getState ? getState() : {category: catKey, region:'KR'};
        const titleMap = {accum:'매집종목', strong:'강한종목', suspicious:'수상해수상해'};
        const manualTitle = (titleInput && titleInput.value ? titleInput.value : '').trim();
        const title = manualTitle || `${titleMap[st.category]||'빅데이터'} ${date_key}`;

        let html = '';
        if(st.category === 'suspicious'){
          const ranked = rankSuspiciousRows(rows);
          const top15 = ranked.slice(0,15);
          html = buildSrankHtmlTop15(title, top15);
        }else{
          const top10 = rows.slice(0,10);
          const top30 = rows.slice(0,30);
          html = buildMrankHtml(title, top10, top30, rows);
        }

        const is_sample = !!byId('bd-ck-sample')?.checked;

        const res = await postJSON('/api/posts/create', {
          category: st.category,
          region: st.region,
          title,
          date_key,
          is_sample,
          html
        });

        if(res && res.ok){
          window.location.href = `/post/?id=${encodeURIComponent(res.id)}`;
        }else{
          alert('업로드 실패: ' + (res.error||''));
        }
      }catch(e){
        alert('업로드 실패: ' + String(e && e.message ? e.message : e));
      }finally{
        btn.disabled = false;
        btn.textContent = '업로드';
        file.value = '';
        const ck = byId('bd-ck-sample'); if(ck) ck.checked = false;
      }
    });
  }

  async function hydratePerformance(){
    const list = byId('perf-list');
    if(!list) return;

    let isAdmin = false;

    async function load(){
      list.innerHTML = `<div class="small">로딩 중...</div>`;
      try{
        const j = await fetchJSON('/api/posts/list?category=perf&region=ALL&limit=80');
        const items = (j.items||[]);
        const upd = byId('perf-badge-upd');
        const cnt = byId('perf-badge-count');
        if(upd) upd.textContent = `UPD: ${fmtTime(j.updated_at||'')}`;
        if(cnt) cnt.textContent = `총 ${items.length}개`;
        list.innerHTML = items.length ? items.map(m=>renderMetaItem(m,{showActions:isAdmin,canDelete:isAdmin})).join('') : `<div class="item"><div><div class="title">성과표가 없습니다.</div><div class="meta">관리자 업로드 후 누적됩니다.</div></div></div>`;
      }catch(e){
        list.innerHTML = `<div class="item"><div><div class="title">성과표를 불러오지 못했습니다.</div><div class="meta">KV 설정 확인</div></div></div>`;
      }
    }

    try{
      const me = await fetchJSON('/api/auth/me');
      isAdmin = detectIsAdmin(me);
      const box = byId('perf-admin-actions');
      if(box) box.style.display = isAdmin ? '' : 'none';
      if(isAdmin){
        bindPerfUpload();
        bindDeleteDelegation(list, load);
      }
    }catch(e){}

    load();
  }

  async function hydratePost(){
    const frame = byId('post-frame');
    if(!frame) return;
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id') || '';
    if(!id){
      frame.srcdoc = '<html><body style="background:#0b1220;color:#fff;font-family:system-ui;padding:24px;">NO ID</body></html>';
      return;
    }
    try{
      const j = await fetchJSON(`/api/posts/get?id=${encodeURIComponent(id)}`);
      if(!j.ok){
        frame.srcdoc = '<html><body style="background:#0b1220;color:#fff;font-family:system-ui;padding:24px;">NOT FOUND</body></html>';
        return;
      }
      const meta = j.meta || {};
      // 해외(US) 콘텐츠는 Pro(89,000원) 이상만
      if(meta && meta.region === 'US'){
        const me = await fetchMeSafe();
        const email = me?.user?.email || '';
        const plan = email ? getPlanLabelForEmail(email) : '미구독';
        const usOk = hasUSAccessByPlanLabel(plan) || detectIsAdmin(me||{});
        if(!usOk){
          frame.srcdoc = `<html><body style="background:#0b1220;color:#fff;font-family:system-ui;padding:24px;">
            <h2 style="margin:0 0 10px;">해외(미국지표) 권한이 없습니다.</h2>
            <p style="margin:0 0 14px;opacity:.85;">Pro(89,000원) 이상부터 해외(US) 열람이 가능합니다.</p>
            <p style="margin:0;"><a href="/subscribe/" style="color:#93c5fd;">구독 페이지로 이동</a></p>
          </body></html>`;
          return;
        }
      }
      const ttl = byId('post-title');
      const sub = byId('post-sub');
      const upd = byId('post-upd');
      const kind = byId('post-kind');
      if(ttl) ttl.textContent = meta.title || '리포트';
      if(sub) sub.textContent = `${meta.region||''} · ${meta.category||''} · ${meta.date_key||''}`;
      if(upd) upd.textContent = `UPD: ${fmtTime(meta.created_at||'')}`;
      if(kind) kind.textContent = 'HTML';

      // admin actions (title update / delete)
      try{
        const me = await fetchJSON('/api/auth/me');
        const isAdmin = detectIsAdmin(me);
        const box = byId('post-admin-actions');
        if(box) box.style.display = isAdmin ? '' : 'none';
        if(isAdmin){
          const inp = byId('post-edit-title');
          const btnSave = byId('post-btn-save-title');
          const btnDel = byId('post-btn-delete');
          if(inp) inp.value = (meta.title||'').trim();

          if(btnSave && !btnSave.dataset.bound){
            btnSave.dataset.bound = '1';
            btnSave.addEventListener('click', async ()=>{
              const newTitle = (inp && inp.value ? inp.value : '').trim();
              if(!newTitle){ alert('제목을 입력하십시오.'); return; }
              btnSave.disabled = true;
              try{
                const res = await postJSON('/api/posts/update_title', {id, title: newTitle});
                if(res && res.ok){
                  if(ttl) ttl.textContent = newTitle;
                  alert('저장되었습니다.');
                }else{
                  alert('저장 실패: ' + (res.error||''));
                }
              }catch(e){
                alert('저장 실패');
              }finally{
                btnSave.disabled = false;
              }
            });
          }

          if(btnDel && !btnDel.dataset.bound){
            btnDel.dataset.bound = '1';
            btnDel.addEventListener('click', async ()=>{
              const ok = confirm('삭제하시겠습니까?');
              if(!ok) return;
              btnDel.disabled = true;
              try{
                const res = await postJSON('/api/posts/delete', {id});
                if(res && res.ok){
                  alert('삭제되었습니다.');
                  window.location.href = '/data/';
                }else{
                  alert('삭제 실패: ' + (res.error||''));
                }
              }catch(e){
                alert('삭제 실패');
              }finally{
                btnDel.disabled = false;
              }
            });
          }
        }
      }catch(e){}

      frame.srcdoc = j.html || '';
    }catch(e){
      frame.srcdoc = '<html><body style="background:#0b1220;color:#fff;font-family:system-ui;padding:24px;">LOAD ERROR</body></html>';
    }
  }

  function csvToRows(text){
    const lines = (text||'').split(/\r?\n/).filter(x=>x.trim().length>0);
    if(lines.length<1) return [];
    const sep = lines[0].includes('\t') ? '\t' : ',';
    const header = lines[0].split(sep).map(h=>h.trim());
    const rows=[];
    for(let i=1;i<lines.length;i++){
      const cols = lines[i].split(sep);
      const r={};
      header.forEach((h,idx)=>{ r[h]= (cols[idx]===undefined? '' : cols[idx]); });
      rows.push(r);
    }
    return rows;
  }

  const MRAK_CSS = `
<style>
:root{
  --bg1:#0b1220;
  --bg2:#0a0f1d;
  --card:#0f1a2e;
  --card2:#101c33;
  --line:rgba(255,255,255,0.08);
  --txt:#eaf0ff;
  --muted:rgba(234,240,255,0.72);
  --muted2:rgba(234,240,255,0.55);
  --good:#ff3b30; /* 매집(긍정) = 레드 */
  --bad:#3b82f6;  /* 부담/약함 = 블루 */
  --warn:#fbbf24;
  --chip:#111b32;
  --shadow: 0 16px 40px rgba(0,0,0,0.38);
  --rs: 18px;
  --rs2: 14px;
}

html, body, [data-testid="stAppViewContainer"]{
  background: radial-gradient(1200px 600px at 20% 10%, rgba(255,59,48,0.10), transparent 55%),
              radial-gradient(1200px 600px at 80% 30%, rgba(59,130,246,0.10), transparent 55%),
              linear-gradient(180deg, var(--bg1), var(--bg2));
  color: var(--txt);
}

[data-testid="stHeader"], [data-testid="stToolbar"]{ background: transparent; }

.block-container{
  padding-top: 1.1rem !important;
  padding-bottom: 2.5rem !important;
  max-width: 1240px;
}

.jl-title{
  display:flex; flex-wrap:wrap; gap:10px; align-items:center; justify-content:space-between;
  margin: 8px 0 14px 0;
}
.jl-title h1{
  font-size: 1.35rem; margin:0; letter-spacing:-0.3px;
}
.jl-sub{
  font-size: 0.92rem; color: var(--muted);
}
.badge{
  display:inline-flex; align-items:center; gap:8px;
  padding: 8px 12px;
  border: 1px solid var(--line);
  background: rgba(255,255,255,0.03);
  border-radius: 999px;
  font-size: 0.85rem;
  color: var(--muted);
}
.grid{
  display:grid;
  grid-template-columns: repeat(12, 1fr);
  gap: 14px;
}
.card{
  grid-column: span 6;
  background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02));
  border: 1px solid var(--line);
  border-radius: var(--rs);
  box-shadow: var(--shadow);
  overflow: hidden;
}
@media (max-width: 980px){
  .card{ grid-column: span 12; }
}
.card-head{
  padding: 14px 16px 10px 16px;
  border-bottom: 1px solid var(--line);
  display:flex; justify-content:space-between; align-items:flex-start; gap: 10px;
  background: linear-gradient(180deg, rgba(255,255,255,0.04), transparent);
}
.rank-pill{
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 0.80rem;
  border: 1px solid var(--line);
  background: rgba(255,255,255,0.03);
  color: var(--muted);
}
.name{
  font-size: 1.05rem;
  font-weight: 800;
  margin:0;
  letter-spacing:-0.3px;
}
.code{
  font-size: 0.84rem;
  color: var(--muted2);
  margin-top: 2px;
}
.card-body{
  padding: 12px 16px 14px 16px;
}
.kv{
  display:grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 14px;
  margin-top: 10px;
}
.kv .item{
  border: 1px solid var(--line);
  background: rgba(15,26,46,0.55);
  border-radius: var(--rs2);
  padding: 10px 10px;
}
.kv .k{
  font-size: 0.76rem;
  color: var(--muted2);
  margin-bottom: 4px;
}
.kv .v{
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--txt);
  display:flex; align-items:center; gap: 8px;
}
.chips{
  display:flex; flex-wrap:wrap; gap:8px; margin-top: 10px;
}
.chip{
  border: 1px solid var(--line);
  background: rgba(17,27,50,0.75);
  color: var(--muted);
  padding: 6px 9px;
  border-radius: 999px;
  font-size: 0.78rem;
}
.sig{
  display:inline-flex; align-items:center; justify-content:center;
  width: 20px; height: 20px;
  border-radius: 6px;
  font-size: 0.82rem;
  font-weight: 900;
}
.sig.pos{ background: rgba(255,59,48,0.17); color: var(--good); border: 1px solid rgba(255,59,48,0.35); }
.sig.neg{ background: rgba(59,130,246,0.17); color: var(--bad); border: 1px solid rgba(59,130,246,0.35); }
.sig.neu{ background: rgba(234,240,255,0.10); color: var(--muted); border: 1px solid var(--line); }

.comment{
  margin-top: 12px;
  border-top: 1px solid var(--line);
  padding-top: 12px;
  color: var(--txt);
  line-height: 1.45;
}
.comment .ttl{
  color: var(--muted2);
  font-size: 0.80rem;
  margin-bottom: 6px;
}
.comment .tx{
  white-space: pre-wrap;
  font-size: 0.92rem;
}

.smallnote{
  color: var(--muted2);
  font-size: 0.82rem;
  line-height:1.35;
}
hr{
  border: none;
  border-top: 1px solid rgba(255,255,255,0.07);
  margin: 18px 0;
}
a{ color: #c7d2fe; }
.stDownloadButton button, .stButton button{
  border-radius: 14px !important;
  border: 1px solid rgba(255,255,255,0.14) !important;
  background: rgba(255,255,255,0.06) !important;
  color: var(--txt) !important;
}
.stDownloadButton button:hover, .stButton button:hover{
  background: rgba(255,255,255,0.10) !important;
}

/* details(전체지표 보기) */
details.details{
  margin-top: 10px;
  border: 1px solid rgba(255,255,255,0.10);
  border-radius: 14px;
  background: rgba(255,255,255,0.02);
  overflow: hidden;
}
details.details > summary{
  cursor: pointer;
  padding: 10px 12px;
  color: rgba(234,240,255,0.85);
  font-size: 0.86rem;
  list-style: none;
}
details.details > summary::-webkit-details-marker{ display:none; }
details.details[open] > summary{
  border-bottom: 1px solid rgba(255,255,255,0.10);
}
.details-wrap{
  padding: 10px 12px 12px 12px;
}
.details-table{
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.details-table td{
  border: 1px solid rgba(255,255,255,0.08);
  padding: 8px 10px;
  color: rgba(234,240,255,0.90);
}
.details-table td.k{
  width: 22%;
  color: rgba(234,240,255,0.65);
  background: rgba(255,255,255,0.02);
  white-space: nowrap;
}
.details-table td.v{
  width: 28%;
  font-weight: 700;
}
</style>
`;

  function buildMrankHtml(title, top10, top30, allRows){
    const css = MRAK_CSS.replace('<style>','').replace('</style>','');

    function safe(v){ return esc(v===null||v===undefined ? '' : String(v)); }
    function num(v){
      const s = String(v===null||v===undefined? '' : v).replace(/,/g,'').trim();
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    }
    function fmt0(v){
      const n = num(v);
      if(n===null) return safe(v);
      return n.toLocaleString('en-US', {maximumFractionDigits: 0});
    }
    function fmt2(v){
      const n = num(v);
      if(n===null) return safe(v);
      return n.toLocaleString('en-US', {maximumFractionDigits: 2});
    }
    function pickKeys(row){
      const keys = ['TV5/20','V5/20','RVOL_20','RVOL_50','BBWP_252','ADX14','PDI14','MDI14','ER20','MFI14','CHOP14','SQUEEZE_ON','DC20_STATE','DC55_STATE','STAGE','52wProx','VolShock','TVx'];
      return keys.filter(k=>row[k]!==undefined);
    }

    function renderCard(row, idx){
      const rkRaw = row['순위'] ?? row['RANK'] ?? idx;
      let rk = parseInt(String(rkRaw).replace(/[^0-9]/g,''),10);
      if(!Number.isFinite(rk) || rk<1) rk = idx;
      // Robust name/code extraction (handles different headers + encoding quirks)
      const disp = (row['표시']||row['DISPLAY']||row['Display']||'') + '';
      let name = (row['종목명']||row['기업명']||row['Name']||row['name']||row['종목']||row['종목이름']||'') + '';
      let code = (row['종목코드']||row['티커']||row['Ticker']||row['ticker']||row['코드']||row['Code']||row['symbol']||row['Symbol']||'') + '';

      // If display like "삼성전자(005930)" exists, parse it
      if(disp && disp.includes('(') && disp.includes(')')){
        const m = disp.match(/^(.*?)\(([^)]+)\)/);
        if(m){
          if(!name) name = (m[1]||'').trim();
          if(!code) code = (m[2]||'').trim();
        }
      }

      // Final fallback: show whatever is available
      const titleLine = disp && disp.trim()
        ? disp.trim()
        : (name && code ? `${name}(${code})` : (name ? name : (code ? code : '(미상)')));

      const chipKeys = ['SQUEEZE_ON','DC20_STATE','DC55_STATE','STAGE','Breakout','UD','DC_STATE'];
      const chips = chipKeys.filter(k=>row[k]!==undefined && String(row[k]).trim()!=='').map(k=>{
        return `<span class="chip">${safe(k)} ${safe(row[k])}</span>`;
      }).join('');

      const kvs = pickKeys(row).slice(0,10).map(k=>{
        const v = row[k];
        const vv = (String(v).match(/%/) ? safe(v) : (k.includes('TV')||k.includes('RVOL')||k.includes('ADX')||k.includes('DI')||k.includes('BBWP')||k.includes('ER')||k.includes('MFI')||k.includes('CHOP') ? fmt2(v) : safe(v)));
        return `<div class="kv-item"><div class="k">${safe(k)}</div><div class="v">${vv}</div></div>`;
      }).join('');

      const detailRows = Object.keys(row).map(k=>`<tr><td>${safe(k)}</td><td>${safe(row[k])}</td></tr>`).join('');
      const detailTbl = `<table><thead><tr><th>지표</th><th>값</th></tr></thead><tbody>${detailRows}</tbody></table>`;

      return `
        <div class="card">
          <div class="card-head">
            <div>
              <div class="name">${safe(titleLine)}</div>
              <div class="code">순위 ${rk} · 종가 ${fmt0(row['종가'])} · 거래대금 ${fmt0(row['거래대금'])}</div>
            </div>
            <div class="rank-pill">SQUEEZE ${safe(row['SQUEEZE_ON']||'OFF')}</div>
          </div>
          <div class="card-body">
            <div class="chips">${chips}</div>
            <div class="kv kv-compact">${kvs}</div>
            <details class="details">
              <summary>전체지표 보기(전 컬럼)</summary>
              <div class="details-wrap">${detailTbl}</div>
            </details>
          </div>
        </div>
      `;
    }

    function table(rows){
      if(!rows || !rows.length) return '<div class="small">데이터 없음</div>';
      const cols = Object.keys(rows[0]);
      const head = cols.map(c=>`<th>${safe(c)}</th>`).join('');
      const body = rows.map(r=>{
        const tds = cols.map(c=>`<td>${safe(r[c])}</td>`).join('');
        return `<tr>${tds}</tr>`;
      }).join('');
      return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
    }

    const t10 = top10||[];
    const t30 = top30||[];
    const all = allRows||[];

    const cards10 = t10.map((r,i)=>renderCard(r,i+1)).join('');
    const cards30 = t30.map((r,i)=>renderCard(r,i+1)).join('');

    const doc = `<!doctype html><html lang="ko"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${safe(title)}</title>
<style>${css}
table{ width:100%; border-collapse:collapse; margin-top:14px; }
th, td{ border:1px solid rgba(255,255,255,0.10); padding:8px 10px; font-size:12px; color:rgba(234,240,255,0.88); }
th{ background: rgba(255,255,255,0.06); color:rgba(234,240,255,0.92); position:sticky; top:0; }
tr:nth-child(even) td{ background: rgba(255,255,255,0.02); }
.wrap{ max-width:1240px; margin:0 auto; padding:18px 16px 34px 16px; }
.table-wrap{ overflow:auto; border-radius:14px; border:1px solid rgba(255,255,255,0.08); }
</style></head><body><div class="wrap">
  <div class="jl-title">
    <div>
      <div class="ttl">${safe(title)}</div>
      <div class="sub">업로드 기반 리포트 · HTML 내보내기 화면</div>
    </div>
    <div class="jl-anchors">
      <a class="anchor" href="#top10">TOP10</a>
      <a class="anchor" href="#top30">TOP30</a>
      <a class="anchor" href="#all">전체</a>
    </div>
  </div>

  <h2 id="top10" style="margin:6px 0 10px 0;">TOP10</h2>
  <div class="grid">${cards10}</div>
  ${table(t10)}

  <hr>

  <h2 id="top30" style="margin:6px 0 10px 0;">TOP30</h2>
  <div class="grid">${cards30}</div>
  ${table(t30)}

  <hr>

  <h2 id="all" style="margin:6px 0 10px 0;">전체(순위 포함)</h2>
  ${table(all)}
</div></body></html>`;
    return doc;
  }

  // =========================
  // Suspicious Ranker (TOP15 cards only) — ported from srank.py
  // - 업로드(엑셀/CSV) → 수상해 랭킹 산출 → 화면/HTML은 TOP15 카드만 (테이블 없음)
  // =========================
  function rankSuspiciousRows(rows){
    const num = (v)=>{
      if(v===null||v===undefined) return NaN;
      const s = String(v).replace(/,/g,'').trim();
      if(!s) return NaN;
      const n = Number(s);
      return Number.isFinite(n) ? n : NaN;
    };
    const toBool = (v)=>{
      if(v===true || v===1) return true;
      if(v===false || v===0 || v===null || v===undefined) return false;
      const s = String(v).trim().toLowerCase();
      return ['1','true','t','yes','y','on','ok','pass','o'].includes(s);
    };
    const codeNum = (row)=>{
      // try 종목코드 -> 표시 "(005930)" -> 코드/code
      const cands = [row['종목코드'], row['code'], row['CODE'], row['티커'], row['ticker']];
      for(const c of cands){
        const n = num(c);
        if(Number.isFinite(n)) return n;
      }
      const disp = row['표시'] ?? row['display'] ?? '';
      const m = String(disp).match(/\((\d+)\)/);
      if(m) return Number(m[1]);
      return NaN;
    };

    const scored = rows.map((row, i)=>{
      const tvmult = num(row['TV_D1_MULT']);
      const tvspk  = num(row['TVSPIKE20']);
      const obvd   = num(row['OBV_s10_diff']);
      const tvamt  = num(row['거래대금']);
      const cmf    = num(row['CMF20']);
      const clv    = num(row['CLV']);

      const pwr  = toBool(row['POWERDAY20_ON']);
      const brk  = toBool(row['DONCH20_BRK']);
      const acc  = toBool(row['OBV_ACCEL_ON']);
      const inst = toBool(row['INSTITUTIONAL_POWER']);

      const t1 = Number.isFinite(tvmult) && tvmult >= 7.0;
      const t2 = Number.isFinite(tvspk)  && tvspk  >= 3.0;
      const t3 = Number.isFinite(obvd)   && obvd   > 0;
      const t4 = Number.isFinite(cmf)    && cmf    > 0;
      const t5 = Number.isFinite(clv)    && clv    > 0;

      const elig = (t1?1:0)+(t2?1:0)+(t3?1:0)+(t4?1:0)+(t5?1:0)+(pwr?1:0)+(brk?1:0)+(acc?1:0)+(inst?1:0);

      const row2 = Object.assign({}, row, {ELIG_COUNT: elig});
      return {row: row2, i, elig, tvmult, tvspk, obvd, tvamt, code: codeNum(row2)};
    });

    scored.sort((a,b)=>{
      // elig desc
      if(b.elig!==a.elig) return b.elig - a.elig;
      // TV_D1_MULT desc
      if((b.tvmult||-Infinity)!==(a.tvmult||-Infinity)) return (b.tvmult||-Infinity) - (a.tvmult||-Infinity);
      // TVSPIKE20 desc
      if((b.tvspk||-Infinity)!==(a.tvspk||-Infinity)) return (b.tvspk||-Infinity) - (a.tvspk||-Infinity);
      // OBV diff desc
      if((b.obvd||-Infinity)!==(a.obvd||-Infinity)) return (b.obvd||-Infinity) - (a.obvd||-Infinity);
      // 거래대금 desc
      if((b.tvamt||-Infinity)!==(a.tvamt||-Infinity)) return (b.tvamt||-Infinity) - (a.tvamt||-Infinity);
      // 종목코드 asc (NaN last)
      const ac = Number.isFinite(a.code) ? a.code : Infinity;
      const bc = Number.isFinite(b.code) ? b.code : Infinity;
      if(ac!==bc) return ac - bc;
      return a.i - b.i; // stable
    });

    return scored.map(x=>x.row);
  }

  function buildSrankHtmlTop15(title, top15Rows){
    const css = MRAK_CSS.replace('<style>','').replace('</style>','');
    const safe = (v)=>esc(v===null||v===undefined ? '' : String(v));

    const num = (v)=>{
      const s = String(v===null||v===undefined? '' : v).replace(/,/g,'').trim();
      const n = Number(s);
      return Number.isFinite(n) ? n : NaN;
    };
    const fmt0 = (v)=>{
      const n = num(v);
      if(!Number.isFinite(n)) return safe(v);
      return n.toLocaleString('en-US', {maximumFractionDigits:0});
    };
    const fmt2 = (v)=>{
      const n = num(v);
      if(!Number.isFinite(n)) return safe(v);
      return n.toLocaleString('en-US', {maximumFractionDigits:2});
    };
    const fmt3 = (v)=>{
      const n = num(v);
      if(!Number.isFinite(n)) return safe(v);
      return n.toLocaleString('en-US', {maximumFractionDigits:3});
    };
    const toBool = (v)=>{
      if(v===true || v===1) return true;
      if(v===false || v===0 || v===null || v===undefined) return false;
      const s = String(v).trim().toLowerCase();
      return ['1','true','t','yes','y','on','ok','pass','o'].includes(s);
    };

    const kvLine = (label, valHtml)=>`<div class="kv-item"><div class="k">${safe(label)}</div><div class="v">${valHtml}</div></div>`;
    const sign = (v)=>{
      const n = num(v);
      if(!Number.isFinite(n) || n===0) return '<span class="sig neu">·</span>';
      if(n>0) return '<span class="sig pos">＋</span>';
      return '<span class="sig neg">－</span>';
    };

    const pickTitleLine = (row)=>{
      const disp = row['표시'] ?? row['display_name'] ?? '';
      if(String(disp).trim()) return String(disp).trim();
      const name = row['종목명'] ?? row['기업명'] ?? row['name'] ?? '';
      const code = row['종목코드'] ?? row['ticker'] ?? row['code'] ?? '';
      if(String(name).trim() && String(code).trim()) return `${String(name).trim()}(${String(code).trim()})`;
      return String(name).trim() || String(code).trim() || '(미상)';
    };

    const cards = top15Rows.map((row, idx)=>{
      const rk = idx+1;
      const titleLine = pickTitleLine(row);

      const chips = [];
      if(toBool(row['POWERDAY20_ON'])) chips.push('POWERDAY20');
      if(toBool(row['DONCH20_BRK'])) chips.push('DONCH20_BRK');
      if(toBool(row['OBV_ACCEL_ON'])) chips.push('OBV_ACCEL');
      if(toBool(row['INSTITUTIONAL_POWER'])) chips.push('INST_POWER');
      const chipHtml = chips.length ? `<div class="chips">${chips.map(c=>`<span class="chip">${safe(c)}</span>`).join('')}</div>` : '';

      const elig = row['ELIG_COUNT']!==undefined ? row['ELIG_COUNT'] : '';
      const tvx = row['TV_D1_MULT']!==undefined ? row['TV_D1_MULT'] : '';

      const kvs = [
        kvLine('거래대금', `${sign(row['거래대금'])}<span>${fmt0(row['거래대금'])}</span>`),
        kvLine('전일대비TV×', `${sign(row['TV_D1_MULT'])}<span>${fmt2(row['TV_D1_MULT'])}</span>`),
        kvLine('TVSPIKE20', `${sign(row['TVSPIKE20'])}<span>${fmt2(row['TVSPIKE20'])}</span>`),
        kvLine('OBV Δ(10)', `${sign(row['OBV_s10_diff'])}<span>${fmt0(row['OBV_s10_diff'])}</span>`),
        kvLine('CMF20', `${sign(row['CMF20'])}<span>${fmt3(row['CMF20'])}</span>`),
        kvLine('CLV', `${sign(row['CLV'])}<span>${fmt3(row['CLV'])}</span>`),
      ].join('');

      return `
<div class="card">
  <div class="card-head">
    <div>
      <div class="name">${safe(titleLine)}</div>
      <div class="code">순위 ${rk} · 종가 ${fmt0(row['종가'])} · D1 ${fmt2(row['등락률(D1%)'])}% · 거래대금 ${fmt0(row['거래대금'])}</div>
    </div>
    <div class="rank-pill">TV× ${fmt2(tvx)} · SCORE ${safe(elig)}</div>
  </div>
  <div class="card-body">
    ${chipHtml}
    <div class="kv kv-compact">${kvs}</div>
  </div>
</div>`;
    }).join('');

    return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safe(title)}</title>
<style>${css}
.wrap{ max-width:1240px; margin:0 auto; padding:18px 16px 34px 16px; }
</style>
</head>
<body>
<div class="wrap">
  <div class="jl-title">
    <div>
      <h1>${safe(title)}</h1>
      <div class="jl-sub">TOP15만 · 카드뉴스 · 테이블 없음</div>
    </div>
    <div class="badge">srank_TOP15</div>
  </div>
  <hr>
  <div class="grid">${cards}</div>
</div>
</body>
</html>`;
  }


  async function parseFileToRows(file){
    const name = file?.name || '';
    const ext = name.split('.').pop().toLowerCase();

    // CSV: auto-detect UTF-8 vs CP949(EUC-KR) to avoid mojibake (��)
    if(ext === 'csv'){
      const buf = await file.arrayBuffer();

      // try decodings; choose the one with fewer replacement chars
      const tryDecode = (enc)=>{
        try{
          const dec = new TextDecoder(enc, {fatal:false});
          return dec.decode(buf);
        }catch(e){
          return null;
        }
      };

      const candidates = [
        {enc:'utf-8'},
        {enc:'euc-kr'},
        {enc:'windows-949'},
        {enc:'x-windows-949'}
      ];

      let best = {text:null, bad: Number.POSITIVE_INFINITY, enc:'utf-8'};
      for(const c of candidates){
        const t = tryDecode(c.enc);
        if(t === null) continue;
        const text = (t.charCodeAt(0)===0xFEFF) ? t.slice(1) : t; // strip BOM
        const bad = (text.match(/�/g) || []).length;
        if(bad < best.bad){
          best = {text, bad, enc:c.enc};
          if(bad === 0) break;
        }
      }

      const text = best.text ?? '';
      return csvToRows(text);
    }

    // XLSX
    if(typeof XLSX === 'undefined'){
      throw new Error('XLSX_MISSING');
    }
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, {type:'array'});
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    return XLSX.utils.sheet_to_json(ws, {defval:''});
  }

  function bindBigdataUpload(getState){
    const btn = byId('bd-btn-upload');
    const file = byId('bd-file');
    const titleInput = byId('bd-title');
    if(!btn || !file) return;

    btn.addEventListener('click', ()=> file.click());
    file.addEventListener('change', async ()=>{
      const f = file.files && file.files[0];
      if(!f) return;
      btn.disabled = true;
      btn.textContent = '업로드 중...';

      try{
        const rows = await parseFileToRows(f);
        const date_key = guessDateKey(f.name);
        const st = getState ? getState() : {category:'accum', region:'KR'};
        const titleMap = {accum:'매집종목', strong:'강한종목', suspicious:'수상해수상해'};
        const manualTitle = (titleInput && titleInput.value ? titleInput.value : '').trim();
        const title = manualTitle || `${titleMap[st.category]||'빅데이터'} ${date_key}`;

        const top10 = rows.slice(0,10);
        const top30 = rows.slice(0,30);
        const html = buildMrankHtml(title, top10, top30, rows);

        const res = await postJSON('/api/posts/create', {
          category: st.category,
          region: st.region,
          title,
          date_key,
          html
        });

        if(res && res.ok){
          window.location.href = `/post/?id=${encodeURIComponent(res.id)}`;
        }else{
          alert('업로드 실패: ' + (res.error||''));
        }
      }catch(e){
        alert('업로드 실패: ' + String(e && e.message ? e.message : e));
      }finally{
        btn.disabled = false;
        btn.textContent = '업로드';
        file.value = '';
      }
    });
  }

  function bindPerfUpload(){
    const btn = byId('perf-btn-upload');
    const file = byId('perf-file');
    const titleInput = byId('perf-title');
    if(!btn || !file) return;

    btn.addEventListener('click', ()=> file.click());
    file.addEventListener('change', async ()=>{
      const f = file.files && file.files[0];
      if(!f) return;
      btn.disabled = true;
      btn.textContent = '업로드 중...';

      try{
        const rows = await parseFileToRows(f);
        const date_key = guessDateKey(f.name);
        const manualTitle = (titleInput && titleInput.value ? titleInput.value : '').trim();
        const title = manualTitle || `성과표 ${date_key}`;
        const top10 = rows.slice(0,10);
        const top30 = rows.slice(0,30);
        const html = buildMrankHtml(title, top10, top30, rows);

        const res = await postJSON('/api/posts/create', {
          category: 'perf',
          region: 'KR',
          title,
          date_key,
          html
        });

        if(res && res.ok){
          window.location.href = `/post/?id=${encodeURIComponent(res.id)}`;
        }else{
          alert('업로드 실패: ' + (res.error||''));
        }
      }catch(e){
        alert('업로드 실패: ' + String(e && e.message ? e.message : e));
      }finally{
        btn.disabled = false;
        btn.textContent = '성과표 업로드';
        file.value = '';
      }
    });
  }


  function bindSubscribeForm(){
    const btn = byId('sub-btn-save');
    if(!btn) return;

    const msg = byId('sub-msg');
    function setMsg(t, ok){
      if(!msg) return;
      msg.textContent = t || '';
      msg.style.color = ok ? '#16a34a' : '#ef4444';
    }

    btn.addEventListener('click', async ()=>{
      const name = (byId('sub-name')?.value||'').trim();
      const phone = (byId('sub-phone')?.value||'').trim();
      const email = (byId('sub-email')?.value||'').trim();
      const ok1 = !!byId('sub-ck-terms')?.checked;
      const ok2 = !!byId('sub-ck-privacy')?.checked;
      const ok3 = !!byId('sub-ck-refund')?.checked;

      if(!name || !phone || !email){
        setMsg('이름/휴대폰/이메일을 입력하십시오.', false);
        return;
      }
      if(!(ok1 && ok2 && ok3)){
        setMsg('약관/개인정보/환불 규정 체크가 필요합니다.', false);
        return;
      }

      // save locally
      try{
        localStorage.setItem('jlab_sub_info', JSON.stringify({name, phone, email, at: new Date().toISOString()}));
      }catch(e){}

      // store request (server)
      try{
        const res = await postJSON('/api/signup/request', {email, name, phone, memo:'SUBSCRIBE'});
        if(res && res.ok){
          setMsg('입력 완료했습니다.', true);
        }else{
          setMsg('입력 완료(저장 확인 필요)', true);
        }
      }catch(e){
        setMsg('입력 완료(로컬 저장)', true);
      }
    });

    // gate pay links
    qsa('a[href^="/pay/"]').forEach(a=>{
      a.addEventListener('click', (e)=>{
        let ok=false;
        try{
          const v = JSON.parse(localStorage.getItem('jlab_sub_info')||'null');
          ok = !!(v && v.email && v.name && v.phone);
        }catch(err){ ok=false; }
        if(!ok){
          e.preventDefault();
          alert('구독 정보 입력(이름/휴대폰/이메일/동의)을 먼저 완료하십시오.');
          byId('sub-name')?.scrollIntoView({behavior:'smooth', block:'center'});
        }
      });
    });
  }

  async function bindSignupRequest(){
    const btn = byId('btn-request-signup');
    if(!btn) return;
    btn.addEventListener('click', async ()=>{
      const email = (byId('rq-email')?.value||'').trim();
      const name = (byId('rq-name')?.value||'').trim();
      const phone = (byId('rq-phone')?.value||'').trim();
      const memo = (byId('rq-memo')?.value||'').trim();
      const msg = byId('rq-msg');
      if(msg) msg.textContent = '';
      try{
        const res = await postJSON('/api/signup/request', {email, name, phone, memo});
        if(res && res.ok){
          if(msg) { msg.textContent = '접수 완료했습니다.'; msg.style.color = '#16a34a'; }
        }else{
          if(msg) { msg.textContent = '접수 실패: ' + (res.error||''); msg.style.color = '#ef4444'; }
        }
      }catch(e){
        if(msg) { msg.textContent = '접수 실패'; msg.style.color = '#ef4444'; }
      }
    });
  }



  async function hydrateMemeBoard(){
    const list = byId('meme-list');
    if(!list) return;

    let isAdmin = false;

    const badgeUpd = byId('meme-badge-upd');
    const badgeCount = byId('meme-badge-count');

    async function load(){
      try{
        const j = await fetchJSON('/api/posts/list?category=meme&region=KR&limit=30');
        const items = (j.items||[]);
        if(badgeUpd) badgeUpd.textContent = `UPD: ${items[0] && items[0].created_at ? fmtTime(items[0].created_at) : '-'}`;
        if(badgeCount) badgeCount.textContent = `LIVE: ${items.length}`;
        list.innerHTML = items.length ? items.map(m=>renderMetaItem(m,{showActions:isAdmin,canDelete:isAdmin})).join('') : `<div class="item"><div><div class="title">등록된 짤이 없습니다.</div><div class="meta">관리자 업로드 후 표시됩니다.</div></div></div>`;
      }catch(e){
        list.innerHTML = `<div class="item"><div><div class="title">목록을 불러오지 못했습니다.</div><div class="meta">KV 설정 확인</div></div></div>`;
      }
    }

    // admin upload UI
    try{
      const me = await fetchJSON('/api/auth/me');
      isAdmin = detectIsAdmin(me);
      const box = byId('meme-admin-actions');
      if(box) box.style.display = isAdmin ? '' : 'none';
      if(isAdmin){
        bindMemeUpload(load);
        bindDeleteDelegation(list, load);
      }
    }catch(e){}

    await load();
  }

  function bindMemeUpload(onDone){
    const btn = byId('meme-btn-upload');
    const file = byId('meme-file');
    const titleInput = byId('meme-title');
    if(!btn || !file) return;

    btn.addEventListener('click', ()=> file.click());

    file.addEventListener('change', async ()=>{
      const f = file.files && file.files[0];
      if(!f) return;

      btn.disabled = true;
      btn.textContent = '업로드 중...';

      try{
        const todayKey = guessDateKey(new Date().toISOString().slice(0,10));
        const t = (titleInput && titleInput.value ? titleInput.value : '').trim() || (f.name || '웃긴짤').replace(/\.[^/.]+$/, '');
        const isVideo = (f.type || '').startsWith('video/');

        let full = '';
        let thumb = '';

        if(isVideo){
          // KV 저장 한계 고려: 너무 큰 파일은 차단
          const maxBytes = 7 * 1024 * 1024; // 7MB
          if(f.size > maxBytes){
            throw new Error('동영상 파일이 너무 큽니다. (7MB 이하로 올리십시오.)');
          }
          full = await readFileAsDataUrl(f);
          thumb = makeVideoThumb(t);
        }else{
          full = await imageToDataUrlResized(f, 1200, 0.86);
          thumb = await imageToDataUrlResized(f, 320, 0.82);
        }

        const html = buildMemeHtml(t, full, isVideo ? (f.type || 'video/mp4') : 'image');

        const payload = {
          category: 'meme',
          region: 'KR',
          title: `웃긴짤 ${todayKey} · ${t}`,
          date_key: todayKey,
          html,
          thumb
        };

        const res = await postJSON('/api/posts/create', payload);
        if(res && res.ok){
          if(typeof onDone === 'function') await onDone();
          window.location.href = `/post/?id=${encodeURIComponent(res.id)}`;
        }else{
          alert('업로드 실패: ' + (res.error||''));
        }
      }catch(e){
        alert('업로드 실패: ' + String(e && e.message ? e.message : e));
      }finally{
        btn.disabled = false;
        btn.textContent = '짤 업로드';
        file.value = '';
      }
    });
  }

  
  function makeVideoThumb(title){
    const safe = esc(title || 'VIDEO');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#3b82f6"/>
          <stop offset="1" stop-color="#ff3b30"/>
        </linearGradient>
      </defs>
      <rect width="320" height="180" rx="18" fill="url(#g)"/>
      <circle cx="160" cy="88" r="34" fill="rgba(0,0,0,0.25)"/>
      <polygon points="152,70 152,106 182,88" fill="#ffffff"/>
      <text x="160" y="160" font-family="Pretendard,system-ui" font-size="14" font-weight="800" text-anchor="middle" fill="rgba(255,255,255,0.92)">${safe}</text>
    </svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

function buildMemeHtml(title, mediaDataUrl, mediaType){
    const safeTitle = esc(title||'');
    const now = new Date();
    const stamp = now.toISOString().replace('T',' ').slice(0,19);
    return `
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeTitle}</title>
<style>
  body{ margin:0; font-family:Pretendard,system-ui,-apple-system,Segoe UI,Roboto,'Noto Sans KR',sans-serif; background:#0b1220; color:#e5e7eb; }
  .wrap{ max-width:980px; margin:0 auto; padding:18px; }
  .card{ background:rgba(2,6,23,.92); border:1px solid rgba(148,163,184,.25); border-radius:16px; padding:16px; }
  h1{ font-size:18px; margin:0 0 10px 0; }
  img{ width:100%; height:auto; border-radius:14px; border:1px solid rgba(148,163,184,.18); }
  .meta{ margin-top:10px; font-size:12px; color:rgba(226,232,240,.75); display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>${safeTitle}</h1>
${(String(mediaType||"")||"").startsWith("video/") ? `      <video controls playsinline style="width:100%; height:auto; border-radius:14px; border:1px solid rgba(148,163,184,.18);" src="${esc(mediaDataUrl)}"></video>` : `      <img src="${esc(mediaDataUrl)}" alt="meme">`}
      <div class="meta">
        <span>업로드: ${esc(stamp)}</span>
        <span>주랩 웃긴짤</span>
      </div>
    </div>
  </div>
</body>
</html>
`;
  }

  async function imageToDataUrlResized(file, maxW, quality){
    const dataUrl = await readFileAsDataUrl(file);
    const img = await loadImage(dataUrl);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const scale = Math.min(1, maxW / Math.max(1, w));
    const nw = Math.max(1, Math.round(w * scale));
    const nh = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement('canvas');
    canvas.width = nw;
    canvas.height = nh;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, nw, nh);

    // Prefer jpeg to reduce size
    const mime = 'image/jpeg';
    return canvas.toDataURL(mime, quality || 0.85);
  }

  function readFileAsDataUrl(file){
    return new Promise((resolve, reject)=>{
      const r = new FileReader();
      r.onload = ()=> resolve(String(r.result||''));
      r.onerror = ()=> reject(new Error('FILE_READ_FAIL'));
      r.readAsDataURL(file);
    });
  }

  function loadImage(src){
    return new Promise((resolve, reject)=>{
      const img = new Image();
      img.onload = ()=> resolve(img);
      img.onerror = ()=> reject(new Error('IMG_LOAD_FAIL'));
      img.src = src;
    });
  }

document.addEventListener('DOMContentLoaded', ()=>{
    renderTopNav();
    // auth-based enhancements (email badge / admin menu)
    enhanceTopNavWithAuth();
    setActiveNav();
    initTickerSearch();
    hydrateMarketStrip();
    hydrateNewsPreview();
    hydrateNewsCenter();
    hydrateAnalysis();
    hydrateNotice();
    hydratePopup();
    hydrateHomeDashboard();
    hydrateBigdataCenter();
    hydratePerformance();
    hydrateCategoryPage();
    hydrateSampleRoom();
    hydrateMemeBoard();
    hydratePost();
    bindSignupRequest();
    bindSubscribeForm();

    // soft refresh
    setInterval(()=>{ hydrateMarketStrip(); }, 60*1000);
  });
})();