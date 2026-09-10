/*
 * vocabulary.js — the words applications use for the concepts this agent needs.
 *
 * Not any platform's wording. These are the ordinary English of user
 * interfaces: a control that saves is called save, commit, apply or store
 * somewhere in the world, and one that discards is called cancel or discard.
 *
 * Vocabulary is only ever a FIRST GUESS. Anything it suggests is confirmed by
 * doing it and reading the result back, because the next platform will use a
 * word that is on nobody's list — and the agent has to survive that. Where the
 * words run out, the agent escalates rather than picks.
 *
 * `negative` matters as much as `strong`. Most costly mistakes here are not
 * "found nothing"; they are "found something that looked right": a control that
 * applies a sub-edit reads exactly like one that commits the document.
 */

export const CONCEPTS = {
  // ── the study's shape ──────────────────────────────────────────────────────
  visit: {
    strong: ['visit', 'encounter', 'timepoint', 'time point', 'occasion', 'event'],
    weak: ['schedule', 'timeline', 'plan', 'calendar'],
    negative: ['document', 'form', 'instrument', 'field', 'question', 'patient', 'subject'],
  },
  form: {
    strong: ['form', 'document', 'instrument', 'crf', 'casebook', 'sheet', 'page'],
    weak: ['source', 'record', 'template'],
    negative: ['visit', 'encounter', 'timepoint', 'field', 'question', 'element'],
  },
  field: {
    strong: ['field', 'question', 'element', 'item', 'control', 'variable'],
    weak: ['entry', 'datapoint', 'data point'],
    negative: ['form', 'document', 'visit'],
  },

  // ── things you do ──────────────────────────────────────────────────────────
  create: {
    strong: ['add', 'new', 'create', 'insert'],
    weak: ['plus', '+', 'append', 'register', 'attach', 'start'],
    negative: ['value', 'answer', 'option', 'row', 'choice', 'page', 'version'],
  },
  commit: {
    strong: ['save', 'commit', 'persist', 'submit', 'store'],
    weak: ['apply', 'confirm', 'done', 'finish', 'update', 'ok', 'accept', 'keep'],
    // Every word here has cost somebody a form. "Save As Template" and "Store
    // Draft Locally" look like commits and persist nothing that matters; "Apply
    // Bulk Load" and "Add Answer" commit a sub-edit inside the thing you are
    // editing, then the next navigation throws the document away.
    negative: [
      'template', 'gallery', 'draft', 'local', 'locally', 'copy', 'export', 'print',
      'preview', 'activate', 'publish', 'release', 'lock', 'validate',
      'cancel', 'discard', 'close', 'revert', 'delete', 'remove',
      'bulk', 'load', 'paste', 'value', 'values', 'answer', 'option', 'row', 'list', 'import',
    ],
  },
  cancel: {
    strong: ['cancel', 'discard', 'dismiss', 'abort', 'revert'],
    weak: ['close', 'back', 'exit', 'undo'],
    negative: ['save', 'commit', 'apply'],
  },
  edit: {
    strong: ['edit', 'design', 'designer', 'builder', 'author', 'configure', 'modify'],
    weak: ['open', 'manage', 'customise', 'customize', 'change', 'revise', 'view'],
    negative: ['delete', 'remove', 'preview', 'print'],
  },
  back: {
    strong: ['back', 'return', 'previous', 'up', 'close'],
    weak: ['cancel', 'exit', 'done', 'breadcrumb'],
    negative: ['delete', 'remove', 'discard'],
  },
  remove: {
    strong: ['remove', 'delete', 'discard', 'clear'],
    weak: ['trash', 'bin', 'x', '×', '✕'],
    negative: [],
  },

  // ── the parts of a field ───────────────────────────────────────────────────
  label: {
    strong: ['label', 'question', 'caption', 'prompt', 'title', 'heading', 'text'],
    weak: ['name', 'display', 'wording'],
    negative: ['placeholder', 'hint', 'help', 'tooltip', 'code', 'value', 'document', 'visit'],
  },
  required: {
    strong: ['required', 'mandatory', 'compulsory', 'obligatory'],
    weak: ['must', 'needed'],
    negative: ['optional', 'hidden'],
  },
  hidden: {
    strong: ['hidden', 'invisible', 'concealed'],
    weak: ['hide', 'conceal', 'suppressed'],
    negative: ['required'],
  },
  minimum: {
    strong: ['minimum', 'min', 'lowest', 'floor', 'lower'],
    weak: ['from', 'least', 'start'],
    negative: ['maximum', 'max', 'highest', 'ceiling'],
  },
  maximum: {
    strong: ['maximum', 'max', 'highest', 'ceiling', 'upper'],
    weak: ['to', 'greatest', 'end'],
    negative: ['minimum', 'min', 'lowest', 'floor'],
  },
  units: {
    strong: ['unit', 'units', 'measure', 'uom'],
    weak: ['dimension'],
    negative: [],
  },
  formula: {
    strong: ['formula', 'expression', 'calculation', 'computation', 'equation', 'derivation', 'script'],
    weak: ['computed', 'derived', 'calculated', 'compute'],
    negative: [],
  },
  decimals: {
    strong: ['decimal', 'decimals', 'precision', 'fractional'],
    weak: ['places', 'digits'],
    negative: [],
  },

  // ── coded values ───────────────────────────────────────────────────────────
  valuesArea: {
    strong: ['value', 'values', 'answer', 'answers', 'option', 'options', 'choice', 'choices', 'code', 'codes'],
    weak: ['list', 'picklist', 'coded'],
    negative: [],
  },
  code: {
    strong: ['code', 'stored', 'key', 'oid', 'submission'],
    weak: ['id', 'internal'],
    negative: ['label', 'shown', 'display', 'text'],
  },
  optionLabel: {
    strong: ['label', 'shown', 'display', 'text', 'caption'],
    weak: ['name', 'title'],
    negative: ['code', 'stored', 'key'],
  },
  addValue: {
    strong: ['add value', 'add answer', 'add option', 'add choice', 'add row'],
    weak: ['add', 'new', '+'],
    negative: ['document', 'visit', 'form', 'field'],
  },
  bulkValues: {
    strong: ['bulk', 'paste', 'import'],
    weak: ['load', 'many', 'multiple'],
    negative: [],
  },

  // ── conditional display ────────────────────────────────────────────────────
  visibility: {
    strong: ['visibility', 'visible', 'display', 'show', 'shown', 'skip', 'conditional', 'condition'],
    weak: ['logic', 'rule', 'when', 'appear', 'relevant'],
    negative: [],
  },
  conditionalMode: {
    strong: ['when', 'if', 'condition', 'conditional', 'depends', 'only'],
    weak: ['show', 'shown', 'based', 'triggered'],
    negative: ['always', 'never', 'unconditional', 'static'],
  },
  controllingField: {
    strong: ['controlling', 'controller', 'source', 'trigger', 'parent', 'depends'],
    weak: ['field', 'question', 'element', 'when', 'based'],
    negative: ['value', 'equals', 'answer', 'response'],
  },
  comparisonValue: {
    strong: ['equals', 'value', 'answer', 'response', 'matches', 'expected'],
    weak: ['is', 'compare', 'target'],
    negative: ['field', 'question', 'element', 'source', 'controlling'],
  },

  // ── other structure ────────────────────────────────────────────────────────
  palette: {
    strong: ['element', 'elements', 'library', 'palette', 'toolbox', 'widget', 'widgets', 'component', 'components'],
    weak: ['question', 'questions', 'field', 'fields', 'type', 'types', 'catalog', 'catalogue', 'add'],
    negative: ['import', 'module', 'modules', 'navigation'],
  },
  repeating: {
    strong: ['repeating', 'log', 'multiple', 'many'],
    weak: ['recurring', 'grid', 'table', 'entries', 'records'],
    negative: ['single', 'one'],
  },
  windowStart: {
    strong: ['start', 'opens', 'from', 'begin', 'first'],
    weak: ['day', 'window', 'lower'],
    negative: ['end', 'closes', 'last'],
  },
  windowEnd: {
    strong: ['end', 'closes', 'to', 'last', 'until'],
    weak: ['day', 'window', 'upper'],
    negative: ['start', 'opens', 'first'],
  },
};

/**
 * A word, or a lone symbol that carries meaning of its own.
 *
 * The two alternatives matter. Symbols have to tokenise — a control named "+"
 * or "…" says something — but they must not glue themselves to the word beside
 * them: "Visible When…" has to yield `when`, not `when…`, or a conditional
 * option becomes invisible to a vocabulary that is looking for exactly that
 * word. A trailing ellipsis is punctuation, not spelling.
 */
const WORD = /[a-z0-9]+|[+×✕…⋮☰]/g;

/** Words of a name, lowercased. Punctuation is noise; symbols are not. */
export function words(value) {
  return String(value == null ? '' : value).toLowerCase().match(WORD) || [];
}

/**
 * How strongly a name means a concept. Negative means "this looks like the
 * concept but is explicitly not it" — worth more than a zero, because it lets
 * a look-alike be ranked below a control with no matching words at all.
 */
export function score(name, concept) {
  const spec = CONCEPTS[concept];
  if (!spec) throw new Error(`unknown concept: ${concept}`);
  const list = words(name);
  if (list.length === 0) return 0;
  const joined = list.join(' ');

  let total = 0;
  for (const phrase of spec.strong) total += containsPhrase(joined, list, phrase) ? 3 : 0;
  for (const phrase of spec.weak) total += containsPhrase(joined, list, phrase) ? 1 : 0;
  for (const phrase of spec.negative) total -= containsPhrase(joined, list, phrase) ? 4 : 0;

  // A short name that matches is a better match: "Save" over "Save As Template".
  if (total > 0 && list.length <= 2) total += 0.5;
  return total;
}

function containsPhrase(joined, list, phrase) {
  if (phrase.includes(' ')) return joined.includes(phrase);
  return list.includes(phrase);
}

/**
 * Rank controls for a concept, best first, dropping anything that does not
 * positively match. Context counts for less than the control's own name: a
 * button called "Add" under a heading about visits adds a visit, but a button
 * called "Add Answer" under the same heading does not.
 */
export function rank(controls, concept, { contextWeight = 0.5 } = {}) {
  return controls
    .map((control) => {
      const own = score(control.name, concept);
      const around = (control.context || []).reduce((sum, bit) => sum + score(bit, concept), 0);
      return { control, score: own + around * contextWeight, ownScore: own };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);
}

/** The single best match, or null when nothing matches or the top two tie. */
export function best(controls, concept, options = {}) {
  const ranked = rank(controls, concept, options);
  if (ranked.length === 0) return null;
  if (ranked.length > 1 && ranked[0].score === ranked[1].score) return null; // a tie is a question, not an answer
  return ranked[0];
}
