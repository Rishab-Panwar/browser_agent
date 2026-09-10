import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { selectFieldOnCanvas } from '../src/orchestrate.js';

/**
 * A designer whose canvas cards select on click, and whose properties panel
 * names the selected card. `selected` says which card the panel already shows.
 */
function designer({ labels, selected, cardsFindable = true }) {
  const cards = labels.map((label, i) => `
    <div class="element-card" id="card-${i}">
      <div class="element-head"><span class="element-label">${cardsFindable ? label : '—'}</span></div>
      ${cardsFindable ? `<div class="element-preview"><textarea aria-label="${label}"></textarea></div>` : ''}
    </div>`).join('');

  const dom = new JSDOM(`<body><div class="columns">
    <section class="canvas"><div class="canvas-surface">${cards}</div></section>
    <aside class="options"><h3>Options</h3>
      <div class="row"><label for="opt-label">Label</label><input type="text" id="opt-label"></div>
    </aside>
  </div></body>`);
  const doc = dom.window.document;
  global.window = dom.window;
  const win = dom.window;
  if (!win.performance) win.performance = { now: () => Date.now() };
  globalThis.performance = globalThis.performance || win.performance;
  globalThis.MessageChannel = globalThis.MessageChannel || win.MessageChannel;
  globalThis.MutationObserver = win.MutationObserver;
  if (!dom.window.PointerEvent) dom.window.PointerEvent = dom.window.MouseEvent; // jsdom has no PointerEvent
  dom.window.Element.prototype.scrollIntoView = () => {};
  dom.window.Element.prototype.getBoundingClientRect = () => ({ width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 });

  const namer = doc.getElementById('opt-label');
  namer.value = labels[selected] ?? '';
  labels.forEach((label, i) => {
    doc.getElementById(`card-${i}`).addEventListener('click', () => { namer.value = label; });
  });
  return { doc, namer };
}

test('a field the panel already shows is already selected', async () => {
  // The field just built is still the selected one. Nothing on the canvas needs
  // pressing, and a designer that renders no findable card for it must not
  // make the agent report a field it can plainly see as unreachable.
  const { doc } = designer({ labels: ['Outcome', 'Resolution Date'], selected: 1, cardsFindable: false });
  assert.equal(await selectFieldOnCanvas(doc, 'Resolution Date'), true);
});

test('a different field is selected by pressing its card', async () => {
  const { doc, namer } = designer({ labels: ['Outcome', 'Resolution Date'], selected: 1 });
  assert.equal(await selectFieldOnCanvas(doc, 'Outcome'), true);
  assert.equal(namer.value, 'Outcome');
});

test('a field that is neither shown nor on the canvas is reported, not claimed', async () => {
  const { doc } = designer({ labels: ['Outcome'], selected: 0 });
  assert.equal(await selectFieldOnCanvas(doc, 'Nowhere To Be Found'), false);
});
