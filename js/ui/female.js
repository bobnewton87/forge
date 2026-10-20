// Sex selector + female profile fields + plain-language "what changes" (FEMALE mode, CONTRACT §20).
// Shared by the Measure body-profile card and Settings → Profile. Browser module; pure HTML strings + a binder.
// CONTRACT-NOTE: writes profile.body.{ sex, menopause, contraception, hormoneTherapy, pregnancy } via store.updateProfile.
//   Switching to female never changes sculpt goals silently: if the profile still has the original default goals,
//   a sheet offers the female starting goals (Keep mine / Switch).
import { esc } from './components.js';
import { FEMALE_LABELS, FEMALE_MODE_INFO, MENOPAUSE, CONTRACEPTION, HORMONE_THERAPY, PREGNANCY } from '../engine/sex.js';
import { SCULPT_GOALS, DEFAULT_SCULPT_GOALS, FEMALE_DEFAULT_SCULPT_GOALS } from '../data/sculpt.js';

const opt = (list, labels, cur, blank) => `${blank ? `<option value="" ${cur ? '' : 'selected'}>${esc(blank)}</option>` : ''}${list.map(v => `<option value="${v}" ${cur === v ? 'selected' : ''}>${esc(labels[v])}</option>`).join('')}`;

// `prefix` keeps ids unique when both cards could be on screen.
export function sexFieldsHTML(body = {}, { prefix = 'sx', segAttr = 'data-pseg' } = {}) {
  const sex = body.sex === 'female' ? 'female' : 'male';
  return `<div class="label">Sex <button type="button" class="bd-i" data-sexinfo aria-label="What changes with sex">ⓘ</button></div>
    <div class="tabs mt" style="margin-top:6px" ${segAttr}="sex">${[['male', 'Male'], ['female', 'Female']].map(([v, l]) => `<button type="button" class="${sex === v ? 'active' : ''}" data-v="${v}">${l}</button>`).join('')}</div>
    <p class="tiny muted" style="margin-top:6px">Sets the body-fat formulas, calorie burn, muscle-gain model, hormone ranges and milestones. Tap ⓘ to see exactly what changes.</p>
    <div class="fm-fields" data-femalefields ${sex === 'female' ? '' : 'hidden'}>
      <div class="grid2 mt">
        <div class="field"><label for="${prefix}-meno">Menopause</label><select id="${prefix}-meno" data-fem="menopause">${opt(MENOPAUSE, FEMALE_LABELS.menopause, body.menopause, 'Not set (estimated from age)')}</select></div>
        <div class="field"><label for="${prefix}-preg">Pregnancy</label><select id="${prefix}-preg" data-fem="pregnancy">${opt(PREGNANCY, FEMALE_LABELS.pregnancy, body.pregnancy || 'none')}</select></div>
        <div class="field"><label for="${prefix}-bc">Hormonal contraception</label><select id="${prefix}-bc" data-fem="contraception">${opt(CONTRACEPTION, FEMALE_LABELS.contraception, body.contraception || 'none')}</select></div>
        <div class="field"><label for="${prefix}-mht">Menopausal hormone therapy</label><select id="${prefix}-mht" data-fem="hormoneTherapy">${opt(HORMONE_THERAPY, FEMALE_LABELS.hormoneTherapy, body.hormoneTherapy || 'none')}</select></div>
      </div>
      <p class="tiny muted">Menopause: premenopausal = periods (regular or not); perimenopause = cycles changing; postmenopausal = 12+ months without a period (STRAW+10). All optional. Pregnancy pauses the projection and calorie deficits. Menopause stage and contraception change the hormone reference values and the notes; Forge models no direct muscle effect from them because the studies don't show one. Cycle phase isn't asked: the evidence doesn't support changing workouts by phase (McNulty 2020).</p>
    </div>`;
}

export function sexInfoHTML() {
  return `<h2>Male vs female in Forge</h2>
    <p class="small muted">Choosing female switches these models to female data. Everything is cited in the app's research notes.</p>
    <ul class="tip-list mt">${FEMALE_MODE_INFO.map(t => `<li class="small">${esc(t)}</li>`).join('')}</ul>
    <p class="tiny muted mt">Nothing here is medical advice. Pregnancy, postpartum, menopause and hormone therapy decisions belong with your clinician.</p>`;
}

// Reads the female selects inside `root` → patch for profile.body (null clears).
export function readFemaleFields(root) {
  const out = {};
  root.querySelectorAll('[data-fem]').forEach(s => { out[s.dataset.fem] = s.value || null; });
  if (out.pregnancy === 'none') out.pregnancy = null;
  for (const k of ['contraception', 'hormoneTherapy']) if (out[k] === 'none') out[k] = null;
  return out;
}

// Toggle visibility of the female fields when the sex segment changes (call from the segment click handler).
export function showFemaleFields(root, sex) {
  const f = root.querySelector('[data-femalefields]'); if (f) f.hidden = sex !== 'female';
}

export function bindSexInfo(root, ctx) {
  root.querySelectorAll('[data-sexinfo]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); ctx.openSheet(sexInfoHTML()); }));
}

const sameGoals = (a, b) => Array.isArray(a) && a.length === b.length && b.every(x => a.includes(x));
// After saving sex = female: offer the female starting goals if the profile still has the untouched original defaults.
export function maybeOfferFemaleGoals(ctx, before) {
  const p = ctx.store.getProfile();
  if (p.body?.sex !== 'female' || before?.body?.sex === 'female') return;
  if (!sameGoals(p.sculptGoals, DEFAULT_SCULPT_GOALS)) return;
  const name = id => SCULPT_GOALS[id]?.name || id;
  ctx.openSheet(`<h2>Starting sculpt goals for women?</h2>
    <p class="small muted">Your sculpt focus is still the app's original list: ${esc(DEFAULT_SCULPT_GOALS.map(name).join(', '))}.</p>
    <p class="small mt">The female starting set is <b>${esc(FEMALE_DEFAULT_SCULPT_GOALS.map(name).join(', '))}</b>. It's a preference default, not a rule; change goals any time in Settings → Sculpt focus.</p>
    <div class="sheet-actions"><button class="btn btn-primary btn-block" data-fg-yes>Use these goals</button><button class="btn btn-ghost btn-block" data-fg-no>Keep my current goals</button></div>`, (el, close) => {
    el.querySelector('[data-fg-no]').onclick = close;
    el.querySelector('[data-fg-yes]').onclick = async () => {
      close();
      try { const { setTargets } = await import('./targets.js'); await setTargets(ctx, { goals: { sculptGoals: [...FEMALE_DEFAULT_SCULPT_GOALS] } }, { reason: 'female starting sculpt goals' }); }
      catch (e) { ctx.store.updateProfile({ sculptGoals: [...FEMALE_DEFAULT_SCULPT_GOALS] }); }
    };
  });
}
