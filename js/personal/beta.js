import{feedbackMailto as d}from"../ui/feedback.js";const n=e=>String(e??"").replace(/[&<>"']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[t]);function l({configured:e=!1,account:t=null}={}){if(!e)return"closed";const a=t&&t.kind!=="test"&&t.cloud;return a&&a.userId&&a.session&&a.session.refresh_token?"open":"signin"}const o=Object.freeze({badge:"BETA",card:"You're testing Forge before launch. Tell us what's broken or confusing.",welcome:"You're testing Forge before launch. Your data is on this phone and in your Forge account. At launch, sign in to the App Store app to bring it along, or move it with Settings → Account → Backup."}),s=`<span class="beta-badge" data-beta-badge>${o.badge}</span>`,g=()=>`<p class="small ob-beta" data-ob-beta>${n(o.welcome)}</p>`,i="betaCard";function x(e){let t=null;try{t=e.store.kv(i)}catch{}return t&&t.dismissed?"":`<div class="card beta-card" data-beta-card>
    <button type="button" class="beta-x" data-beta-dismiss aria-label="Dismiss">×</button>
    <div class="beta-card-t">${s}<b>Thanks for testing</b></div>
    <p class="small">${n(o.card)}</p>
    <a class="btn btn-sm beta-send" href="${n(d("feedback",{route:"today"}))}" data-feedback="feedback">Send feedback</a>
  </div>`}function u(e,t){const a=e.querySelector("[data-beta-card]");if(!a)return;a.querySelector("[data-beta-dismiss]").addEventListener("click",()=>{try{t.store.kv(i,{dismissed:!0})}catch{a.remove()}});const r=a.querySelector("a[data-feedback]");r.addEventListener("click",()=>r.setAttribute("href",d("feedback",{route:"today"})))}const c=`.beta-badge{display:inline-flex;align-items:center;padding:2px 6px;border-radius:6px;flex:none;background:var(--accent-soft);color:var(--accent);border:1px solid rgba(255,107,61,.4);font-size:10.5px;font-weight:900;letter-spacing:.1em;line-height:1.3}
.brand .beta-badge{margin-left:2px}
.beta-card{padding:14px 52px 14px 14px;border-color:rgba(255,107,61,.3)}
.beta-card-t{display:flex;align-items:center;gap:8px;font-size:15px;margin-bottom:4px}
.beta-card .beta-send{margin-top:10px;min-height:44px}
.beta-x{position:absolute;top:4px;right:4px;width:44px;height:44px;border-radius:12px;display:grid;place-items:center;color:var(--muted);font-size:24px;line-height:1}
.beta-x:active{background:var(--card2)}
.ob-beta{margin:12px 0;padding:10px 12px;border-radius:12px;background:var(--accent-soft);border:1px solid rgba(255,107,61,.3)}
#content[data-route="beta"]{padding-bottom:calc(var(--sab, 0px) + 8px)}
#content[data-route="beta"] ~ .tabbar{display:none}
.app-header:has(~ #content[data-route="beta"]) .loc-pill{display:none}
.bg-gate{min-height:calc(100dvh - 140px);display:flex;flex-direction:column;justify-content:center;gap:12px;padding:12px 4px 24px}
.bg-gate .ob-hero{margin-bottom:4px}
.bg-gate h1{font-size:28px;line-height:1.15}
.bg-gate .btn{min-height:52px}
.bg-gate .bg-help{text-align:center;min-height:44px;display:flex;align-items:center;justify-content:center}`;if(typeof document<"u"&&document.head&&!document.getElementById("forge-beta-css")){const e=document.createElement("style");e.id="forge-beta-css",e.textContent=c,document.head.appendChild(e)}export{s as BADGE,o as COPY,u as bindTodayCard,l as gateState,x as todayCardHTML,g as welcomeHTML};
