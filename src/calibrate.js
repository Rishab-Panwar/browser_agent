/*
 * calibrate.js — learning a platform by experiment, before trusting it.
 *
 * Two things have to be discovered on any eSource the agent has not seen:
 *
 *   which library entry means which canonical field type, and
 *   which control actually persists an edit.
 *
 * Neither can be settled by reading names. Element libraries put near-identical
 * words next to each other — a list-of-choices control one row from a single
 * tick box — and toolbars put a control that saves a *copy* beside the one that
 * saves the document. The words are the same; the behaviour is not.
 *
 * So both are settled the same way: do the thing, watch what changes, and keep
 * the answer only if the page proves it. What is learned lands in a `platform`
 * object the rest of the run consults; nothing here is remembered between
 * platforms.
 */

import { CAP, text } from './capabilities.js';
import { appeared, describe, groups, snapshot } from './perceive.js';
import { press, revealHidden, settle, type } from './act.js';
import { best, rank, score } from './vocabulary.js';

/** The thirteen types a study specification can ask for. */
export const CANONICAL = [
  'text', 'textarea', 'integer', 'decimal', 'date', 'time', 'datetime',
  'boolean', 'single_select', 'multi_select', 'radio', 'checkbox', 'calculated',
];

/** Confidence below this is not acted on; it becomes a question for a human. */
export const CONFIDENT = 0.6;

/**
 * Find the element library.
 *
 * Candidate groups come from several levels of containment, because a palette's
 * entries may be siblings or each wrapped in their own element. They are then
 * scored, rather than the first one being taken: a navigation bar is also a
 * group of similar buttons, and preferring whichever was found first is how a
 * four-item menu gets mistaken for a thirteen-item library.
 */
/**
 * Something a library could offer you: a thing you pick to add.
 *
 * Buttons are the common shape, but a catalogue rendered as a listbox is just
 * as ordinary, and its entries are options rather than buttons. Insisting on
 * buttons means such a library is not seen at all — the agent then stands in
 * the designer and reports it could not find one.
 *
 * A native <option> is excluded on purpose. It is a value inside a chooser, not
 * a control in its own right, and a long <select> would otherwise look like an
 * element library every time one is open.
 */
const isCatalogueEntry = (control) =>
  control.cap === CAP.ACTION
  || (control.cap === CAP.OPTION && control.el && control.el.tagName !== 'OPTION');

export function findPalette(doc, { known = [] } = {}) {
  const isKnown = new Set(known.map((n) => String(n).trim().toLowerCase()));
  const snap = snapshot(doc);
  const candidates = groups(snap, { minSize: 4 })
    .filter((group) => group.members.every(isCatalogueEntry))
    .map((group) => {
      const context = group.members[0].context.join(' ');
      const averageWords = group.members.reduce((n, m) => n + m.name.split(/\s+/).length, 0) / group.members.length;
      const distinct = new Set(group.members.map((m) => m.name.toLowerCase())).size;
      const variety = distinct / group.members.length;
      // A library offers things you do not have yet; a study tree lists the
      // ones you already made. We know what we made, so a group whose entries
      // are mostly the visits and forms from the plan is navigation — however
      // library-shaped it looks, and however tidily its names differ.
      const recognised = group.members.filter((m) => isKnown.has(m.name.trim().toLowerCase())).length;
      const ours = group.members.length ? recognised / group.members.length : 0;
      const named = score(context, 'palette') > 0;
      return {
        ...group,
        named,
        variety,
        ours,
        // Distinctness separates a library from a list of records: a library
        // offers a different KIND of thing per entry, while a record list gives
        // every row the same buttons, so twenty-one controls turn out to be
        // three names repeated seven times. Counting controls alone, the longer
        // list wins — and an agent that takes an instrument list for an element
        // palette believes it is standing in a designer while looking at a table.
        //
        // A library is a longish list of short noun-ish labels sitting under a
        // heading that says so. Size counts, but not enough to let a big list of
        // anything win.
        score: score(context, 'palette') * 2
          + Math.min(distinct, 16) / 4
          + (averageWords <= 4 ? 1 : 0)
          + (variety >= 0.9 ? 1 : 0) // every entry its own kind of thing
          - (ours > 0.5 ? 4 : 0) // the things we built: a tree of records, not a library
          - (variety < 0.5 ? 3 : 0) // the same buttons once per row: a list of records
          - (group.level > 1 ? 0.25 : 0), // prefer the tighter grouping when both fit
      };
    })
    .sort((a, b) => b.score - a.score);

  return candidates[0] || null;
}

/**
 * Try every library entry once and record what the page did about it.
 *
 * The classification never reads the entry's name for meaning. It asks what
 * appeared: a coded-values editor, a range, a decimal precision, a formula box,
 * and what the field itself renders as. Names only break ties between entries
 * whose behaviour is identical.
 */
export async function learnTypes(doc, { removeProbe, known = [] }) {
  const palette = findPalette(doc, { known });
  if (!palette) return { ok: false, reason: 'no element library found on this screen' };

  const entries = [];
  for (const entry of palette.members) {
    const before = snapshot(doc);
    const pressed = await press(doc, entry);
    if (!pressed) continue;
    const after = snapshot(doc);
    const revealed = appeared(before, after);

    const facets = readFacets(revealed);
    entries.push({ name: entry.name, describe: describe(entry, before), facets, inert: revealed.length === 0 });

    await removeProbe(doc);
  }

  const usable = entries.filter((e) => !e.inert);
  if (usable.length === 0) return { ok: false, reason: 'no library entry did anything when pressed' };

  return { ok: true, palette, entries, map: assign(usable) };
}

/**
 * What a field's configuration surface tells us about its type.
 *
 * Read from what APPEARED, so a control that was already on screen for some
 * other reason cannot be mistaken for evidence about this entry.
 */
/**
 * Names a properties panel gives its own controls.
 *
 * A designer shows two things at once: the surface that CONFIGURES a field, and
 * a preview of the field itself. Both are made of ordinary controls, and only
 * the preview says anything about what the field is — a Visibility dropdown in
 * the panel is not the field rendering a chooser, and a bulk-paste textarea is
 * not the field being multi-line.
 *
 * The panel names its controls after properties; the preview is named after the
 * field. That is the line drawn here.
 */
const PANEL_CONCEPTS = [
  'label', 'required', 'hidden', 'minimum', 'maximum', 'units', 'decimals', 'formula',
  'visibility', 'controllingField', 'comparisonValue', 'code', 'optionLabel',
  'addValue', 'bulkValues', 'remove', 'commit', 'palette',
];

const isPanelControl = (control) =>
  PANEL_CONCEPTS.some((concept) => score(control.name, concept) > 0);

function readFacets(revealed) {
  // Context is not evidence here. A panel headed "Options" would otherwise make
  // every field on every platform look like it has a coded values editor.
  const namedFor = (concept) => revealed.some((c) => score(c.name, concept) > 0);

  const preview = revealed.filter((c) => !isPanelControl(c));
  const inputs = preview.filter((c) => c.cap === CAP.TEXT && c.el.tagName === 'INPUT');
  const inputTypes = inputs.map((c) => (c.el.getAttribute('type') || 'text').toLowerCase());
  const hints = inputs.map((c) => temporalHint(c.el));

  return {
    // A coded list is offered when the panel grows somewhere to put a code and
    // its label, or something that adds another one — not when a heading
    // happens to use the word "options".
    codedValues: (namedFor('code') && namedFor('optionLabel')) || namedFor('addValue') || namedFor('bulkValues'),
    range: namedFor('minimum') && namedFor('maximum'),
    decimals: namedFor('decimals'),
    formula: namedFor('formula'),

    // Everything below is about the FIELD, so the panel's own controls are out.
    multiline: preview.some((c) => c.cap === CAP.TEXT && c.el.tagName === 'TEXTAREA'),
    chooser: preview.some((c) => c.cap === CAP.CHOOSER),
    toggles: preview.filter((c) => c.cap === CAP.TOGGLE).length,
    date: inputTypes.includes('date') || hints.includes('date'),
    time: inputTypes.includes('time') || hints.includes('time'),
    datetime: inputTypes.includes('datetime-local') || hints.includes('datetime'),
    yesNo: preview.filter((c) => c.cap === CAP.ACTION && /^(yes|no|true|false)$/i.test(c.name)).length >= 2,
  };
}

/**
 * What a plain text box is asking for, judged by the shape it shows.
 *
 * Not every designer uses `type="date"`. Plenty render a bare text input and
 * tell the user what to put in it with a mask — "DD-MMM-YYYY", "HH:MM",
 * "YYYY-MM-DD HH:MM". Ignoring that leaves the three temporal types looking
 * identical, and they then get handed to each other's library entries.
 *
 * The masks themselves are not platform vocabulary: a day-month-year shape is a
 * date anywhere, in any product, in most languages.
 */
function temporalHint(el) {
  const shown = [
    el.getAttribute && el.getAttribute('placeholder'),
    el.getAttribute && el.getAttribute('pattern'),
  ].filter(Boolean).join(' ').toLowerCase();
  if (!shown) return null;

  const looksDate = /(d{1,4}\W*m{1,4}\W*y{2,4})|(y{4}\W*m{1,2}\W*d{1,2})|(m{2,4}\W*d{1,2}\W*y{2,4})/.test(shown);
  const looksTime = /h{1,2}\s*[:.]\s*m{2}/.test(shown);

  if (looksDate && looksTime) return 'datetime';
  if (looksDate) return 'date';
  if (looksTime) return 'time';
  return null;
}

/**
 * Score one entry against every canonical type.
 *
 * Behaviour first and heavily; the entry's own name only nudges. That ordering
 * is what defeats a library whose words are unhelpful — an entry called "Tally
 * Counter" shares no letters with `integer`, and is still unmistakable once you
 * see that it grew a range and no decimal precision.
 */
function classify(entry) {
  const f = entry.facets;
  const s = Object.fromEntries(CANONICAL.map((t) => [t, 0]));
  const bump = (types, n) => { for (const t of types) s[t] += n; };

  if (f.formula) bump(['calculated'], 8);
  if (f.codedValues) bump(['single_select', 'multi_select', 'radio'], 6);
  else bump(['text', 'textarea', 'integer', 'decimal', 'date', 'time', 'datetime', 'boolean', 'checkbox'], 1);

  if (f.range) bump(['integer', 'decimal'], 6);
  if (f.decimals) { bump(['decimal'], 5); bump(['integer'], -4); }
  else if (f.range) bump(['integer'], 2);

  if (f.datetime) bump(['datetime'], 8);
  if (f.date && !f.datetime) bump(['date'], 8);
  if (f.time && !f.datetime) bump(['time'], 8);
  if (f.multiline) bump(['textarea'], 6);
  if (f.yesNo) bump(['boolean'], 7);
  if (f.toggles === 1 && !f.codedValues) bump(['checkbox'], 5);
  if (f.chooser && f.codedValues) bump(['single_select'], 2);

  // The name breaks ties between entries the platform treats identically —
  // it never overrides what the platform actually did.
  const named = {
    text: ['text', 'string', 'line', 'short'],
    textarea: ['area', 'long', 'paragraph', 'multi', 'notes', 'comment'],
    integer: ['integer', 'whole', 'count', 'tally', 'number'],
    decimal: ['decimal', 'precise', 'fraction', 'float', 'measure', 'measurement'],
    date: ['date', 'day', 'calendar'],
    time: ['time', 'clock', 'hour'],
    datetime: ['datetime', 'timestamp', 'moment'],
    boolean: ['yes', 'no', 'boolean', 'switch', 'toggle'],
    single_select: ['dropdown', 'select one', 'pick one', 'menu', 'picklist', 'combo', 'selector'],
    multi_select: ['multi', 'many', 'check list', 'checklist', 'several', 'multiple'],
    radio: ['radio', 'option button', 'button', 'expanded'],
    checkbox: ['checkbox', 'tick', 'single tick', 'flag'],
    calculated: ['calculated', 'computed', 'derived', 'formula'],
  };
  const lowered = entry.name.toLowerCase();
  for (const [type, hints] of Object.entries(named)) {
    for (const hint of hints) if (lowered.includes(hint)) s[type] += 1.5;
  }

  const ranked = CANONICAL.map((t) => ({ type: t, score: s[t] })).sort((a, b) => b.score - a.score);
  const top = ranked[0];
  const runnerUp = ranked[1];
  const confidence = top.score <= 0 ? 0
    : Math.min(1, (top.score - Math.max(runnerUp.score, 0)) / Math.max(top.score, 1));
  return { ranked, best: top.type, confidence, evidence: describeFacets(f) };
}

function describeFacets(f) {
  const seen = [];
  if (f.formula) seen.push('a formula box appeared');
  if (f.codedValues) seen.push('a coded values editor appeared');
  if (f.range) seen.push(f.decimals ? 'a range with decimal precision' : 'a range with no decimal precision');
  if (f.multiline) seen.push('the field renders as multi-line text');
  if (f.yesNo) seen.push('the field renders yes/no controls');
  if (f.toggles === 1 && !f.codedValues) seen.push('the field renders a single tick');
  if (f.chooser) seen.push('the field renders a chooser');
  if (f.date) seen.push('a date input');
  if (f.time) seen.push('a time input');
  if (f.datetime) seen.push('a date-and-time input');
  return seen;
}

/**
 * Give each canonical type the entry that fits it best.
 *
 * Assigned in order of how sure we are, and an entry is used once: two types
 * cannot both be the same control. What is left unassigned is left unassigned —
 * a guess here builds 15 fields of the wrong type before anybody notices.
 */
function assign(entries) {
  const scored = [];
  for (const entry of entries) {
    const verdict = classify(entry);
    for (const { type, score: value } of verdict.ranked) {
      if (value > 0) scored.push({ type, entry, value, confidence: verdict.confidence, evidence: verdict.evidence });
    }
  }
  scored.sort((a, b) => b.value - a.value || b.confidence - a.confidence);

  const map = {};
  const usedEntries = new Set();
  for (const candidate of scored) {
    if (map[candidate.type] || usedEntries.has(candidate.entry.name)) continue;
    map[candidate.type] = {
      entry: candidate.entry.name,
      describe: candidate.entry.describe,
      confidence: candidate.confidence,
      evidence: candidate.evidence,
    };
    usedEntries.add(candidate.entry.name);
  }
  return map;
}

/**
 * Find the control that genuinely persists an edit.
 *
 * Names cannot settle this: a toolbar routinely offers "Save As Template",
 * "Store Draft Locally" and "Commit Changes" side by side, and two of those
 * throw the work away. So a marker field is planted, a candidate is pressed,
 * the builder is left and reopened, and the answer is kept only if the marker
 * survived the round trip. The marker is then removed and that removal saved,
 * so calibration leaves nothing behind.
 *
 * Candidates are looked for behind disclosures too: a control inside a closed
 * menu is not in the document, and cannot be found by any amount of scoring.
 */
export async function learnCommit(doc, { plantMarker, leave, reopen, markerPresent, removeMarker }) {
  const marker = 'Probe Field ZQX';
  const tried = [];

  for (let attempt = 0; attempt < 4; attempt++) {
    if (!(await plantMarker(doc, marker))) {
      return { ok: false, reason: 'could not create a field to test saving with', tried };
    }

    let candidates = commitCandidates(doc);
    if (candidates.length <= attempt) {
      await revealHidden(doc);
      candidates = commitCandidates(doc);
    }
    const candidate = candidates[attempt];
    if (!candidate) break;

    tried.push(candidate.control.name);
    await press(doc, candidate.control);
    await leave(doc);
    await reopen(doc);

    if (await markerPresent(doc, marker)) {
      const proof = describe(candidate.control, snapshot(doc));
      await removeMarker(doc, marker);

      // Removing the sentinel is only half of it: on a platform whose save sits
      // behind an overflow menu, that menu has closed again by now, so looking
      // only at what is visible finds no way to keep the deletion — and the
      // probe field survives in the saved form, in the middle of a real study.
      let again = commitCandidates(doc).find((c) => c.control.name === candidate.control.name);
      if (!again) {
        await revealHidden(doc);
        again = commitCandidates(doc).find((c) => c.control.name === candidate.control.name);
      }
      if (again) await press(doc, again.control);

      // Say so if it is still there. Residue left in someone's study is worth a
      // warning even when everything else about the run went well.
      const residue = await markerPresent(doc, marker);
      return { ok: true, commit: proof, name: candidate.control.name, tried, residue, marker };
    }
  }

  return { ok: false, reason: 'nothing on this screen persisted an edit', tried };
}

/** Save-ish controls, look-alikes already ranked below by the vocabulary. */
export function commitCandidates(doc) {
  const snap = snapshot(doc);
  return rank(snap.controls.filter((c) => c.cap === CAP.ACTION && !c.disabled), 'commit');
}

export { best, rank, score, snapshot, settle, text, type };
