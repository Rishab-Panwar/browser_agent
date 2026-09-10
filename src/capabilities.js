/*
 * capabilities.js — what a control MEANS, independent of how it was built.
 *
 * Every eSource renders the same handful of clinical concepts with whatever
 * widgets its component library happens to provide. A "required" flag is an
 * <input type=checkbox> on one platform, a <button role="switch"> on the next,
 * and a two-state <div role="button" aria-pressed> on the one after that. The
 * three are the same capability wearing different clothes.
 *
 * So the agent never asks "is this a checkbox?". It asks "can this hold an
 * on/off state?" — and every capability lists the ways it is realised in the
 * wild. Adding a new realisation is one entry here, not a new branch in five
 * call sites.
 *
 * Three rules hold everywhere in this file:
 *
 *   1. An explicit ARIA role outranks the tag. The tag says how a widget was
 *      assembled; the role says what its author means it to be.
 *   2. A value may be a string, a number or a boolean. Coerce at the boundary.
 *   3. `undefined` means "could not tell", and is never the same as "no".
 */

/** The capabilities the agent can reason about. */
export const CAP = {
  TOGGLE: 'toggle', // holds an on/off state
  CHOOSER: 'chooser', // offers a set of values, one or many
  TEXT: 'text', // holds free text
  ACTION: 'action', // does something when pressed
  OPTION: 'option', // one choice inside a chooser
};

const ROLE_CAPABILITY = {
  switch: CAP.TOGGLE,
  checkbox: CAP.TOGGLE,
  menuitemcheckbox: CAP.TOGGLE,
  radio: CAP.TOGGLE,
  menuitemradio: CAP.TOGGLE,
  combobox: CAP.CHOOSER,
  listbox: CAP.CHOOSER,
  textbox: CAP.TEXT,
  searchbox: CAP.TEXT,
  option: CAP.OPTION,
  button: CAP.ACTION,
  tab: CAP.ACTION,
  link: CAP.ACTION,
  menuitem: CAP.ACTION,
  treeitem: CAP.ACTION,
  gridcell: CAP.ACTION,
};

const INPUT_CAPABILITY = {
  checkbox: CAP.TOGGLE,
  radio: CAP.TOGGLE,
  button: CAP.ACTION,
  submit: CAP.ACTION,
  reset: CAP.ACTION,
  image: CAP.ACTION,
  file: null, // nothing in a study spec is a file upload; ignore rather than guess
};

/**
 * The capability of an element, or null if it is not something to act on.
 *
 * Role first, deliberately. A component library builds a switch as
 * `<button role="switch">`; testing the tag first classifies it as a plain
 * button, its state then reads as unsettable, and the flag is silently never
 * set — the worst way to be wrong, because the form looks right afterwards.
 */
export function capabilityOf(el) {
  if (!el || !el.getAttribute) return null;

  // A control that reports a pressed state is a toggle whatever else it calls
  // itself: `role="button"` with `aria-pressed` is how component libraries
  // build a two-state button, and reading the role alone loses the state.
  if (el.getAttribute('aria-pressed') !== null) return CAP.TOGGLE;

  const role = (el.getAttribute('role') || '').toLowerCase();
  if (role && Object.prototype.hasOwnProperty.call(ROLE_CAPABILITY, role)) {
    return ROLE_CAPABILITY[role];
  }

  const tag = el.tagName;
  if (tag === 'SELECT') return CAP.CHOOSER;
  if (tag === 'TEXTAREA') return CAP.TEXT;
  if (tag === 'OPTION') return CAP.OPTION;
  if (tag === 'BUTTON' || tag === 'A') return CAP.ACTION;
  if (tag === 'INPUT') {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (Object.prototype.hasOwnProperty.call(INPUT_CAPABILITY, type)) return INPUT_CAPABILITY[type];
    return CAP.TEXT; // text, number, date, time, email, url... all hold typed text
  }
  if (isEditable(el)) return CAP.TEXT;

  return null;
}

/** contenteditable, in either of its two legal spellings. */
export function isEditable(el) {
  const ce = el.getAttribute && el.getAttribute('contenteditable');
  return ce === '' || ce === 'true';
}

/**
 * Whether a chooser takes more than one value at a time.
 * Unknown is null — the caller decides what to do about it, rather than
 * inheriting a guess.
 */
export function isMultiSelect(el) {
  if (!el || !el.getAttribute) return null;
  if (el.tagName === 'SELECT') return !!el.multiple;
  const multi = el.getAttribute('aria-multiselectable');
  if (multi === 'true') return true;
  if (multi === 'false') return false;
  return null;
}

/**
 * The on/off state of a toggle.
 *
 * Native inputs answer with a `checked` property; ARIA widgets answer with
 * `aria-checked`; toggle buttons answer with `aria-pressed`. Reading only the
 * first makes every custom switch look permanently off — so a switch already
 * in the wanted state gets clicked and turned WRONG, which is worse than never
 * touching it. Returns undefined when the element does not say.
 */
export function toggleState(el) {
  if (!el) return undefined;
  if ('checked' in el && typeof el.checked === 'boolean') return el.checked;
  const aria = el.getAttribute && (el.getAttribute('aria-checked') || el.getAttribute('aria-pressed'));
  if (aria === 'true') return true;
  if (aria === 'false') return false;
  return undefined;
}

/**
 * The value a control currently shows.
 *
 * A native input keeps it in `.value`; a custom chooser paints it as its own
 * text. Everything is coerced: an accessibility value can be a number or a
 * boolean, and calling string methods on those is how a run dies three fields
 * into a platform nobody tested on.
 */
export function displayedValue(el) {
  if (!el) return '';
  if (el.tagName === 'SELECT') {
    const chosen = el.selectedOptions && el.selectedOptions[0];
    return chosen ? text(chosen.textContent) : '';
  }
  if ('value' in el && typeof el.value !== 'undefined' && el.tagName !== 'DIV') {
    return text(el.value);
  }
  if (isEditable(el)) return text(el.textContent);
  return text(el.textContent);
}

/** Coerce anything to trimmed text. Never assume the DOM handed you a string. */
export function text(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/**
 * Does this element advertise that it hides something?
 *
 * A toolbar that overflows into a kebab menu keeps its commit control off
 * screen entirely — and a control that is not in the DOM cannot be found by
 * any amount of clever scoring. Anything that says "there is more behind me"
 * is worth opening before concluding a control does not exist.
 */
export function isDisclosure(el, name) {
  if (!el || !el.getAttribute) return false;
  if (el.getAttribute('aria-expanded') === 'true') return false; // already open
  if (el.getAttribute('aria-haspopup')) return true;
  if (el.getAttribute('aria-expanded') === 'false') return true;
  return DISCLOSURE_GLYPHS.test(text(name));
}

/**
 * Generic overflow wording. Not any platform's vocabulary — these are what
 * overflow affordances are called and drawn as across the web. Structural
 * signals above do the real work; this only catches menus that declare nothing.
 */
const DISCLOSURE_GLYPHS = /^(…|\.\.\.|⋮|⋯|☰|more|more actions|actions|options|menu|overflow)$/i;

/** True when the element is rendered and could be interacted with. */
export function isVisible(el) {
  if (!el || !el.isConnected) return false;
  if (el.closest('[hidden]')) return false;
  const win = el.ownerDocument && el.ownerDocument.defaultView;
  if (!win) return false;
  const style = win.getComputedStyle(el);
  if (!style) return false;
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (Number.parseFloat(style.opacity) === 0) return false;
  const box = el.getBoundingClientRect();
  return box.width > 0 && box.height > 0;
}

/** True when the control is present but refuses interaction. */
export function isDisabled(el) {
  if (!el) return true;
  if ('disabled' in el && el.disabled === true) return true;
  return el.getAttribute && el.getAttribute('aria-disabled') === 'true';
}
