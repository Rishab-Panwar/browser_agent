/*
 * panel.js — the reviewer's side of the run.
 *
 * Two jobs, and the second is the important one:
 *
 *   Show the ledger honestly. Built, escalated and unreached are three
 *   different things and are never added together into a single reassuring
 *   number. `unaccounted` is shown even though it should always be zero,
 *   because the run having lost track of itself is exactly the thing a
 *   progress bar would hide.
 *
 *   Put one question at a time, with the evidence behind it. A reviewer who is
 *   asked 195 times learns to click through without reading, which is worse
 *   than not asking.
 */

const $ = (id) => document.getElementById(id);

let ir = null;
let tabId = null;
const trace = [];

// ── loading the specification ────────────────────────────────────────────────

$('file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  // The browser's own file control is hidden so the panel can style the label,
  // which means the chosen name has to be shown here — a picker that still
  // reads "choose a file" after you chose one is the panel lying about state.
  const pick = document.querySelector('.file .pick');
  if (pick) pick.textContent = file.name;
  try {
    ir = JSON.parse(await file.text());
    const forms = ir.visits.reduce((n, v) => n + v.forms.length, 0);
    const fields = ir.visits.reduce((n, v) => n + v.forms.reduce((m, f) => m + f.fields.length, 0), 0);
    const rules = ir.visits.reduce((n, v) =>
      n + v.forms.reduce((m, f) => m + f.fields.filter((d) => d.skip_logic).length, 0), 0);
    $('spec').textContent =
      `${ir.study.protocol_id} — ${ir.visits.length} visits · ${forms} forms · ${fields} fields · ${rules} display rules`;
    $('run').disabled = false;
  } catch (error) {
    $('spec').textContent = `That file could not be read as a study specification: ${error.message}`;
    $('run').disabled = true;
  }
});

// ── running ──────────────────────────────────────────────────────────────────

$('run').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab.id;
  $('run').disabled = true;
  $('stop').disabled = false;
  $('status').textContent = 'putting the agent into this tab…';

  const injected = await chrome.runtime.sendMessage({ type: 'inject', tabId });
  if (!injected || !injected.ok) {
    $('status').textContent = `could not run here: ${injected && injected.error}`;
    $('run').disabled = false;
    return;
  }
  $('status').textContent = 'building…';
  chrome.tabs.sendMessage(tabId, { type: 'start', ir });
});

$('stop').addEventListener('click', () => {
  if (tabId) chrome.tabs.sendMessage(tabId, { type: 'stop' });
  $('status').textContent = 'stopping after the current item…';
});

$('export').addEventListener('click', async () => {
  const response = await chrome.tabs.sendMessage(tabId, { type: 'trace' });
  download('run.json', JSON.stringify(response, null, 2));
});

function download(name, content) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

// ── what the agent says ──────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case 'progress':
      showProgress(message);
      break;
    case 'log':
      trace.push(message.entry);
      appendTrace(message.entry);
      break;
    case 'ask':
      showQuestion(message.question);
      break;
    case 'answered':
      $('question').replaceChildren();
      break;
    case 'finished':
      $('status').textContent = message.report.stopped ? 'stopped' : 'finished';
      showLedger(message.report);
      $('run').disabled = false;
      $('stop').disabled = true;
      $('export').disabled = false;
      break;
    case 'failed':
      $('status').textContent = `stopped on an error: ${message.report.error}`;
      $('run').disabled = false;
      $('stop').disabled = true;
      $('export').disabled = false;
      break;
    default:
      break;
  }
});

/**
 * Where the run has got to, while it is still running.
 *
 * Settled items over planned items — never a percentage of elapsed time, and
 * never a bar that moves on its own. The number only advances when something
 * has actually been decided, so a run that has stopped making progress looks
 * stopped instead of looking busy.
 */
function showProgress({ counts, doing }) {
  const settled = (counts.built || 0) + (counts.escalated || 0);
  $('status').textContent = `building… ${settled} of ${counts.plan}${doing ? ` · ${doing}` : ''}`;
  showLedger({ counts });
}

function appendTrace(entry) {
  const line = document.createElement('div');
  line.className = `line ${entry.kind}`;
  line.textContent = `${entry.kind}  ${entry.message}`;
  $('trace').prepend(line);
}

/**
 * One question, its evidence, and what a person can do about it.
 *
 * The options come from the agent rather than being invented here, so a card
 * never offers a choice the run cannot act on.
 */
function showQuestion(question) {
  const card = document.createElement('div');
  card.className = 'card';

  const heading = document.createElement('h3');
  heading.textContent = question.question;
  card.append(heading);

  if (question.path) {
    const where = document.createElement('p');
    where.className = 'path';
    where.textContent = question.path;
    card.append(where);
  }

  const evidence = document.createElement('ul');
  evidence.className = 'evidence';
  for (const line of question.evidence || []) {
    const item = document.createElement('li');
    item.textContent = line;
    if (question.uncertain && question.uncertain.some((t) => line.startsWith(`${t} `))) {
      item.className = 'uncertain';
    }
    evidence.append(item);
  }
  card.append(evidence);

  // Anything the agent was unsure about can be corrected here, one row at a
  // time. The alternatives come from the platform's own library, so a
  // correction is always something the run can carry out.
  const corrections = {};
  for (const choice of question.choices || []) {
    const row = document.createElement('label');
    row.className = 'correction';

    const name = document.createElement('span');
    name.textContent = `${choice.type} (${choice.confidence.toFixed(2)})`;
    row.append(name);

    const picker = document.createElement('select');
    for (const entry of choice.alternatives) {
      const option = document.createElement('option');
      option.value = entry;
      option.textContent = entry;
      if (entry === choice.chosen) option.selected = true;
      picker.append(option);
    }
    picker.addEventListener('change', () => {
      if (picker.value === choice.chosen) delete corrections[choice.type];
      else corrections[choice.type] = picker.value;
      row.classList.toggle('changed', picker.value !== choice.chosen);
    });
    row.append(picker);
    card.append(row);
  }

  for (const option of question.options || []) {
    const button = document.createElement('button');
    button.textContent = option.label;
    button.addEventListener('click', () => chrome.tabs.sendMessage(tabId, { type: 'answer', id: option.id, corrections }));
    card.append(button);
  }

  $('question').replaceChildren(card);
}

/** Built, escalated and unreached, kept apart. */
function showLedger(report) {
  const counts = report.counts || {};
  $('ledger').replaceChildren();
  for (const [label, value, tone] of [
    ['built', counts.built, 'good'],
    ['escalated', counts.escalated, 'warn'],
    ['unreached', counts.unreached, 'warn'],
    ['unaccounted', counts.unaccounted, counts.unaccounted ? 'bad' : 'good'],
    ['in the plan', counts.plan, ''],
  ]) {
    const box = document.createElement('div');
    box.className = `count ${tone}`;
    box.innerHTML = `<b>${value ?? '—'}</b><span>${label}</span>`;
    $('ledger').append(box);
  }

  const open = (report.items || []).filter((i) => i.status !== 'built');
  if (open.length) {
    const list = document.createElement('ul');
    list.className = 'open';
    for (const item of open.slice(0, 40)) {
      const row = document.createElement('li');
      row.textContent = `${item.kind} “${item.name}” — ${item.note || item.status}`;
      list.append(row);
    }
    $('ledger').append(list);
  }
}
