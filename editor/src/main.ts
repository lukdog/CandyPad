// App shell: state, undo/redo, validation on every mutation, and the persistence wiring.
import board from '@board';
import bundledKeymap from '@keymap';
import { buildIndex } from './keycodes';
import { checkOledC } from './oled';
import { createPanel } from './panel';
import {
  LINKED_REPO_LABEL, autosave, clearDraft, downloadKeymap, fsaAvailable, loadInitial, onDropFile,
  pickRepoDir, readFromRepo, readKeymapFile, repoLinked, shareLink, writeToRepo,
  type LoadSource, type OledSettings, type RepoState,
} from './persist';
import { createLayerTabs, createPad } from './render';
import type { Issue, KeyboardJson, KeymapJson, Target } from './types';
import { validate } from './validate';

declare const __COMMIT__: string;

const kb = board as unknown as KeyboardJson;
const bundled = bundledKeymap as unknown as KeymapJson;
const index = buildIndex();

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

// ── state ────────────────────────────────────────────────
let km: KeymapJson = structuredClone(bundled);
let oled: OledSettings = { brightness: 128, timeout: 120000 };
let oledCode = '';
let layer = 0;
let selected: Target | null = null;
let issues: Issue[] = [];

/** No autosave until loadInitial resolves. It awaits readFromRepo() before reading the
 *  draft, so the immediate first paint would otherwise overwrite the draft it is about to
 *  read - which silently broke restore-after-reload entirely. */
let booted = false;

const past: string[] = [];
const future: string[] = [];
let coalesceKey = '';
let coalesceAt = 0;

/** One snapshot per logical edit: consecutive tweaks to the same cell collapse into one undo step. */
function snapshot(key: string) {
  const now = Date.now();
  if (key && key === coalesceKey && now - coalesceAt < 800) {
    coalesceAt = now;
    return;
  }
  past.push(JSON.stringify(km));
  if (past.length > 50) past.shift();
  future.length = 0;
  coalesceKey = key;
  coalesceAt = now;
}

function mutate(key: string, fn: () => void) {
  snapshot(key);
  fn();
  refresh();
}

function restore(from: string[], to: string[]) {
  const snap = from.pop();
  if (snap === undefined) return;
  to.push(JSON.stringify(km));
  km = JSON.parse(snap) as KeymapJson;
  coalesceKey = '';
  layer = Math.min(layer, (km.layers?.length ?? 1) - 1);
  panel.close();
  selected = null;
  refresh();
}

const encoderCount = kb.encoder?.rotary.length ?? 0;
const keyCount = kb.layouts?.[bundled.layout]?.layout.length ?? 0;

/** layers and encoders must stay the same length or QMK fails a STATIC_ASSERT at compile time. */
function addLayer() {
  mutate('', () => {
    km.layers.push(Array.from({ length: keyCount }, () => 'KC_TRNS'));
    if (km.encoders) {
      km.encoders.push(Array.from({ length: encoderCount }, () => ({ ccw: 'KC_TRNS', cw: 'KC_TRNS' })));
    }
  });
  layer = km.layers.length - 1;
  refresh();
}

function removeLayer(n: number) {
  if (km.layers.length <= 1) return;
  mutate('', () => {
    km.layers.splice(n, 1);
    km.encoders?.splice(n, 1);
  });
  layer = Math.min(layer, km.layers.length - 1);
  refresh();
}

function assign(t: Target, value: string) {
  const key = t.kind === 'key' ? `k${t.layer}:${t.index}` : `e${t.layer}:${t.enc}:${t.dir}`;
  mutate(key, () => {
    if (t.kind === 'key') {
      const row = km.layers[t.layer];
      if (row) row[t.index] = value;
      return;
    }
    const pair = km.encoders?.[t.layer]?.[t.enc];
    if (pair) pair[t.dir] = value;
  });
}

// ── views ────────────────────────────────────────────────
function pick(t: Target) {
  selected = t;
  layer = t.layer;
  const current =
    t.kind === 'key'
      ? (km.layers[t.layer]?.[t.index] ?? '')
      : (km.encoders?.[t.layer]?.[t.enc]?.[t.dir] ?? '');
  const label =
    t.kind === 'key'
      ? `Layer ${t.layer} · key ${t.index}${kb.layouts?.[km.layout]?.layout[t.index]?.label ? ` (${kb.layouts[km.layout]!.layout[t.index]!.label})` : ''}`
      : `Layer ${t.layer} · knob ${t.enc} ${t.dir}`;
  panel.open(t, current, km.layers.length, label);
  refresh();
}

const panel = createPanel(index, assign);
const pad = createPad(kb, bundled.layout, index, pick);
const tabs = createLayerTabs({
  onSelect: (n) => {
    layer = n;
    refresh();
  },
  onAdd: addLayer,
  onRemove: removeLayer,
});

const sourceBadge = el('span', 'badge', 'loading…');
let source: LoadSource = 'bundled';
let sourceLabel = '';

function setSource(next: LoadSource, label: string) {
  source = next;
  sourceLabel = label;
  sourceBadge.textContent = label;
  sourceBadge.dataset['source'] = next;
}

/** True when what is on screen exists nowhere but this tab. A shared link is the sharp case:
 *  loadInitial already consumed the fragment from the URL, so discarding it loses it for good. */
function isUnsaved(): boolean {
  return source === 'shared-link' || source === 'local-file' || source === 'autosave' || past.length > 0;
}

const statusLine = document.querySelector<HTMLElement>('#status')!;

function status(text: string, kind: 'ok' | 'err' = 'ok') {
  statusLine.textContent = text;
  statusLine.className = kind;
  if (text) window.setTimeout(() => (statusLine.textContent === text ? (statusLine.textContent = '') : null), 4000);
}

// ── issues: collapsed by default, count badge in the summary ──
const issueList = el('div', 'issues');
const issueCounts = el('span', 'issue-counts');
const issuesBox = el('details', 'issues-box');
const issuesSummary = el('summary', 'issues-summary');
issuesSummary.append(el('span', 'eyebrow', 'Validation'), issueCounts);
issuesBox.append(issuesSummary, issueList);

function renderIssues() {
  const errs = issues.filter((i) => i.severity === 'error').length;
  const warns = issues.length - errs;
  issueCounts.textContent = '';
  if (!issues.length) {
    issueCounts.append(el('span', 'count is-ok', 'All good'));
  } else {
    if (errs) issueCounts.append(el('span', 'count is-error', `${errs} error${errs === 1 ? '' : 's'}`));
    if (warns) issueCounts.append(el('span', 'count is-warning', `${warns} warning${warns === 1 ? '' : 's'}`));
  }
  issuesBox.classList.toggle('has-error', errs > 0);

  issueList.textContent = '';
  if (!issues.length) {
    issueList.append(el('p', 'hint', 'The keymap passes every check.'));
    return;
  }
  for (const it of issues) {
    const row = el('button', `issue is-${it.severity}`);
    row.append(el('code', 'issue-code', it.code), el('span', 'issue-msg', it.message));
    if (it.where?.layer !== undefined) {
      row.addEventListener('click', () => {
        const w = it.where!;
        if (w.key !== undefined) pick({ kind: 'key', layer: w.layer!, index: w.key });
        else if (w.enc !== undefined && w.dir) pick({ kind: 'enc', layer: w.layer!, enc: w.enc, dir: w.dir });
        else {
          layer = w.layer!;
          refresh();
        }
      });
    } else {
      row.disabled = true;
    }
    issueList.appendChild(row);
  }
}

function refresh() {
  issues = validate(km, kb, index);
  pad.paint(km, layer, issues, selected);
  tabs.paint(km.layers.length, layer, issues);
  renderIssues();
  if (!issues.some((i) => i.severity === 'error')) saveAnyway.hidden = true;
  if (booted) autosave(km);
}

// ── top bar ──────────────────────────────────────────────
function button(label: string, onClick: () => void, cls = 'btn') {
  const b = el('button', cls, label);
  b.addEventListener('click', onClick);
  return b;
}

async function save(force = false) {
  const errs = issues.filter((i) => i.severity === 'error');
  if (errs.length && !force) {
    status(`${errs.length} validation error(s) — fix them or use "Save anyway"`, 'err');
    saveAnyway.hidden = false;
    return;
  }
  try {
    if (!(await repoLinked()) && !(await pickRepoDir())) return;
    await writeToRepo(km, oled, oledCode);
    saveAnyway.hidden = true;
    setSource('linked-repo', LINKED_REPO_LABEL); // what is on screen now is what is on disk
    const warn = oledCode.trim() ? checkOledC(oledCode) : null;
    status(warn ? `saved — but the OLED code looks off: ${warn}` : `written to ${writtenFiles()}`, warn ? 'err' : 'ok');
  } catch (e) {
    // writeToRepo throws Error with a message meant for the user; String(e) would prefix "Error:".
    status(`save failed: ${e instanceof Error ? e.message : String(e)}`, 'err');
  }
}

function writtenFiles(): string {
  return oledCode.trim() ? 'keymap.json + config.h + oled.c + rules.mk' : 'keymap.json + config.h';
}

/** Linking a clone shows that clone — but only when nothing unsaved would be thrown away.
 *  Arriving via a share link and then linking a repo must not silently drop the shared
 *  keymap: the fragment is already consumed, and the adopt would overwrite the draft too. */
async function linkRepo(): Promise<void> {
  if (!(await pickRepoDir())) {
    status('not linked', 'err');
    return;
  }
  const repo = await readFromRepo();
  if (!repo) {
    status('repo linked, but its keymap.json could not be read', 'err');
    return;
  }
  const differs = JSON.stringify(repo.km) !== JSON.stringify(km);
  if (differs && isUnsaved()) {
    const keep = window.confirm(
      `Keep the keymap that is on screen?\n\n` +
        `It came from "${sourceLabel}" and is not saved anywhere yet, and your clone holds a ` +
        `different keymap.json.\n\n` +
        `OK — keep this one; "Save to repo" will write it into the clone.\n` +
        `Cancel — discard it and load the clone's keymap instead.`,
    );
    if (keep) {
      status('repo linked — "Save to repo" will write what is on screen into your clone');
      return; // write target set, content untouched
    }
  }
  adoptRepo(repo);
}

function adoptRepo(repo: RepoState): void {
  snapshot(''); // before anything is replaced: undo must be able to bring the old work back
  km = repo.km;
  oled = repo.oled;
  oledCode = repo.code;
  layer = 0;
  selected = null;
  panel.close();
  setSource('linked-repo', LINKED_REPO_LABEL);
  refresh(); // re-validates: the clone's file may well be broken, and then we say so
  status('loaded keymap.json, config.h and oled.c from the linked clone');
}

/** Replaces everything on screen with another keymap, snapshotting first so it is undoable. */
function adopt(next: KeymapJson, src: LoadSource, label: string): void {
  snapshot('');
  km = next;
  layer = 0;
  selected = null;
  panel.close();
  setSource(src, label);
  refresh(); // re-validates: an imported or reset keymap may well be broken, and then we say so
}

/** Out of a draft and back to whatever the draft was covering — the clone, else the bundle. */
async function resetToSource(): Promise<void> {
  if (!window.confirm(
    'Discard your local draft?\n\n' +
      'Everything not saved to your clone is thrown away and the editor goes back to the ' +
      'keymap it started from. Undo can still bring it back until you reload.',
  )) return;

  const repo = await readFromRepo();
  if (repo) adoptRepo(repo);
  else adopt(structuredClone(bundled), 'bundled', `bundled snapshot @ ${__COMMIT__.slice(0, 7)}`);
  // After refresh(), not before: refresh() autosaves, so clearing first would be undone at once.
  clearDraft();
  status(repo ? 'draft discarded — back to your linked clone' : 'draft discarded — back to the bundled snapshot');
}

const saveAnyway = button('Save anyway', () => void save(true), 'btn danger');
saveAnyway.hidden = true;

const brand = el('div', 'brand');
brand.append(el('h1', 'wordmark', 'CandyPad'), el('span', 'eyebrow', 'QMK keymap editor'));

const meta = el('div', 'topbar-meta');
meta.append(sourceBadge, el('span', 'commit', `build ${__COMMIT__}`));

// Not named `history`: that shadows window.history, which the hashchange handler needs.
const historyGroup = el('div', 'tb-group');
historyGroup.append(
  button('Undo', () => restore(past, future), 'btn ghost'),
  button('Redo', () => restore(future, past), 'btn ghost'),
  button('Reset', () => void resetToSource(), 'btn ghost'),
);

// Hidden picker, same validated path as the drop target. Kept in the DOM: a detached
// input does not open a picker in every browser.
const fileInput = el('input');
fileInput.type = 'file';
fileInput.accept = 'application/json,.json';
fileInput.hidden = true;
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  fileInput.value = ''; // so picking the same file twice still fires change
  if (!file) return;
  void readKeymapFile(file).then((loaded) => {
    if (!loaded) {
      status(`${file.name} is not a valid keymap.json`, 'err');
      return;
    }
    adopt(loaded, 'local-file', `local file — ${file.name}, not saved anywhere yet`);
    status(`imported ${file.name}`);
  });
});

const exportGroup = el('div', 'tb-group');
exportGroup.append(
  fileInput,
  button('Import', () => fileInput.click(), 'btn ghost'),
  button('Share', async () => {
    const url = shareLink(km);
    try {
      await navigator.clipboard.writeText(url);
      status('share link copied to clipboard');
    } catch {
      window.prompt('Share link', url);
    }
  }, 'btn ghost'),
  button('Download', () => downloadKeymap(km), 'btn ghost'),
);

const actions = el('div', 'tb-actions');
actions.append(historyGroup, exportGroup);

// ── OLED settings behind a disclosure (config.h #defines: QMK does not expose these to keymap.json) ──
const sheet = el('dialog', 'sheet');
const sheetHead = el('div', 'sheet-head');
const sheetTitle = el('div', 'panel-headtext');
sheetTitle.append(el('span', 'eyebrow', 'Firmware'), el('h2', 'panel-title', 'OLED settings'));
const sheetClose = el('button', 'icon-btn', '✕');
sheetClose.addEventListener('click', () => sheet.close());
sheetHead.append(sheetTitle, sheetClose);

function numberField(label: string, min: number, max: number, read: () => number, onChange: (n: number) => void) {
  const row = el('label', 'row');
  const input = el('input', 'num');
  input.type = 'number';
  input.min = String(min);
  input.max = String(max);
  input.addEventListener('change', () => {
    const n = Math.min(max, Math.max(min, Number(input.value) || 0));
    input.value = String(n);
    onChange(n);
  });
  row.append(el('span', 'row-label', label), input);
  return { row, sync: () => (input.value = String(read())) };
}

const oledFields = [
  numberField('Brightness (0–255)', 0, 255, () => oled.brightness, (n) => (oled = { ...oled, brightness: n })),
  numberField('Timeout (ms)', 0, 3_600_000, () => oled.timeout, (n) => (oled = { ...oled, timeout: n })),
];
const codeArea = el('textarea', 'code');
codeArea.rows = 10;
codeArea.spellcheck = false;
codeArea.placeholder = [
  'oled_set_cursor(0, 0);',
  'oled_write_ln("hello", false);',
  'return false;  // false: the board keeps drawing its dashboard on rows 1 and 3',
].join('\n');
const codeWarn = el('p', 'hint code-warn');

function syncCodeWarning() {
  const warn = codeArea.value.trim() ? checkOledC(codeArea.value) : null;
  codeWarn.textContent = warn ? `Looks unbalanced: ${warn}. Saving is still allowed — CI has the real compiler.` : '';
  codeWarn.classList.toggle('is-warn', warn !== null);
}
codeArea.addEventListener('input', () => {
  oledCode = codeArea.value;
  syncCodeWarning();
});

const codeBlock = el('div', 'field');
codeBlock.append(
  el('span', 'row-label', 'candypad_render_default_user() body'),
  codeArea,
  el(
    'p',
    'hint',
    'Written to oled.c, with SRC += oled.c in rules.mk. Return true when you drew everything ' +
      'yourself, false to let the board draw its layer/encoder dashboard over rows 1 and 3. ' +
      'Rows 0 and 2 of the 21x4 grid are free. Empty the box to delete both files.',
  ),
  codeWarn,
);

const sheetBody = el('div', 'sheet-body');
sheetBody.append(
  ...oledFields.map((f) => f.row),
  el('p', 'hint', 'Written to config.h as #defines when you save to the repo — keymap.json cannot carry them.'),
  codeBlock,
);
sheet.append(sheetHead, sheetBody);

// Sync on open, not at build time: loadInitial may replace the defaults with the linked clone's values.
const settingsBtn = button('Settings', () => {
  for (const f of oledFields) f.sync();
  codeArea.value = oledCode;
  syncCodeWarning();
  sheet.showModal();
}, 'btn ghost');

// ── info dialog ──────────────────────────────────────────
// Authored as static markup in index.html, not built here: a closed <dialog> keeps its
// prose in the raw HTML for crawlers that do not run JavaScript, which is the only
// indexable text this page has now that #app is JS-filled.
const info = document.querySelector<HTMLDialogElement>('#about')!;
info.querySelector('[data-close-about]')!.addEventListener('click', () => info.close());

const infoBtn = button('\u24d8', () => info.showModal(), 'icon-btn');
infoBtn.title = 'About this editor, and how to build your own firmware';
infoBtn.setAttribute('aria-label', 'About this editor, and how to build your own firmware');

const repoGroup = el('div', 'tb-group');
if (fsaAvailable()) {
  repoGroup.append(
    settingsBtn,
    infoBtn,
    button('Link repo…', () => void linkRepo()),
    button('Save to repo', () => void save(), 'btn primary'),
    saveAnyway,
  );
} else {
  repoGroup.append(settingsBtn, infoBtn, el('span', 'hint', 'Direct save needs a Chromium browser — use Download.'));
}
actions.append(repoGroup);

const toolbar = el('div', 'toolbar');
toolbar.append(brand, meta, actions);

// ── mount ────────────────────────────────────────────────
const padCard = el('section', 'pad-card');
const padHead = el('div', 'pad-card-head');
padHead.append(el('span', 'eyebrow', `${kb.keyboard_name ?? 'CandyPad'} · ${bundled.layout}`), tabs.el);
const padWrap = el('div', 'pad-wrap');
padWrap.append(pad.el);
padCard.append(padHead, padWrap);

document.querySelector('#topbar')!.append(toolbar);
document.querySelector('#stage')!.append(padCard, issuesBox);
document.querySelector('#side')!.append(panel.el);
document.body.append(sheet);

document.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey)) return;
  if (e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    restore(past, future);
  } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
    e.preventDefault();
    restore(future, past);
  }
});

onDropFile(document.body, (loaded) => {
  snapshot('');
  km = loaded;
  layer = 0;
  setSource('local-file', 'local file (dropped) — not saved anywhere yet');
  refresh();
});

// Pasting a share link into an already-open tab only changes the fragment, which does not
// re-run loadInitial - the link would be silently ignored. Reload so it is actually honoured.
addEventListener('hashchange', () => {
  if (!new URLSearchParams(location.hash.replace(/^#/, '')).has('km')) return;
  if (confirm('Open the shared keymap from this link? Unsaved changes in this tab will be lost.')) {
    location.reload();
  } else {
    history.replaceState(null, '', location.pathname + location.search);
  }
});

loadInitial(bundled)
  .then((loaded) => {
    booted = true;
    km = loaded.km;
    layer = 0;
    // Show what config.h actually holds, not our defaults, or the panel would quietly
    // offer to overwrite the linked clone's real values with 128/60000.
    if (loaded.oled) oled = loaded.oled;
    oledCode = loaded.code;
    setSource(loaded.source, loaded.label);
    refresh();
  })
  .catch((e) => {
    booted = true;
    setSource('bundled', `bundled snapshot @ ${__COMMIT__}`);
    status(`could not restore: ${String(e)}`, 'err');
    refresh();
  });

refresh();
