(function(){
  'use strict';

  // NewsCenter v2: page-local enhancements only.
  // - Theme 3x3
  // - Stock/keyword search
  // - Clean list rendering with event badges
  // - Robust RSS proxy parsing (JSON or XML)
  // - Scoped CSS injection (news page only)

  const byId = (id)=>document.getElementById(id);

  function esc(v){
    const s = (v === null || v === undefined) ? '' : String(v);
    return s.replace(/[&<>"'`]/g, (ch)=>({
      '&':'&amp;',
      '<':'&lt;',
      '>':'&gt;',
      '"':'&quot;',
      "'":'&#39;',
      '`':'&#96;'
    }[ch]));
  }

  // Decode HTML entities like &amp;quot; -> ", etc.
  function decodeEntities(s){
    if(!s) return '';
    const txt = document.createElement('textarea');
    // Handle double-escaped entities commonly seen in feeds
    txt.innerHTML = s.replaceAll('&amp;','&');
    return txt.value;
  }

  function injectScopedCss(){
    if(document.getElementById('newscenter-v2-style')) return;
    const style = document.createElement('style');
    style.id = 'newscenter-v2-style';
    style.textContent = `
      /* Fix dark-on-dark text in controls (news page only) */
      body[data-nc="v2"] .controls .input span{color:rgba(226,232,240,.92)!important;}
      body[data-nc="v2"] .controls .input input{color:rgba(226,232,240,1)!important; caret-color:rgba(226,232,240,1)!important;}
      body[data-nc="v2"] .controls .input input::placeholder{color:rgba(148,163,184,.9)!important;}

      body[data-nc="v2"] .tabs{gap:8px; flex-wrap:wrap;}
      body[data-nc="v2"] .tabs .tab{padding:10px 12px; border-radius:12px; font-weight:900;}
      body[data-nc="v2"] .nc-layout{display:grid; grid-template-columns: 2fr 1fr; gap:14px;}
      @media (max-width: 960px){ body[data-nc="v2"] .nc-layout{grid-template-columns: 1fr;} }
      body[data-nc="v2"] .nc-panel{border:1px solid rgba(148,163,184,.35); background:rgba(255,255,255,.75); border-radius:16px; padding:14px;}
      body[data-nc="v2"] .nc-panel .panel-top{display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:10px;}
      body[data-nc="v2"] .nc-panel .panel-top h2{margin:0; font-size:16px; letter-spacing:-.2px;}
      body[data-nc="v2"] .nc-muted{font-size:12px; font-weight:800; color:rgba(100,116,139,.95);}
      body[data-nc="v2"] .nc-list{display:flex; flex-direction:column; gap:10px;}
      body[data-nc="v2"] .nc-item{display:flex; gap:12px; justify-content:space-between; align-items:flex-start; padding:12px; border:1px solid rgba(148,163,184,.25); border-radius:14px; background:rgba(255,255,255,.92);}
      body[data-nc="v2"] .nc-item:hover{background:rgba(255,255,255,1);}
      body[data-nc="v2"] .nc-title{font-weight:1000; letter-spacing:-.3px; line-height:1.35; margin:0;}
      body[data-nc="v2"] .nc-title a{color:rgba(15,23,42,1); text-decoration:none;}
      body[data-nc="v2"] .nc-title a:hover{text-decoration:underline;}
      body[data-nc="v2"] .nc-meta{margin-top:6px; display:flex; flex-wrap:wrap; gap:6px; align-items:center;}
      body[data-nc="v2"] .nc-chip{display:inline-flex; align-items:center; gap:6px; padding:4px 8px; border-radius:999px; font-size:12px; font-weight:1000; border:1px solid rgba(148,163,184,.28); background:rgba(248,250,252,.9); color:rgba(30,41,59,1);}
      body[data-nc="v2"] .nc-chip.theme{border-color:rgba(34,197,94,.35); background:rgba(34,197,94,.08);}
      body[data-nc="v2"] .nc-chip.event{border-color:rgba(59,130,246,.35); background:rgba(59,130,246,.08);}
      body[data-nc="v2"] .nc-chip.src{border-color:rgba(148,163,184,.35); background:rgba(148,163,184,.08);}
      body[data-nc="v2"] .nc-right{min-width:64px; font-weight:1000; color:rgba(59,130,246,1);}
      body[data-nc="v2"] .nc-grid{display:grid; grid-template-columns:repeat(12, 1fr); gap:12px;}
      body[data-nc="v2"] .nc-theme-card{grid-column: span 4; text-decoration:none;}
      body[data-nc="v2"] .nc-theme-card .card{height:100%;}
      @media (max-width: 960px){ body[data-nc="v2"] .nc-theme-card{grid-column: span 6;} }
      @media (max-width: 760px){ body[data-nc="v2"] .nc-theme-card{grid-column: span 12;} }
      body[data-nc="v2"] .nc-theme-hd{font-weight:1000; letter-spacing:-.3px; line-height:1.25; margin-top:10px;}
      body[data-nc="v2"] .nc-theme-bottom{margin-top:10px; display:flex; flex-wrap:wrap; gap:6px;}
    `;
    document.head.appendChild(style);
    document.body.setAttribute('data-nc','v2');
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

  function fmtTime(t){
    if(!t) return '-';
    const s = String(t);
    return s.length>24 ? s.slice(0,19).replace('T',' ') : s;
  }

  function parsePubDateToTs(pubDate){
    if(!pubDate) return 0;
    const d = new Date(pubDate);
    const ts = d.getTime();
    return Number.isFinite(ts) ? ts : 0;
  }

  function infomaxFeeds(){
    return [
      { key:'popular', name:'인기', url:'https://news.einfomax.co.kr/rss/clickTop.xml' },
      { key:'S1N2', name:'증권', url:'https://news.einfomax.co.kr/rss/S1N2.xml' },
      { key:'S1N7', name:'IB/기업', url:'https://news.einfomax.co.kr/rss/S1N7.xml' },
      { key:'S1N15', name:'정책/금융', url:'https://news.einfomax.co.kr/rss/S1N15.xml' },
      { key:'S1N16', name:'채권/외환', url:'https://news.einfomax.co.kr/rss/S1N16.xml' },
      { key:'S1N17', name:'부동산', url:'https://news.einfomax.co.kr/rss/S1N17.xml' },
      { key:'S1N21', name:'해외주식', url:'https://news.einfomax.co.kr/rss/S1N21.xml' },
      { key:'S1N23', name:'국제뉴스', url:'https://news.einfomax.co.kr/rss/S1N23.xml' },
      { key:'all', name:'전체', url:'https://news.einfomax.co.kr/rss/allArticle.xml' },
    ];
  }

  function parseRssXmlToItems(xmlText, feed){
    try{
      const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
      const items = Array.from(doc.querySelectorAll('item')).map(it=>{
        const title = (it.querySelector('title')?.textContent||'').trim();
        const link = (it.querySelector('link')?.textContent||'').trim();
        const pubDate = (it.querySelector('pubDate')?.textContent||'').trim();
        return {
          title: decodeEntities(title),
          link,
          pubDate,
          feedKey: feed?.key||'',
          feedName: feed?.name||'',
          press: '연합인포맥스',
          ts: parsePubDateToTs(pubDate)
        };
      }).filter(x=>x.title && x.link);
      return items;
    }catch(e){
      return [];
    }
  }

  async function fetchFeedItems(feed){
    const u = '/api/rss?u=' + encodeURIComponent(feed.url) + '&limit=60';
    const r = await fetch(u, {cache:'no-store'});
    if(!r.ok) throw new Error('RSS fetch failed: ' + r.status);
    const ct = (r.headers.get('content-type')||'').toLowerCase();

    // Preferred: JSON
    if(ct.includes('application/json')){
      const j = await r.json();
      const items = Array.isArray(j?.items) ? j.items : [];
      return items.map(it=>{
        const title = decodeEntities(it.title || '');
        const link = it.link || it.url || '';
        const pubDate = it.pubDate || it.pubdate || it.published || it.time || '';
        return {
          title,
          link,
          pubDate,
          feedKey: feed.key,
          feedName: feed.name,
          press: it.press || it.source || '연합인포맥스',
          ts: parsePubDateToTs(pubDate)
        };
      }).filter(x=>x.title && x.link);
    }

    // Fallback: XML
    const text = await r.text();
    // If JSON leaked as text
    if(text && text.trim().startsWith('{')){
      try{
        const j = JSON.parse(text);
        const items = Array.isArray(j?.items) ? j.items : [];
        return items.map(it=>{
          const title = decodeEntities(it.title || '');
          const link = it.link || it.url || '';
          const pubDate = it.pubDate || it.pubdate || it.published || it.time || '';
          return {
            title,
            link,
            pubDate,
            feedKey: feed.key,
            feedName: feed.name,
            press: it.press || it.source || '연합인포맥스',
            ts: parsePubDateToTs(pubDate)
          };
        }).filter(x=>x.title && x.link);
      }catch(e){}
    }
    return parseRssXmlToItems(text, feed);
  }

  function normTitleForDedupe(title){
    const t = (title||'').toLowerCase();
    return t
      .replace(/\[(.*?)\]/g,' ')
      .replace(/\((.*?)\)/g,' ')
      .replace(/\s+/g,' ')
      .replace(/["'“”‘’]/g,'')
      .trim();
  }

  function dedupeItems(items){
    const seen = new Map();
    for(const it of items){
      const k = normTitleForDedupe(it.title);
      if(!k) continue;
      const prev = seen.get(k);
      if(!prev){
        seen.set(k, it);
        continue;
      }
      // keep newer
      if((it.ts||0) > (prev.ts||0)) seen.set(k, it);
    }
    return Array.from(seen.values());
  }

  const EVENT_RULES = [
    { key:'실적', re:/실적|잠정|가이던스|컨센서스|어닝|매출|영업이익|순이익/i },
    { key:'수주', re:/수주|공급계약|계약\s?체결|납품|협약|MOU/i },
    { key:'증설', re:/증설|투자|캐파|공장|라인|증산|시설/i },
    { key:'유증/CB', re:/유상증자|무상증자|감자|CB|BW|전환사채|신주인수권/i },
    { key:'M&A', re:/인수|합병|M\&A|지분|경영권/i },
    { key:'규제/소송', re:/제재|규제|소송|조사|압수수색|리콜|과징금/i },
    { key:'리포트', re:/목표가|투자의견|리포트|증권사|상향|하향/i },
  ];

  function pickEvent(title){
    const t = title||'';
    for(const r of EVENT_RULES){
      if(r.re.test(t)) return r.key;
    }
    return '';
  }

  const THEMES = [
    { key:'semi', name:'반도체', keywords:[
      '반도체','HBM','DRAM','낸드','NAND','파운드리','AI 반도체','칩','웨이퍼','TSMC','ASML',
      '삼성전자','SK하이닉스','하이닉스','한미반도체','DB하이텍'
    ]},
    { key:'battery', name:'2차전지', keywords:[
      '2차전지','배터리','리튬','양극재','음극재','전해질','LFP','NCM','ESS','전기차',
      'LG에너지솔루션','삼성SDI','SK온','에코프로','포스코퓨처엠'
    ]},
    { key:'defense', name:'방산', keywords:[
      '방산','K-방산','수출','미사일','레이다','레이더','전차','자주포','함정','탄약',
      '한화','LIG넥스원','현대로템','한국항공우주','KAI'
    ]},
    { key:'ship', name:'조선', keywords:[
      '조선','LNG선','수주','수주잔고','선박','해양플랜트','친환경선','암모니아','조선소',
      'HD현대중공업','삼성중공업','한화오션','HD현대미포'
    ]},
    { key:'bio', name:'바이오', keywords:[
      '바이오','제약','임상','FDA','허가','신약','기술수출','라이선스','항체','mRNA',
      '셀트리온','삼성바이오','한미약품','유한양행'
    ]},
    { key:'airobot', name:'AI·로봇', keywords:[
      'AI','인공지능','데이터센터','GPU','클라우드','로봇','휴머노이드','자동화','비전','센서',
      '네이버','카카오','삼성SDS','두산로보틱스'
    ]},
    { key:'nuke', name:'원전·전력', keywords:[
      '원전','SMR','전력','송전','변전','전선','수소','가스터빈','전기요금',
      '두산에너빌리티','한국전력','한전','LS','일진전기'
    ]},
    { key:'game', name:'게임·콘텐츠', keywords:[
      '게임','콘텐츠','IP','신작','출시','모바일게임','PC게임','엔터','드라마','OTT',
      '넥슨','넷마블','엔씨소프트','크래프톤','하이브','SM'
    ]},
    { key:'macro', name:'금리·환율', keywords:[
      '금리','환율','달러','원화','FOMC','연준','Fed','인플레이션','물가','국채','채권','DXY','달러인덱스'
    ]},
  ];

  function tagThemes(title){
    const t = (title||'').toLowerCase();
    const hits = [];
    for(const th of THEMES){
      for(const k of th.keywords){
        if(!k) continue;
        if(t.includes(String(k).toLowerCase())){ hits.push(th.name); break; }
      }
    }
    return hits;
  }

  function renderItem(it){
    const event = pickEvent(it.title);
    const themes = tagThemes(it.title);
    const chips = [];
    if(themes[0]) chips.push(`<span class="nc-chip theme">${esc(themes[0])}</span>`);
    if(event) chips.push(`<span class="nc-chip event">${esc(event)}</span>`);
    chips.push(`<span class="nc-chip src">${esc(it.feedName||'RSS')}</span>`);
    const metaTime = it.pubDate ? fmtTime(it.pubDate) : '-';
    return `
      <div class="nc-item">
        <div style="min-width:0;">
          <p class="nc-title"><a href="${esc(it.link)}" target="_blank" rel="noopener">${esc(it.title)}</a></p>
          <div class="nc-meta">
            ${chips.join('')}
            <span class="nc-muted">${esc(it.press||'')} · ${esc(metaTime)}</span>
          </div>
        </div>
        <div class="nc-right">원문</div>
      </div>
    `;
  }

  function renderLatestPane(el, items, q, armed){
    if(!armed){
      el.innerHTML = `
        <div class="card">
          <div class="card-top"><h3>종목뉴스 검색</h3><span class="badge wait">WAIT</span></div>
          <p style="margin:0;">상단 검색창에 종목/키워드를 입력한 뒤 <b>검색</b>을 누르시면 결과가 표시됩니다.</p>
        </div>
      `;
      return;
    }

    const query = (q||'').trim().toLowerCase();
    const filtered = query ? items.filter(it=> (it.title||'').toLowerCase().includes(query)) : items;
    const top = filtered.slice(0, 18);
    const rightThemes = buildThemeSummary(filtered);
    el.innerHTML = `
      <div class="nc-layout">
        <div class="nc-panel">
          <div class="panel-top">
            <h2>최신 종목뉴스</h2>
            <div class="nc-muted">표시: ${top.length} / ${filtered.length}건</div>
          </div>
          <div class="nc-list">${top.map(renderItem).join('')}</div>
        </div>
        <div class="nc-panel">
          <div class="panel-top">
            <h2>오늘의 테마</h2>
            <div class="nc-muted">상위 6개</div>
          </div>
          <div class="nc-list">
            ${rightThemes.map(t=>{
              return `
                <div class="nc-item" style="align-items:center;">
                  <div style="min-width:0;">
                    <div style="font-weight:1000; letter-spacing:-.2px;">${esc(t.name)}</div>
                    <div class="nc-muted">${esc(t.count)}건 · ${esc(t.headline||'-')}</div>
                  </div>
                  <div class="nc-right">보기</div>
                </div>
              `;
            }).join('')}
          </div>
          <div class="hr" style="margin:12px 0;"></div>
          <div class="nc-muted">테마 탭에서 3×3로 정리됩니다.</div>
        </div>
      </div>
    `;
  }

  function buildThemeSummary(items){
    const m = new Map();
    for(const it of items){
      const ts = it.ts||0;
      const th = tagThemes(it.title);
      if(!th.length) continue;
      const name = th[0];
      const cur = m.get(name) || { name, count:0, headline:'', ts:0 };
      cur.count += 1;
      if(ts > cur.ts){ cur.ts = ts; cur.headline = it.title; }
      m.set(name, cur);
    }
    return Array.from(m.values()).sort((a,b)=> (b.count-a.count) || (b.ts-a.ts)).slice(0,6);
  }

  function renderThemePane(el, items){
    // Build 3x3 theme cards
    const perTheme = new Map();
    for(const th of THEMES) perTheme.set(th.name, []);

    for(const it of items){
      const tags = tagThemes(it.title);
      for(const t of tags){
        if(perTheme.has(t)) perTheme.get(t).push(it);
      }
    }
    // Keep top 1 headline per theme
    const cards = THEMES.map(th=>{
      const arr = (perTheme.get(th.name)||[]).sort((a,b)=> (b.ts-a.ts));
      const first = arr[0];
      const count = arr.length;
      return {
        key: th.key,
        name: th.name,
        count,
        headline: first ? first.title : '기사 없음',
        link: first ? first.link : '#'
      };
    });

    el.innerHTML = `
      <div class="section-title">
        <h2>테마 스냅샷 (3×3)</h2>
        <div class="hint">테마별로 최신 기사 1개 + 건수만 표시합니다. 클릭하면 원문으로 이동합니다.</div>
      </div>
      <div class="nc-grid">
        ${cards.map(c=>{
          const badge = c.count ? `<span class="badge ok">${c.count}건</span>` : `<span class="badge missing">0건</span>`;
          return `
            <a class="nc-theme-card" href="${esc(c.link)}" target="_blank" rel="noopener">
              <div class="card">
                <div class="card-top"><h3>${esc(c.name)}</h3>${badge}</div>
                <div class="nc-theme-hd">${esc(c.headline)}</div>
                <div class="nc-theme-bottom">
                  <span class="nc-chip theme">${esc(c.name)}</span>
                  <span class="nc-chip src">RSS</span>
                </div>
              </div>
            </a>
          `;
        }).join('')}
      </div>

      <div class="hr" style="margin-top:16px;"></div>
      <div class="section-title" style="margin-top:12px;">
        <h2>테마별 최신 리스트</h2>
        <div class="hint">전체 기사에서 테마 키워드로 자동 분류합니다.</div>
      </div>
      <div class="nc-panel">
        <div class="nc-list">${items.slice(0,30).map(renderItem).join('')}</div>
      </div>
    `;
  }

  function renderRssPane(el, feeds){
    el.innerHTML = `
      <div class="section-title">
        <h2>RSS 원본 보기</h2>
        <div class="hint">테마/종목 정제 이전의 RSS 섹션 목록입니다.</div>
      </div>
      <div class="grid" style="margin-top:12px;">
        ${feeds.filter(f=>f.key!=='all').slice(0,9).map(f=>{
          return `
            <a class="card link-card" href="${esc(f.url)}" target="_blank" rel="noopener" style="grid-column: span 4;">
              <div class="card-top"><h3>${esc(f.name)}</h3><span class="badge live">RSS</span></div>
              <div class="nc-muted" style="margin-top:10px;">${esc(f.url)}</div>
            </a>
          `;
        }).join('')}
      </div>
      <div class="small" style="margin-top:12px;">RSS URL은 원문이 아니라 RSS 문서입니다.</div>
    `;
  }

  function setTabs(){
    const tabs = byId('nc-tabs');
    if(!tabs) return;
    tabs.innerHTML = [
      '<button class="tab active" type="button" data-tab="latest">최신</button>',
      '<button class="tab" type="button" data-tab="theme">테마</button>',
      '<button class="tab" type="button" data-tab="rss">RSS</button>'
    ].join('');
  }

  function showPane(key){
    const panes = {
      latest: byId('nc-pane-latest'),
      theme: byId('nc-pane-theme'),
      rss: byId('nc-pane-rss')
    };
    // Site-wide CSS defines `.pane{display:none}` and `.pane.active{display:block}`.
    // Use the `active` class so panes actually render under app.css.
    Object.entries(panes).forEach(([k,el])=>{
      if(!el) return;
      el.classList.toggle('active', k===key);
      // Also set inline display as a hard override in case other styles exist.
      el.style.display = (k===key ? 'block' : 'none');
    });
    const tabs = byId('nc-tabs');
    if(tabs){
      Array.from(tabs.querySelectorAll('.tab')).forEach(b=>b.classList.toggle('active', b.dataset.tab===key));
    }
  }

  async function boot(){
    const tabs = byId('nc-tabs');
    const qInput = byId('nc-q');
    const btnRefresh = byId('nc-refresh');
    const btnSearch = byId("nc-search");
    const paneLatest = byId('nc-pane-latest');
    const paneTheme = byId('nc-pane-theme');
    const paneRss = byId('nc-pane-rss');

    if(!tabs || !paneLatest || !paneTheme || !paneRss) return;

    injectScopedCss();
    setTabs();

    const feeds = infomaxFeeds();
    renderRssPane(paneRss, feeds);

    let unified = [];
    let searchArmed = false;


    function renderWaitPanes(){
      renderLatestPane(paneLatest, [], (qInput ? qInput.value : ''), false);
      paneTheme.innerHTML = `
        <div class="card">
          <div class="card-top"><h3>테마 스냅샷</h3><span class="badge wait">WAIT</span></div>
          <p style="margin:0;">상단에서 <b>검색</b>을 누르시면 테마(3×3)와 최신 리스트가 표시됩니다.</p>
        </div>
      `;
    }

    async function loadAll(){
      setHeroStatus({updatedText:'UPD: -', statusText:'로딩…', statusKind:'wait'});
      paneLatest.innerHTML = '<div class="card"><div class="card-top"><h3>뉴스 수집 중</h3><span class="badge wait">WAIT</span></div><p>RSS 수집 및 정제 중입니다.</p></div>';
      paneTheme.innerHTML = '';

      try{
        const core = feeds.filter(f=>f.key!=='all');
        const results = await Promise.all(core.map(f=>fetchFeedItems(f).catch(()=>[])));
        unified = dedupeItems(results.flat());
        unified.sort((a,b)=> (b.ts-a.ts));

        const upd = unified[0]?.pubDate || '-';
        setHeroStatus({updatedText:`UPD: ${fmtTime(upd)}`, statusText:`OK · ${unified.length}건`, statusKind:'ok'});

        if(searchArmed){
          const qNow = qInput ? qInput.value : '';
          renderLatestPane(paneLatest, unified, qNow, true);
          renderThemePane(paneTheme, unified);
        }else{
          renderWaitPanes();
        }
      }catch(e){
        unified = [];
        setHeroStatus({updatedText:'UPD: -', statusText:'MISSING', statusKind:'missing'});
        paneLatest.innerHTML = `
          <div class="card">
            <div class="card-top"><h3>뉴스센터 연결 실패</h3><span class="badge missing">MISSING</span></div>
            <p>/api/rss 프록시가 동작하지 않거나 RSS 수집이 차단되었습니다.</p>
          </div>
        `;
        paneTheme.innerHTML = '';
      }
    }

    // UI events
    tabs.addEventListener('click', (e)=>{
      const b = e.target;
      if(!(b && b.classList && b.classList.contains('tab'))) return;
      showPane(b.dataset.tab);
    });

    function doSearch(){
      const q = (qInput ? String(qInput.value||"") : "").trim();
      // Option 2: results must appear only after explicit search.
      searchArmed = true;
      showPane("latest");

      const run = async ()=>{
        if(!unified.length){
          await loadAll();
        }
        renderLatestPane(paneLatest, unified, q, true);
        renderThemePane(paneTheme, unified);
      };
      // fire and forget with proper error handling via loadAll
      run();
    }

    if(qInput){
      qInput.addEventListener("keydown", (e)=>{
        if(e.key === "Enter"){
          e.preventDefault();
          doSearch();
        }
      });
    }
    if(btnSearch){
      btnSearch.addEventListener("click", doSearch);
    }
    if(btnRefresh){
      btnRefresh.addEventListener("click", ()=>{
        // Explicit action only.
        searchArmed = true;
        loadAll();
      });
    }

    // initial: do NOT load until user presses search (Option 2).
    showPane('latest');
    setHeroStatus({updatedText:'UPD: -', statusText:'대기', statusKind:'wait'});
    renderWaitPanes();
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
