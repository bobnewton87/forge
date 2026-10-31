import{esc as d}from"./components.js";import{PACE_FIELDS as c}from"../data/cardio.js";import{runningForm as p,runningPatch as u,runningSummary as h,PACE_LABELS as y,PACE_HINT as v,EVENT_MAX as f}from"../engine/running.js";import{wLabel as b}from"../units.js";const m={mi:{easy:"9:30-10:15",threshold:"8:00",marathon:"8:45",fast:"7:00"},km:{easy:"5:55-6:20",threshold:"5:00",marathon:"5:25",fast:"4:20"}};function A(i){const a=p(i),r=b(i?.units),o=h(i),s=(e,t,n)=>`<div class="field"><label for="rn-${e}">${d(t)}</label><input id="rn-${e}" data-rn="${e}" value="${d(a[e])}" ${n}>
    <div class="tiny" style="color:var(--bad)" data-rn-err="${e}" hidden></div></div>`;return`<div class="section-title" id="sec-running">Running</div>
  <div class="card" data-rn-card>
    <p class="small muted mb">Optional, for runners. Without paces, cardio notes go by effort (the talk test). With them, run and treadmill notes use your paces. A past race weight adds a projection milestone: more lean mass than you had at that weight.</p>
    ${o?`<p class="tiny mb" data-rn-sum>Saved: ${d(o)}</p>`:""}
    <div class="label">Paces per</div>
    <div class="tabs mt" style="margin-top:6px;margin-bottom:12px" data-rn-units>${["mi","km"].map(e=>`<button type="button" class="${a.unit===e?"active":""}" data-rn-unit="${e}">${e==="mi"?"mile":"km"}</button>`).join("")}</div>
    <div class="grid2">${c.map(e=>s(e,y[e],`type="text" autocomplete="off" autocapitalize="off" maxlength="11" placeholder="e.g. ${m[a.unit][e]}"`)).join("")}</div>
    <p class="tiny muted" style="margin:-6px 0 12px">${d(v)}</p>
    <div class="grid2">
      ${s("raceWeight",`Race weight (${r})`,'type="number" inputmode="decimal" step="0.1"')}
      ${s("raceBodyFat","Body fat then (%)",'type="number" inputmode="decimal" step="0.1"')}
    </div>
    <p class="tiny muted" style="margin:-6px 0 12px">On the DXA scale, like every body-fat number in Forge. Smart scales and calipers usually read 3-4 points lower.</p>
    ${s("event","Race (optional)",`type="text" maxlength="${f}" autocomplete="off" placeholder="e.g. marathon"`)}
    <div class="row" style="gap:8px"><button type="button" class="btn btn-sm btn-primary" data-rn-save>Save</button>
      <button type="button" class="btn btn-sm btn-ghost" data-rn-clear>Clear</button></div>
  </div>`}function L(i,a){const r=i.querySelector("[data-rn-card]");if(!r)return;let o=r.querySelector("[data-rn-unit].active")?.dataset.rnUnit||"mi";r.querySelectorAll("[data-rn-unit]").forEach(t=>t.addEventListener("click",()=>{o=t.dataset.rnUnit,r.querySelectorAll("[data-rn-unit]").forEach(n=>n.classList.toggle("active",n===t)),c.forEach(n=>{const l=r.querySelector(`[data-rn="${n}"]`);l&&(l.placeholder=`e.g. ${m[o][n]}`)})}));const s=()=>({unit:o,...Object.fromEntries([...r.querySelectorAll("[data-rn]")].map(t=>[t.dataset.rn,t.value]))}),e=t=>r.querySelectorAll("[data-rn-err]").forEach(n=>{const l=t[n.dataset.rnErr];n.hidden=!l,n.textContent=l||""});r.querySelector("[data-rn-save]").addEventListener("click",()=>{const t=u(s(),a.store.getProfile());e(t.errors),t.ok&&(a.store.updateProfile(t.patch),a.toast(t.patch.cardioPaces?"Saved. Newly planned cardio uses your paces.":Object.keys(t.patch.benchmarks).length?"Saved":"Cleared"),a.rerender())}),r.querySelector("[data-rn-clear]").addEventListener("click",()=>{r.querySelectorAll("[data-rn]").forEach(t=>{t.value=""}),e({}),a.store.updateProfile(u({},a.store.getProfile()).patch),a.toast("Cleared"),a.rerender()})}export{L as bindRunning,A as runningHTML};
