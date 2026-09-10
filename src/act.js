/*
 * act.js — the agent's hands.
 *
 * Three rules, each of which exists because breaking it costs a whole run:
 *
 *   1. Re-resolve before acting. Between deciding and doing, the page may have
 *      re-rendered and the control you chose may be detached. Acting on a
 *      detached node does nothing, silently, and reads back as "the platform
 *      ignored me".
 *
 *   2. Read the state before changing it. A toggle already in the wanted state
 *      must not be clicked — clicking it turns it WRONG, which is worse than
 *      leaving it alone, because the form still looks built afterwards.
 *
 *   3. Report what happened, not what was attempted. Every function here says
 *      whether the page ended up how it was asked to, so the caller can count
 *      outcomes rather than intentions.
 */

import { CAP, isEditable, text, toggleState } from './capabilities.js';
import { describe, offers, resolve, snapshot } from './perceive.js';

/**
 * Pause, without spinning.
 *
 * A background tab clamps setTimeout to a second or more, which would turn a
 * two-minute run into an hour the moment the user switches tab. MessageChannel
 * tasks are not throttled that way — but posting a message in a loop until the
 * time is up burns a core and floods the task queue with thousands of
 * dispatches per pause, which is its own way of making a page slow.
 *
 * So: a visible tab is not throttled at all, and gets one timer. Only a hidden
 * tab pays for the message loop, and only for as long as it stays hidden.
 */
export function delay(ms) {
  const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
  if (!hidden) return new Promise((done) => setTimeout(done, ms));

  return new Promise((done) => {
    const started = performance.now();
    const channel = new MessageChannel();
    const finish = () => { channel.port1.close(); channel.port2.close(); done(); };
    channel.port1.onmessage = () => {
      if (performance.now() - started >= ms) finish();
      else channel.port2.postMessage(0);
    };
    channel.port2.postMessage(0);
  });
}

/**
 * Waiting is bounded on purpose.
 *
 * A page that keeps changing — a toast fading, a spinner, a framework that
 * re-renders on a timer — never goes quiet, and an unbounded wait then costs
 * the ceiling on every single action. Ten actions a field turns a two-minute
 * run into a quarter of an hour, for nothing: if the page is still busy after
 * this long, reading it again later is cheaper than waiting now.
 */
export async function settle(doc, quietMs = 40, maxMs = 450) {
  const started = performance.now();
  let lastChange = started;
  const observer = new MutationObserver(() => { lastChange = performance.now(); });
  observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
  for (;;) {
    await delay(12);
    const now = performance.now();
    if (now - lastChange >= quietMs || now - started >= maxMs) break;
  }
  observer.disconnect();
}

/** The live element for a control, found again if the one we hold has gone. */
function live(doc, control, snap) {
  if (control.el && control.el.isConnected) return control.el;
  const found = resolve(doc, describe(control, snap || snapshot(doc)));
  return found ? found.el : null;
}

/**
 * Press something.
 *
 * A full pointer sequence, not just .click(): a framework-bound page may listen
 * for pointerdown/mouseup and ignore a bare click, and a component library's
 * custom control frequently listens for neither.
 */
export async function press(doc, control) {
  const el = live(doc, control);
  if (!el) return false;
  el.scrollIntoView({ block: 'center' });
  const win = doc.defaultView;
  const opts = { bubbles: true, cancelable: true, view: win };
  el.dispatchEvent(new win.PointerEvent('pointerdown', opts));
  el.dispatchEvent(new win.MouseEvent('mousedown', opts));
  el.dispatchEvent(new win.PointerEvent('pointerup', opts));
  el.dispatchEvent(new win.MouseEvent('mouseup', opts));
  el.click();
  await settle(doc);
  return true;
}

/**
 * Put text into a control, and confirm it took.
 *
 * The native value setter is used deliberately: assigning `.value` directly is
 * invisible to frameworks that track their own state, so the field looks filled
 * to a human and is empty to the application.
 */
export async function type(doc, control, value) {
  const el = live(doc, control);
  if (!el) return false;
  const wanted = text(value);

  el.scrollIntoView({ block: 'center' });
  el.focus();

  if (isEditable(el)) {
    el.textContent = wanted;
  } else {
    const win = doc.defaultView;
    const proto = el.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value');
    if (setter && setter.set) setter.set.call(el, wanted);
    else el.value = wanted;
  }
  fire(doc, el, 'input');
  fire(doc, el, 'change');
  el.blur();
  await settle(doc);

  const after = live(doc, control);
  return after ? text(isEditable(after) ? after.textContent : after.value) === wanted : false;
}

/**
 * Set a two-state control, only if it is not already there.
 *
 * `undefined` means the control does not report its state. Pressing it then is
 * a coin flip, so the caller is told we could not do it rather than being left
 * to assume it worked.
 */
export async function setToggle(doc, control, wanted) {
  const el = live(doc, control);
  if (!el) return { ok: false, reason: 'control not on the page' };

  const before = toggleState(el);
  if (before === undefined) return { ok: false, reason: 'the control does not report its state' };
  if (before === !!wanted) return { ok: true, changed: false };

  await press(doc, control);

  const after = toggleState(live(doc, control));
  if (after === !!wanted) return { ok: true, changed: true };
  return { ok: false, reason: `still reads ${String(after)} after pressing` };
}

/**
 * Choose a value in a chooser, by what it says rather than by position.
 *
 * Works the same for a native select and for a custom widget that renders its
 * options only while open — `offers()` hides that difference, and the option is
 * then pressed like anything else.
 */
export async function choose(doc, control, wanted) {
  const el = live(doc, control);
  if (!el) return { ok: false, reason: 'control not on the page' };
  const target = text(wanted);

  if (el.tagName === 'SELECT') {
    const match = [...el.options].find((o) => text(o.textContent) === target)
      || [...el.options].find((o) => text(o.value) === target)
      || [...el.options].find((o) => text(o.textContent).toLowerCase() === target.toLowerCase());
    if (!match) return { ok: false, reason: 'not offered', offered: [...el.options].map((o) => text(o.textContent)) };
    el.value = match.value;
    fire(doc, el, 'change');
    await settle(doc);
    return { ok: true, chose: text(match.textContent) };
  }

  const snap = snapshot(doc);
  const available = await offers(doc, control, { open: (node) => node.click(), settle: () => settle(doc) });
  const match = available.find((o) => o.text === target)
    || available.find((o) => o.value === target)
    || available.find((o) => o.text.toLowerCase() === target.toLowerCase());
  if (!match) return { ok: false, reason: 'not offered', offered: available.map((o) => o.text) };

  // Open it for real this time and press the option that appeared.
  const opener = live(doc, control, snap);
  if (!opener) return { ok: false, reason: 'chooser vanished' };
  if (opener.getAttribute('aria-expanded') !== 'true') {
    opener.click();
    await settle(doc);
  }
  const option = [...doc.querySelectorAll('[role="option"]')].find((o) => text(o.textContent) === match.text);
  if (!option) return { ok: false, reason: 'option disappeared when opened' };
  option.click();
  await settle(doc);
  return { ok: true, chose: match.text };
}

/**
 * Open anything that admits to hiding controls, and report what that revealed.
 *
 * Absence has to be proven. A commit control inside a closed menu is not in the
 * document at all, so no amount of scoring will find it — the only honest way
 * to say "there is no save here" is to have looked behind the doors first.
 */
export async function revealHidden(doc, { limit = 3 } = {}) {
  const before = snapshot(doc);
  const doors = before.controls.filter((c) => c.opensSomething && !c.disabled).slice(0, limit);
  let revealed = [];
  for (const door of doors) {
    await press(doc, door);
    const after = snapshot(doc);
    const fresh = after.controls.filter((c) => !before.controls.some((b) => b.el === c.el));
    revealed = revealed.concat(fresh);
  }
  return revealed;
}

function fire(doc, el, type) {
  el.dispatchEvent(new doc.defaultView.Event(type, { bubbles: true, cancelable: true }));
}

/** Convenience for callers that want a control by capability and name. */
export function find(doc, cap, name) {
  return snapshot(doc).controls.find((c) => c.cap === cap && c.name === name) || null;
}

export { CAP };

/**
 * Press a bare element that is not a control.
 *
 * A canvas paints each field as a plain element with a click handler and no
 * role. It is genuinely pressable, and invisible to anything that only looks at
 * controls — so the caller finds it by the text it shows, and this presses it.
 * The handler is usually on an ancestor; the event bubbles to it.
 */
export async function pressElement(doc, el) {
  if (!el || !el.isConnected) return false;
  el.scrollIntoView({ block: 'center' });
  const win = doc.defaultView;
  const opts = { bubbles: true, cancelable: true, view: win };
  el.dispatchEvent(new win.PointerEvent('pointerdown', opts));
  el.dispatchEvent(new win.MouseEvent('mousedown', opts));
  el.dispatchEvent(new win.PointerEvent('pointerup', opts));
  el.dispatchEvent(new win.MouseEvent('mouseup', opts));
  el.dispatchEvent(new win.MouseEvent('click', opts));
  await settle(doc);
  return true;
}
