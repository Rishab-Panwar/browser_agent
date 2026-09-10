/*
 * build.js — putting one field onto a form, and proving it landed.
 *
 * The order of operations here is not arbitrary. Type is chosen first and never
 * changed afterwards, because a designer that reshapes its configuration
 * surface under a type change quietly discards whatever the new shape cannot
 * hold: set a range and then switch to a text field, and the range is gone with
 * no error anywhere.
 *
 * Every setter reports what happened rather than that it was attempted, and the
 * caller counts only what read back. A field is "built" when the platform says
 * so, not when we say so.
 */

import { CAP, text } from './capabilities.js';
import { accessibleName, appeared, resolve, snapshot } from './perceive.js';
import { choose, press, revealHidden, setToggle, type } from './act.js';
import { best, rank, score as scoreWord } from './vocabulary.js';

/** Controls of one capability, ignoring anything disabled. */
const of = (doc, cap) => snapshot(doc).controls.filter((c) => c.cap === cap && !c.disabled);

/**
 * The input that names a field.
 *
 * Deliberately not "the first textbox that appeared": a designer that keeps its
 * options panel mounted between fields shows no new controls at all, and one
 * that rebuilds it shows a dozen. The label input is found by meaning, and the
 * values area is ruled out — a coded value's "Label" column is a label too, and
 * typing the field's name into it corrupts the list instead.
 */
export function labelInput(doc) {
  const boxes = of(doc, CAP.TEXT).filter((c) => !inValuesArea(c));
  const picked = best(boxes, 'label');
  return picked ? picked.control : null;
}

/**
 * Is this box part of a coded value row, rather than a property of the field?
 *
 * Decided by what sits beside it, not by what the surrounding panel is called.
 * "Options" means both "the coded choices" and "the settings for this thing",
 * and a designer that titles its properties panel "Options" would otherwise
 * make the field's own label look like a value's label — so the field never
 * gets named and nothing downstream works.
 *
 * A value row is small and holds a code beside its label. A properties panel is
 * large and holds no code at all, so widening past a handful of inputs settles
 * the question rather than confusing it.
 */
function inValuesArea(control) {
  const el = control.el;
  if (!el) return false;

  const boxesIn = (node) => (node ? [...node.querySelectorAll('input, textarea, [contenteditable]')] : []);
  const codeAmong = (boxes) =>
    boxes.some((other) => other !== el && scoreWord(accessibleName(other), 'code') > 0);

  // A code sharing this box's own container settles it.
  const parent = el.parentElement;
  const siblings = boxesIn(parent);
  if (siblings.length >= 2 && codeAmong(siblings)) return true;

  // Some designers wrap each cell, putting the pair one level further out. A
  // row holds exactly the two — anything wider is a panel that merely happens
  // to contain a coded list somewhere else in it.
  const grandparent = parent && parent.parentElement;
  const nearby = boxesIn(grandparent);
  return nearby.length === 2 && codeAmong(nearby);
}

/**
 * Put one field on the form.
 *
 * Returns a report rather than a boolean: which parts were set, which the
 * platform does not appear to offer, and which were attempted and did not take.
 * The difference matters — "this designer has no units control" is a fact about
 * the platform, while "units did not take" is a fact about this field.
 */
/** A thing you press to add something: a button, or an option in a catalogue. */
const isPickable = (control) =>
  control.cap === CAP.ACTION
  || (control.cap === CAP.OPTION && control.el && control.el.tagName !== 'OPTION');

export async function buildField(doc, field, platform, { log = () => {} } = {}) {
  const done = [];
  const missing = [];
  const failed = [];

  const mapping = platform.types[field.type];
  if (!mapping) return { ok: false, reason: `this platform has nothing that means ${field.type}`, missing: ['type'] };

  // 1. Type first, by pressing the library entry we proved means this type.
  //
  // Found the way calibration described it, not by assuming it is a button. A
  // catalogue rendered as a listbox offers options, and demanding a button here
  // makes every entry on such a platform unfindable — the library is located,
  // probed and understood, and then not one field can be added from it.
  const entry = resolve(doc, mapping.describe)
    || snapshot(doc).controls.find((c) => c.name === mapping.entry && isPickable(c));
  if (!entry) return { ok: false, reason: `library entry "${mapping.entry}" is not on this screen` };
  if (!(await press(doc, entry))) return { ok: false, reason: `could not press "${mapping.entry}"` };
  log('added', `${field.label} as "${mapping.entry}"`);
  done.push('type');

  // 2. Name it.
  const nameBox = labelInput(doc);
  if (!nameBox) return { ok: false, reason: 'no control on this screen names a field', missing: ['label'] };
  if (await type(doc, nameBox, field.label)) done.push('label');
  else failed.push('label');

  // 3. Required, only when the specification asks for it. A toggle that will
  //    not report its state is reported, not pressed hopefully.
  if (field.required) {
    const toggle = best(of(doc, CAP.TOGGLE), 'required');
    if (!toggle) missing.push('required');
    else {
      const result = await setToggle(doc, toggle.control, true);
      if (result.ok) done.push('required');
      else failed.push(`required (${result.reason})`);
    }
  }

  // 4. Range and units. One reading of the page serves all three: nothing here
  //    changes which controls exist, only what they hold.
  const propertyBoxes = of(doc, CAP.TEXT).filter((c) => !inValuesArea(c));
  for (const [key, concept] of [['min', 'minimum'], ['max', 'maximum'], ['units', 'units']]) {
    if (field[key] === undefined || field[key] === null || field[key] === '') continue;
    const box = best(propertyBoxes, concept);
    if (!box) { missing.push(key); continue; }
    if (await type(doc, box.control, field[key])) done.push(key);
    else failed.push(key);
  }

  // 5. Formula.
  if (field.formula) {
    const box = best(of(doc, CAP.TEXT), 'formula');
    if (!box) missing.push('formula');
    else if (await type(doc, box.control, field.formula)) done.push('formula');
    else failed.push('formula');
  }

  // 6. Coded values.
  if (field.options && field.options.length) {
    const result = await setOptions(doc, field.options, { log });
    if (result.ok) done.push('options');
    else if (result.missing) missing.push('options');
    else failed.push(`options (${result.reason})`);
  }

  return { ok: failed.length === 0, done, missing, failed };
}

/**
 * Enter a coded list, one row at a time.
 *
 * Row-by-row is preferred over any bulk box even when both exist. A bulk box
 * has an undocumented separator — `code=label` on one platform, a tab on the
 * next — and getting it wrong silently produces a list where every code is a
 * label. That failure is invisible on screen and wrong in the database, which
 * is the worst combination available.
 */
export async function setOptions(doc, options, { log = () => {} } = {}) {
  const addRow = best(of(doc, CAP.ACTION), 'addValue');
  if (!addRow) return { ok: false, missing: true, reason: 'no control adds a coded value' };

  for (const [index, option] of options.entries()) {
    const before = snapshot(doc);
    await press(doc, addRow.control);

    // What the press ADDED, by meaning rather than by object identity. A panel
    // that rebuilds itself hands back new elements for every row it already
    // had, and the second row's "Code" then ties with the first — leaving an
    // empty row behind and the rest of the list unentered.
    const fresh = appeared(before, snapshot(doc)).filter((c) => c.cap === CAP.TEXT);
    const pool = fresh.length ? fresh : of(doc, CAP.TEXT).filter(inValuesArea);

    const codeBox = best(pool, 'code');
    if (!codeBox) return { ok: false, reason: `row ${index + 1} has no input for a code` };

    // The label for THIS row, not the field's own label input. Both are called
    // "Label" on plenty of designers, so the name cannot separate them and a
    // tie would otherwise resolve to whichever came first — writing the value's
    // text over the field's name, or the reverse.
    const row = rowContaining(codeBox.control.el);
    const rowMates = pool.filter((c) => c.el !== codeBox.control.el && (!row || row.contains(c.el)));
    const labelBox = best(rowMates, 'optionLabel') || (rowMates.length === 1 ? { control: rowMates[0] } : null);
    if (!labelBox) {
      return { ok: false, reason: `row ${index + 1} has no input for a label beside its code` };
    }

    const codeOk = await type(doc, codeBox.control, option.code);
    const labelOk = await type(doc, labelBox.control, option.label);
    if (!codeOk || !labelOk) return { ok: false, reason: `row ${index + 1} did not accept its code and label` };
  }

  log('values', `${options.length} coded value(s) entered row by row`);
  return { ok: true };
}

/**
 * Make a field conditional on another field's answer.
 *
 * Run as a second pass over a form, after every field exists — a rule can point
 * at a field defined below it in the specification, and a controller that has
 * not been created yet is not offerable.
 */
export async function setDisplayRule(doc, rule, { log = () => {} } = {}) {
  const choosers = of(doc, CAP.CHOOSER);
  const modeChooser = best(choosers, 'visibility');
  if (!modeChooser) return { ok: false, missing: true, reason: 'no control makes a field conditional' };

  const conditional = await conditionalOption(doc, modeChooser.control);
  if (!conditional) return { ok: false, reason: 'the visibility control offers no conditional mode' };

  const modeSet = await choose(doc, modeChooser.control, conditional);
  if (!modeSet.ok) return { ok: false, reason: `could not set the mode: ${modeSet.reason}` };

  // The controlling-field chooser usually appears only once the mode is set.
  const after = of(doc, CAP.CHOOSER).filter((c) => c.el !== modeChooser.control.el);
  const fieldChooser = best(after, 'controllingField')
    || { control: after.find((c) => c.name !== modeChooser.control.name) };
  if (!fieldChooser || !fieldChooser.control) return { ok: false, reason: 'no control picks the controlling field' };

  const chosen = await choose(doc, fieldChooser.control, rule.when_field_label);
  if (!chosen.ok) {
    return { ok: false, reason: `"${rule.when_field_label}" was not offered`, offered: chosen.offered };
  }

  const valueBox = best(of(doc, CAP.TEXT), 'comparisonValue');
  if (!valueBox) return { ok: false, reason: 'no control holds the value to compare against' };
  if (!(await type(doc, valueBox.control, rule.equals_value))) {
    return { ok: false, reason: 'the comparison value did not take' };
  }

  log('rule', `shown when "${rule.when_field_label}" = "${rule.equals_value}"`);
  return { ok: true };
}

/** Whichever of a visibility chooser's options means "only sometimes". */
async function conditionalOption(doc, chooser) {
  const { offers } = await import('./perceive.js');
  const { settle } = await import('./act.js');
  const available = await offers(doc, chooser, { open: (node) => node.click(), settle: () => settle(doc) });
  const ranked = rank(available.map((o) => ({ name: o.text, context: [] })), 'conditionalMode');
  return ranked.length ? ranked[0].control.name : null;
}

/**
 * Read a field back off the platform and compare it with the specification.
 *
 * Anything the surface will not show is reported as unread, never as wrong: an
 * agent that cannot see a value has learned nothing about it, and saying
 * "mismatch" would send a reviewer to check a field that is perfectly fine.
 */
export function readField(doc, field) {
  const differences = [];
  const unread = [];

  const nameBox = labelInput(doc);
  if (!nameBox) unread.push('label');
  else if (text(nameBox.value) !== text(field.label)) {
    differences.push({ part: 'label', wanted: field.label, found: nameBox.value });
  }

  if (field.required) {
    const toggle = best(of(doc, CAP.TOGGLE), 'required');
    if (!toggle || toggle.control.state === undefined) unread.push('required');
    else if (toggle.control.state !== true) differences.push({ part: 'required', wanted: true, found: false });
  }

  for (const [key, concept] of [['min', 'minimum'], ['max', 'maximum'], ['units', 'units'], ['formula', 'formula']]) {
    if (field[key] === undefined || field[key] === null || field[key] === '') continue;
    const box = best(of(doc, CAP.TEXT).filter((c) => !inValuesArea(c)), concept);
    if (!box) { unread.push(key); continue; }
    if (!sameValue(box.control.value, field[key])) {
      differences.push({ part: key, wanted: field[key], found: box.control.value });
    }
  }

  return { differences, unread };
}

/** Platforms store numbers as strings; compare by value, not by type. */
function sameValue(found, wanted) {
  const a = text(found);
  const b = text(wanted);
  if (a === b) return true;
  const na = Number(a);
  const nb = Number(b);
  return !Number.isNaN(na) && !Number.isNaN(nb) && na === nb;
}

export { revealHidden };

/**
 * The smallest container that holds this box and its companions.
 *
 * A coded value is entered as a small group — a code and its label, sometimes a
 * remove button. Finding that group is how the agent tells one row's inputs
 * from the next row's, and from the field's own properties.
 */
function rowContaining(el) {
  let node = el && el.parentElement;
  for (let up = 0; up < 4 && node; up++) {
    const boxes = node.querySelectorAll('input, textarea, [contenteditable]');
    if (boxes.length >= 2 && boxes.length <= 4) return node;
    if (boxes.length > 4) return null;
    node = node.parentElement;
  }
  return null;
}
