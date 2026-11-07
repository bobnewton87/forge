import{esc as c}from"./components.js";import{FEATURES as x}from"../flags.js";import{classify as y,groupCredits as T,CLASS_TYPES as $}from"../classes/classify.js";import{fmtDayKey as v}from"../util.js";import{DAYS as A,CLASS_MIN as k,CLASS_MAX as S,NAME_MAX as M,TIMETABLE_MAX as w,normalizeTimetable as h,normalizeClassEntry as E,normalizeBookingUrl as g,fmtClock as L}from"../classes/timetable.js";import{loadPersonal as B}from"../personal.js";const m=await B("crunchScreen"),p=()=>!!m&&x.crunch,q={chest:"Chest",back:"Back",shoulders:"Delts",biceps:"Biceps",triceps:"Triceps",forearms:"Forearms",core:"Abs",glutes:"Glutes",quads:"Quads",hamstrings:"Hams",calves:"Calves"},H=`<style>
.cs-wrap{display:flex;flex-direction:column;gap:8px}
.cs-rows .set-row{min-height:48px;padding:6px 0}
.cs-add{display:flex;flex-direction:column;gap:8px;margin-top:4px}
.cs-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.cs-grid input,.cs-grid select{min-height:44px;min-width:0;width:100%}
.cs-book{display:flex;flex-direction:column;gap:6px;margin-top:6px}.cs-book input{min-height:44px;width:100%}
.cs-grid [name=name]{grid-column:1 / -1}
.cs-del{appearance:none;border:1px solid var(--line);background:var(--card2);color:var(--muted);border-radius:10px;min-width:40px;min-height:40px;font-size:16px;cursor:pointer}
</style>`;function N(t,e){if(!t)return"";const s=y(t,e||45),i=T(s.muscles),a=Object.entries(i).sort((n,d)=>d[1]-n[1]).slice(0,3).map(([n,d])=>`${q[n]||n} ${d}`);return`${s.label} · ${s.cardioMinutes} cardio min${a.length?" · "+a.join(", "):""}`}function C(t){return t.length?t.map((e,s)=>`<div class="set-row cs-row" data-cs-row="${s}"><div class="grow">
      <div class="t">${c(v(e.day))} ${c(e.time?L(e.time):"any time")} · ${c(e.name)}</div>
      <div class="s">${e.minutes} min · ${c(y(e.name,e.minutes).label)}</div></div>
      <button type="button" class="cs-del" data-cs-del="${s}" aria-label="Remove ${c(e.name)}">✕</button></div>`).join(""):'<p class="small muted">No classes yet. Add the ones you go to each week.</p>'}function J(t,e){if(!e||!e.id)return"";const s=h(e.classes),i=c(e.id);return`${H}<div class="cs-wrap" data-cs-loc="${i}" data-cs-list="${c(JSON.stringify(s))}">
    <div class="label">Class timetable</div>
    <p class="tiny muted">The classes you go to here each week. The planner suggests them on class and flex days, and you can log one in a tap.</p>
    <div class="cs-rows">${C(s)}</div>
    ${s.length<w?`<form class="cs-add" autocomplete="off">
      <div class="cs-grid">
        <input name="name" type="text" list="cs-types-${i}" placeholder="Class name, e.g. Spin" maxlength="${M}" required aria-label="Class name">
        <select name="day" aria-label="Day">${A.map(a=>`<option value="${a}">${v(a)}</option>`).join("")}</select>
        <input name="time" type="time" aria-label="Start time">
        <input name="minutes" type="number" inputmode="numeric" min="${k}" max="${S}" value="45" aria-label="Minutes">
      </div>
      <datalist id="cs-types-${i}">${$.map(a=>`<option value="${c(a.name)}"></option>`).join("")}</datalist>
      <div class="tiny muted" data-cs-preview></div>
      <button class="btn btn-sm btn-block" type="submit">Add class</button>
    </form>`:`<p class="tiny muted">That's the most one gym can hold (${w}).</p>`}
    <div class="cs-book"><label class="label" for="cs-book-${i}">Booking link</label>
      <input id="cs-book-${i}" type="url" inputmode="url" autocapitalize="off" autocomplete="off" spellcheck="false" data-cs-book
             value="${c(g(e.bookingUrl)||"")}" placeholder="https://" maxlength="500" aria-describedby="cs-book-note-${i}">
      <p class="tiny muted" id="cs-book-note-${i}">Optional: where you book classes here, such as your gym's app or class page. The class list shows a Book link.</p></div>
    ${p()?m.crunchRowHTML(t,e):""}
  </div>`}function X(t){return p()?m.crunchCardHTML(t):""}function Y(t){return p()?m.crunchSectionHTML(t):""}function b(t){try{return h(JSON.parse(t.dataset.csList||"[]"))}catch{return[]}}function F(t,e=null){const s=[...t?.querySelectorAll?.(".cs-wrap[data-cs-loc]")||[]],i=e?s.find(n=>n.dataset.csLoc===e):s[0],a=i?g(i.querySelector("[data-cs-book]")?.value):void 0;return a===null?void 0:a}function G(t,e=null){const s=[...t?.querySelectorAll?.(".cs-wrap[data-cs-loc]")||[]];t?.matches?.(".cs-wrap[data-cs-loc]")&&s.unshift(t);const i=e?s.find(a=>a.dataset.csLoc===e):s[0];return i?b(i):[]}function U(t,e,s){const i=t.store.getProfile();return(i.locations||[]).some(a=>a.id===e)?(t.store.updateProfile({locations:i.locations.map(a=>a.id===e?{...a,classes:s}:a)}),!0):!1}function D(t,e){if(t.dataset.csBound)return;t.dataset.csBound="1";const s=t.dataset.csLoc,i=(r,o)=>{t.dataset.csList=JSON.stringify(r);const l=t.querySelector(".cs-rows");l&&(l.innerHTML=C(r)),U(e,s,r),o&&e.toast&&e.toast(o)},a=t.querySelector("[data-cs-book]");a?.addEventListener("change",()=>{const r=g(a.value);if(r===null){e.toast&&e.toast("Use a link that starts with https://");return}a.value=r;const o=e.store.getProfile();(o.locations||[]).some(l=>l.id===s)&&(e.store.updateProfile({locations:o.locations.map(l=>{if(l.id!==s)return l;const u={...l};return r?u.bookingUrl=r:delete u.bookingUrl,u})}),e.toast&&e.toast(r?"Booking link saved":"Booking link removed"))}),t.addEventListener("click",r=>{const o=r.target.closest("[data-cs-del]");if(!o)return;r.preventDefault();const l=b(t),[u]=l.splice(Number(o.dataset.csDel),1);u&&i(l,`Removed ${u.name}`)});const n=t.querySelector(".cs-add");if(!n)return;const d=n.querySelector("[data-cs-preview]");let f=!1;n.elements.minutes.addEventListener("input",()=>{f=!0}),n.addEventListener("input",r=>{if(r.target===n.elements.name&&!f){const o=$.find(l=>l.name.toLowerCase()===n.elements.name.value.trim().toLowerCase());o&&(n.elements.minutes.value=o.duration)}d.textContent=N(n.elements.name.value.trim(),Number(n.elements.minutes.value))}),n.addEventListener("submit",r=>{r.preventDefault();const o=E({name:n.elements.name.value,day:n.elements.day.value,time:n.elements.time.value,minutes:n.elements.minutes.value});if(!o){e.toast&&e.toast(`Add a name and ${k}–${S} minutes`);return}const l=h([...b(t),o]);i(l,`Added ${o.name} · ${v(o.day)}${o.time?" "+L(o.time):""}`),n.elements.name.value="",n.elements.time.value="",d.textContent="",f=!1})}function K(t,e){!t||!e?.store||(t.querySelectorAll(".cs-wrap[data-cs-loc]").forEach(s=>D(s,e)),p()&&m.bindCrunchSettings(t,e))}export{K as bindClassesSettings,J as classesSettingsHTML,X as crunchCardHTML,Y as crunchSectionHTML,F as readBookingUrl,G as readClassesSettings};
