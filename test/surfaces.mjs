/*
 * surfaces.mjs — the agent against every eSource we can get hold of, headless.
 *
 * Not part of `npm test`: it needs mocks that live outside this package, and a
 * full study takes a while to build. It exists so a change to perception or
 * navigation can be checked against more than one platform before anyone is
 * asked to sit in front of a browser — the fastest bugs to fix are the ones
 * found without a human in the loop.
 *
 *   node test/surfaces.mjs all  <spec.ir.json>   every surface present here
 *   node test/surfaces.mjs meridian <spec.ir.json>  just the one
 *
 * Only Meridian ships with this repository; the rest are located through
 * SURFACES_ROOT and skipped when absent.
 *
 * Each surface is built, then its own saved state is read back and compared
 * against the input file by verify-build.mjs. The agent never reads that state.
 */
import { JSDOM } from 'jsdom';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run } from '../src/orchestrate.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const DIFFER = fileURLToPath(new URL('../verify-build.mjs', import.meta.url));

/*
 * Where the surfaces that do not ship here live.
 *
 * Only the Meridian mock is ours to publish, so it is the only one in this
 * repository. The rest are looked for on the machine and skipped when absent.
 *
 * Point SURFACES_ROOT at a directory holding them to run those too:
 *
 *   SURFACES_ROOT=/path/to/mocks node test/surfaces.mjs all spec.ir.json
 */
const ROOT = process.env.SURFACES_ROOT || '';
const IR = process.argv[3] || process.env.STUDY_IR || '';

const SURFACES = [
  { name: 'mock-a', what: "the assignment's own eSource mock", built: ROOT && `${ROOT}/esource-mock/dist` },
  { name: 'meridian', what: 'Meridian Clinical — Study Configuration (ours, ships here)', page: `${HERE}../mocks/meridian/index.html` },
  { name: 'second', what: 'a second study designer', page: ROOT && `${ROOT}/second/index.html` },
  { name: 'third', what: 'a third study designer', built: ROOT && `${ROOT}/third/dist` },
];

/** A page jsdom will actually run: bundles inlined, scripts moved past #app. */
function pageFor(surface) {
  if (surface.page) return { html: readFileSync(surface.page, 'utf8') };
  const dir = surface.built;
  let html = readFileSync(`${dir}/index.html`, 'utf8');
  const assets = readdirSync(`${dir}/assets`);
  const js = assets.find((f) => f.endsWith('.js'));
  const css = assets.find((f) => f.endsWith('.css'));
  html = html.replace(/<script[^>]*src="[^"]+"[^>]*><\/script>/, '');
  if (css) html = html.replace(/<link[^>]*href="[^"]+\.css"[^>]*>/, `<style>${readFileSync(`${dir}/assets/${css}`, 'utf8')}</style>`);
  // jsdom does not run type="module", and a classic script runs at once — so it
  // goes last, after the element the app mounts into exists.
  return { html: html.replace('</body>', `<script>${readFileSync(`${dir}/assets/${js}`, 'utf8')}</script></body>`) };
}

async function build(surface) {
  const dom = new JSDOM(pageFor(surface).html, { runScripts: 'dangerously', pretendToBeVisual: true });
  const win = dom.window;
  await new Promise((r) => setTimeout(r, 400));

  // Facilities jsdom lacks. None of them change what the agent decides.
  if (!win.PointerEvent) win.PointerEvent = win.MouseEvent;
  win.Element.prototype.scrollIntoView = () => {};
  win.Element.prototype.getBoundingClientRect = function () {
    return { width: 120, height: 24, top: 0, left: 0, right: 120, bottom: 24 };
  };
  globalThis.window = win;
  globalThis.document = win.document;
  globalThis.performance = globalThis.performance || win.performance;
  globalThis.MessageChannel = globalThis.MessageChannel || win.MessageChannel;
  globalThis.MutationObserver = win.MutationObserver;

  const started = Date.now();
  const report = await run(win.document, JSON.parse(readFileSync(IR, 'utf8')), {
    ask: async () => ({ id: 'accept' }),
    log: () => {},
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(0);

  const out = `${HERE}../runs/state-${surface.name}-headless.json`;
  const state = win.__readState ? win.__readState() : null;
  if (state) writeFileSync(out, JSON.stringify(typeof state === 'string' ? JSON.parse(state) : state, null, 2));

  // The differ exits non-zero when it finds differences — that is its answer,
  // not a crash, so its output is read either way.
  let verdict = 'no state to read';
  let detail = [];
  if (state) {
    let text = '';
    try {
      text = execFileSync(process.execPath, [DIFFER, IR, out], { encoding: 'utf8' });
    } catch (error) {
      text = `${error.stdout || ''}${error.stderr || ''}`;
    }
    const lines = text.split('\n');
    verdict = (lines.find((l) => l.includes('difference')) || 'no verdict').trim();
    detail = lines.filter((l) => /^[A-Z][A-Z ]+\s+\(\d+\)$/.test(l.trim())).map((l) => l.trim());
  }
  return { report, seconds, verdict, detail, warnings: report.warnings || [] };
}

if (!existsSync(IR)) {
  console.error(`No study specification at ${IR}\nPass one: node test/surfaces.mjs <surface|all> <path-to.ir.json>`);
  process.exit(2);
}

const only = process.argv[2] && process.argv[2] !== 'all' ? process.argv[2] : '';
const results = [];
for (const surface of SURFACES) {
  if (only && surface.name !== only) continue;
  // Only the Meridian mock ships here. The rest are found through
  // SURFACES_ROOT, and their absence is expected rather than a failure.
  const needed = surface.page || `${surface.built}/index.html`;
  if (!existsSync(needed)) {
    console.log(`${surface.what}
  skipped : not present on this machine
`);
    continue;
  }
  process.stdout.write(`${surface.what}\n  building… `);
  try {
    const { report, seconds, verdict, detail, warnings } = await build(surface);
    const c = report.counts;
    console.log(`${seconds}s`);
    console.log(`  ledger : ${c.built} built · ${c.escalated} escalated · ${c.unreached} unreached · ${c.unaccounted} unaccounted (plan ${c.plan})`);
    console.log(`  verify : ${verdict}`);
    for (const d of detail) console.log(`           ${d}`);
    for (const w of warnings) console.log(`  warn   : ${w}`);
    // Why anything did not settle, most common first — the first thing anyone
    // wants when a surface does not come out clean.
    const notes = {};
    for (const item of report.items) if (item.status !== 'built') notes[item.note] = (notes[item.note] || 0) + 1;
    for (const [note, n] of Object.entries(notes).sort((a, b) => b[1] - a[1]).slice(0, 5)) {
      console.log(`  open   : ${String(n).padStart(4)} × ${note || '(no reason recorded)'}`);
    }
    results.push({ surface: surface.name, ok: /0 differences/.test(verdict) && c.unaccounted === 0 });
  } catch (error) {
    console.log(`FAILED: ${error.message}`);
    results.push({ surface: surface.name, ok: false });
  }
  console.log();
}

const bad = results.filter((r) => !r.ok);
console.log(bad.length === 0
  ? `all ${results.length} surface(s) built clean`
  : `${bad.length} of ${results.length} surface(s) not clean: ${bad.map((b) => b.surface).join(', ')}`);
process.exitCode = bad.length === 0 ? 0 : 1;
