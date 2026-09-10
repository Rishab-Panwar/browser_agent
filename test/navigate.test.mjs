/*
 * Knowing where you are.
 *
 * Both assertions here come from the first end-to-end run against a real mock:
 * a document whose name is plain text was reported missing right after being
 * created, and an empty designer was reported unreachable while the agent was
 * standing in it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { alreadyListed, inDesigner } from '../src/navigate.js';
import { findPalette } from '../src/calibrate.js';

function page(html) {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  const win = dom.window;
  win.Element.prototype.getBoundingClientRect = () =>
    ({ width: 120, height: 24, top: 0, left: 0, right: 120, bottom: 24, x: 0, y: 0, toJSON() {} });
  win.Element.prototype.scrollIntoView = function () {};
  if (!win.PointerEvent) win.PointerEvent = win.MouseEvent;
  globalThis.performance = globalThis.performance || win.performance;
  globalThis.MutationObserver = win.MutationObserver;
  return win.document;
}

test('a record is found whether its name is a link or plain text', () => {
  const doc = page(`<!doctype html><table><tbody>
    <tr><td><button type="button">Screening</button></td><td>-28 to -1</td></tr>
    <tr><td>Demographics</td><td>Draft</td><td><button type="button">Edit</button></td></tr>
  </tbody></table>`);

  assert.equal(alreadyListed(doc, 'Screening'), true, 'a clickable name');
  assert.equal(alreadyListed(doc, 'Demographics'), true,
    'a name the platform chose not to make clickable is still a record that exists');
  assert.equal(alreadyListed(doc, 'Vital Signs'), false, 'and something absent is still absent');
});

test('a name buried inside a sentence is not a record', () => {
  const doc = page('<!doctype html><p>No documents yet. Add Demographics to begin.</p>');
  assert.equal(alreadyListed(doc, 'Demographics'), false);
});

const DESIGNER = (canvas) => `<!doctype html>
  <div><button type="button">← Screening</button>
       <button type="button">Preview</button>
       <button type="button">Save</button></div>
  <aside><h2>Elements</h2><ul>
    <li><button type="button">Single Line Textbox</button></li>
    <li><button type="button">Number (Whole)</button></li>
    <li><button type="button">Date</button></li>
    <li><button type="button">Dropdown</button></li>
    <li><button type="button">Checkbox</button></li>
  </ul></aside>
  <section><h2>Options</h2>${canvas}</section>`;

test('an empty designer is recognised before anything has been added to it', () => {
  const doc = page(DESIGNER('<p>Select an element on the canvas to edit its options.</p>'));
  assert.equal(inDesigner(doc, { hasPalette: (d) => findPalette(d) }), true,
    'no field exists yet, so there is nothing to name — that is not the same as not being here');
});

test('a designer with a field selected is still recognised', () => {
  const doc = page(DESIGNER('<label for="l">Label</label><input id="l" type="text" value="Subject Initials">'));
  assert.equal(inDesigner(doc, { hasPalette: (d) => findPalette(d) }), true);
});

test('a list of records is not mistaken for a designer', () => {
  const doc = page(`<!doctype html><h2>Source Documents</h2>
    <table><tbody>
      <tr><td>Demographics</td><td><button type="button">Edit</button></td></tr>
      <tr><td>Vital Signs</td><td><button type="button">Edit</button></td></tr>
    </tbody></table>
    <button type="button">+ New Source Document</button>`);
  assert.equal(inDesigner(doc, { hasPalette: (d) => findPalette(d) }), false);
});

// ── leaving ──────────────────────────────────────────────────────────────────

const WITH_EXIT = (exit) => `<!doctype html>
  <div>${exit}<button type="button">Save</button></div>
  <aside><h2>Elements</h2><ul>
    <li><button type="button">Single Line Textbox</button></li>
    <li><button type="button">Number (Whole)</button></li>
    <li><button type="button">Date</button></li>
    <li><button type="button">Dropdown</button></li>
    <li><button type="button">Checkbox</button></li>
  </ul></aside>
  <script>
    for (const b of document.querySelectorAll('div button')) {
      b.addEventListener('click', () => { if (b.dataset.exit) document.querySelector('aside').remove(); });
    }
  </script>`;

const leaves = async (exitHtml, towards) => {
  const doc = page(WITH_EXIT(exitHtml));
  const { leaveDesigner } = await import('../src/navigate.js');
  return leaveDesigner(doc, { hasPalette: (d) => findPalette(d), towards });
};

test('a breadcrumb named after where it goes is recognised as the way out', async () => {
  const result = await leaves('<button type="button" data-exit="1">← Screening</button>', 'Screening');
  assert.equal(result.ok, true, 'a back control is frequently named after its destination, not "back"');
});

test('an arrow marks the way out even when the destination is unknown', async () => {
  const result = await leaves('<button type="button" data-exit="1">← Some Visit</button>', '');
  assert.equal(result.ok, true);
});

test('a control that plainly says back still works', async () => {
  const result = await leaves('<button type="button" data-exit="1">Back to Timeline</button>', '');
  assert.equal(result.ok, true);
});

test('a designer with no way out says so rather than looping', async () => {
  const result = await leaves('', '');
  assert.equal(result.ok, false);
  assert.match(result.reason, /led out/);
});

// ── things that are not controls ─────────────────────────────────────────────

test('a field painted on a canvas is found by the text it shows', async () => {
  const { elementsShowing } = await import('../src/navigate.js');
  // No role, no tabindex, no href — a real designer's canvas card.
  const doc = page(`<!doctype html><div class="card" onclick="void 0">
    <span class="label">Subject Initials *</span><span class="meta">Single Line Textbox</span></div>`);

  const found = elementsShowing(doc, 'Subject Initials');
  assert.equal(found.length, 1, 'invisible to a control search, and still the thing to click');
  assert.equal(found[0].textContent, 'Subject Initials *');
});

test('pressing a bare element reaches the handler on its ancestor', async () => {
  const { pressElement } = await import('../src/act.js');
  const { elementsShowing } = await import('../src/navigate.js');
  const doc = page(`<!doctype html><div id="card"><span id="lab">Race</span></div>
    <script>document.getElementById('card').addEventListener('click', () => {
      document.getElementById('card').setAttribute('data-selected', 'yes'); });</script>`);

  await pressElement(doc, elementsShowing(doc, 'Race')[0]);
  assert.equal(doc.getElementById('card').getAttribute('data-selected'), 'yes',
    'the handler is on the card; clicking the label bubbles up to it');
});

test('a name inside a longer sentence is not a field', async () => {
  const { elementsShowing } = await import('../src/navigate.js');
  const doc = page('<!doctype html><p>Race and Ethnicity are collected at Screening.</p>');
  assert.deepEqual(await elementsShowing(doc, 'Race'), []);
});

// ── scoping to a record's own row ────────────────────────────────────────────

const LIST = `<!doctype html><h2>Source Documents</h2>
<table><tbody>
  <tr><td>Demographics</td><td>Draft</td>
      <td><button type="button">Edit</button><button type="button">Activate</button></td></tr>
  <tr><td>Vital Signs</td><td>Draft</td>
      <td><button type="button">Edit</button><button type="button">Activate</button></td></tr>
</tbody></table>`;

test('a record\'s own controls are found, not the first ones on the page', async () => {
  const { controlsBeside } = await import('../src/navigate.js');
  const doc = page(LIST);

  const first = controlsBeside(doc, 'Demographics');
  const second = controlsBeside(doc, 'Vital Signs');
  assert.equal(first.length, 2);
  assert.equal(second.length, 2);
  assert.notEqual(first[0].el, second[0].el,
    'every row offers the same buttons; taking the first designs record one over and over');
});

test('the same scoping works when records are cards rather than rows', async () => {
  const { controlsBeside } = await import('../src/navigate.js');
  const doc = page(`<!doctype html>
    <div><h3>Screening</h3><p>-28 to -1</p><button type="button">Open</button></div>
    <div><h3>Baseline</h3><p>0 to 0</p><button type="button">Open</button></div>`);

  const baseline = controlsBeside(doc, 'Baseline');
  assert.equal(baseline.length, 1);
  assert.equal(baseline[0].context.includes('Baseline'), true);
});

test('a name that is nowhere gives no controls rather than the page\'s', async () => {
  const { controlsBeside } = await import('../src/navigate.js');
  assert.deepEqual(controlsBeside(page(LIST), 'Nothing Like This'), []);
});
