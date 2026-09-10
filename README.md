# Study Builder Agent

A Chrome extension that reads a study specification and builds it into whatever
eSource form designer is open in the tab, with no prior knowledge of that
platform.

Run against **four** independent eSource platforms — the assignment's own mock
and three others, only one of which this project wrote — it builds ABC-101
completely on every one of them: 4 visits, 28 forms, 195 fields, 13 display
rules, checked field by field by a differ that reads the platform's saved state
rather than the agent's account of itself.

The number that matters more: on **first contact** with the fourth platform it
managed **32 of 240**. See [Evidence](#evidence).

## Setup

```bash
npm install && npm run build      # bundles src/ into dist/
npm test                          # 80 unit tests; 5 skip without the spec below
```

**What is not in this repository.** The study specification
(`abc-101-study.ir.json`) and the assignment's own eSource mock are the
assignment's material, so neither is published here. Everything runs without
them — the tests that need the specification skip and say so, and
`mocks/meridian/index.html` is a complete designer written for this project that
ships and can be built against immediately.

```bash
npm run mock                      # the Meridian designer on :5174
```

Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → `dist/`.
Open a designer in a tab — `npm run mock` above, or the assignment's own on
:5173 — click the extension icon, choose `abc-101-study.ir.json`, **Build into
this tab**. The agent is injected at run time, so a tab opened before installing
does not need reloading.

The mock is served over http rather than opened off the disk on purpose: a
`file://` page makes Chrome demand "Allow access to file URLs" before an
extension may touch it, which is a step about where the file is stored rather
than about anything being evaluated.

No API key, no network calls. The agent is deterministic code, not a model in a
loop — every decision has to be explainable to a reviewer, and "the model
thought so" is not an explanation a study builder can act on.

## Architecture

`perceive → decide → act → confirm`, looping, with **confirm** doing the real work.

- **perceive.js** — the only DOM-aware module. Turns the page into controls with
  a *capability* (TOGGLE / CHOOSER / TEXT / ACTION / OPTION), an accessible name
  computed as a screen reader would, and the headings that scope it. Nothing
  above it knows what a `<div>` is. The only selectors in `src/` are standard
  HTML and ARIA — no CSS class, id, or platform wording anywhere.
- **vocabulary.js** — concepts (`commit`, `label`, `minimum`, `visibility`…) in
  ordinary English, with `strong`, `weak` and **`negative`** terms. The costly
  mistake is not "found nothing", it is "found something that looked right", so
  `Save As Template` ranks *below* a control with no matching words. A tie
  returns `null`: a tie is a question, not an answer.
- **act.js** — re-resolves every control immediately before using it. A node
  reference is a snapshot, not a handle; a designer that re-renders hands back a
  detached element.
- **confirm** — nothing counts because it was clicked. Fields are read back off
  the saved form; a form counts only after a commit *proved* to persist.

**The ledger.** A plan of 240 items is derived from the input file before
anything is touched. `built + escalated + unreached = plan`, and `unaccounted`
must be 0 — shown separately, never summed into one reassuring number.

Its limit, found the hard way: it counts *planned* items, so it cannot see what
shouldn't be there. It once reported 28 forms built when 17 existed, and once
left a probe field in a real form. Both were caught by `verify-build.mjs`, which
reads the platform's saved state rather than the agent's account of itself.

## Type mapping

| canonical | Mock A | Designer B | Designer C | Meridian |
|---|---|---|---|---|
| `integer` | Number (Whole) | Tally Counter | Number | Whole Amount |
| `decimal` | Number (Decimal) | Measurement | Number (Precise) | Exact Amount |
| `checkbox` | Checkbox | Single Tick | Tick Box | Confirmation Mark |

String matching cannot survive that. So the agent **runs an experiment**: on
entering the first designer it presses every library entry once and records what
*appeared* — a coded-values editor? a min and max? a precision box? a formula
box? what does the field render as? Names only break ties between entries the
platform treats identically. Probes are removed before any real field is built.
The margin between the top two candidates is a **confidence score**; below 0.6
it goes to the human gate.

Two details that cost whole runs: diffs are by **semantic signature, not element
identity** (a page that rebuilds itself would otherwise report the whole screen
as new); and a **properties panel is not a preview** (a panel headed "Options"
would make every field look like it has coded values).

**Finding the save** is the same problem. Every mock here puts a decoy where a
save belongs — `Save As Template`, `Store Draft Locally`, `Save to Library` —
and two hide the real one in a `⋯` menu. So the agent plants a sentinel field,
presses a candidate, leaves, returns, and checks it survived. A control that
fails a round trip is not a save, whatever it is called.

## The human gate

**One calibration card, before anything is built** — the whole type map with
confidence and the evidence behind each row (`boolean → "Yes/No Toggle" (0.92)
— the field renders yes/no controls`). A reviewer asked 195 times learns to
click through without reading. Each uncertain row has a **dropdown of that
platform's own entries**, so disagreeing with one mapping costs one dropdown,
not the run.

**Per-item escalations during the run**, never counted as built:

```
present, but this designer will not show formula — unverified
could not select the field to give it a rule; the panel is showing "Outcome"
```

On one designer it escalated exactly 7 formula fields; the differ then found
exactly those 7 wrong and nothing else. That match is the property worth having.

Progress reads `building… 142 of 240 · field "Vital Signs"` — it advances only
when an item settles, so a stalled run looks stalled.

## Evidence

The brief asks for a second mock of your own, run against **unchanged**.
`mocks/meridian/index.html` is a fourth platform written from scratch: sidebar
tree navigation, catalogue as a `role="listbox"`, `role="switch"` toggles, save
called `Apply Changes` in an overflow menu.

| Stage | Result | What changed |
|---|---|---|
| First contact | **32 / 240** | nothing |
| after 4 agent fixes | **217 / 240** | see below |
| after 2 mock fixes | 240 built, 21 wrong types | the mock was being unfair |
| after 1 vocabulary fix | **240 / 240** | agent didn't know `concealed` = hidden |

**32 → 217 is the agent improving; 217 → 240 is partly the mock getting fairer**
(it drew a boolean as `Affirmative / Negative`, and offered no precision control
at all). The four agent bugs were all general:

1. A record list read as a palette — 7 rows × 3 buttons is 21 controls but 3
   distinct names. A library offers a different *kind* per entry.
2. A study tree outscored the real catalogue — a tree lists what you already
   made, and the agent knows what it made.
3. `alreadyListed` answered from the whole page, including a sidebar naming
   every form in the study. **The ledger recorded 28 forms built when 17
   existed** — a false *built*, the worst failure available.
4. `buildField` could only press buttons, so a `role="option"` catalogue was
   understood and then unusable.

Meridian now passes, so it is a **regression test, not evidence** — a benchmark
tuned until it passes proves nothing. The evidence is the three platforms this
project did not write.

| Platform | Written by | Ledger | Differ |
|---|---|---|---|
| the assignment's eSource mock | the assignment | 240 built · 0 escalated | **0 differences** |
| a second study designer | not this project | 240 built · 0 escalated | **0 differences** |
| a third study designer | not this project | 240 built · 0 escalated | **0 differences** |
| Meridian Clinical | this project | 240 built · 0 escalated | **0 differences** |

```bash
npm test                                     # 80 unit tests (jsdom), ~4s
node test/surfaces.mjs all <spec.ir.json>    # every surface present, ~15 min
```

Only Meridian ships here; the rest are located through `SURFACES_ROOT` and
skipped when absent.

**By-hand verification.** `verify-build.mjs` reads the platform's saved state
and compares visit windows, repeating flags, every field's type, required, min,
max, units, formula, coded pairs *in order*, skip logic and field order —
reporting extras and duplicates too. It never reads the agent's report. It has
disagreed with the agent repeatedly and has always been right.

```bash
# in the mock's tab console:  copy(__exportState())
node verify-build.mjs abc-101-study.ir.json built-state.json
```

`__exportState()` is the mock's verification hook for humans. The agent never
calls it — reading the answer key answers a different question.

## Where it breaks

- **Vocabulary lags reality.** One designer calls a formula `Computation Rule`;
  Meridian calls hidden `Concealed`. Each was a one-word fix, invisible until a
  new platform appeared. This is the most likely failure on an unseen platform.
- **Genuinely ambiguous platforms stay ambiguous.** With no precision control
  anywhere, `integer` and `decimal` are indistinguishable; one designer gave
  `decimal → "Number (Precise)" (0.19)`. Reporting low confidence is correct
  behaviour, not a bug.
- **It cannot do what a platform cannot.** One designer has no formula editor, so
  7 calculated fields were escalated rather than claimed.
- **Not yet exercised:** drag-and-drop designers, paginated canvases.

When it breaks it escalates with the evidence and the ledger stops reconciling.
It has not silently claimed a field it did not build, with one exception — the
28-vs-17 form count above, found by the differ and fixed.

## Run time

Full 240-item build in Chrome: 94s, 124s and 184s across the three designers —
roughly 0.4–0.8s per item, varying with how much each platform re-renders.

Two fixes mattered. Settling is **bounded at 450ms**: a page that never goes
quiet otherwise costs the ceiling on every action, turning two minutes into
fifteen. And the pause between actions used to spin a `MessageChannel` to dodge
background-tab throttling — a *visible* tab is not throttled, so it now gets one
timer.

## Next, given two weeks

1. **Clearable escalations** — show the field and the designer state, let the
   reviewer point at the right control, apply it, continue. Most escalations are
   one gesture from resolved.
2. **Persist what a reviewer teaches it**, keyed to the platform, so the second
   run doesn't ask again.
3. **A fifth surface nobody here designed**, kept strictly held out. Everything
   in this repo is now training data.
4. Drag-and-drop and paginated canvases.
5. **A dry run** — perceive, calibrate, show the whole plan without touching the
   study, so a build is approved before it happens rather than audited after.

## AI tools

Claude (via Claude Code) was used throughout — agent, mock, tests, this README.

It helped most at turning failures into root causes: reproducing a failing
surface in jsdom and instrumenting it beat re-running the browser and guessing.
`test/surfaces.mjs` came out of that.

It got in the way by being confidently wrong at the moments that matter. It
called a fix verified when only one direction had been tested, proposed two
wrong causes for a stall before instrumentation found the real one, and once
made a change that fixed one platform while silently breaking another from
240/240 to 11/240 — caught only by running all four. The discipline that came
out of it is the one the agent itself uses: **don't believe a claim you haven't
verified, and say who verified it.** Every number here comes from a run in
`traces/` or reproducible with `test/surfaces.mjs`.

## Layout

```
src/perceive.js      the page as capabilities — the only DOM-aware module
src/capabilities.js  what a control IS (ARIA role outranks HTML tag)
src/vocabulary.js    concept word lists, including the negative ones
src/act.js           press, type, choose — bounded waits, re-resolved elements
src/calibrate.js     probe the library; prove the save control
src/navigate.js      where am I, and how do I get there
src/build.js         one field, and reading it back
src/orchestrate.js   the plan, the ledger, the run
src/panel.js         the reviewer's side: progress, questions, ledger
test/                80 unit tests + surfaces.mjs (headless, per platform)
mocks/meridian/      our own fourth eSource platform
verify-build.mjs     independent differ — does not trust the agent
```

~3,000 lines, no runtime dependencies.
