/*
 * The ledger.
 *
 * A counter that increments when an action is dispatched reports a fuller
 * build than the platform holds: 195 fields "built" against 175 stored, four
 * visits "built" against two saved. These tests hold the line that it may only
 * increment once the platform has been asked afterwards and agreed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { fileURLToPath } from 'node:url';

import { makeLedger, planOf } from '../src/orchestrate.js';

/*
 * The study specification is the assignment's material and is not published here.
 *
 * These tests need it, so they skip when it is absent rather than fail — the
 * suite stays meaningful for anyone who has the assignment and honest for
 * anyone who does not. Point STUDY_IR at your own copy, or drop it beside the
 * repository as fixtures/abc-101-study.ir.json.
 */
const IR_PATH = process.env.STUDY_IR
  || fileURLToPath(new URL('../fixtures/abc-101-study.ir.json', import.meta.url));
const HAVE_IR = existsSync(IR_PATH);

test('the plan counts everything the specification asks for', (t) => {
  if (!HAVE_IR) return t.skip('the study specification is not beside this repository');
  const ir = JSON.parse(readFileSync(IR_PATH, 'utf8'));
  const plan = planOf(ir);

  const count = (kind) => plan.filter((i) => i.kind === kind).length;
  assert.equal(count('visit'), 4);
  assert.equal(count('form'), 28);
  assert.equal(count('field'), 195);
  assert.equal(count('rule'), 13);
  assert.equal(plan.length, 240, 'four numbers a reviewer can check against the brief');
});

test('everything starts unreached, and nothing is unaccounted for', (t) => {
  if (!HAVE_IR) return t.skip('the study specification is not beside this repository');
  const ledger = makeLedger(planOf(JSON.parse(readFileSync(IR_PATH, 'utf8'))));
  const counts = ledger.counts();
  assert.equal(counts.built, 0);
  assert.equal(counts.unreached, 240);
  assert.equal(counts.unaccounted, 0);
});

test('an item moved between states is never counted twice', (t) => {
  if (!HAVE_IR) return t.skip('the study specification is not beside this repository');
  const ledger = makeLedger([
    { kind: 'field', path: 'a', name: 'A' },
    { kind: 'field', path: 'b', name: 'B' },
  ]);
  ledger.unreached('a', 'built, awaiting verification');
  ledger.built('a');
  ledger.escalated('b', 'the platform will not show its units');

  const counts = ledger.counts();
  assert.deepEqual(
    { built: counts.built, escalated: counts.escalated, unreached: counts.unreached },
    { built: 1, escalated: 1, unreached: 0 },
  );
  assert.equal(counts.unaccounted, 0);
});

test('an escalated item keeps the reason a reviewer needs', (t) => {
  if (!HAVE_IR) return t.skip('the study specification is not beside this repository');
  const ledger = makeLedger([{ kind: 'field', path: 'a', name: 'Hematocrit' }]);
  ledger.escalated('a', 'units % did not read back');
  const row = ledger.entries()[0];
  assert.equal(row.status, 'escalated');
  assert.match(row.note, /units/);
});

test('the totals always reconcile, whatever happened during the run', (t) => {
  if (!HAVE_IR) return t.skip('the study specification is not beside this repository');
  const plan = Array.from({ length: 50 }, (_, i) => ({ kind: 'field', path: `f${i}`, name: `F${i}` }));
  const ledger = makeLedger(plan);
  for (let i = 0; i < 20; i++) ledger.built(`f${i}`);
  for (let i = 20; i < 33; i++) ledger.escalated(`f${i}`, 'asked a human');
  // the rest were never reached at all

  const counts = ledger.counts();
  assert.equal(counts.built + counts.escalated + counts.unreached, counts.plan);
  assert.equal(counts.unaccounted, 0, 'a run that has lost track of itself must say so');
});
