// App shell: state, undo/redo, validation on every mutation, and the persistence wiring.
import board from '@board';
import bundledKeymap from '@keymap';
import { buildIndex } from './keycodes';
import { createPanel } from './panel';
import {
  autosave, downloadKeymap, fsaAvailable, loadInitial, onDropFile,
  pickRepoDir, repoLinked, shareLink, writeToRepo, type OledSettings,
} from './persist';
import { createEncoderLegend, createLayerTabs, createPad } from './render';
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
let oled: OledSettings = { brightness: 128, timeout: 60000 };
let layer = 0;
let selected: Target | null = null;
let issues: Issue[] = [];

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
const legend = createEncoderLegend(index, pick);
const tabs = createLayerTabs({
  onSelect: (n) => {
    layer = n;
    refresh();
  },
  onAdd: addLayer,
  onRemove: removeLayer,
});

const issueList = el('div', 'issues');
const sourceBadge = el('span', 'badge', 'loading…');
const statusLine = document.querySelector<HTMLElement>('#status')!;

function status(text: string, kind: 'ok' | 'err' = 'ok') {
  statusLine.textContent = text;
  statusLine.className = kind;
  if (text) window.setTimeout(() => (statusLine.textContent === text ? (statusLine.textContent = '') : null), 4000);
}

function renderIssues() {
  issueList.textContent = '';
  const errs = issues.filter((i) => i.severity === 'error').length;
  issueList.appendChild(
    el('h3', 'builder-title', issues.length ? `${errs} error(s), ${issues.length - errs} warning(s)` : 'No issues'),
  );
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
  legend.paint(km, layer);
  tabs.paint(km.layers.length, layer, issues);
  renderIssues();
  if (!issues.some((i) => i.severity === 'error')) saveAnyway.hidden = true;
  autosave(km);
}

// ── toolbar ──────────────────────────────────────────────
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
    await writeToRepo(km, oled);
    saveAnyway.hidden = true;
    status('written to keymap.json + config.h');
  } catch (e) {
    // writeToRepo throws Error with a message meant for the user; String(e) would prefix "Error:".
    status(`save failed: ${e instanceof Error ? e.message : String(e)}`, 'err');
  }
}

const saveAnyway = button('Save anyway', () => void save(true), 'btn danger');
saveAnyway.hidden = true;

const toolbar = el('div', 'toolbar');
toolbar.append(
  el('span', 'brand', 'CandyPad'),
  sourceBadge,
  button('Undo', () => restore(past, future)),
  button('Redo', () => restore(future, past)),
  button('Share', async () => {
    const url = shareLink(km);
    try {
      await navigator.clipboard.writeText(url);
      status('share link copied to clipboard');
    } catch {
      window.prompt('Share link', url);
    }
  }),
  button('Download', () => downloadKeymap(km)),
);
if (fsaAvailable()) {
  toolbar.append(
    button('Link repo…', async () => status((await pickRepoDir()) ? 'repo linked' : 'not linked', 'ok')),
    button('Save to repo', () => void save(), 'btn primary'),
    saveAnyway,
  );
} else {
  toolbar.append(el('span', 'hint', 'Direct save needs a Chromium browser — use Download instead.'));
}
toolbar.append(el('span', 'commit', `build ${__COMMIT__}`));

// ── OLED settings (config.h #defines: QMK does not expose these to keymap.json) ──
const oledBox = el('div', 'builder');
oledBox.appendChild(el('h3', 'builder-title', 'OLED (config.h)'));
function numberField(label: string, value: number, min: number, max: number, onChange: (n: number) => void) {
  const row = el('label', 'row');
  const input = el('input', 'num');
  input.type = 'number';
  input.min = String(min);
  input.max = String(max);
  input.value = String(value);
  input.addEventListener('change', () => {
    const n = Math.min(max, Math.max(min, Number(input.value) || 0));
    input.value = String(n);
    onChange(n);
  });
  row.append(el('span', 'row-label', label), input);
  return row;
}
oledBox.append(
  numberField('brightness (0-255)', oled.brightness, 0, 255, (n) => (oled = { ...oled, brightness: n })),
  numberField('timeout (ms)', oled.timeout, 0, 3_600_000, (n) => (oled = { ...oled, timeout: n })),
);

// ── mount ────────────────────────────────────────────────
document.querySelector('#topbar')!.append(toolbar);
const stage = document.querySelector('#stage')!;
stage.append(tabs.el, pad.el, legend.el, oledBox, issueList);
document.querySelector('#side')!.append(panel.el);

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
  sourceBadge.textContent = 'local file (dropped)';
  refresh();
});

loadInitial(bundled)
  .then((loaded) => {
    km = loaded.km;
    layer = 0;
    // Show what config.h actually holds, not our defaults, or the panel would quietly
    // offer to overwrite the linked clone's real values with 128/60000.
    if (loaded.oled) oled = loaded.oled;
    sourceBadge.textContent = loaded.label;
    sourceBadge.dataset['source'] = loaded.source;
    refresh();
  })
  .catch((e) => {
    sourceBadge.textContent = `bundled snapshot @ ${__COMMIT__}`;
    status(`could not restore: ${String(e)}`, 'err');
    refresh();
  });

refresh();
