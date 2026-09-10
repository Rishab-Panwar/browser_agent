/*
 * orchestrate.js — the run.
 *
 * The ordering is not a preference; each step exists because doing it any other
 * way loses data on some platform:
 *
 *   Visits, then every document under a visit, then a designer session per
 *   document. Calibration happens once, inside the first designer opened, and
 *   the probes are discarded by leaving without committing.
 *
 *   Within a form: fields in specification order, type chosen at creation and
 *   never changed afterwards, then display rules as a SECOND pass — a rule can
 *   name a field defined below it, and a controller that does not exist yet
 *   cannot be offered.
 *
 *   Then commit, leave, reopen, and read every field back. What the platform
 *   holds after a round trip is the only evidence that counts.
 *
 * The ledger is strict: every item in the plan is built, escalated or
 * unreached, and `built` increments only after read-back. A counter that
 * increments on action is a to-do list: it records what was attempted, and an
 * attempt that silently failed still counts. A build reported as complete while
 * the platform holds less is the failure this exists to prevent.
 */

import { CAP, text } from './capabilities.js';
import { snapshot } from './perceive.js';
import { press, pressElement, revealHidden, settle, type as typeInto } from './act.js';
import { CANONICAL, CONFIDENT, findPalette, learnCommit, learnTypes } from './calibrate.js';
import { buildField, labelInput, readField, setDisplayRule } from './build.js';
import {
  alreadyListed, elementsShowing, fillCreationForm, goTo, inDesigner, leaveDesigner, namedInText, openDesigner, openNamed,
} from './navigate.js';
import { best, rank, score as scoreWord } from './vocabulary.js';

/** Everything the specification asks for, as countable items. */
export function planOf(ir) {
  const items = [];
  for (const [v, visit] of ir.visits.entries()) {
    items.push({ kind: 'visit', path: `visits[${v}]`, name: visit.name });
    for (const [f, form] of visit.forms.entries()) {
      items.push({ kind: 'form', path: `visits[${v}].forms[${f}]`, name: form.name, visit: visit.name });
      for (const [d, field] of form.fields.entries()) {
        items.push({
          kind: 'field', path: `visits[${v}].forms[${f}].fields[${d}]`,
          name: field.label, visit: visit.name, form: form.name,
        });
        if (field.skip_logic) {
          items.push({
            kind: 'rule', path: `visits[${v}].forms[${f}].fields[${d}].skip_logic`,
            name: field.label, visit: visit.name, form: form.name,
          });
        }
      }
    }
  }
  return items;
}

/**
 * The ledger.
 *
 * Nothing is counted twice and nothing goes uncounted. `unaccounted` should
 * always be zero; if it is not, the run has lost track of itself, and saying so
 * is more useful than a plausible-looking total.
 */
export function makeLedger(plan, onChange = () => {}) {
  const state = new Map(plan.map((item) => [item.path, { item, status: 'unreached', note: '' }]));
  // Every settled item is announced as it happens. A run that says only
  // "building…" for two minutes gives a reviewer no way to tell work from a
  // hang, and the counts already exist — there is nothing to estimate.
  const settle = (path, status, note) => {
    state.set(path, { ...state.get(path), status, note });
    onChange(counts(), state.get(path));
  };
  const counts = () => {
    const totals = { built: 0, escalated: 0, unreached: 0 };
    for (const row of state.values()) totals[row.status] += 1;
    return { ...totals, plan: state.size, unaccounted: state.size - (totals.built + totals.escalated + totals.unreached) };
  };
  return {
    built: (path, note = '') => settle(path, 'built', note),
    escalated: (path, note) => settle(path, 'escalated', note),
    unreached: (path, note) => settle(path, 'unreached', note),
    get: (path) => state.get(path),
    entries: () => [...state.values()],
    counts,
  };
}

/**
 * Run a whole study build.
 *
 * `ask` is the human gate: it is given a question with the evidence behind it
 * and returns a decision. Anything the agent cannot settle honestly goes there
 * rather than being guessed — an item that was asked about is never counted as
 * built.
 */
export async function run(doc, ir, { ask, log = () => {}, stopped = () => false, progress = () => {} } = {}) {
  const plan = planOf(ir);
  const ledger = makeLedger(plan, progress);
  const platform = { types: {}, commit: null, commitName: '' };
  // Hands back the palette itself, not just a yes: callers need to know whether
  // it is a library by name as well as by shape.
  // The names of everything this run creates. A catalogue never contains them;
  // a navigation tree is made of them.
  const known = ir.visits.flatMap((v) => [v.name, ...v.forms.map((f) => f.name)]);
  const hasPalette = (page) => findPalette(page, { known });
  const warnings = [];

  const halt = () => stopped() ? { stopped: true } : null;

  // ── 1. visits ──────────────────────────────────────────────────────────────
  const toSchedule = await goTo(doc, {
    creates: 'visit',
    expectedNames: ir.visits.map((v) => v.name),
    notWhen: ['palette'],
    hints: ['visit'],
  });
  if (!toSchedule.ok) {
    await ask({
      kind: 'lost', path: 'visits',
      question: 'I cannot find the screen where visits are created. Please navigate there, then choose Retry.',
      evidence: [toSchedule.reason, `Tried: ${toSchedule.tried.join(', ') || 'nothing that looked like a way there'}`],
      options: [{ id: 'retry', label: 'Retry (I navigated there)' }, { id: 'stop', label: 'Stop the run' }],
    });
  }

  for (const [v, visit] of ir.visits.entries()) {
    if (halt()) break;
    const path = `visits[${v}]`;

    if (alreadyListed(doc, visit.name)) {
      ledger.built(path, 'already present');
      log('skip', `visit "${visit.name}" already exists`);
    } else {
      const opened = await openCreationForm(doc, 'visit');
      if (!opened) {
        ledger.unreached(path, 'no control creates a visit here');
        continue;
      }
      const filled = await fillCreationForm(doc, {
        text: [['visit', visit.name], ['windowStart', visit.window_start_day], ['windowEnd', visit.window_end_day]],
      }, { log });
      await settle(doc);

      if (alreadyListed(doc, visit.name)) {
        ledger.built(path);
        log('built', `visit "${visit.name}"`);
        if (filled.missing.length) warnings.push(`${path}: could not set ${filled.missing.join(', ')}`);
      } else {
        ledger.escalated(path, 'the visit did not appear after committing the form');
      }
    }
  }

  // ── 2. documents, then fields, one visit at a time ────────────────────────
  for (const [v, visit] of ir.visits.entries()) {
    if (halt()) break;

    await goTo(doc, { creates: 'visit', expectedNames: ir.visits.map((x) => x.name), notWhen: ['palette'], mustShow: visit.name });
    const entered = await openNamed(doc, visit.name);
    if (!entered.ok) {
      for (const item of plan.filter((i) => i.visit === visit.name)) {
        ledger.unreached(item.path, `could not open visit "${visit.name}"`);
      }
      continue;
    }

    // 2a. every document exists before any is designed
    for (const [f, form] of visit.forms.entries()) {
      if (halt()) break;
      const path = `visits[${v}].forms[${f}]`;

      if (alreadyListed(doc, form.name)) { ledger.built(path, 'already present'); continue; }

      const opened = await openCreationForm(doc, 'form');
      if (!opened) { ledger.unreached(path, 'no control creates a document here'); continue; }

      const filled = await fillCreationForm(doc, {
        text: [['form', form.name]],
        toggles: [['repeating', form.repeating]],
      }, { log });
      await settle(doc);

      if (alreadyListed(doc, form.name)) {
        ledger.built(path);
        log('built', `document "${form.name}"`);
        if (form.repeating && filled.missing.includes('repeating')) {
          ledger.escalated(path, 'created, but nothing on the dialog marks it as a repeating log');
        }
      } else {
        ledger.escalated(path, 'the document did not appear after committing the form');
      }
    }

    // 2b. design each document
    for (const [f, form] of visit.forms.entries()) {
      if (halt()) break;
      const formPath = `visits[${v}].forms[${f}]`;
      const fieldItems = plan.filter((i) => i.path.startsWith(`${formPath}.fields`));

      const design = await openDesigner(doc, form.name, { hasPalette });
      if (!design.ok) {
        for (const item of fieldItems) ledger.unreached(item.path, design.reason);
        continue;
      }

      // Calibrate once, in the first designer we reach, then discard the probes
      // by leaving without committing.
      if (!platform.commit) {
        const ready = await calibrate(doc, { platform, ask, log, hasPalette, form, visit, warnings, known });
        if (!ready.ok) {
          for (const item of fieldItems) ledger.unreached(item.path, ready.reason);
          return finish({ ledger, platform, warnings, reason: ready.reason });
        }
        const reopened = await openDesigner(doc, form.name, { hasPalette });
        if (!reopened.ok) {
          for (const item of fieldItems) ledger.unreached(item.path, reopened.reason);
          continue;
        }
      }

      await buildForm(doc, { form, formPath, platform, ledger, ask, log, halt });

      // Commit, leave, come back, and let the platform say what it kept.
      await commit(doc, platform, log);
      await leaveDesigner(doc, { hasPalette, towards: visit.name });
      const audit = await openDesigner(doc, form.name, { hasPalette });
      if (!audit.ok) {
        for (const item of fieldItems) ledger.escalated(item.path, 'built, but could not reopen the form to verify it');
      } else {
        await verifyForm(doc, { form, formPath, ledger, log });
      }
      await leaveDesigner(doc, { hasPalette, towards: visit.name });
    }
  }

  return finish({ ledger, platform, warnings });
}

/**
 * Press whatever creates a thing of this kind, and confirm a dialog opened.
 *
 * "Add" alone is ambiguous on a screen that can add several things, so the
 * candidate must read as creating THIS kind — by its own name or by the
 * heading it sits under. Success is judged by somewhere to type appearing,
 * not by having pressed something.
 */
async function openCreationForm(doc, kind) {
  const before = snapshot(doc);
  const candidates = rank(before.controls.filter((c) => c.cap === CAP.ACTION && !c.disabled), 'create')
    .filter((c) => scoreWord(c.control.name, kind) > 0
      || (c.control.context || []).some((bit) => scoreWord(bit, kind) > 0));

  for (const candidate of (candidates.length ? candidates : rank(before.controls.filter((c) => c.cap === CAP.ACTION && !c.disabled), 'create')).slice(0, 3)) {
    await press(doc, candidate.control);
    const grew = snapshot(doc).controls.filter(
      (c) => c.cap === CAP.TEXT && !before.controls.some((b) => b.el === c.el),
    );
    if (grew.length) return true;
  }
  return false;
}

/** Learn the platform: what its library entries mean, and what really saves. */
async function calibrate(doc, { platform, ask, log, hasPalette, form, visit, warnings = [], known = [] }) {
  log('calibrate', 'probing the element library');
  const learned = await learnTypes(doc, {
    known,
    removeProbe: async (page) => {
      const { best } = await import('./vocabulary.js');
      const { CAP } = await import('./capabilities.js');
      const remove = best(snapshot(page).controls.filter((c) => c.cap === CAP.ACTION && !c.disabled), 'remove');
      if (remove) await press(page, remove.control);
    },
  });
  if (!learned.ok) return { ok: false, reason: learned.reason };
  platform.types = learned.map;

  await leaveDesigner(doc, { hasPalette, towards: visit.name }); // discard the probe fields
  const back = await openDesigner(doc, form.name, { hasPalette });
  if (!back.ok) return { ok: false, reason: back.reason };

  log('calibrate', 'proving which control actually saves');
  const commitLearned = await learnCommit(doc, {
    plantMarker: async (page, marker) => {
      const anyEntry = Object.values(platform.types)[0];
      if (!anyEntry) return false;
      const entry = snapshot(page).controls.find((c) => c.name === anyEntry.entry);
      if (!entry) return false;
      await press(page, entry);
      const namer = labelInput(page);
      if (!namer) return false;
      const { type } = await import('./act.js');
      return type(page, namer, marker);
    },
    leave: async (page) => leaveDesigner(page, { hasPalette, towards: visit.name }),
    reopen: async (page) => openDesigner(page, form.name, { hasPalette }),
    markerPresent: async (page, marker) => namedInText(page, marker)
      || snapshot(page).controls.some((c) => text(c.name) === marker || text(c.value) === marker),
    removeMarker: async (page, marker) => {
      // A delete control acts on the SELECTED field. Removing the marker without
      // selecting it first leaves calibration residue in a real form.
      await selectFieldOnCanvas(page, marker);
      const remove = best(snapshot(page).controls.filter((c) => c.cap === CAP.ACTION && !c.disabled), 'remove');
      if (remove) await press(page, remove.control);
    },
  });
  if (!commitLearned.ok) return { ok: false, reason: commitLearned.reason };
  if (commitLearned.residue) {
    warnings.push(`the calibration probe field "${commitLearned.marker}" could not be removed from "${form.name}" — delete it by hand`);
  }
  platform.commit = commitLearned.commit;
  platform.commitName = commitLearned.name;
  log('calibrate', `"${commitLearned.name}" is the control that persists`);

  // Everything learned, shown once, before a single real field is built.
  const uncertain = Object.entries(platform.types).filter(([, m]) => m.confidence < CONFIDENT);
  const decision = await ask({
    kind: 'calibration', path: 'platform',
    question: 'This is what I worked out about this platform. Build the study with it?',
    evidence: [
      ...CANONICAL.map((t) => {
        const m = platform.types[t];
        return m ? `${t} → "${m.entry}" (${m.confidence.toFixed(2)}) — ${m.evidence.join('; ') || 'by name only'}`
          : `${t} → nothing here means this`;
      }),
      `saves with: "${commitLearned.name}" (proved by a round trip)`,
    ],
    options: [
      { id: 'accept', label: 'Accept and build' },
      { id: 'stop', label: 'Stop — this is wrong' },
    ],
    uncertain: uncertain.map(([t]) => t),
    // What a reviewer may change, and to what. Offering the library's own
    // entries means a correction can always be acted on — and it makes
    // disagreeing with one mapping cost one dropdown rather than the whole run,
    // which is the difference between a queue that clears and one that doesn't.
    choices: uncertain.map(([type, m]) => ({
      type,
      chosen: m.entry,
      confidence: m.confidence,
      alternatives: learned.entries.filter((e) => !e.inert).map((e) => e.name),
    })),
  });
  if (decision && decision.id === 'stop') return { ok: false, reason: 'the reviewer rejected the calibration' };

  // A correction is the reviewer's knowledge, not a guess, so it replaces the
  // probe's answer outright and is recorded as theirs.
  for (const [type, entryName] of Object.entries((decision && decision.corrections) || {})) {
    const entry = learned.entries.find((e) => e.name === entryName);
    if (!entry) continue;
    platform.types[type] = { entry: entry.name, describe: entry.describe, confidence: 1, evidence: ['chosen by the reviewer'] };
    log('calibrate', `reviewer set ${type} → "${entry.name}"`);
  }

  // Hand the caller a clean starting point: it reopens the designer itself, and
  // from inside one there is no way in to find.
  await leaveDesigner(doc, { hasPalette, towards: visit.name });
  return { ok: true };
}

/** Fields in order, then display rules once every controller exists. */
async function buildForm(doc, { form, formPath, platform, ledger, ask, log, halt }) {
  for (const [d, field] of form.fields.entries()) {
    if (halt()) return;
    const path = `${formPath}.fields[${d}]`;
    const report = await buildField(doc, field, platform, { log });

    if (!report.ok) {
      ledger.escalated(path, report.reason || `did not take: ${(report.failed || []).join(', ')}`);
      continue;
    }
    if (report.missing.length) {
      ledger.escalated(path, `built, but this designer offers no ${report.missing.join(', ')}`);
      continue;
    }
    // Not counted yet: only the read-back after a save may do that.
    ledger.unreached(path, 'built, awaiting verification');
  }

  for (const [d, field] of form.fields.entries()) {
    if (!field.skip_logic || halt()) continue;
    const path = `${formPath}.fields[${d}].skip_logic`;
    const selected = await selectFieldOnCanvas(doc, field.label);
    if (!selected) {
      const showing = labelInput(doc);
      ledger.escalated(path, 'could not select the field to give it a rule; the panel is showing '
        + JSON.stringify(showing ? showing.value : '(no label input)'));
      continue;
    }

    const result = await setDisplayRule(doc, field.skip_logic, { log });
    if (result.ok) ledger.unreached(path, 'set, awaiting verification');
    else ledger.escalated(path, result.reason + (result.offered ? ` (offered: ${result.offered.join(', ')})` : ''));
  }
}

/**
 * Click a field on the canvas so the properties panel shows it.
 *
 * A field on a canvas is frequently not a control at all — a plain element with
 * a click handler, no role, no tabindex. Pressing the element that SHOWS the
 * name works anyway, because the handler sits on an ancestor and the event
 * bubbles up to it. Success is judged by the panel now naming that field, not
 * by having clicked.
 */
export async function selectFieldOnCanvas(doc, label) {
  const wanted = text(label);

  // Selection you already have is selection. The test is whether the panel
  // names this field — and it may name it before we touch anything, because the
  // field we just finished building is still the selected one. Pressing first
  // can only risk a state that was already correct, and reporting failure
  // without ever asking is how a field the panel was showing all along gets
  // escalated as unreachable.
  if (panelShows(doc, wanted)) return true;

  const control = snapshot(doc).controls.find((c) => text(c.name) === wanted);
  if (control) {
    await press(doc, control);
    if (panelShows(doc, wanted)) return true;
  }

  for (const node of elementsShowing(doc, wanted)) {
    await pressElement(doc, node);
    if (panelShows(doc, wanted)) return true;
  }

  // One last honest look. A press can land while the check straight after it
  // reads a panel that had not finished redrawing; what matters is where the
  // page ended up, not which attempt got it there.
  return panelShows(doc, wanted);
}

function panelShows(doc, wanted) {
  const namer = labelInput(doc);
  return !!namer && text(namer.value) === wanted;
}

/** Press the control proved to persist. Re-open a menu if it went back inside one. */
async function commit(doc, platform, log) {
  const { resolve } = await import('./perceive.js');
  const { revealHidden } = await import('./act.js');
  let control = resolve(doc, platform.commit);
  if (!control) {
    await revealHidden(doc);
    control = resolve(doc, platform.commit);
  }
  if (!control) return false;
  await press(doc, control);
  log('commit', `pressed "${platform.commitName}"`);
  return true;
}

/** Read every field back off the saved form; only now may anything count. */
async function verifyForm(doc, { form, formPath, ledger, log }) {
  for (const [d, field] of form.fields.entries()) {
    const path = `${formPath}.fields[${d}]`;
    const selected = await selectFieldOnCanvas(doc, field.label);
    if (!selected) {
      // A field that never got built is not a field that failed to save, and
      // saying so buries the reason it did not get built. The first failure is
      // the one worth reporting; this pass only speaks for fields it was told
      // were built.
      const already = ledger.get(path);
      if (already && already.status === 'escalated') continue;
      ledger.escalated(path, 'not on the form after saving');
      continue;
    }
    const { differences, unread } = readField(doc, field);
    if (differences.length) {
      ledger.escalated(path, differences.map((x) => `${x.part}: wanted ${JSON.stringify(x.wanted)}, found ${JSON.stringify(x.found)}`).join('; '));
    } else if (unread.length) {
      ledger.escalated(path, `present, but this designer will not show ${unread.join(', ')}: unverified`);
    } else {
      ledger.built(path);
    }

    if (field.skip_logic) {
      const rulePath = `${path}.skip_logic`;
      const row = ledger.get(rulePath);
      if (row && row.status !== 'escalated') ledger.built(rulePath);
    }
  }
  log('verify', `${form.name}: read back`);
}

function finish({ ledger, platform, warnings, reason }) {
  const counts = ledger.counts();
  return {
    counts,
    reason,
    warnings,
    platform: { types: platform.types, commit: platform.commitName },
    items: ledger.entries().map((row) => ({
      path: row.item.path, kind: row.item.kind, name: row.item.name, status: row.status, note: row.note,
    })),
  };
}
