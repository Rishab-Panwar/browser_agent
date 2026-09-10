/*
 * Acting on controls, whatever they are made of.
 *
 * Every test states an outcome on the page, not a call that was made. An agent
 * that counts attempts instead of results is how a study reports 195 fields
 * built and holds 175.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

import { CAP, toggleState, displayedValue } from '../src/capabilities.js';
import { snapshot } from '../src/perceive.js';
import { choose, press, revealHidden, setToggle, type } from '../src/act.js';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'fixtures', 'widgets.html'), 'utf8');

function page() {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  const win = dom.window;
  win.Element.prototype.getBoundingClientRect = () =>
    ({ width: 120, height: 24, top: 0, left: 0, right: 120, bottom: 24, x: 0, y: 0, toJSON() {} });
  win.Element.prototype.scrollIntoView = function () {};
  if (!win.PointerEvent) win.PointerEvent = win.MouseEvent; // jsdom has no PointerEvent
  if (!win.performance) win.performance = { now: () => Date.now() };
  globalThis.performance = globalThis.performance || win.performance;
  globalThis.MessageChannel = globalThis.MessageChannel || win.MessageChannel;
  globalThis.MutationObserver = win.MutationObserver;
  return win.document;
}

const pick = (doc, cap, name, extra = () => true) =>
  snapshot(doc).controls.filter((c) => c.cap === cap && c.name === name).find(extra);

// ── toggles ──────────────────────────────────────────────────────────────────

test('a switch already in the wanted state is left alone', async () => {
  const doc = page();
  const sw = pick(doc, CAP.TOGGLE, 'Mandatory', (c) => c.el.getAttribute('role') === 'switch');
  const result = await setToggle(doc, sw, true);
  assert.equal(result.ok, true);
  assert.equal(result.changed, false, 'pressing an already-on switch turns it off — the wrong direction of wrong');
  assert.equal(toggleState(doc.querySelector('[role="switch"]')), true);
});

test('a native checkbox and a switch are both set the same way', async () => {
  const doc = page();
  for (const control of snapshot(doc).controls.filter((c) => c.cap === CAP.TOGGLE && c.name === 'Mandatory')) {
    const result = await setToggle(doc, control, false);
    assert.equal(result.ok, true, 'both realisations accept the same instruction');
  }
  assert.equal(doc.getElementById('req-native').checked, false);
  assert.equal(doc.querySelector('[role="switch"]').getAttribute('aria-checked'), 'false');
});

test('a control that will not say its state is reported, never assumed', async () => {
  const doc = page();
  const mute = doc.createElement('button');
  mute.setAttribute('role', 'switch');
  mute.setAttribute('aria-label', 'Unknowable');
  doc.body.append(mute);
  const control = pick(doc, CAP.TOGGLE, 'Unknowable');
  const result = await setToggle(doc, control, true);
  assert.equal(result.ok, false);
  assert.match(result.reason, /does not report/);
});

// ── choosers ─────────────────────────────────────────────────────────────────

test('choosing by visible text works on a native select', async () => {
  const doc = page();
  const native = pick(doc, CAP.CHOOSER, 'Element Kind', (c) => c.el.tagName === 'SELECT');
  const result = await choose(doc, native, 'Pick One');
  assert.equal(result.ok, true);
  assert.equal(displayedValue(doc.getElementById('kind-native')), 'Pick One');
});

test('choosing by visible text works on a widget that renders options only when open', async () => {
  const doc = page();
  const combo = pick(doc, CAP.CHOOSER, 'Element Kind', (c) => c.el.tagName !== 'SELECT');
  const result = await choose(doc, combo, 'Free Text');
  assert.equal(result.ok, true, result.reason);
  assert.equal(displayedValue(doc.getElementById('kind-combo')), 'Free Text');
});

test('a value the chooser does not offer is refused with what it did offer', async () => {
  const doc = page();
  const combo = pick(doc, CAP.CHOOSER, 'Element Kind', (c) => c.el.tagName !== 'SELECT');
  const result = await choose(doc, combo, 'Moment Picker');
  assert.equal(result.ok, false);
  assert.deepEqual(result.offered, ['Free Text', 'Number', 'Pick One'],
    'the evidence a human needs is what was actually available');
});

// ── text ─────────────────────────────────────────────────────────────────────

test('typing is confirmed by reading the field back', async () => {
  const doc = page();
  const input = doc.createElement('input');
  input.type = 'text';
  input.id = 'q-text';
  const label = doc.createElement('label');
  label.setAttribute('for', 'q-text');
  label.textContent = 'Question Text';
  doc.body.append(label, input);

  const control = pick(doc, CAP.TEXT, 'Question Text');
  assert.equal(await type(doc, control, 'Subject Initials'), true);
  assert.equal(doc.getElementById('q-text').value, 'Subject Initials');
});

test('a field that refuses what was typed reports failure rather than success', async () => {
  const doc = page();
  const input = doc.createElement('input');
  input.type = 'text';
  input.id = 'q-stubborn';
  input.addEventListener('input', () => { input.value = ''; }); // a field that rejects everything
  const label = doc.createElement('label');
  label.setAttribute('for', 'q-stubborn');
  label.textContent = 'Stubborn';
  doc.body.append(label, input);

  const control = pick(doc, CAP.TEXT, 'Stubborn');
  assert.equal(await type(doc, control, 'anything'), false);
});

// ── disclosures ──────────────────────────────────────────────────────────────

test('opening the doors reveals a commit control that scoring alone could never find', async () => {
  const doc = page();
  const hiddenAtFirst = snapshot(doc).controls.some((c) => c.name === 'Commit Changes');
  assert.equal(hiddenAtFirst, false);

  const revealed = await revealHidden(doc);
  assert.ok(revealed.some((c) => c.name === 'Commit Changes'),
    'absence is only ever provable after looking behind what admits to hiding things');
});

// ── re-resolution ────────────────────────────────────────────────────────────

test('an action still lands after the control it targets has been re-rendered', async () => {
  const doc = page();
  const combo = pick(doc, CAP.CHOOSER, 'Element Kind', (c) => c.el.tagName !== 'SELECT');
  const held = combo.el;

  await choose(doc, combo, 'Free Text'); // the widget rebuilds itself here
  assert.equal(held.isConnected, true, 'this fixture reuses its node; a stricter one would not');

  const again = await choose(doc, combo, 'Pick One');
  assert.equal(again.ok, true, again.reason);
  assert.equal(displayedValue(doc.getElementById('kind-combo')), 'Pick One');
});

test('pressing a control that has left the page fails instead of throwing', async () => {
  const doc = page();
  const control = pick(doc, CAP.ACTION, 'Participants');
  control.el.remove();
  assert.equal(await press(doc, control), false);
});
