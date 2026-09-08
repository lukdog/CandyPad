// Assignment panel: raw field, a always-visible modifier-wrap bar, and the keycode
// picker split into task categories (see categories.ts) instead of one long scroll.
// Everything it produces is stored verbatim: no canonicalisation, because KC_BTN3
// and MS_BTN3 both compile and silently rewriting one produces diffs nobody asked for.
import { buildCategories, matchesQuery, type Category, type CategoryEntry } from './categories';
import { parse } from './expr';
import { capLabel } from './labels';
import type { KeycodeIndex, Target } from './types';

const MODS = ['CTL', 'SFT', 'ALT', 'GUI'] as const;
type Mod = (typeof MODS)[number];

const MOD_LABEL: Record<Mod, string> = { CTL: '⌃ Ctrl', SFT: '⇧ Shift', ALT: '⌥ Alt', GUI: '⌘ Gui' };

/** Nested, outermost-first and always in this order, so the same picks give the same string. */
function wrap(base: string, mods: Set<Mod>, side: 'L' | 'R'): string {
  let out = base;
  for (let i = MODS.length - 1; i >= 0; i--) {
    const m = MODS[i]!;
    if (mods.has(m)) out = `${side}${m}(${out})`;
  }
  return out;
}

/** Inverse of wrap() for pre-filling the builder from an existing assignment. */
function peel(raw: string): { base: string; mods: Set<Mod>; side: 'L' | 'R' } {
  const mods = new Set<Mod>();
  let side: 'L' | 'R' = 'L';
  let s = raw.trim();
  for (;;) {
    const m = /^([LR])(CTL|SFT|ALT|GUI)\((.*)\)$/.exec(s);
    if (!m) break;
    side = m[1] as 'L' | 'R';
    mods.add(m[2] as Mod);
    s = m[3]!.trim();
  }
  return { base: s, mods, side };
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

export interface Panel {
  el: HTMLElement;
  open(target: Target, current: string, layerCount: number, title: string): void;
  close(): void;
}

const MAX_ROWS = 240;

export function createPanel(index: KeycodeIndex, onAssign: (t: Target, value: string) => void): Panel {
  const { categories, skipped } = buildCategories(index);
  if (skipped.length) console.warn(`[categories] ${skipped.length} curated keycode(s) not in the table:`, skipped);
  const allEntries = categories.find((c) => c.kind === 'all')?.entries ?? [];

  const root = el('aside', 'panel');

  let target: Target | null = null;
  let base = 'KC_NO';
  let mods = new Set<Mod>();
  let side: 'L' | 'R' = 'L';
  let layerCount = 1;
  let active: Category = categories[0]!;

  // ── empty state ──
  const empty = el('div', 'panel-empty');
  empty.append(
    el('div', 'empty-glyph', '⌨'),
    el('p', 'empty-title', 'No key selected'),
    el('p', 'empty-hint', 'Click a key, a knob, or an encoder chip to assign a keycode.'),
  );

  const body = el('div', 'panel-body');
  body.hidden = true;

  // ── head ──
  const head = el('div', 'panel-head');
  const headText = el('div', 'panel-headtext');
  const heading = el('h2', 'panel-title', 'Assign');
  headText.append(el('span', 'eyebrow', 'Assign to'), heading);
  const closeBtn = el('button', 'icon-btn', '✕');
  closeBtn.setAttribute('aria-label', 'close panel');
  closeBtn.addEventListener('click', () => close());
  head.append(headText, closeBtn);

  // Cap preview sits next to the raw field: the old separate "current" box repeated the
  // same string the input already shows.
  const currentCap = el('span', 'current-cap');

  // ── raw expression (the source of truth for what gets stored) ──
  const raw = el('input', 'raw');
  raw.type = 'text';
  raw.spellcheck = false;
  raw.setAttribute('aria-label', 'raw keycode expression');
  const rawErr = el('div', 'raw-err');

  function commit(value: string, syncRaw = true) {
    if (syncRaw) raw.value = value;
    showParse(value);
    if (target) onAssign(target, value);
    renderCurrent(value);
  }

  function showParse(value: string) {
    const { errors } = parse(value);
    rawErr.textContent = errors.map((e) => e.message).join(' · ');
    rawErr.classList.toggle('has-err', errors.some((e) => !e.code.startsWith('W_')));
    rawErr.classList.toggle('has-warn', errors.length > 0 && errors.every((e) => e.code.startsWith('W_')));
  }

  // Re-peel on every keystroke: without this, typing a keycode by hand and then ticking a
  // modifier would wrap the *previous* base instead of what was just typed.
  raw.addEventListener('input', () => {
    const peeled = peel(raw.value);
    base = peeled.base || 'KC_NO';
    mods = peeled.mods;
    side = peeled.side;
    syncMods();
    commit(raw.value, false);
  });

  function renderCurrent(value: string) {
    currentCap.textContent = capLabel(value, index) || '∅';
  }

  // ── quick actions ──
  const quick = el('div', 'quick');
  for (const [label, value] of [['▽  Transparent', 'KC_TRNS'], ['∅  None', 'KC_NO']] as const) {
    const b = el('button', 'ghost-btn', label);
    b.addEventListener('click', () => {
      base = value;
      mods = new Set();
      syncMods();
      commit(value);
    });
    quick.appendChild(b);
  }

  // ── modifier-wrap bar: one row, always visible, orthogonal to the category tabs ──
  const modBox = el('div', 'wrapbar');
  const modHead = el('div', 'wrapbar-head');
  const baseLabel = el('code', 'base-label', base);
  modHead.append(el('span', 'eyebrow', 'Modifier wrap'), baseLabel);

  const sideRow = el('div', 'seg');
  const sideInputs: HTMLInputElement[] = [];
  const sideChips: HTMLElement[] = [];
  for (const s of ['L', 'R'] as const) {
    const chip = el('label', 'seg-item');
    const rb = el('input', 'sr-only');
    rb.type = 'radio';
    rb.name = 'mod-side';
    rb.checked = s === 'L';
    rb.addEventListener('change', () => {
      side = s;
      syncMods();
      commit(wrap(base, mods, side));
    });
    chip.append(rb, el('span', undefined, s === 'L' ? 'Left' : 'Right'));
    sideRow.appendChild(chip);
    sideInputs.push(rb);
    sideChips.push(chip);
  }

  const modRow = el('div', 'chips');
  const modInputs = new Map<Mod, { cb: HTMLInputElement; chip: HTMLElement }>();
  for (const m of MODS) {
    const chip = el('label', 'chip');
    const cb = el('input', 'sr-only');
    cb.type = 'checkbox';
    cb.addEventListener('change', () => {
      if (cb.checked) mods.add(m);
      else mods.delete(m);
      syncMods();
      commit(wrap(base, mods, side));
    });
    chip.append(cb, el('span', undefined, MOD_LABEL[m]));
    modRow.appendChild(chip);
    modInputs.set(m, { cb, chip });
  }
  const wrapRow = el('div', 'wrapbar-row');
  wrapRow.append(sideRow, modRow);
  modBox.append(modHead, wrapRow);

  function syncMods() {
    baseLabel.textContent = base;
    for (const [m, { cb, chip }] of modInputs) {
      cb.checked = mods.has(m);
      chip.classList.toggle('is-on', cb.checked);
    }
    const i = side === 'L' ? 0 : 1;
    sideInputs[i]!.checked = true;
    sideChips.forEach((c, n) => c.classList.toggle('is-on', n === i));
  }

  // ── layer builder: lives inside the Layers category, not as a third stacked box ──
  const layerBox = el('div', 'builder');
  const layerFn = el('select', 'sel');
  for (const fn of ['MO', 'TO', 'TG', 'OSL', 'LT']) layerFn.appendChild(el('option', undefined, fn));
  const layerNum = el('select', 'sel');
  const layerApply = el('button', 'accent-btn', 'Apply');
  layerApply.addEventListener('click', () => {
    const fn = layerFn.value;
    const n = layerNum.value;
    commit(fn === 'LT' ? `LT(${n},${base})` : `${fn}(${n})`);
  });
  const layerRow = el('div', 'row');
  layerRow.append(layerFn, layerNum, layerApply);
  layerBox.append(
    el('span', 'eyebrow', 'Layer switch'),
    layerRow,
    el('p', 'hint', 'MO holds · TO switches · TG toggles · OSL is one-shot · LT taps the base keycode above and holds the layer.'),
  );

  // ── category tabs + list ──
  const tabsEl = el('div', 'cat-tabs');
  tabsEl.setAttribute('role', 'tablist');
  for (const cat of categories) {
    const b = el('button', 'cat-tab', cat.label);
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => {
      active = cat;
      search.value = '';
      syncTabs();
      renderList();
    });
    tabsEl.appendChild(b);
  }

  function syncTabs() {
    [...tabsEl.children].forEach((b, i) => {
      const on = categories[i] === active;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', String(on));
    });
  }

  const search = el('input', 'search');
  search.type = 'search';
  search.placeholder = 'Search all keycodes…';
  search.addEventListener('input', () => renderList());

  const listNote = el('div', 'kc-note');
  const list = el('div', 'kc-list');

  function entryButton(entry: CategoryEntry): HTMLElement {
    const b = el('button', 'kc');
    b.append(el('span', 'kc-cap', capLabel(entry.name, index) || '∅'), el('span', 'kc-name', entry.name));
    b.title = entry.kc.label ?? entry.name;
    // Picking a keycode sets the builder base and assigns it with the current wrappers.
    b.addEventListener('click', () => {
      base = entry.name;
      syncMods();
      commit(wrap(base, mods, side));
    });
    return b;
  }

  // A query always searches the whole index, so nothing is unreachable through the categories.
  function renderList() {
    const q = search.value.trim().toLowerCase();
    const searching = q.length > 0;
    layerBox.hidden = searching || active.kind !== 'layers';
    list.hidden = !layerBox.hidden;
    list.textContent = '';

    if (!layerBox.hidden) {
      listNote.textContent = '';
      return;
    }

    const pool = searching ? allEntries : active.entries;
    const hits = searching ? pool.filter((e) => matchesQuery(e, q)) : pool;
    for (const entry of hits.slice(0, MAX_ROWS)) list.appendChild(entryButton(entry));

    const rest = hits.length - Math.min(hits.length, MAX_ROWS);
    listNote.textContent = !hits.length
      ? 'No matches.'
      : searching
        ? `${hits.length} match${hits.length === 1 ? '' : 'es'} across all ${allEntries.length} keycodes${rest ? ` — showing ${MAX_ROWS}, refine the search` : ''}`
        : `${hits.length} keycode${hits.length === 1 ? '' : 's'}${rest ? ` — showing ${MAX_ROWS}, use the search` : ''}`;
  }

  const rawField = el('div', 'field');
  rawField.append(el('span', 'eyebrow', 'Raw expression'), raw);
  const assignRow = el('div', 'assign-row');
  assignRow.append(currentCap, rawField);

  body.append(head, assignRow, rawErr, quick, modBox, tabsEl, search, listNote, layerBox, list);
  root.append(empty, body);

  function open(t: Target, current: string, layers: number, title: string) {
    target = t;
    layerCount = layers;
    heading.textContent = title;
    const peeled = peel(current);
    base = peeled.base || 'KC_NO';
    mods = peeled.mods;
    side = peeled.side;
    syncMods();
    layerNum.textContent = '';
    for (let l = 0; l < layerCount; l++) layerNum.appendChild(el('option', undefined, String(l)));
    raw.value = current;
    showParse(current);
    renderCurrent(current);
    syncTabs();
    renderList();
    empty.hidden = true;
    body.hidden = false;
    raw.focus();
  }

  function close() {
    body.hidden = true;
    empty.hidden = false;
    target = null;
  }

  return { el: root, open, close };
}
