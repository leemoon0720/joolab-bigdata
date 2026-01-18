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


  function getPlan(email){
    try { return localStorage.getItem("jlab_plan_"+email) || "미구독"; } catch(e){ return "미구독"; }
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
      const plan = getPlan(email);
      if(acctBadge) acctBadge.textContent = (role === "admin") ? "ADMIN" : "LOGIN";
      if(subBadge) subBadge.textContent = plan;
      if(subDesc) subDesc.textContent = `현재 로그인: ${email} · 권한: ${role} · 구독: ${plan}`;

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
        // IMPORTANT: this site uses Bearer tokens saved in localStorage.
        // Server-side logout clears cookie, but tokens must be cleared on client to truly logout.
        try{ localStorage.removeItem("jlab_token"); }catch(e){}
        try{ localStorage.removeItem("joolab_token"); }catch(e){}
        try{ sessionStorage.removeItem("jlab_token"); }catch(e){}
        try{ sessionStorage.removeItem("joolab_token"); }catch(e){}

        try{
          await fetchJSON('/api/auth/logout');
        }catch(e){}
        await render();
      });
    }

    if(btnCancel){
      btnCancel.addEventListener("click", ()=>{
        setMsg(cancelMsg, "구독 해지는 월구독 페이지에서 진행해 주십시오.", false);
      });
    }
  }

  document.addEventListener("DOMContentLoaded", ()=>{
    bind();
    render();
  });
})();