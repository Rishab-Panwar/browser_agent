/*
 * navigate.js — knowing where you are, and getting somewhere else.
 *
 * This is the layer that broke every agent I looked at while designing this
 * one, and always the same way: one predicate decided "am I on the schedule?"
 * or "am I in the designer?", that predicate assumed one layout, and when it
 * was wrong the run did not fail — it went somewhere else and kept working.
 * One of them clicked the correct control, arrived at the correct screen,
 * failed to recognise it, and blacklisted that control as a wrong turn.
 *
 * So nothing here answers a question about location from a single signal, and
 * a navigation attempt is judged by whether it ARRIVED, never by whether the
 * page changed. A decorative tab produces no change; a wrong breadcrumb
 * produces plenty. Both are equally not the way.
 */

import { CAP, text } from './capabilities.js';
import { snapshot } from './perceive.js';
import { press, revealHidden } from './act.js';
import { best, rank, score } from './vocabulary.js';

const actions = (doc) => snapshot(doc).controls.filter((c) => c.cap === CAP.ACTION && !c.disabled);

/**
 * How strongly the page looks like a given screen.
 *
 * Two independent kinds of evidence: a control that would only exist here, and
 * content that would only be listed here. Either alone is a guess; together
 * they are a reading. Returns a count of signals so callers can insist on more
 * than one before acting on it.
 */
export function screenEvidence(doc, { creates, expectedNames = [], notWhen = [] }) {
  const snap = snapshot(doc);
  const signals = [];

  const creator = best(snap.controls.filter((c) => c.cap === CAP.ACTION && !c.disabled), 'create');
  if (creator && score(creator.control.name, creates) > 0) signals.push(`a control that adds a ${creates}`);
  else {
    const scoped = rank(snap.controls.filter((c) => c.cap === CAP.ACTION), creates)
      .find((c) => score(c.control.name, 'create') > 0);
    if (scoped) signals.push(`a control that adds a ${creates}`);
  }

  const listed = expectedNames.filter((name) =>
    snap.controls.some((c) => text(c.name) === text(name)));
  if (listed.length) signals.push(`${listed.length} expected item(s) already listed`);

  for (const other of notWhen) {
    if (snap.controls.some((c) => score(c.name, other) > 2)) {
      return { signals: [], blockedBy: other };
    }
  }

  return { signals, count: signals.length };
}

/**
 * Get to a screen, judged by arriving rather than by anything moving.
 *
 * A control that has been tried and did not lead here is not tried again — but
 * only after the arrival test has had its say, because blacklisting a control
 * on a faulty test is how an agent locks itself out of the one door that works.
 */
export async function goTo(doc, { creates, expectedNames = [], notWhen = [], hints = [], attempts = 5, mustShow = '' }) {
  // "Somewhere that lists these things" is not the same as "the screen holding
  // the one I want". A breadcrumb naming the record currently open is enough to
  // satisfy the looser test, so an agent deep inside Screening concludes it has
  // already arrived at the schedule and never goes looking for Week 4.
  const arrived = () => (mustShow ? reachableHere(doc, mustShow) : true)
    && screenEvidence(doc, { creates, expectedNames, notWhen }).count > 0;
  if (arrived()) return { ok: true, already: true };

  const wrongTurns = new Set();

  for (let attempt = 0; attempt < attempts; attempt++) {
    const candidates = [];
    for (const hint of [...hints, creates, 'back']) {
      for (const ranked of rank(actions(doc), hint)) {
        if (!wrongTurns.has(ranked.control.name)) candidates.push(ranked);
      }
    }
    candidates.sort((a, b) => b.score - a.score);

    const next = candidates[0];
    if (!next) {
      // Nothing visible leads here; a door may be hiding the way.
      const revealed = await revealHidden(doc);
      if (revealed.length === 0) break;
      continue;
    }

    await press(doc, next.control);
    if (arrived()) return { ok: true, via: next.control.name };
    wrongTurns.add(next.control.name);
  }

  return {
    ok: false,
    reason: `could not reach the screen where a ${creates} is created`,
    tried: [...wrongTurns],
  };
}

/** Is this named record something we could open from here? */
function reachableHere(doc, name) {
  const wanted = text(name);
  return snapshot(doc).controls.some((c) => c.cap === CAP.ACTION && text(c.name) === wanted)
    || elementsShowing(doc, wanted).length > 0;
}

/** Open a named record — a row, a card, a link; whatever the platform uses. */
export async function openNamed(doc, name) {
  const named = snapshot(doc).controls
    .filter((c) => c.cap === CAP.ACTION && text(c.name) === text(name) && !c.disabled);
  if (named.length) { await press(doc, named[0]); return { ok: true }; }

  // The name may be plain text with the way in beside it — a row whose only
  // pressable thing is Open, or the row itself.
  const beside = controlsBeside(doc, name);
  if (beside.length === 1) { await press(doc, beside[0]); return { ok: true }; }
  const opener = best(beside, 'edit');
  if (opener) { await press(doc, opener.control); return { ok: true }; }

  return { ok: false, reason: `nothing named "${name}" to open` };
}

/**
 * Is a record with this name already listed? Existence before creation.
 *
 * A record's name is not always something you can click. A visit may be a link
 * and a document beside it plain text in a table cell — the platform's choice,
 * and no business of ours. Looking only at controls reports a record that was
 * just created as missing, and an agent that believes that creates it again.
 */
export function alreadyListed(doc, name) {
  const wanted = text(name);
  if (!wanted) return false;
  const here = (el) => !inNavigation(el);
  if (snapshot(doc).controls.some((c) => text(c.name) === wanted && here(c.el))) return true;
  return elementsShowing(doc, wanted).some(here);
}

/**
 * Is this inside the application's navigation rather than the list on screen?
 *
 * A study tree in a sidebar names every form in the whole study, on every
 * screen. Asking "did the form I just created appear?" of the whole page then
 * answers yes for a form created somewhere else entirely — so the run records
 * work it never did, which is worse than recording a failure. Navigation
 * declares itself: a nav landmark, or an aside that is not the main content.
 */
function inNavigation(el) {
  return !!(el && el.closest && el.closest('nav, aside, [role="navigation"], header, footer'));
}

/** The name as its own piece of visible text, rather than buried in a sentence. */
export function namedInText(doc, name) {
  return elementsShowing(doc, name).length > 0;
}

/**
 * Elements whose own text IS this name.
 *
 * Not everything that shows a record is a control. A designer paints each field
 * on its canvas as a plain div with a click handler and no role at all — real,
 * pressable, and invisible to anything that only looks at controls. Finding it
 * by the text it shows is how the agent selects a field to read it back.
 *
 * A trailing required marker is tolerated: a platform is entitled to draw
 * "Subject Initials *" for a field the specification calls "Subject Initials".
 */
export function elementsShowing(doc, name) {
  const wanted = text(name);
  if (!wanted) return [];
  const found = [];
  const walker = doc.createTreeWalker(doc.body, 1 /* SHOW_ELEMENT */);
  let node = walker.currentNode;
  while (node) {
    let own = '';
    for (const child of node.childNodes) if (child.nodeType === 3) own += child.textContent;
    const shown = text(own).replace(/\s*\*$/, '');
    if (shown === wanted) found.push(node);
    node = walker.nextNode();
  }
  return found;
}

/**
 * Fill and submit a small creation form — a new visit, a new document.
 *
 * The fields are matched by meaning, so the same code fills "Visit Name" and
 * "Timepoint Name". A field the dialog does not offer is reported rather than
 * skipped silently: a repeating flag that never got set is a form that holds
 * one record where the study needs many, and nothing on screen says so.
 */
export async function fillCreationForm(doc, values, { log = () => {} } = {}) {
  const { type, setToggle } = await import('./act.js');
  const missing = [];
  const snap = snapshot(doc);
  const boxes = snap.controls.filter((c) => c.cap === CAP.TEXT && !c.disabled);

  for (const [concept, value] of values.text || []) {
    if (value === undefined || value === null || value === '') continue;
    const box = best(boxes, concept);
    if (!box) { missing.push(concept); continue; }
    if (!(await type(doc, box.control, value))) missing.push(concept);
  }

  for (const [concept, wanted] of values.toggles || []) {
    if (!wanted) continue;
    const toggle = best(snap.controls.filter((c) => c.cap === CAP.TOGGLE && !c.disabled), concept);
    if (!toggle) { missing.push(concept); continue; }
    const result = await setToggle(doc, toggle.control, true);
    if (!result.ok) missing.push(concept);
    else log('set', concept);
  }

  const submit = best(actions(doc), 'commit') || best(actions(doc), 'create');
  if (!submit) return { ok: false, reason: 'nothing on this dialog commits it', missing };
  await press(doc, submit.control);

  return { ok: true, missing };
}

/**
 * Open a record's designer.
 *
 * "In the designer" is corroborated: a library of things to add AND somewhere
 * to name what you added. A breadcrumb alone, or a palette-shaped navigation
 * bar alone, is not enough — that mistake cost one agent every run it ever made
 * on the mock it was written against.
 */
export async function openDesigner(doc, recordName, { hasPalette }) {
  const rowControls = controlsBeside(doc, recordName);
  const pool = rowControls.length ? rowControls : actions(doc);

  for (const candidate of rank(pool, 'edit').slice(0, 3)) {
    await press(doc, candidate.control);
    if (inDesigner(doc, { hasPalette })) return { ok: true, via: candidate.control.name };
  }

  // The record's own name is frequently the way in.
  const byName = await openNamed(doc, recordName);
  if (byName.ok && inDesigner(doc, { hasPalette })) return { ok: true, via: recordName };

  return { ok: false, reason: `could not open the designer for "${recordName}"` };
}

/**
 * Two signals, not one — but the second must be something an EMPTY designer has.
 *
 * A designer with nothing on its canvas yet has no field to name, so its
 * options panel is bare; insisting on a label input means the agent stands in
 * the designer and reports that it could not open it. What an empty designer
 * always has, besides a library, is a way to keep the work and a way back out.
 */
export function inDesigner(doc, { hasPalette }) {
  const palette = hasPalette(doc);
  if (!palette) return false;
  // A library that is CALLED a library is evidence by itself. A list of records
  // is never sitting under a heading that says "Elements" or "Question
  // Palette", so this cannot be satisfied by a table of forms — while insisting
  // on a visible save cannot be satisfied by a designer that keeps its save in
  // an overflow menu, which is a real and common shape.
  // A library that is CALLED a library is evidence by itself — and so is one
  // that is unmistakably shaped like a library: a decent number of entries, all
  // different, and none of them the visits or forms this run created. Requiring
  // the name as well would fail any designer whose catalogue has no heading and
  // whose save is behind an overflow menu, which is a real combination.
  if (palette.named) return true;
  // Size is the honest discriminator for an unnamed library. A study can ask
  // for any of thirteen canonical field types, so a designer that supports the
  // work has to offer roughly that many — while an application chrome offers a
  // handful of areas. Six was not enough: a nav bar plus a back link reaches it,
  // and the agent then walks out of a list it had just returned to.
  if (palette.members.length >= 10 && palette.variety >= 0.9 && !palette.ours) return true;

  const snap = snapshot(doc);
  const pressable = snap.controls.filter((c) => c.cap === CAP.ACTION && !c.disabled);
  const corroborating = [
    best(snap.controls.filter((c) => c.cap === CAP.TEXT && !c.disabled), 'label'), // a field to name
    best(pressable, 'commit'), // somewhere to keep it
  ].filter(Boolean);

  // A way back is deliberately NOT evidence. Every screen in an application
  // has one, so accepting it means any page carrying four buttons reads as a
  // designer — and the agent then presses back again from the list it just
  // returned to, landing a screen further out than it meant to and unable to
  // find the record it came from. What an empty designer has that a list of
  // records does not is somewhere to keep an edit.
  return corroborating.length > 0;
}

/**
 * Leave the designer, judged by having left.
 *
 * The way out is often not called "back". A breadcrumb is named after its
 * DESTINATION — "← Screening" — so a vocabulary looking for back-words finds
 * nothing and the agent stays where it is, unable to save or reopen anything.
 * So three kinds of candidate are tried, in decreasing confidence, and each is
 * judged by whether the designer is behind us afterwards.
 *
 * `towards` is the name of the thing that contains this one, when the caller
 * knows it. It is a hint, never a requirement.
 */
export async function leaveDesigner(doc, { hasPalette, towards = '', attempts = 4 }) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (!inDesigner(doc, { hasPalette })) return { ok: true };

    const candidate = wayOut(doc, towards, attempt);
    if (!candidate) break;
    await press(doc, candidate);
  }
  return inDesigner(doc, { hasPalette })
    ? { ok: false, reason: 'nothing on this screen led out of the designer' }
    : { ok: true };
}

/** Leading arrows and chevrons: how a breadcrumb marks itself in any language. */
const POINTS_BACK = /^\s*[←‹«⟵<]/;

function wayOut(doc, towards, skip = 0) {
  const pressable = actions(doc);
  const ordered = [
    // Named after where it goes, and that is where we came from.
    ...(towards ? pressable.filter((c) => text(c.name).includes(text(towards))) : []),
    // Marked as pointing back, whatever it is called.
    ...pressable.filter((c) => POINTS_BACK.test(c.name)),
    // Actually says "back".
    ...rank(pressable, 'back').map((r) => r.control),
  ];

  const seen = new Set();
  const unique = ordered.filter((c) => !seen.has(c.el) && seen.add(c.el));
  return unique[skip] || unique[0] || null;
}

/**
 * The controls that belong to a named record.
 *
 * A list gives every record the same buttons — Edit, Activate, Delete — and the
 * only thing that says which row is which is the name sitting a cell away. That
 * name is usually not the button's label, nor a heading above it, so scoping by
 * accessible context finds nothing and the agent falls back to "the first Edit
 * on the page". It then designs the first record over and over while believing
 * it is working through the list.
 *
 * So the record is found by its text, and the smallest container holding both
 * that text and something pressable is the row. Works for a table row, a card,
 * or a list item, because it asks about containment rather than about markup.
 */
export function controlsBeside(doc, recordName) {
  const snap = snapshot(doc);
  const pressable = snap.controls.filter((c) => c.cap === CAP.ACTION && !c.disabled);

  for (const labelNode of elementsShowing(doc, recordName)) {
    let node = labelNode.parentElement;
    for (let up = 0; up < 5 && node; up++) {
      const inside = pressable.filter((c) => node.contains(c.el) && c.el !== labelNode);
      // A row's worth of controls, not a whole screen's.
      if (inside.length > 0 && inside.length <= 6) return inside;
      if (inside.length > 6) break;
      node = node.parentElement;
    }
  }
  return [];
}
