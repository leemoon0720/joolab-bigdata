(function(){
  const $ = (id)=>document.getElementById(id);

  async function fetchJSON(url){
    const r = await fetch(url, {cache:'no-store'});
    if(!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.json();
  }
  async function postJSON(url, body){
    const r = await fetch(url, {
      method:'POST',
      headers:{'content-type':'application/json; charset=utf-8'},
      body: JSON.stringify(body || {})
    });
    if(!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.json();
  }

  function setMsg(id, msg, ok){
    const el = $(id);
    if(!el) return;
    el.textContent = msg || '';
    el.style.color = ok ? '#16a34a' : '#ef4444';
  }

  let state = { status_text:'대기', status_kind:'wait', items:[] };

  function nowKSTText(){
    try{
      const d = new Date();
      // KST 표기만(로컬이 KST 기준이면 그대로)
      const pad = (n)=>String(n).padStart(2,'0');
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }catch(e){
      return '';
    }
  }

  async function initAdmin(){
    const wrap = $('admin-notice-wrap');
    if(!wrap) return; // 관리자 UI가 없는 페이지면 종료

    try{
      const me = await fetchJSON('/api/auth/me');
      if(!me || !me.ok || !me.user || me.user.role !== 'admin'){
        wrap.style.display = 'none';
        return;
      }
      wrap.style.display = '';
    }catch(e){
      wrap.style.display = 'none';
      return;
    }

    // load notice
    try{
      const j = await fetchJSON('/api/notice/latest');
      if(j && j.ok){
        state.status_text = j.status_text || '대기';
        state.status_kind = j.status_kind || 'wait';
        state.items = Array.isArray(j.items) ? j.items : [];
      }
      const stText = $('ad-status-text');
      const stKind = $('ad-status-kind');
      if(stText) stText.value = state.status_text;
      if(stKind) stKind.value = state.status_kind;
      setMsg('ad-status-msg', `현재 공지 ${state.items.length}건 로드됨`, true);
    }catch(e){
      setMsg('ad-status-msg', '공지 로드 실패', false);
    }

    // load popup
    try{
      const p = await fetchJSON('/api/popup/config');
      if(p && p.ok){
        $('ad-pop-enabled').checked = !!p.enabled;
        $('ad-pop-title').value = p.title || '';
        $('ad-pop-body').value = p.body || '';
        $('ad-pop-link').value = p.link_url || '';
        $('ad-pop-linktxt').value = p.link_text || '';
        $('ad-pop-start').value = p.start_at || '';
        $('ad-pop-end').value = p.end_at || '';
        $('ad-pop-dismiss').value = (p.dismiss_hours != null) ? String(p.dismiss_hours) : '24';
        setMsg('ad-pop-msg', `팝업 로드 완료`, true);
      }
    }catch(e){
      setMsg('ad-pop-msg', '팝업 로드 실패', false);
    }

    bindAdmin();
  }

  function bindAdmin(){
    const addBtn = $('ad-item-add');
    const saveBtn = $('ad-save-notice');
    const savePopupBtn = $('ad-save-popup');

    if(addBtn){
      addBtn.addEventListener('click', ()=>{
        const type = ($('ad-item-type')?.value || 'notice').trim();
        const title = ($('ad-item-title')?.value || '').trim();
        const time = ($('ad-item-time')?.value || '').trim() || nowKSTText();
        const summary = ($('ad-item-summary')?.value || '').trim();
        const impact = ($('ad-item-impact')?.value || '').trim();
        const rollback = ($('ad-item-rollback')?.value || '').trim();
        const link = ($('ad-item-link')?.value || '').trim();

        if(!title) return setMsg('ad-item-msg', '제목을 입력해 주십시오.', false);
        if(!summary) return setMsg('ad-item-msg', '요약을 입력해 주십시오.', false);

        state.items = [{ type, title, time, summary, impact, rollback, link }, ...state.items].slice(0, 50);

        // 입력값 초기화
        if($('ad-item-title')) $('ad-item-title').value = '';
        if($('ad-item-time')) $('ad-item-time').value = '';
        if($('ad-item-summary')) $('ad-item-summary').value = '';
        if($('ad-item-impact')) $('ad-item-impact').value = '';
        if($('ad-item-rollback')) $('ad-item-rollback').value = '';
        if($('ad-item-link')) $('ad-item-link').value = '';

        setMsg('ad-item-msg', `추가됨 (총 ${state.items.length}건)`, true);

        // 화면 리스트 즉시 갱신(공지 페이지에서만)
        try{
          const wrap = document.getElementById('notice-items');
          if(wrap && window.hydrateNotice) window.hydrateNotice();
        }catch(e){}
      });
    }

    if(saveBtn){
      saveBtn.addEventListener('click', async ()=>{
        state.status_text = ($('ad-status-text')?.value || '대기').trim();
        state.status_kind = ($('ad-status-kind')?.value || 'wait').trim();

        try{
          const res = await postJSON('/api/admin/notice/save', {
            status_text: state.status_text,
            status_kind: state.status_kind,
            items: state.items
          });
          if(!res.ok) return setMsg('ad-save-msg', res.message || '저장 실패', false);
          setMsg('ad-save-msg', `저장 완료: ${res.updated_at}`, true);
          // 공지 재로딩
          try{ if(window.hydrateNotice) window.hydrateNotice(); }catch(e){}
        }catch(e){
          setMsg('ad-save-msg', '저장 실패 (서버 저장소 KV 설정 필요)', false);
        }
      });
    }

    if(savePopupBtn){
      savePopupBtn.addEventListener('click', async ()=>{
        const enabled = !!$('ad-pop-enabled')?.checked;
        const title = ($('ad-pop-title')?.value || '').trim();
        const body = ($('ad-pop-body')?.value || '').trim();
        const link_url = ($('ad-pop-link')?.value || '').trim();
        const link_text = ($('ad-pop-linktxt')?.value || '').trim() || '자세히';
        const start_at = ($('ad-pop-start')?.value || '').trim() || null;
        const end_at = ($('ad-pop-end')?.value || '').trim() || null;
        const dismiss_hours = Number(($('ad-pop-dismiss')?.value || '24').trim());

        try{
          const res = await postJSON('/api/admin/popup/save', {
            enabled, title, body, link_url, link_text, start_at, end_at, dismiss_hours
          });
          if(!res.ok) return setMsg('ad-pop-msg', res.message || '저장 실패', false);
          setMsg('ad-pop-msg', `저장 완료: ${res.updated_at}`, true);
          // 팝업은 새로고침 시 적용(즉시 반영도 가능하지만 최소 변경)
        }catch(e){
          setMsg('ad-pop-msg', '저장 실패 (서버 저장소 KV 설정 필요)', false);
        }
      });
    }
  }

  document.addEventListener('DOMContentLoaded', initAdmin);
})();