/*
 * Building a field, and being honest about what landed.
 *
 * The designer below answers to meaning rather than to any particular wording,
 * and includes the two traps that matter: a coded value's own "Label" column
 * next to the field's label input, and a bulk box beside the row-by-row editor.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { buildField, labelInput, readField, setOptions } from '../src/build.js';
import { snapshot } from '../src/perceive.js';
import { CAP } from '../src/capabilities.js';

const DESIGNER = `<!doctype html><meta charset="utf-8">
<section>
  <h2>Question Setup</h2>
  <div><label for="q-label">Question Text</label><input id="q-label" type="text"></div>
  <div><button type="button" role="switch" aria-checked="false" aria-label="Mandatory"></button></div>
  <div><label for="q-min">Lowest Accepted</label><input id="q-min" type="text"></div>
  <div><label for="q-max">Highest Accepted</label><input id="q-max" type="text"></div>
  <div><label for="q-units">Unit of Measure</label><input id="q-units" type="text"></div>
  <div><label for="q-formula">Expression</label><input id="q-formula" type="text"></div>

  <fieldset id="answers">
    <legend>Answers</legend>
    <div id="rows"></div>
    <button type="button" id="add-answer">Add Answer</button>
    <label for="bulk">Bulk Load</label><textarea id="bulk"></textarea>
    <button type="button">Apply Bulk Load</button>
  </fieldset>
</section>

<aside><h2>Question Palette</h2>
  <ul>
    <li><button type="button">Short Answer</button></li>
    <li><button type="button">Tally Counter</button></li>
    <li><button type="button">Pick Several</button></li>
  </ul>
</aside>

<script>
  let row = 0;
  document.getElementById('add-answer').addEventListener('click', () => {
    const id = 'r' + (row++);
    const wrap = document.createElement('div');
    wrap.innerHTML =
      '<label for="' + id + 'c">Stored Code</label><input id="' + id + 'c" type="text">' +
      '<label for="' + id + 'l">Shown Text</label><input id="' + id + 'l" type="text">';
    document.getElementById('rows').append(wrap);
  });
  for (const sw of document.querySelectorAll('[role="switch"]')) {
    sw.addEventListener('click', () =>
      sw.setAttribute('aria-checked', sw.getAttribute('aria-checked') === 'true' ? 'false' : 'true'));
  }
</script>`;

function page(html = DESIGNER) {
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

const platform = {
  types: {
    text: { entry: 'Short Answer' },
    integer: { entry: 'Tally Counter' },
    multi_select: { entry: 'Pick Several' },
  },
};

test('the field label input is not confused with a coded value label', async () => {
  const doc = page();
  doc.getElementById('add-answer').click(); // a "Shown Text" column now exists too
  const box = labelInput(doc);
  assert.equal(box.el.id, 'q-label', 'typing the field name into a value row corrupts the list instead');
});

test('a field is built with every part the specification asks for', async () => {
  const doc = page();
  const report = await buildField(doc, {
    label: 'Systolic Blood Pressure', type: 'integer', required: true,
    min: 60, max: 250, units: 'mmHg',
  }, platform);

  assert.equal(report.ok, true, JSON.stringify(report));
  assert.deepEqual(report.failed, []);
  assert.equal(doc.getElementById('q-label').value, 'Systolic Blood Pressure');
  assert.equal(doc.querySelector('[role="switch"]').getAttribute('aria-checked'), 'true');
  assert.equal(doc.getElementById('q-min').value, '60');
  assert.equal(doc.getElementById('q-max').value, '250');
  assert.equal(doc.getElementById('q-units').value, 'mmHg');
});

test('coded values are entered row by row, with codes and labels kept apart', async () => {
  const doc = page();
  const result = await setOptions(doc, [
    { code: 'WH', label: 'White' },
    { code: 'BL', label: 'Black or African American' },
  ]);
  assert.equal(result.ok, true, result.reason);

  const values = [...doc.querySelectorAll('#rows input')].map((i) => i.value);
  assert.deepEqual(values, ['WH', 'White', 'BL', 'Black or African American'],
    'a list where every code equals its label looks right on screen and is wrong in the database');
});

test('a part the designer does not offer is reported missing, not failed', async () => {
  const doc = page(DESIGNER.replace(/<div><label for="q-units".*?<\/div>/s, ''));
  const report = await buildField(doc, {
    label: 'Heart Rate', type: 'integer', required: false, min: 30, max: 220, units: 'bpm',
  }, platform);

  assert.ok(report.missing.includes('units'), 'the platform has no units control — that is not this field failing');
  assert.deepEqual(report.failed, []);
});

test('a type this platform has no entry for is refused before anything is pressed', async () => {
  const doc = page();
  const report = await buildField(doc, { label: 'Onset', type: 'datetime' }, platform);
  assert.equal(report.ok, false);
  assert.match(report.reason, /nothing that means datetime/);
});

// ── reading back ─────────────────────────────────────────────────────────────

test('a field that was built correctly reads back with no differences', async () => {
  const doc = page();
  const field = { label: 'Heart Rate', type: 'integer', required: true, min: 30, max: 220, units: 'bpm' };
  await buildField(doc, field, platform);

  const { differences, unread } = readField(doc, field);
  assert.deepEqual(differences, []);
  assert.deepEqual(unread, []);
});

test('a value the platform quietly changed is reported as a difference', async () => {
  const doc = page();
  const field = { label: 'Heart Rate', type: 'integer', min: 30, max: 220 };
  await buildField(doc, field, platform);
  doc.getElementById('q-max').value = '999'; // the platform "helpfully" rewrote it

  const { differences } = readField(doc, field);
  assert.equal(differences.length, 1);
  assert.equal(differences[0].part, 'max');
  assert.equal(differences[0].found, '999');
});

test('a part that cannot be seen is reported unread, never as a mismatch', async () => {
  const doc = page(DESIGNER.replace(/<div><label for="q-units".*?<\/div>/s, ''));
  const { differences, unread } = readField(doc, { label: 'X', type: 'integer', units: 'bpm' });
  assert.ok(unread.includes('units'));
  assert.equal(differences.some((d) => d.part === 'units'), false,
    'calling an unreadable value wrong sends a reviewer to check a field that is fine');
});

test('numbers stored as strings are not reported as differences', async () => {
  const doc = page();
  const field = { label: 'Heart Rate', type: 'integer', min: 30 };
  await buildField(doc, field, platform);
  const { differences } = readField(doc, field);
  assert.deepEqual(differences, [], '"30" and 30 are the same number');
});

test('a properties panel titled "Options" does not hide the field label input', () => {
  // Observed on a real mock: the panel heading collided with the word for coded
  // choices, the label input was ruled out as part of a value row, and nothing
  // downstream could name a field.
  const doc = page(`<!doctype html><section><h2>Options</h2>
    <div><label for="lab">Label</label><input id="lab" type="text"></div>
    <div><label for="mn">Minimum</label><input id="mn" type="text"></div>
    <div><label for="mx">Maximum</label><input id="mx" type="text"></div>
    <div><label for="un">Units</label><input id="un" type="text"></div>
    <div><label for="dp">Decimal Places</label><input id="dp" type="text"></div>
  </section>`);
  const box = labelInput(doc);
  assert.ok(box, 'a panel called Options is settings, not a coded value row');
  assert.equal(box.el.id, 'lab');
});

test('inside a real value row, the label column is still ruled out', () => {
  const doc = page(`<!doctype html><section><h2>Options</h2>
    <div><label for="lab">Label</label><input id="lab" type="text"></div>
    <fieldset><legend>Values</legend>
      <div><label for="c0">Code</label><input id="c0" type="text">
           <label for="l0">Label</label><input id="l0" type="text"></div>
    </fieldset>
  </section>`);
  const box = labelInput(doc);
  assert.equal(box.el.id, 'lab', 'a code sitting beside it is what makes a label a value label');
});

test('a designer that rebuilds its panel still gets every coded value', async () => {
  // The row-adding control replaces the whole panel each time, so every earlier
  // row comes back as new elements. Observed on a real mock: two rows entered,
  // one of them empty, and the rest of the list silently dropped.
  const doc = page(`<!doctype html><section><h2>Options</h2>
    <div><label for="lab">Label</label><input id="lab" type="text"></div>
    <fieldset><legend>Values</legend><div id="rows"></div>
      <button type="button" id="add">Add Value</button></fieldset>
  </section>
  <script>
    // Rebuilds every row on each add — but keeps what was entered, the way a
    // designer backed by state does.
    const rows = [];
    function paint() {
      document.getElementById('rows').innerHTML = rows.map((r, i) =>
        '<div><label for="c' + i + '">Code</label><input id="c' + i + '" type="text" value="' + r.code + '">' +
        '<label for="l' + i + '">Label</label><input id="l' + i + '" type="text" value="' + r.label + '"></div>').join('');
      for (const [i, row] of rows.entries()) {
        document.getElementById('c' + i).addEventListener('input', (e) => { row.code = e.target.value; });
        document.getElementById('l' + i).addEventListener('input', (e) => { row.label = e.target.value; });
      }
    }
    document.getElementById('add').addEventListener('click', () => { rows.push({ code: '', label: '' }); paint(); });
  </script>`);

  const result = await setOptions(doc, [
    { code: 'HL', label: 'Hispanic or Latino' },
    { code: 'NHL', label: 'Not Hispanic or Latino' },
    { code: 'NR', label: 'Not Reported' },
  ]);

  assert.equal(result.ok, true, result.reason);
  const values = [...doc.querySelectorAll('#rows input')].map((i) => i.value);
  assert.deepEqual(values, ['HL', 'Hispanic or Latino', 'NHL', 'Not Hispanic or Latino', 'NR', 'Not Reported']);
});
