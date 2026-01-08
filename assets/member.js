(function(){
  const $ = (id)=>document.getElementById(id);

  const KEY_USERS = "jlab_users_v1";
  const KEY_SESSION = "jlab_session_v1";

  function loadUsers(){
    try{ return JSON.parse(localStorage.getItem(KEY_USERS) || "{}"); }
    catch(e){ return {}; }
  }
  function saveUsers(obj){
    localStorage.setItem(KEY_USERS, JSON.stringify(obj));
  }
  function setMsg(el, msg, ok){
    if(!el) return;
    el.textContent = msg || "";
    el.style.color = ok ? "rgba(15,23,42,.85)" : "rgba(220,38,38,.92)";
  }

  function getSession(){
    try{ return JSON.parse(localStorage.getItem(KEY_SESSION) || "null"); }
    catch(e){ return null; }
  }
  function setSession(s){
    localStorage.setItem(KEY_SESSION, JSON.stringify(s));
  }
  function clearSession(){
    localStorage.removeItem(KEY_SESSION);
  }

  function getPlan(email){
    return localStorage.getItem("jlab_plan_"+email) || "미구독";
  }
  function setPlan(email, plan){
    localStorage.setItem("jlab_plan_"+email, plan);
  }

  function render(){
    const sess = getSession();
    const acctBadge = $("acct-badge");
    const subBadge = $("sub-badge");
    const subDesc = $("sub-desc");
    if(!sess || !sess.email){
      if(acctBadge) acctBadge.textContent = "GUEST";
      if(subBadge) subBadge.textContent = "-";
      if(subDesc) subDesc.textContent = "로그인 후 확인 가능합니다.";
      return;
    }
    const plan = getPlan(sess.email);
    if(acctBadge) acctBadge.textContent = "LOGIN";
    if(subBadge) subBadge.textContent = plan;
    if(subDesc) subDesc.textContent = `현재 로그인: ${sess.email} · 구독: ${plan}`;
  }

  function bind(){
    const suEmail=$("su-email"), suPass=$("su-pass"), suNick=$("su-nick"), suMsg=$("su-msg");
    const liEmail=$("li-email"), liPass=$("li-pass"), liMsg=$("li-msg");
    const btnSignup=$("btn-signup"), btnLogin=$("btn-login"), btnLogout=$("btn-logout");
    const btnCancel=$("btn-cancel"), cancelMsg=$("cancel-msg");

    if(btnSignup){
      btnSignup.addEventListener("click", ()=>{
        const email=(suEmail?.value||"").trim().toLowerCase();
        const pass=(suPass?.value||"").trim();
        const nick=(suNick?.value||"").trim();
        if(!email || !email.includes("@")) return setMsg(suMsg, "이메일을 확인해 주십시오.", false);
        if(pass.length < 8) return setMsg(suMsg, "비밀번호는 8자 이상으로 설정해 주십시오.", false);

        const users=loadUsers();
        if(users[email]) return setMsg(suMsg, "이미 가입된 이메일입니다.", false);

        users[email] = { email, pass, nick, created: new Date().toISOString() };
        saveUsers(users);
        setMsg(suMsg, "가입 완료되었습니다. 우측에서 로그인해 주십시오.", true);
      });
    }

    if(btnLogin){
      btnLogin.addEventListener("click", ()=>{
        const email=(liEmail?.value||"").trim().toLowerCase();
        const pass=(liPass?.value||"").trim();
        if(!email || !email.includes("@")) return setMsg(liMsg, "이메일을 확인해 주십시오.", false);
        const users=loadUsers();
        if(!users[email] || users[email].pass !== pass) return setMsg(liMsg, "이메일 또는 비밀번호가 일치하지 않습니다.", false);

        setSession({ email, at: new Date().toISOString() });
        setMsg(liMsg, "로그인 완료되었습니다.", true);
        render();
      });
    }

    if(btnLogout){
      btnLogout.addEventListener("click", ()=>{
        clearSession();
        setMsg(liMsg, "로그아웃되었습니다.", true);
        render();
      });
    }

    if(btnCancel){
      btnCancel.addEventListener("click", ()=>{
        const sess = getSession();
        if(!sess || !sess.email) return setMsg(cancelMsg, "로그인 후 해지 신청이 가능합니다.", false);
        // 베타(심사용): 해지 신청 = 구독 상태를 '미구독'으로 변경
        setPlan(sess.email, "미구독");
        setMsg(cancelMsg, "해지 신청이 접수되었습니다. 다음 결제부터 중단됩니다.", true);
        render();
      });
    }

    // 결제 완료 리턴(테스트): /account/?plan=Basic 형태로 들어오면 플랜 반영
    try{
      const url = new URL(location.href);
      const plan = url.searchParams.get("plan");
      const sess = getSession();
      if(plan && sess && sess.email){
        const p = ["Basic","Pro","VIP"].includes(plan) ? plan : null;
        if(p){
          setPlan(sess.email, p);
          // URL 정리
          url.searchParams.delete("plan");
          history.replaceState({}, "", url.pathname + (url.search ? url.search : ""));
        }
      }
    }catch(e){}

    render();
  }

  document.addEventListener("DOMContentLoaded", bind);
})();