/*
 * Widget equivalence.
 *
 * Each test asserts that two controls built differently but MEANING the same
 * are perceived the same. Every assertion here corresponds to a defect observed
 * in a real agent on a real platform, not to a hypothetical.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

import { CAP, toggleState, isDisclosure, displayedValue, text } from '../src/capabilities.js';
import { snapshot, offers, groups, describe, resolve, accessibleName, appeared } from '../src/perceive.js';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'fixtures', 'widgets.html'), 'utf8');

function page() {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  // jsdom gives every element a zero-sized box, which our visibility test would
  // read as "not rendered". Give them a size; hidden elements stay hidden
  // through display/visibility, which jsdom does compute.
  dom.window.Element.prototype.getBoundingClientRect = function () {
    return { width: 120, height: 24, top: 0, left: 0, right: 120, bottom: 24, x: 0, y: 0, toJSON() {} };
  };
  return dom.window.document;
}

const byName = (snap, cap, name) => snap.controls.filter((c) => c.cap === cap && c.name === name);

// ── toggles ──────────────────────────────────────────────────────────────────

test('a native checkbox and a role=switch are both toggles', () => {
  const doc = page();
  const snap = snapshot(doc);
  const toggles = byName(snap, CAP.TOGGLE, 'Mandatory');
  assert.equal(toggles.length, 2, 'both realisations should be seen, and seen as the same thing');
  for (const t of toggles) assert.equal(t.state, true, 'both report their state as on');
});

test('a toggle button reports through aria-pressed', () => {
  const doc = page();
  const [hidden] = byName(snapshot(doc), CAP.TOGGLE, 'Hidden');
  assert.ok(hidden, 'aria-pressed marks a two-state control');
  assert.equal(hidden.state, false);
});

test('a control that does not say its state answers undefined, never false', () => {
  const doc = page();
  const mute = doc.createElement('button');
  mute.setAttribute('role', 'switch');
  assert.equal(toggleState(mute), undefined,
    '"could not tell" must be distinguishable from "off", or a set is skipped silently');
});

// ── choosers ─────────────────────────────────────────────────────────────────

test('a native select and a custom combobox are both choosers showing the same value', () => {
  const doc = page();
  const snap = snapshot(doc);
  const choosers = byName(snap, CAP.CHOOSER, 'Element Kind');
  assert.equal(choosers.length, 2);
  for (const c of choosers) assert.equal(displayedValue(c.el), 'Number');
});

test('a native select offers its options without being touched', async () => {
  const doc = page();
  const native = byName(snapshot(doc), CAP.CHOOSER, 'Element Kind').find((c) => c.el.tagName === 'SELECT');
  const options = await offers(doc, native);
  assert.deepEqual(options.map((o) => o.text), ['Free Text', 'Number', 'Pick One']);
});

test('a closed custom combobox offers nothing until it is opened, then the same options', async () => {
  const doc = page();
  const combo = byName(snapshot(doc), CAP.CHOOSER, 'Element Kind').find((c) => c.el.tagName !== 'SELECT');

  const withoutTouching = await offers(doc, combo);
  assert.deepEqual(withoutTouching, [], 'a closed chooser genuinely shows nothing — say so rather than guess');

  const opened = await offers(doc, combo, { open: (el) => el.click() });
  assert.deepEqual(opened.map((o) => o.text), ['Free Text', 'Number', 'Pick One']);
});

test('reading a chooser leaves it closed, so the next one is not answered by this one', async () => {
  const doc = page();
  const combo = byName(snapshot(doc), CAP.CHOOSER, 'Element Kind').find((c) => c.el.tagName !== 'SELECT');
  await offers(doc, combo, { open: (el) => el.click() });
  const live = doc.getElementById('kind-combo');
  assert.equal(live.getAttribute('aria-expanded'), 'false', 'a listbox left open answers for every later question');
});

// ── grouping ─────────────────────────────────────────────────────────────────

test('a palette is found whether its entries are siblings or each wrapped', () => {
  const doc = page();
  const found = groups(snapshot(doc));
  const flat = found.find((g) => g.container.id === 'palette-flat');
  const wrapped = found.find((g) => g.container.id === 'palette-wrapped');
  assert.ok(flat, 'sibling entries');
  assert.ok(wrapped, 'entries wrapped one level deeper — the same palette');
  assert.equal(flat.members.length, 5);
  assert.equal(wrapped.members.length, 5);
});

test('a smaller decoy cluster does not hide a larger real one', () => {
  const doc = page();
  const found = groups(snapshot(doc));
  assert.ok(found.find((g) => g.container.id === 'decoy'), 'the decoy is a group too — that is fine');
  const sizes = found.map((g) => g.members.length);
  assert.ok(Math.max(...sizes) >= 5, 'every level is offered, so scoring can prefer the real palette');
});

// ── disclosures ──────────────────────────────────────────────────────────────

test('an overflow control is recognised as hiding something', () => {
  const doc = page();
  const more = snapshot(doc).controls.find((c) => c.name === 'More actions');
  assert.ok(more, 'the overflow button is perceived');
  assert.equal(more.opensSomething, true);
});

test('a commit control hidden behind a disclosure is invisible until it is opened', () => {
  const doc = page();
  const hiddenBefore = snapshot(doc).controls.some((c) => c.name === 'Commit Changes');
  assert.equal(hiddenBefore, false, 'not in the DOM at all — no amount of scoring finds it');

  doc.querySelector('#toolbar-overflow button').click();
  const nowVisible = snapshot(doc).controls.some((c) => c.name === 'Commit Changes');
  assert.equal(nowVisible, true, 'absence must be proven by looking, not assumed');
});

test('a disclosure already open is not treated as something still to open', () => {
  const doc = page();
  const more = doc.querySelector('#toolbar-overflow button');
  more.click();
  assert.equal(isDisclosure(more, 'More actions'), false);
});

// ── record lists ─────────────────────────────────────────────────────────────

test('records are found whether they are table rows or cards', () => {
  const doc = page();
  const snap = snapshot(doc);
  const screening = snap.controls.filter((c) => c.name === 'Screening');
  assert.equal(screening.length, 2, 'a row and a card are both a record you can open');
});

// ── re-resolution ────────────────────────────────────────────────────────────

test('a control is found again after the widget that held it re-rendered', async () => {
  const doc = page();
  const combo = byName(snapshot(doc), CAP.CHOOSER, 'Element Kind').find((c) => c.el.tagName !== 'SELECT');
  const desc = describe(combo, snapshot(doc));

  await offers(doc, combo, { open: (el) => el.click() }); // re-renders the widget
  const again = resolve(doc, desc);
  assert.ok(again, 'the description survives what the node reference does not');
  assert.equal(again.name, 'Element Kind');
});

// ── coercion ─────────────────────────────────────────────────────────────────

test('a value that is not a string does not end the run', () => {
  assert.equal(text(42), '42');
  assert.equal(text(true), 'true');
  assert.equal(text(null), '');
  assert.equal(text(undefined), '');
});

test('a textbox is named by its label, never by the data a user typed into it', () => {
  const doc = page();
  const input = doc.createElement('input');
  input.type = 'text';
  input.id = 'subject-initials';
  input.value = 'ABC';
  const label = doc.createElement('label');
  label.setAttribute('for', 'subject-initials');
  label.textContent = 'Subject Initials';
  doc.body.append(label, input);
  assert.equal(accessibleName(input), 'Subject Initials');
});

test('a page that rebuilds itself does not report every control as new', () => {
  const doc = page();
  const before = snapshot(doc);

  // What a framework does on any state change: same screen, all-new elements.
  doc.body.innerHTML = doc.body.innerHTML;

  const after = snapshot(doc);
  assert.equal(appeared(before, after).length, 0,
    'an identity diff would call the whole screen new, and every probe would then look identical');
});

test('something genuinely added is still seen after a rebuild', () => {
  const doc = page();
  const before = snapshot(doc);

  doc.body.innerHTML = doc.body.innerHTML;
  const extra = doc.createElement('button');
  extra.textContent = 'Decimal Places';
  doc.body.append(extra);

  const fresh = appeared(before, snapshot(doc));
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].name, 'Decimal Places');
});

test('a second control identical to an existing one counts as an addition', () => {
  const doc = page();
  const before = snapshot(doc);
  const twin = doc.createElement('button');
  twin.textContent = 'Free Text';
  doc.body.append(twin);

  const fresh = appeared(before, snapshot(doc));
  assert.equal(fresh.length, 1, 'counted as a multiset, so a duplicate row is not swallowed');
});
