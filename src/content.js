/*
 * content.js — the agent, running inside the page it is building into.
 *
 * Everything above this file is pure: it takes a document and returns
 * decisions. This is the only place that knows it is an extension — it holds
 * the message channel to the panel, and turns the panel's answers into the
 * promises the orchestrator is waiting on.
 *
 * The gate is implemented here rather than in the orchestrator so that a
 * question is always a real pause: the run stops at the await until a person
 * answers, and nothing is built in the meantime.
 */

import { run } from './orchestrate.js';

const state = {
  running: false,
  stopRequested: false,
  pending: null, // the question a human is currently looking at
  trace: [],
  report: null,
};

function log(kind, message, path = '') {
  const entry = { at: Date.now(), kind, message, path };
  state.trace.push(entry);
  send({ type: 'log', entry });
}

function send(message) {
  try {
    chrome.runtime.sendMessage(message);
  } catch {
    // The panel may be closed. A run does not depend on anyone watching.
  }
}

/**
 * Put a question to the reviewer and wait.
 *
 * Every question carries the evidence that produced it. A card that says only
 * "could not verify" tells a reviewer nothing they can act on; one that says
 * what was looked at, what was found, and what the specification wanted can be
 * answered in seconds.
 */
function ask(question) {
  return new Promise((resolve) => {
    state.pending = { question, resolve };
    log('ask', question.question, question.path);
    send({ type: 'ask', question });
  });
}

function answer(id, corrections = {}) {
  if (!state.pending) return;
  const { question, resolve } = state.pending;
  state.pending = null;
  const fixed = Object.entries(corrections);
  const said = fixed.length ? `${id} (corrected ${fixed.map(([t, e]) => `${t}→"${e}"`).join(', ')})` : id;
  log('answered', `${question.path || 'run'}: ${said}`);
  send({ type: 'answered', id });
  resolve({ id, corrections });
}

async function start(ir) {
  if (state.running) return;
  state.running = true;
  state.stopRequested = false;
  state.trace = [];
  state.report = null;
  const startedAt = Date.now();

  send({ type: 'started', plan: ir.visits.length });

  try {
    const report = await run(document, ir, {
      ask,
      log,
      stopped: () => state.stopRequested,
      progress: (counts, item) => send({ type: 'progress', counts, doing: item && item.item ? `${item.item.kind} "${item.item.name}"` : '' }),
    });
    state.report = { ...report, durationMs: Date.now() - startedAt, stopped: state.stopRequested };
    send({ type: 'finished', report: state.report });
  } catch (error) {
    // A crash is a result too, and hiding it behind a half-finished counter is
    // how a run gets reported as a success it was not.
    state.report = {
      error: String((error && error.message) || error),
      durationMs: Date.now() - startedAt,
    };
    log('error', state.report.error);
    send({ type: 'failed', report: state.report });
  } finally {
    state.running = false;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  switch (message && message.type) {
    case 'ping':
      respond({ ok: true, running: state.running, pending: state.pending ? state.pending.question : null });
      return true;
    case 'start':
      start(message.ir);
      respond({ ok: true });
      return true;
    case 'answer':
      answer(message.id, message.corrections);
      respond({ ok: true });
      return true;
    case 'stop':
      state.stopRequested = true;
      log('stop', 'stop requested; finishing the current item');
      respond({ ok: true });
      return true;
    case 'trace':
      respond({ trace: state.trace, report: state.report });
      return true;
    default:
      return false;
  }
});

log('ready', 'agent loaded in this tab');
