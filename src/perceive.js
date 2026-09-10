/*
 * perceive.js — the page, as capabilities.
 *
 * This is the only module that touches the DOM. Everything above it reasons
 * about a list of controls with a capability, an accessible name and a context;
 * nothing above it knows what a <div> is.
 *
 * Two primitives here are the ones that decide whether a run survives contact
 * with an unfamiliar designer:
 *
 *   offers()   — what a chooser can choose from. A native <select> carries its
 *                options at all times; a component library renders them only
 *                while open. Asking a closed one and believing the empty answer
 *                is how an agent concludes a control offers nothing.
 *
 *   groups()   — sets of sibling-ish controls. A palette's entries may be
 *                direct siblings, or each wrapped in its own <li>. Looking one
 *                level only, and stopping at the first thing that matches, is
 *                how a four-item navigation bar gets mistaken for a
 *                thirteen-item element library.
 *
 * No CSS class, element id or platform wording appears in this file.
 */

import {
  CAP, capabilityOf, displayedValue, isDisabled, isDisclosure, isVisible,
  isMultiSelect, text, toggleState,
} from './capabilities.js';

/** Elements worth considering. Standard HTML and ARIA only. */
const CANDIDATES = [
  'button', 'a[href]', 'input', 'select', 'textarea', 'option',
  '[role]', '[contenteditable="true"]', '[contenteditable=""]', '[tabindex]',
].join(',');

/**
 * Accessible name, computed the way a screen reader computes it.
 *
 * Order matters and follows the ARIA spec: an explicit label wins over content,
 * content wins over a placeholder. Everything is coerced — an attribute can
 * come back as something other than a string on exotic elements.
 */
export function accessibleName(el) {
  const doc = el.ownerDocument;

  const label = text(el.getAttribute && el.getAttribute('aria-label'));
  if (label) return label;

  const labelledBy = el.getAttribute && el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const joined = String(labelledBy).split(/\s+/)
      .map((id) => { const ref = doc.getElementById(id); return ref ? text(ref.textContent) : ''; })
      .filter(Boolean).join(' ');
    if (joined) return joined;
  }

  if (el.id) {
    const forLabel = doc.querySelector(`label[for="${cssEscape(el.id)}"]`);
    if (forLabel) {
      const t = text(forLabel.textContent);
      if (t) return t;
    }
  }

  const wrapping = el.closest && el.closest('label');
  if (wrapping) {
    const t = text(wrapping.textContent);
    if (t) return t;
  }

  // Content is a name for things you press or pick, not for things you fill in:
  // a textbox's content is the user's data, not its label.
  const cap = capabilityOf(el);
  if (cap === CAP.ACTION || cap === CAP.OPTION) {
    const t = text(el.textContent);
    if (t) return t;
  }

  const placeholder = text(el.getAttribute && el.getAttribute('placeholder'));
  if (placeholder) return placeholder;

  return text(el.getAttribute && el.getAttribute('title'));
}

function cssEscape(value) {
  const win = typeof window !== 'undefined' ? window : null;
  if (win && win.CSS && win.CSS.escape) return win.CSS.escape(value);
  return String(value).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c);
}

/**
 * The headings, legends and dialog titles that scope an element.
 *
 * Context is how the agent tells one "Add" button from another without knowing
 * either platform's wording: the one under a heading about visits adds a visit.
 */
const HEADINGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LEGEND']);
const contextCache = new WeakMap();

export function contextOf(el) {
  const cached = contextCache.get(el);
  if (cached) return cached;

  const bits = [];
  let node = el;
  while (node && node.nodeType === 1) {
    const aria = node.getAttribute && node.getAttribute('aria-label');
    if (aria && node !== el) bits.push(text(aria));

    // A container's heading is its own child, not something buried anywhere
    // inside it. Searching whole subtrees costs the same work again for every
    // control on the page, which on a form that grows as it is built turns a
    // two-minute run into a quarter of an hour.
    for (const child of node.children || []) {
      if (child === el) break; // only what precedes us can scope us
      if (HEADINGS.has(child.tagName) || (child.getAttribute && child.getAttribute('role') === 'heading')) {
        const label = text(child.textContent);
        if (label) bits.push(label);
      }
    }

    if (node.getAttribute && node.getAttribute('aria-modal') === 'true') break; // a modal is its own world
    node = node.parentElement;
  }

  const context = [...new Set(bits.filter(Boolean))];
  contextCache.set(el, context);
  return context;
}

/**
 * A description that can find this control again after the page changes.
 *
 * Capability and name are the durable part. `nth` disambiguates the case that
 * bites: two controls legitimately share a name because they are the same
 * concept offered twice — a native chooser and a custom one labelled "Element
 * Kind", say. Without it, acting on "the one called X" silently acts on
 * whichever is first in the document.
 */
export function describe(control, snap) {
  const siblings = (snap ? snap.controls : [])
    .filter((c) => c.cap === control.cap && c.name === control.name);
  const nth = siblings.length > 1 ? siblings.findIndex((c) => c.el === control.el) : -1;
  return { cap: control.cap, name: control.name, context: control.context.slice(0, 2), nth };
}

/**
 * Find a described control on the page as it is NOW.
 *
 * A node reference is a snapshot, not a handle: a widget that re-renders when
 * you interact with it hands back a detached element, and every later read of
 * it is a reading of a corpse. Anything held across an action is re-resolved
 * by what it IS — capability plus accessible name — never by object identity.
 */
export function resolve(doc, desc) {
  if (!desc) return null;
  const all = snapshot(doc).controls.filter((c) => c.cap === desc.cap && c.name === desc.name);
  if (all.length === 0) return null;
  if (all.length === 1) return all[0];

  if (desc.context && desc.context.length) {
    const sameContext = all.filter((c) => desc.context.every((bit) => c.context.includes(bit)));
    if (sameContext.length === 1) return sameContext[0];
    if (sameContext.length > 1) return sameContext[desc.nth >= 0 ? Math.min(desc.nth, sameContext.length - 1) : 0];
  }
  if (desc.nth >= 0 && desc.nth < all.length) return all[desc.nth];
  return all[0];
}

/** Everything actionable on the page right now. */
export function snapshot(doc) {
  const controls = [];
  const seen = new Set();
  let index = 0;

  for (const el of doc.querySelectorAll(CANDIDATES)) {
    if (seen.has(el)) continue;
    const cap = capabilityOf(el);
    if (!cap) continue;
    if (!isVisible(el)) continue;
    seen.add(el);

    controls.push({
      el,
      cap,
      name: accessibleName(el),
      context: contextOf(el),
      state: cap === CAP.TOGGLE ? toggleState(el) : undefined,
      value: cap === CAP.TEXT || cap === CAP.CHOOSER ? displayedValue(el) : '',
      multiple: cap === CAP.CHOOSER ? isMultiSelect(el) : null,
      disabled: isDisabled(el),
      opensSomething: isDisclosure(el, accessibleName(el)),
      // What this control IS, independent of the object that currently backs it.
      signature: null, // filled below, once name and context are known
      index: index++,
    });
  }

  for (const control of controls) {
    control.signature = [control.cap, control.name, control.context.join(">")].join("|");
  }
  return { doc, controls, at: Date.now() };
}

/**
 * Controls present now that were not present before.
 *
 * The honest way to attribute a change to an action: what a click produced,
 * rather than whatever happens to be on the page afterwards. Used both to learn
 * what a palette entry does and to read a chooser that only renders when open.
 */
export function appeared(before, after) {
  // Compared by what a control IS, never by which object it is. A page that
  // rebuilds itself on every interaction hands back all-new elements for the
  // same controls, and an identity diff then reports the entire screen as new —
  // so a probe "reveals" the palette that was always there, and every entry
  // looks like it does the same thing. Counted as a multiset, so a second
  // identical row still registers as an addition.
  const remaining = new Map();
  for (const control of before.controls) {
    remaining.set(control.signature, (remaining.get(control.signature) || 0) + 1);
  }
  const fresh = [];
  for (const control of after.controls) {
    const left = remaining.get(control.signature) || 0;
    if (left > 0) remaining.set(control.signature, left - 1);
    else fresh.push(control);
  }
  return fresh;
}

/**
 * What a chooser can choose from.
 *
 * Three shapes, one answer:
 *   - a native <select> already holds its options
 *   - an open custom listbox has them in the DOM
 *   - a closed one has nothing at all, and must be opened to be read
 *
 * When it has to open the control it takes only the options that APPEARED,
 * never every [role=option] in the document: a listbox left open elsewhere
 * would otherwise answer for a chooser that was never asked. It then puts the
 * control back the way it found it.
 *
 * `open` and `settle` are injected so this module stays free of act.js and
 * remains testable without a real browser.
 */
export async function offers(doc, control, { open, settle } = {}) {
  const el = control.el;
  if (!el) return [];

  if (el.tagName === 'SELECT') {
    return [...el.options].map((o) => ({ text: text(o.textContent), value: text(o.value) }));
  }

  const inDom = optionsIn(doc, el);
  if (inDom.length) return inDom;
  if (!open) return []; // caller did not permit interaction; an empty answer is honest here

  const before = snapshot(doc);
  const wasOpen = el.getAttribute && el.getAttribute('aria-expanded') === 'true';
  await open(el);
  if (settle) await settle();

  const after = snapshot(doc);
  const fresh = appeared(before, after).filter((c) => c.cap === CAP.OPTION);
  const options = (fresh.length ? fresh : after.controls.filter((c) => c.cap === CAP.OPTION))
    .map((c) => ({ text: c.name, value: text(c.el.getAttribute('data-value')) || c.name }))
    .filter((o) => o.text);

  if (!wasOpen) {
    const live = resolve(doc, describe(control, before));
    if (live && live.el.getAttribute && live.el.getAttribute('aria-expanded') === 'true') {
      await open(live.el);
      if (settle) await settle();
    }
  }
  return options;
}

/** Options already in the DOM for this chooser, preferring the list it owns. */
function optionsIn(doc, el) {
  const ownedId = el.getAttribute && (el.getAttribute('aria-controls') || el.getAttribute('aria-owns'));
  const owned = ownedId ? doc.getElementById(ownedId) : null;
  const scope = owned || el;
  return [...scope.querySelectorAll('[role="option"], option')]
    .filter((o) => isVisible(o) || o.tagName === 'OPTION')
    .map((o) => ({ text: text(o.textContent), value: text(o.getAttribute('data-value') || o.value) }))
    .filter((o) => o.text);
}

/**
 * Sets of controls that look like one repeated thing — a palette, a row of
 * tabs, a list of records.
 *
 * Grouped at several levels of containment, because a list's items may be
 * direct siblings or each wrapped in its own element, and the wrapper depth is
 * a styling decision no agent should depend on. Every level is returned and
 * scored by the caller; stopping at the first level that yields anything is
 * how a navigation bar wins over the palette it sits above.
 */
export function groups(snap, { minSize = 3, levels = 3 } = {}) {
  const actionable = snap.controls.filter((c) => !c.disabled);
  const found = [];
  const seenContainers = new Set();

  for (let level = 1; level <= levels; level++) {
    const byContainer = new Map();
    for (const control of actionable) {
      let container = control.el;
      for (let up = 0; up < level && container; up++) container = container.parentElement;
      if (!container || container === snap.doc.body || container === snap.doc.documentElement) continue;
      if (!byContainer.has(container)) byContainer.set(container, []);
      byContainer.get(container).push(control);
    }
    for (const [container, members] of byContainer) {
      if (members.length < minSize) continue;
      if (seenContainers.has(container)) continue;
      seenContainers.add(container);
      found.push({ container, members, level });
    }
  }
  return found;
}
