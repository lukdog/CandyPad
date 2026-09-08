// Assignment panel. Everything it produces is stored verbatim: no canonicalisation,
// because KC_BTN3 and MS_BTN3 both compile and silently rewriting one produces
// diffs the user never asked for.
import { parse } from './expr';
import { capLabel } from './labels';
import type { Keycode, KeycodeIndex, Target } from './types';

/** 0.0.7 has no `keypad` group — numpad keys live in `basic` — so this section is curated. */
const NUMPAD = [
  'KC_NUM', 'KC_PSLS', 'KC_PAST', 'KC_PMNS', 'KC_PPLS', 'KC_PENT', 'KC_PDOT', 'KC_PCMM', 'KC_PEQL',
  'KC_P0', 'KC_P1', 'KC_P2', 'KC_P3', 'KC_P4', 'KC_P5', 'KC_P6', 'KC_P7', 'KC_P8', 'KC_P9',
];

/** Groups worth showing on a macropad; the rest hide behind "show all". */
const PRIMARY = ['basic', 'media', 'mouse', 'modifiers', 'quantum'];

const MODS = ['CTL', 'SFT', 'ALT', 'GUI'] as const;
type Mod = (typeof MODS)[number];

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
  const root = el('aside', 'panel');
  root.hidden = true;

  let target: Target | null = null;
  let base = 'KC_NO';
  let mods = new Set<Mod>();
  let side: 'L' | 'R' = 'L';
  let layerCount = 1;
  let showAll = false;

  const head = el('div', 'panel-head');
  const heading = el('h2', 'panel-title', 'Assign');
  const closeBtn = el('button', 'icon-btn', '✕');
  closeBtn.addEventListener('click', () => close());
  head.append(heading, closeBtn);

  const currentBox = el('div', 'current');

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
    currentBox.textContent = '';
    currentBox.append(
      el('span', 'current-cap', capLabel(value, index) || '∅'),
      el('code', 'current-raw', value),
    );
  }

  // ── quick buttons ──
  const quick = el('div', 'quick');
  for (const [label, value] of [['▽ KC_TRNS', 'KC_TRNS'], ['∅ KC_NO', 'KC_NO']] as const) {
    const b = el('button', 'big-btn', label);
    b.addEventListener('click', () => {
      base = value;
      mods = new Set();
      syncMods();
      commit(value);
    });
    quick.appendChild(b);
  }

  // ── modifier-wrap builder ──
  const modBox = el('div', 'builder');
  modBox.appendChild(el('h3', 'builder-title', 'Wrap in modifiers'));
  const baseLabel = el('code', 'base-label', base);
  const baseRow = el('div', 'row');
  baseRow.append(el('span', 'row-label', 'base'), baseLabel);
  const modRow = el('div', 'row');
  const modInputs = new Map<Mod, HTMLInputElement>();
  for (const m of MODS) {
    const wrapEl = el('label', 'chk');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.addEventListener('change', () => {
      if (cb.checked) mods.add(m); else mods.delete(m);
      commit(wrap(base, mods, side));
    });
    wrapEl.append(cb, el('span', undefined, m));
    modRow.appendChild(wrapEl);
    modInputs.set(m, cb);
  }
  const sideRow = el('div', 'row');
  const sideInputs: HTMLInputElement[] = [];
  for (const s of ['L', 'R'] as const) {
    const wrapEl = el('label', 'chk');
    const rb = el('input');
    rb.type = 'radio';
    rb.name = 'mod-side';
    rb.checked = s === 'L';
    rb.addEventListener('change', () => {
      side = s;
      commit(wrap(base, mods, side));
    });
    wrapEl.append(rb, el('span', undefined, s === 'L' ? 'Left' : 'Right'));
    sideRow.appendChild(wrapEl);
    sideInputs.push(rb);
  }
  modBox.append(baseRow, modRow, sideRow);

  function syncMods() {
    baseLabel.textContent = base;
    for (const [m, cb] of modInputs) cb.checked = mods.has(m);
    sideInputs[side === 'L' ? 0 : 1]!.checked = true;
  }

  // ── layer builder ──
  const layerBox = el('div', 'builder');
  layerBox.appendChild(el('h3', 'builder-title', 'Layer keycode'));
  const layerFn = el('select', 'sel');
  for (const fn of ['MO', 'TO', 'TG', 'OSL', 'LT']) layerFn.appendChild(el('option', undefined, fn));
  const layerNum = el('select', 'sel');
  const layerApply = el('button', 'btn', 'Apply');
  layerApply.addEventListener('click', () => {
    const fn = layerFn.value;
    const n = layerNum.value;
    commit(fn === 'LT' ? `LT(${n},${base})` : `${fn}(${n})`);
  });
  const layerRow = el('div', 'row');
  layerRow.append(layerFn, layerNum, layerApply);
  const layerHint = el('div', 'hint', 'LT() taps the base keycode above and holds the layer.');
  layerBox.append(layerRow, layerHint);

  // ── keycode list ──
  const search = el('input', 'search');
  search.type = 'search';
  search.placeholder = 'Search keycodes…';
  search.addEventListener('input', () => renderList());
  const allToggle = el('label', 'chk show-all');
  const allCb = el('input');
  allCb.type = 'checkbox';
  allCb.addEventListener('change', () => {
    showAll = allCb.checked;
    renderList();
  });
  allToggle.append(allCb, el('span', undefined, 'show all groups'));
  const list = el('div', 'kc-list');

  const byGroup = new Map(index.groups.map((g) => [g.group, g.keycodes]));
  const numpad = NUMPAD.map((n) => index.byName.get(n)).filter((k): k is Keycode => !!k);

  function sections(): { group: string; keycodes: Keycode[] }[] {
    const out = [{ group: 'numpad', keycodes: numpad }];
    for (const g of PRIMARY) out.push({ group: g, keycodes: byGroup.get(g) ?? [] });
    if (showAll) {
      for (const g of index.groups) {
        if (!PRIMARY.includes(g.group)) out.push(g);
      }
    }
    return out.filter((s) => s.keycodes.length);
  }

  function matches(kc: Keycode, q: string): boolean {
    if (!q) return true;
    return (
      kc.key.toLowerCase().includes(q) ||
      (kc.label ?? '').toLowerCase().includes(q) ||
      (kc.aliases ?? []).some((a) => a.toLowerCase().includes(q))
    );
  }

  // Capped per section, not virtualised: every group keeps a visible header and the
  // search box is the way through ~730 entries.
  function renderList() {
    const q = search.value.trim().toLowerCase();
    const perSection = q ? MAX_ROWS : 24;
    list.textContent = '';
    let painted = 0;
    let skipped = 0;
    for (const sec of sections()) {
      const hits = sec.keycodes.filter((kc) => matches(kc, q));
      if (!hits.length) continue;
      const room = Math.min(perSection, MAX_ROWS - painted);
      if (room <= 0) {
        skipped += hits.length;
        continue;
      }
      list.appendChild(el('div', 'kc-group', sec.group));
      for (const kc of hits.slice(0, room)) {
        painted++;
        const b = el('button', 'kc');
        b.append(el('span', 'kc-cap', capLabel(kc.key, index) || '∅'), el('span', 'kc-name', kc.key));
        b.title = kc.label ?? kc.key;
        // Picking a keycode sets the builder base and assigns it with the current wrappers.
        b.addEventListener('click', () => {
          base = kc.key;
          syncMods();
          commit(wrap(base, mods, side));
        });
        list.appendChild(b);
      }
      const rest = hits.length - Math.min(room, hits.length);
      if (rest) list.appendChild(el('div', 'kc-more', `+${rest} more in ${sec.group} — use the search`));
    }
    if (skipped) list.appendChild(el('div', 'kc-more', `${skipped} more — refine the search`));
    if (!painted) list.appendChild(el('div', 'kc-more', 'no matches'));
  }

  root.append(
    head,
    currentBox,
    quick,
    el('h3', 'builder-title', 'Raw expression'),
    raw,
    rawErr,
    modBox,
    layerBox,
    el('h3', 'builder-title', 'Keycodes'),
    search,
    allToggle,
    list,
  );

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
    renderList();
    root.hidden = false;
    raw.focus();
  }

  function close() {
    root.hidden = true;
    target = null;
  }

  return { el: root, open, close };
}
