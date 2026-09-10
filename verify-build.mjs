/*
 * Independent verification: diff a mock's SAVED state against the IR.
 *
 * 1. In the mock's tab, DevTools console (context = top):
 *      copy(__exportState())
 *    Paste into a file, e.g. built-state.json
 * 2. node verify-build.mjs <ir.json> <built-state.json>
 *
 * Does not trust the agent's own audit. Compares every visit, form, field,
 * type, required flag, range, units, formula, coded-value pair, skip-logic
 * rule and field order, and reports extras and duplicates as well as misses.
 */
import fs from 'fs';

const [irPath, statePath] = process.argv.slice(2);
if (!irPath || !statePath) {
  console.error('usage: node verify-build.mjs <ir.json> <built-state.json>');
  process.exit(2);
}

const ir = JSON.parse(fs.readFileSync(irPath, 'utf8'));

// DevTools "Copy" sometimes yields a JS string literal rather than raw JSON.
// If the file does not start with an object brace, evaluate it as a literal.
let text = fs.readFileSync(statePath, 'utf8').trim();
let raw = text[0] === '{' ? JSON.parse(text) : Function('return ' + text)();
let guard = 0;
while (typeof raw === 'string' && guard++ < 5) raw = JSON.parse(raw);
const built = raw.study || raw;

const problems = [];
const P = (kind, where, detail) => problems.push({ kind, where, detail });
const norm = (v) => (v === undefined || v === null || v === '' ? null : v);

// The platform may store numbers as strings; compare by value, not by JS type.
const same = (a, b) => {
  a = norm(a); b = norm(b);
  if (a === b) return true;
  if (a === null || b === null) return false;
  const na = Number(a), nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb;
  return String(a) === String(b);
};

const builtVisits = new Map((built.visits || []).map((v) => [v.name, v]));
for (const bv of built.visits || []) {
  if (!ir.visits.some((v) => v.name === bv.name)) P('EXTRA VISIT', bv.name, '');
}

for (const iv of ir.visits) {
  const bv = builtVisits.get(iv.name);
  if (!bv) { P('MISSING VISIT', iv.name, ''); continue; }
  if (!same(bv.windowStart, iv.window_start_day) || !same(bv.windowEnd, iv.window_end_day))
    P('VISIT WINDOW', iv.name, `ir ${iv.window_start_day}..${iv.window_end_day}  built ${bv.windowStart}..${bv.windowEnd}`);

  const seen = new Map();
  for (const bf of bv.forms || []) seen.set(bf.name, (seen.get(bf.name) || 0) + 1);
  for (const [n, c] of seen) if (c > 1) P('DUPLICATE FORM', `${iv.name} / ${n}`, `${c} copies`);
  for (const bf of bv.forms || []) if (!iv.forms.some((f) => f.name === bf.name)) P('EXTRA FORM', `${iv.name} / ${bf.name}`, '');

  for (const iff of iv.forms) {
    const bf = (bv.forms || []).find((f) => f.name === iff.name);
    if (!bf) { P('MISSING FORM', `${iv.name} / ${iff.name}`, ''); continue; }
    if (!!bf.repeating !== !!iff.repeating)
      P('REPEATING FLAG', `${iv.name} / ${iff.name}`, `ir ${!!iff.repeating}  built ${!!bf.repeating}`);

    const bFields = bf.fields || [];
    for (const bfl of bFields) {
      if (!iff.fields.some((f) => f.label === bfl.label)) P('EXTRA FIELD', `${iv.name} / ${iff.name} > ${bfl.label}`, '');
    }

    for (const [i, ifl] of iff.fields.entries()) {
      const where = `${iv.name} / ${iff.name} > ${ifl.label}`;
      const bfl = bFields.find((f) => f.label === ifl.label);
      if (!bfl) { P('MISSING FIELD', where, `type ${ifl.type}`); continue; }
      if (bfl.type !== ifl.type) P('WRONG TYPE', where, `ir ${ifl.type}  built ${bfl.type}`);
      if (!!bfl.required !== !!ifl.required) P('REQUIRED', where, `ir ${!!ifl.required}  built ${!!bfl.required}`);
      for (const k of ['min', 'max', 'units', 'formula']) {
        if (!same(ifl[k], bfl[k])) P(k.toUpperCase(), where, `ir ${JSON.stringify(norm(ifl[k]))}  built ${JSON.stringify(norm(bfl[k]))}`);
      }
      const io = ifl.options || [], bo = bfl.options || [];
      if (io.length !== bo.length) P('OPTION COUNT', where, `ir ${io.length}  built ${bo.length}`);
      else for (const [j, o] of io.entries()) {
        if (o.code !== bo[j].code || o.label !== bo[j].label)
          P('OPTION PAIR', where, `#${j} ir ${o.code}=${o.label}  built ${bo[j].code}=${bo[j].label}`);
      }
      const isl = ifl.skip_logic, bsl = bfl.skipLogic;
      if (isl && !bsl) P('MISSING SKIP LOGIC', where, `when ${isl.when_field_label} = ${isl.equals_value}`);
      else if (!isl && bsl) P('EXTRA SKIP LOGIC', where, JSON.stringify(bsl));
      else if (isl && bsl && (isl.when_field_label !== bsl.whenFieldLabel || String(isl.equals_value) !== String(bsl.equalsValue)))
        P('WRONG SKIP LOGIC', where, `ir "${isl.when_field_label}"="${isl.equals_value}"  built "${bsl.whenFieldLabel}"="${bsl.equalsValue}"`);

      const bIdx = bFields.findIndex((f) => f.label === ifl.label);
      if (bIdx !== i) P('FIELD ORDER', where, `ir #${i}  built #${bIdx}`);
    }
  }
}

const irFields = ir.visits.reduce((s, v) => s + v.forms.reduce((t, f) => t + f.fields.length, 0), 0);
const bFieldsTotal = (built.visits || []).reduce((s, v) => s + (v.forms || []).reduce((t, f) => t + (f.fields || []).length, 0), 0);
console.log(`platform: ${raw.platform || '(unknown)'}   spec: ${raw.specVersion || '-'}`);
console.log(`IR:    ${ir.visits.length} visits, ${ir.visits.reduce((s, v) => s + v.forms.length, 0)} forms, ${irFields} fields`);
console.log(`BUILT: ${(built.visits || []).length} visits, ${(built.visits || []).reduce((s, v) => s + (v.forms || []).length, 0)} forms, ${bFieldsTotal} fields`);
console.log('');

if (problems.length === 0) {
  console.log('*** 0 differences. The built study matches the input file. ***');
  process.exit(0);
}
const byKind = {};
for (const p of problems) (byKind[p.kind] ||= []).push(p);
console.log(`${problems.length} difference(s):\n`);
for (const [kind, list] of Object.entries(byKind)) {
  console.log(`${kind}  (${list.length})`);
  for (const p of list.slice(0, 25)) console.log(`   ${p.where}${p.detail ? '  --  ' + p.detail : ''}`);
  if (list.length > 25) console.log(`   ... and ${list.length - 25} more`);
  console.log('');
}
process.exit(1);
