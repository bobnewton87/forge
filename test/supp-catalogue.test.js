import test from 'node:test';
import assert from 'node:assert/strict';
import { SUPPLEMENTS, NOT_MODELED, CATEGORIES, EVIDENCE, isUnapproved, isModeled } from '../js/data/supplements.js';

const CATS = new Set(CATEGORIES.map(c => c.id));
const RANGES = {
  leanCeilingMult: [0.85, 1.6], leanRetentionMult: [0.5, 1.5], partitionShift: [-0.1, 0.1], tdeeDelta: [-300, 300],
  intakeDelta: [-800, 400], waterLb: [0, 6], rampWeeks: [0, 52], leanDirectLbPerWeek: [0, 1], fatDirectLbPerWeek: [-0.5, 0],
  intakePctOfMaint: [-0.35, 0], taperAfterWeeks: [1, 104], waterRampWeeks: [0, 12],
};

test('catalogue has the required items with valid schema', () => {
  const required = ['creatine', 'protein_powder', 'caffeine', 'beta_alanine', 'citrulline', 'vitamin_d', 'omega3', 'hmb', 'ashwagandha',
    'tongkat_ali', 'zma', 'collagen', 'electrolytes', 'melatonin', 'sleep_hygiene', 'trt', 'semaglutide', 'tirzepatide', 'adderall',
    'bpc157', 'tb500', 'ipamorelin_cjc', 'mk677', 'tesamorelin', 'hgh'];
  for (const id of required) assert.ok(SUPPLEMENTS[id], 'missing ' + id);
  assert.ok(Object.keys(SUPPLEMENTS).length >= 25);
  for (const [id, s] of Object.entries(SUPPLEMENTS)) {
    assert.equal(s.id, id);
    assert.ok(CATS.has(s.category), `${id} category`);
    assert.ok(EVIDENCE[s.evidence], `${id} evidence`);
    for (const k of ['name', 'status', 'summary', 'mechanism']) assert.ok(typeof s[k] === 'string' && s[k].length > (k === 'name' || k === 'status' ? 2 : 10), `${id}.${k}`);
    assert.ok(Array.isArray(s.effects) && s.effects.length >= 1, `${id} effects`);
    assert.ok(Array.isArray(s.risks), `${id} risks`);
    assert.ok(Array.isArray(s.sources) && s.sources.length >= 1, `${id} sources`);
    for (const src of s.sources) assert.ok(src.length > 20 && /\d{4}|WADA|FDA|Food and Drug/.test(src), `${id} source looks like a citation: ${src}`);
    assert.ok(s.typicalUse === null || typeof s.typicalUse === 'string', `${id} typicalUse`);
    assert.ok(s.model && typeof s.model === 'object', `${id} model`);
  }
});

test('every model param is in a sane, evidence-matched range', () => {
  for (const [id, s] of Object.entries(SUPPLEMENTS)) {
    const m = s.model;
    for (const [k, [lo, hi]] of Object.entries(RANGES)) {
      if (m[k] == null) continue;
      assert.ok(typeof m[k] === 'number' && Number.isFinite(m[k]), `${id}.${k} numeric`);
      assert.ok(m[k] >= lo && m[k] <= hi, `${id}.${k}=${m[k]} outside [${lo}, ${hi}]`);
    }
    // §22: 'exogenousT' items (oral and nasal testosterone) are level-driven, not dose-driven — the dose unit
    // differs per product, so they carry a trial-mean serum level instead and a measured lab always wins.
    if (m.kind === 'exogenousT') {
      assert.ok(Number.isFinite(m.trialLevel) && m.trialLevel > 0, `${id} needs a trial level`);
      assert.ok(typeof m.trialLevelNote === 'string' && m.trialLevelNote.length > 10, `${id} must say where that level comes from`);
      continue;
    }
    if (isModeled(s)) {
      assert.ok(m.dose && m.dose.unit && Number.isFinite(m.dose.default) && m.dose.default > 0, `${id} needs a default dose`);
      assert.ok(Array.isArray(m.dose.studied) && m.dose.studied[0] <= m.dose.studied[1], `${id} studied range`);
      if (m.response) {
        for (let i = 1; i < m.response.length; i++) assert.ok(m.response[i][0] > m.response[i - 1][0], `${id} response anchors ascending`);
        assert.equal(m.response[0][1], 0, `${id} zero dose → zero effect`);
      }
      if (m.rampByDose) for (const [, w] of m.rampByDose) assert.ok(w > 0 && w <= 52, `${id} ramp weeks`);
    }
  }
});

test('unapproved compounds: typicalUse null, clear status, risks listed', () => {
  const unapproved = Object.values(SUPPLEMENTS).filter(isUnapproved);
  assert.ok(unapproved.length >= 5);
  for (const s of unapproved) {
    assert.equal(s.typicalUse, null, s.id);
    assert.match(s.status, /not fda approved/i, s.id);
    assert.match(s.status, /wada/i, s.id);
    assert.ok(s.risks.length >= 2, s.id + ' risks');
  }
  for (const id of ['bpc157', 'tb500', 'ipamorelin_cjc', 'mk677', 'enobosarm', 'lgd4033']) assert.ok(isUnapproved(SUPPLEMENTS[id]), id);
  // no human evidence → nothing projected
  for (const id of ['bpc157', 'tb500', 'ipamorelin_cjc']) { assert.equal(SUPPLEMENTS[id].evidence, 'none'); assert.equal(isModeled(SUPPLEMENTS[id]), false); }
  // prescription items say so
  for (const id of ['trt', 'semaglutide', 'tirzepatide', 'adderall', 'hgh', 'tesamorelin']) assert.match(SUPPLEMENTS[id].status, /prescription/i, id);
});

test('not-modeled list covers the dangerous compounds with reasons', () => {
  const names = NOT_MODELED.map(n => n.name.toLowerCase()).join(' | ');
  for (const k of ['steroid', 'clenbuterol', 'dnp', 'insulin', 'thyroid']) assert.ok(names.includes(k), k);
  for (const n of NOT_MODELED) assert.ok(n.why.length > 30, n.name);
});

test('evidence grades are honest for key items', () => {
  assert.equal(SUPPLEMENTS.creatine.evidence, 'strong');
  assert.equal(SUPPLEMENTS.hmb.evidence, 'weak');
  assert.equal(SUPPLEMENTS.tongkat_ali.evidence, 'weak');
  assert.match(SUPPLEMENTS.collagen.summary, /not a muscle builder/i);
  assert.match(SUPPLEMENTS.hgh.summary, /water/i);
  assert.match(SUPPLEMENTS.mk677.summary, /water/i);
});
