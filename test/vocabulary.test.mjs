/*
 * Reading names.
 *
 * Both cases below cost a real run: an ellipsis glued to the word before it
 * hid the only conditional option a designer offered, and a lone symbol has to
 * survive tokenising because a control named "+" or "…" means something.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { words, score } from '../src/vocabulary.js';

test('a trailing ellipsis does not swallow the word before it', () => {
  assert.deepEqual(words('Visible When…'), ['visible', 'when', '…']);
  assert.ok(score('Visible When…', 'conditionalMode') > 0,
    'this is the only conditional option some designers offer');
});

test('a lone symbol is still a word', () => {
  assert.deepEqual(words('+'), ['+']);
  assert.deepEqual(words('…'), ['…']);
});

test('an unconditional option is not mistaken for a conditional one', () => {
  assert.ok(score('Always Show', 'conditionalMode') <= 0);
  assert.ok(score('Visible', 'conditionalMode') <= 0);
});

test('other punctuation is noise', () => {
  assert.deepEqual(words('Window Start (day)'), ['window', 'start', 'day']);
  assert.deepEqual(words('Yes / No Switch'), ['yes', 'no', 'switch']);
});
