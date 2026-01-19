(function(){
  const $ = (id)=>document.getElementById(id);

  // UI helpers (keep edits minimal: no layout changes, only show/hide)
  function closestSectionByChildId(childId){
    const el = $(childId);
    if(!el) return null;
    return el.closest('section');
  }
  function setDisplay(el, show){
    if(!el) return;
    el.style.display = show ? '' : 'none';
  }
  function setDisabled(el, disabled){
    if(!el) return;
    el.disabled = !!disabled;
  }

  function applyAccountPageUI(loggedIn, email){
    // Always hide signup box on this site (signup is handled by community)
    const signupCard = closestSectionByChildId('btn-signup');
    if(signupCard) setDisplay(signupCard, false);

    // Toggle login card content
    const loginCard = closestSectionByChildId('btn-login');
    if(!loginCard) return;

    const liEmail = $('li-email');
    const liPass  = $('li-pass');
    const btnLogin = $('btn-login');
    const btnLogout = $('btn-logout');
    const liMsg = $('li-msg');

    if(loggedIn){
      // Hide inputs + login button, keep logout visible
      if(liEmail) liEmail.value = email || liEmail.value || '';
      // Hide the input rows by walking up to their nearest ".input" wrappers
      const emailWrap = liEmail ? liEmail.closest('.input') : null;
      const passWrap  = liPass  ? liPass.closest('.input')  : null;
      setDisplay(emailWrap, false);
      setDisplay(passWrap, false);
      // Hide related labels if present
      if(liEmail){
        const lbl = liEmail.closest('.form')?.querySelector('label.flabel');
        // first label is email
        setDisplay(lbl, false);
      }
      // Second label (password)
      const labels = loginCard.querySelectorAll('label.flabel');
      if(labels && labels.length){
        labels.forEach((lab)=>setDisplay(lab, false));
      }

      setDisplay(btnLogin, false);
      setDisplay(btnLogout, true);
      setDisabled(btnLogout, false);
      if(liMsg) {
        liMsg.textContent = email ? `현재 로그인: ${email}` : '로그인 상태입니다.';
        liMsg.style.color = '#64748b';
      }
    }else{
      // Guest: show inputs + login button, hide logout
      const emailWrap = liEmail ? liEmail.closest('.input') : null;
      const passWrap  = liPass  ? liPass.closest('.input')  : null;
      setDisplay(emailWrap, true);
      setDisplay(passWrap, true);
      const labels = loginCard.querySelectorAll('label.flabel');
      if(labels && labels.length){
        labels.forEach((lab)=>setDisplay(lab, true));
      }
      setDisplay(btnLogin, true);
      setDisplay(btnLogout, false);
      if(liMsg) {
        // keep existing message
      }
    }
  }

  function setMsg(el, msg, ok){
    if(!el) return;
    el.textContent = msg || "";
    el.style.color = ok ? "#16a34a" : "#ef4444";
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

  async function render(){
    const acctBadge = $("acct-badge");
    const subBadge = $("sub-badge");
    const subDesc = $("sub-desc");

    try{
      const me = await fetchJSON('/api/auth/me');
      if(!me || !me.ok || !me.user || !me.user.email){
        if(acctBadge) acctBadge.textContent = "GUEST";
        if(subBadge) subBadge.textContent = "-";
        if(subDesc) subDesc.textContent = "로그인이 필요합니다.";
        applyAccountPageUI(false, '');
        return;
      }
      const email = me.user.email;
      const role = me.user.role || "user";

      // 구독은 서버 기준(/api/subscription/me)
      let planDisplay = '미구독';
      let status = 'none';
      let expireAt = null;
      try{
        const sub = await fetchJSON('/api/subscription/me');
        if(sub && sub.ok){
          planDisplay = sub.plan_display || '미구독';
          status = sub.status || 'none';
          expireAt = sub.expire_at || null;
        }
      }catch(e){}

      if(acctBadge) acctBadge.textContent = (role === "admin") ? "ADMIN" : "LOGIN";
      if(subBadge) subBadge.textContent = planDisplay;
      if(subDesc){
        const expText = expireAt ? (' · 만료: ' + String(expireAt).slice(0,10)) : '';
        subDesc.textContent = `현재 로그인: ${email} · 권한: ${role} · 구독: ${planDisplay}${expText}`;
      }

      applyAccountPageUI(true, email);
    }catch(e){
      if(acctBadge) acctBadge.textContent = "GUEST";
      if(subBadge) subBadge.textContent = "-";
      if(subDesc) subDesc.textContent = "로그인이 필요합니다.";
      applyAccountPageUI(false, '');
    }
  }

  function bind(){
    const suMsg=$("su-msg");
    const liEmail=$("li-email"), liPass=$("li-pass"), liMsg=$("li-msg");
    const btnSignup=$("btn-signup"), btnLogin=$("btn-login"), btnLogout=$("btn-logout");
    const btnCancel=$("btn-cancel"), cancelMsg=$("cancel-msg");

    // 회원가입은 커뮤니티에서만 진행(데이터센터는 커뮤니티 명단 기반 로그인)
    if(btnSignup){
      btnSignup.addEventListener("click", ()=>{
        setMsg(suMsg, "회원가입은 커뮤니티에서만 가능합니다. (데이터센터는 커뮤니티 회원 명단 기반 로그인)", false);
      });
    }

    if(btnLogin){
      btnLogin.addEventListener("click", async ()=>{
        const email=(liEmail?.value||"").trim().toLowerCase();
        const pass=(liPass?.value||"").trim();
        if(!email || !email.includes("@")) return setMsg(liMsg, "이메일을 확인해 주십시오.", false);
        if(!pass) return setMsg(liMsg, "비밀번호를 입력해 주십시오.", false);

        try{
          const res = await postJSON('/api/auth/login', { email, password: pass });
          if(!res.ok) return setMsg(liMsg, res.message || "로그인 실패", false);
          setMsg(liMsg, "로그인 완료되었습니다.", true);
          try{
            if(res && res.token){
              try{ localStorage.setItem("jlab_token", res.token); }catch(e){}
              try{ localStorage.setItem("joolab_token", res.token); }catch(e){}
            }
          }catch(e){}
          await render();

          // next 처리
          try{
            const u = new URL(window.location.href);
            const next = u.searchParams.get('next');
            if(next){
              window.location.href = next;
              return;
            }
          }catch(e){}
        
          window.location.href = '/';
          return;
}catch(e){
          setMsg(liMsg, "로그인 실패 (서버 오류)", false);
        }
      });
    }

    if(btnLogout){
      btnLogout.addEventListener("click", async ()=>{
        // HARD LOGOUT: clear session cookie + any client tokens, then force reload.
        // This site authenticates via HttpOnly cookie (jlab_sess). Client tokens may still exist from older builds.
        try{ btnLogout.disabled = true; }catch(e){}

        // 1) Call server logout first (sets Set-Cookie Max-Age=0)
        try{
          await fetch('/api/auth/logout', { method:'GET', cache:'no-store', credentials:'include' });
        }catch(e){}

        // 2) Best-effort client-side cleanup (does not affect HttpOnly cookie, but prevents stale UI logic)
        const keys = [
          'jlab_token','joolab_token','token','access_token','auth','auth_token','session','user','me'
        ];
        try{
          keys.forEach(k=>{ try{ localStorage.removeItem(k); }catch(e){} });
        }catch(e){}
        try{
          keys.forEach(k=>{ try{ sessionStorage.removeItem(k); }catch(e){} });
        }catch(e){}

        // 3) Best-effort cookie removal (HttpOnly cookies cannot be deleted via JS, but we try for non-HttpOnly variants)
        // Server-side logout is the source of truth; this is only a safety net.
        function expireCookie(name, domain){
          let s = `${name}=; Max-Age=0; Path=/; SameSite=Lax; Secure`;
          if(domain) s += `; Domain=${domain}`;
          document.cookie = s;
        }
        try{
          const host = location.hostname;
          // host-only
          expireCookie('jlab_sess', '');
          // common domains
          expireCookie('jlab_sess', host);
          // parent domains
          const parts = host.split('.');
          if(parts.length >= 2){
            const p1 = '.' + parts.slice(-2).join('.');
            expireCookie('jlab_sess', p1);
          }
                  }catch(e){}
        // Also try known apex domain for this project
        try{ expireCookie('jlab_sess', '.joolab.co.kr'); }catch(e){}
        try{ expireCookie('jlab_sess', 'joolab.co.kr'); }catch(e){}

        // 4) Force navigation to refresh all scripts and nav state
        try{
          const ts = Date.now();
          window.location.replace('/account/?logout=1&ts=' + ts);
          return;
        }catch(e){}
        try{ window.location.href = '/account/'; }catch(e){}
      });
    }
if(btnCancel){
      btnCancel.addEventListener("click", async ()=>{
        // Cancel = stop access immediately (this does NOT mean refund).
        const ok = confirm('구독 해지를 진행하시겠습니까?\n- 만료형 이용권은 자동결제가 아닙니다.\n- 해지는 접근 권한을 즉시 비활성화합니다.\n- 환불은 환불·해지 규정에 따릅니다.');
        if(!ok) return;
        try{
          setMsg(cancelMsg, '해지 처리 중...', true);
          const res = await postJSON('/api/subscription/cancel', {});
          if(res && res.ok){
            setMsg(cancelMsg, '해지가 완료되었습니다. (접근 권한이 비활성화되었습니다)', true);
            await render();
            return;
          }
          setMsg(cancelMsg, (res && (res.message||res.error)) ? (res.message||res.error) : '해지 실패', false);
        }catch(e){
          setMsg(cancelMsg, '해지 실패 (서버 오류)', false);
        }
      });
    }
  }

  document.addEventListener("DOMContentLoaded", ()=>{
    bind();
    render();
  });
})();