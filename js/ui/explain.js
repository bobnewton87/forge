import{esc as a,openSheet as p}from"./components.js";import{EXPLAIN as c,SOURCES as u,VALIDATION_REPORT as f}from"../data/sources.js";import{unitsCopy as d}from"../engine/nutrition.js";function v(i,s=""){if(!c[i])return"";const n=s||c[i].title.toLowerCase();return`<button type="button" class="bd-i fx-i" data-explain="${a(i)}" aria-label="How Forge estimates ${a(n)}" title="How Forge estimates this">ⓘ</button>`}function m(i,{lines:s=[],units:n="lb"}={}){const t=c[i];if(!t)return"";const l=e=>d(e,n),o=(t.sources||[]).map(e=>u[e]).filter(Boolean),r=(Array.isArray(s)?s:[]).filter(e=>typeof e=="string"&&e.trim());return`<div class="fx-sheet" data-explain-sheet="${a(i)}">
    <div class="tiny muted bold fx-kicker">How Forge estimates this</div>
    <h2>${a(t.title)}</h2>
    <div class="label mt">What goes in</div>
    <ul class="tip-list fx-list">${t.inputs.map(e=>`<li class="small">${a(l(e))}</li>`).join("")}</ul>
    <div class="label mt">How</div>
    <p class="small fx-p">${a(l(t.method))}</p>
    <div class="label mt">How accurate it is</div>
    <p class="small fx-p">${a(l(t.accuracy))}</p>
    ${t.note?`<p class="small fx-p muted">${a(l(t.note))}</p>`:""}
    ${r.length?`<div class="fx-you">${r.map(e=>`<p class="small">${a(l(e))}</p>`).join("")}</div>`:""}
    ${o.length?`<div class="label mt">Sources</div>
    <ul class="fx-src">${o.map(e=>`<li class="tiny"><b>${a(e.author)}</b> ${a(String(e.year))}. <i>${a(e.journal)}</i>. <a href="${a(e.link)}" target="_blank" rel="noopener noreferrer">${a(e.link.replace(/^https:\/\//,""))}</a></li>`).join("")}</ul>`:""}
    <p class="tiny muted fx-foot">Accuracy figures: ${a(f)}, which tested Forge against published trials.</p>
  </div>`}function x(i,s,n={}){let t=n.units;if(t==null)try{t=i?.store?.getProfile?.()?.units}catch{t="lb"}const l=m(s,{...n,units:t});l&&p(i,l)}function y(i,s,n=()=>({})){i&&i.querySelectorAll("[data-explain]:not([data-explain-bound])").forEach(t=>{t.dataset.explainBound="1",t.addEventListener("click",l=>{l.preventDefault(),l.stopPropagation();let o={};try{o=n(t.dataset.explain)||{}}catch{o={}}x(s,t.dataset.explain,o)})})}export{y as bindExplain,m as explainHTML,v as infoButton,x as openExplain};
