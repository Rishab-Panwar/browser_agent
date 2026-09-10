/*
 * Learning a platform by experiment.
 *
 * The fixture below is deliberately hostile in the two ways that matter: its
 * library entries are named nothing like the canonical types, and its toolbar
 * offers three controls that read like "save" of which one actually saves.
 * An agent that reads names gets both wrong.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { findPalette, learnTypes, learnCommit, commitCandidates } from '../src/calibrate.js';
import { snapshot } from '../src/perceive.js';
import { CAP } from '../src/capabilities.js';

/**
 * A designer whose vocabulary shares nothing with the canonical type names.
 * Pressing an entry reveals the configuration surface that type would need —
 * which is the only honest signal about what the entry means.
 */
const DESIGNER = `<!doctype html><meta charset="utf-8">
<main>
  <h2>Question Setup</h2>
  <div id="config"></div>
</main>
<aside>
  <h2>Question Palette</h2>
  <ul id="palette">
    <li><button type="button">Short Answer</button></li>
    <li><button type="button">Long Answer</button></li>
    <li><button type="button">Tally Counter</button></li>
    <li><button type="button">Measurement</button></li>
    <li><button type="button">Pick Several</button></li>
    <li><button type="button">Single Tick</button></li>
    <li><button type="button">Moment Picker</button></li>
    <li><button type="button">Computed Value</button></li>
    <li><button type="button">Import From Library…</button></li>
  </ul>
</aside>
<nav>
  <button type="button">Participants</button>
  <button type="button">Queries</button>
  <button type="button">Exports</button>
  <button type="button">Study Setup</button>
</nav>
<script>
  const config = document.getElementById('config');
  const SURFACES = {
    'Short Answer':    ['label', 'text'],
    'Long Answer':     ['label', 'textarea'],
    'Tally Counter':   ['label', 'range'],
    'Measurement':     ['label', 'range', 'decimals'],
    'Pick Several':    ['label', 'values'],
    'Single Tick':     ['label', 'tick'],
    'Moment Picker':   ['label', 'datetime'],
    'Computed Value':  ['label', 'formula'],
  };
  const build = {
    label: () => field('Question Text', '<input type="text">'),
    text: () => field('Preview', '<input type="text">'),
    textarea: () => field('Preview', '<textarea></textarea>'),
    range: () => field('Lowest Accepted', '<input type="text">') + field('Highest Accepted', '<input type="text">'),
    decimals: () => field('Decimal Places', '<input type="text">'),
    values: () => '<fieldset><legend>Answers</legend>' + field('Stored Code','<input type="text">') + field('Shown Text','<input type="text">') + '</fieldset>',
    tick: () => field('Preview', '<input type="checkbox">'),
    datetime: () => field('Preview', '<input type="datetime-local">'),
    formula: () => field('Expression', '<input type="text">'),
  };
  let n = 0;
  function field(label, control) {
    const id = 'c' + (n++);
    return '<div><label for="' + id + '">' + label + '</label>' +
      control.replace('<input', '<input id="' + id + '"').replace('<textarea', '<textarea id="' + id + '"') + '</div>';
  }
  for (const entry of document.querySelectorAll('#palette button')) {
    entry.addEventListener('click', () => {
      const parts = SURFACES[entry.textContent];
      if (!parts) return;                       // "Import From Library…" is inert on purpose
      config.innerHTML = parts.map((p) => build[p]()).join('');
    });
  }
</script>`;

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

const clearConfig = async (doc) => { doc.getElementById('config').innerHTML = ''; };

test('the palette is preferred over a navigation bar of similar buttons', () => {
  const doc = page(DESIGNER);
  const palette = findPalette(doc);
  assert.ok(palette);
  assert.equal(palette.container.id, 'palette', 'a heading that says "palette" beats a bigger unlabelled group');
  assert.equal(palette.members.length, 9);
});

test('entries are classified by what they DO, not by what they are called', async () => {
  const doc = page(DESIGNER);
  const learned = await learnTypes(doc, { removeProbe: clearConfig });
  assert.equal(learned.ok, true, learned.reason);

  const entryFor = (type) => learned.map[type] && learned.map[type].entry;
  assert.equal(entryFor('calculated'), 'Computed Value', 'the only entry that grew a formula box');
  assert.equal(entryFor('datetime'), 'Moment Picker', 'the only one that renders a date-and-time input');
  assert.equal(entryFor('textarea'), 'Long Answer', 'the only one that renders multi-line text');
  assert.equal(entryFor('decimal'), 'Measurement', 'a range WITH decimal precision');
  assert.equal(entryFor('integer'), 'Tally Counter', 'a range WITHOUT decimal precision — the pair only behaviour separates');
});

test('an entry that does nothing is marked inert rather than mapped to something', async () => {
  const doc = page(DESIGNER);
  const learned = await learnTypes(doc, { removeProbe: clearConfig });
  const importer = learned.entries.find((e) => e.name.startsWith('Import'));
  assert.equal(importer.inert, true);
  assert.equal(Object.values(learned.map).some((m) => m.entry.startsWith('Import')), false,
    'a decoy must not be handed a canonical type');
});

test('a type the platform gives no evidence for is left unmapped, never guessed', async () => {
  const doc = page(DESIGNER);
  const learned = await learnTypes(doc, { removeProbe: clearConfig });
  // This designer offers no separate date-only or time-only control.
  assert.ok(!learned.map.date || learned.map.date.confidence < 1,
    'nothing here is unambiguously date-only; low confidence or absent is the honest answer');
});

// ── proving the commit control ───────────────────────────────────────────────

const TOOLBAR = `<!doctype html><meta charset="utf-8">
<div id="bar">
  <button type="button">Preview</button>
  <button type="button">Save As Template</button>
  <button type="button">Store Draft Locally</button>
  <button type="button">Commit Changes</button>
</div>
<div id="canvas"></div>`;

function commitHarness() {
  const doc = page(TOOLBAR);
  let saved = '';        // what survived a round trip
  let working = '';      // what is on the canvas now

  for (const button of doc.querySelectorAll('#bar button')) {
    button.addEventListener('click', () => {
      // Only one of these four writes to the store. The others are plausible
      // and useless — which is the whole point of proving it by round trip.
      if (button.textContent === 'Commit Changes') saved = working;
    });
  }

  return {
    doc,
    plantMarker: async (_doc, marker) => { working = marker; doc.getElementById('canvas').textContent = marker; return true; },
    leave: async () => { doc.getElementById('canvas').textContent = ''; working = ''; },
    reopen: async () => { working = saved; doc.getElementById('canvas').textContent = saved; },
    markerPresent: async (_doc, marker) => doc.getElementById('canvas').textContent === marker,
    removeMarker: async () => { working = ''; doc.getElementById('canvas').textContent = ''; },
  };
}

test('the control that persists is found by round trip, not by its name', async () => {
  const harness = commitHarness();
  const learned = await learnCommit(harness.doc, harness);
  assert.equal(learned.ok, true, learned.reason);
  assert.equal(learned.name, 'Commit Changes');
  assert.ok(learned.tried.length >= 1);
});

test('look-alikes rank below a real commit before anything is even pressed', () => {
  const doc = page(TOOLBAR);
  const names = commitCandidates(doc).map((c) => c.control.name);
  assert.equal(names[0], 'Commit Changes');
  assert.ok(!names.includes('Save As Template'), 'a control that saves a copy is not a commit');
  assert.ok(!names.includes('Store Draft Locally'), 'nor is one that saves somewhere else');
});

test('a sub-edit control is never mistaken for a commit', () => {
  const doc = page(`<!doctype html><fieldset><legend>Answers</legend>
    <button type="button">Apply Bulk Load</button>
    <button type="button">Add Answer</button></fieldset>`);
  const names = commitCandidates(doc).map((c) => c.control.name);
  assert.deepEqual(names, [], 'applying a sub-edit persists nothing; taking it loses the whole form');
});

test('a toolbar with nothing that saves says so, rather than pressing something hopeful', async () => {
  const doc = page(`<!doctype html><div><button type="button">Preview</button>
    <button type="button">Discard Changes</button></div><div id="canvas"></div>`);
  const learned = await learnCommit(doc, {
    plantMarker: async () => true,
    leave: async () => {},
    reopen: async () => {},
    markerPresent: async () => false,
    removeMarker: async () => {},
  });
  assert.equal(learned.ok, false);
  assert.match(learned.reason, /persisted/);
});

// ── temporal types that share one input type ─────────────────────────────────

const TEMPORAL = `<!doctype html><meta charset="utf-8">
<main><h2>Question Setup</h2><div id="config"></div></main>
<aside><h2>Question Palette</h2><ul>
  <li><button type="button">Date</button></li>
  <li><button type="button">Time</button></li>
  <li><button type="button">Date/Time</button></li>
  <li><button type="button">Single Line Textbox</button></li>
</ul></aside>
<script>
  // Every one of these is a plain text input. The mask is the only thing that
  // says what it wants — which is how plenty of real designers do it.
  const MASK = {
    'Date': 'DD-MMM-YYYY',
    'Time': 'HH:MM',
    'Date/Time': 'DD-MMM-YYYY HH:MM',
    'Single Line Textbox': '',
  };
  const config = document.getElementById('config');
  for (const entry of document.querySelectorAll('#palette button, aside button')) {
    entry.addEventListener('click', () => {
      config.innerHTML =
        '<div><label for="lab">Question Text</label><input id="lab" type="text"></div>' +
        '<div><label for="pv">Preview</label><input id="pv" type="text" placeholder="' + MASK[entry.textContent] + '"></div>';
    });
  }
</script>`;

test('date, time and datetime are told apart by the mask when the input type is not', async () => {
  const doc = page(TEMPORAL);
  const learned = await learnTypes(doc, { removeProbe: clearConfig });
  assert.equal(learned.ok, true, learned.reason);

  const entryFor = (t) => learned.map[t] && learned.map[t].entry;
  assert.equal(entryFor('date'), 'Date');
  assert.equal(entryFor('time'), 'Time');
  assert.equal(entryFor('datetime'), 'Date/Time',
    'all three are type="text"; only "DD-MMM-YYYY HH:MM" says which is which');
});

// ── telling the panel apart from the field ───────────────────────────────────

const PANEL_HEADED_OPTIONS = `<!doctype html><meta charset="utf-8">
<section><h2>Options</h2><div id="config"></div></section>
<aside><h2>Elements</h2><ul>
  <li><button type="button">Single Line Textbox</button></li>
  <li><button type="button">Check List</button></li>
  <li><button type="button">Number (Whole)</button></li>
  <li><button type="button">Yes/No Toggle</button></li>
</ul></aside>
<script>
  // Every field gets the same panel: a label, a type chooser and a visibility
  // chooser. Only the preview differs. A designer heading this panel "Options"
  // must not make every field look like it holds a coded list.
  const PREVIEW = {
    'Single Line Textbox': '<input type="text" aria-label="Preview">',
    'Check List': '<label for="c">Code</label><input id="c" type="text">' +
                  '<label for="l">Label</label><input id="l" type="text">',
    'Number (Whole)': '<label for="mn">Minimum</label><input id="mn" type="text">' +
                      '<label for="mx">Maximum</label><input id="mx" type="text">',
    'Yes/No Toggle': '<button type="button">Yes</button><button type="button">No</button>',
  };
  for (const entry of document.querySelectorAll('aside button')) {
    entry.addEventListener('click', () => {
      document.getElementById('config').innerHTML =
        '<label for="lab">Label</label><input id="lab" type="text">' +
        '<label for="ty">Element Type</label><select id="ty"><option>a</option></select>' +
        '<label for="vis">Visibility</label><select id="vis"><option>Visible</option></select>' +
        PREVIEW[entry.textContent];
    });
  }
</script>`;

test('a panel headed "Options" does not make every field look coded', async () => {
  const doc = page(PANEL_HEADED_OPTIONS);
  const learned = await learnTypes(doc, { removeProbe: clearConfig });
  assert.equal(learned.ok, true, learned.reason);

  const evidenceFor = (name) => {
    const entry = Object.values(learned.map).find((m) => m.entry === name);
    return entry ? entry.evidence.join('; ') : '';
  };
  assert.doesNotMatch(evidenceFor('Single Line Textbox'), /coded values/,
    'a plain text field grew no code and no label column');
  assert.match(evidenceFor('Check List'), /coded values/,
    'this one genuinely did');
});

test('the panel\'s own choosers are not the field rendering a chooser', async () => {
  const doc = page(PANEL_HEADED_OPTIONS);
  const learned = await learnTypes(doc, { removeProbe: clearConfig });
  const entry = Object.values(learned.map).find((m) => m.entry === 'Number (Whole)');
  assert.ok(entry);
  assert.doesNotMatch(entry.evidence.join('; '), /renders a chooser/,
    'an Element Type dropdown belongs to the panel, not to the field');
});
