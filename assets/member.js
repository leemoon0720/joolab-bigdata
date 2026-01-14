(function(){
  const $ = (id)=>document.getElementById(id);

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

      // 비로그인 상태: 회원가입/로그인 폼 표시
      const cardSignup = $("acct-card-signup");
      const cardLogin  = $("acct-card-login");
      const subtitle   = $("acct-subtitle");
      if(cardSignup) cardSignup.style.display = "";
      if(cardLogin) cardLogin.style.display = "";
      if(subtitle) subtitle.textContent = "회원가입 · 로그인 · 내 구독 상태 확인";

      const btnLogout2 = $("btn-logout2");
      if(btnLogout2) btnLogout2.style.display = "none";

        return;
      }
      const email = me.user.email;
      const role = me.user.role || "user";

      // 결제 리턴 처리: /account/?plan=Basic|Pro|VIP  (가격표: 29,000 / 89,000(미국지표 포함) / 200,000)
      try{
        const u = new URL(window.location.href);
        const qp = (u.searchParams.get('plan')||'').trim();
        if(qp){
          const key = "jlab_plan_" + email;
          let label = "미구독";
          if(/^basic$/i.test(qp)) label = "29,000원";
          else if(/^pro$/i.test(qp)) label = "89,000원(미국지표 포함)";
          else if(/^vip$/i.test(qp)) label = "200,000원";
          localStorage.setItem(key, label);

          // URL에서 plan 제거
          u.searchParams.delete('plan');
          window.history.replaceState({}, "", u.pathname + (u.search||""));
        }
      }catch(e){}

      const plan = getPlan(email);
      if(acctBadge) acctBadge.textContent = (role === "admin") ? "ADMIN" : "LOGIN";
      if(subBadge) subBadge.textContent = plan;
      if(subDesc) subDesc.textContent = `현재 로그인: ${email} · 권한: ${role} · 구독: ${plan}`;

      // 로그인 상태: 회원가입/로그인 폼 숨김 + 부제 변경
      const cardSignup = $("acct-card-signup");
      const cardLogin  = $("acct-card-login");
      const subtitle   = $("acct-subtitle");
      if(cardSignup) cardSignup.style.display = "none";
      if(cardLogin) cardLogin.style.display = "none";
      if(subtitle) subtitle.textContent = "내 구독 상태";

      // 내 구독 상태 영역 로그아웃 버튼
      const btnLogout2 = $("btn-logout2");
      if(btnLogout2){
        btnLogout2.style.display = "";
        btnLogout2.onclick = async ()=>{
          try{ await fetch("/api/auth/logout", {credentials:"include"}); }catch(e){}
          window.location.href = "/account/";
        };
      }

    }catch(e){
      if(acctBadge) acctBadge.textContent = "GUEST";
      if(subBadge) subBadge.textContent = "-";
      if(subDesc) subDesc.textContent = "로그인이 필요합니다.";
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