// Geometry -> DOM. The 19 elements are built once; painting only touches
// textContent and classList, so there is no diffing and no framework.
import { capLabel, isNo, isTrans } from './labels';
import type { Issue, KeyboardJson, KeycodeIndex, KeymapJson, LayoutEntry, Target } from './types';

const UNIT = 88;
const GAP = 6;

interface Slot {
  el: HTMLElement;
  target: Target | null; // layer is filled in at paint time
  make: (layer: number) => Target;
}

export interface Pad {
  el: HTMLElement;
  paint(km: KeymapJson, layer: number, issues: Issue[], selected: Target | null): void;
}

const sameTarget = (a: Target | null, b: Target | null): boolean =>
  !!a && !!b && a.kind === b.kind && a.layer === b.layer &&
  (a.kind === 'key' ? a.index === (b as typeof a).index
    : a.enc === (b as Extract<Target, { kind: 'enc' }>).enc && a.dir === (b as Extract<Target, { kind: 'enc' }>).dir);

/** Issue key so a cell can look up its own findings in one pass. */
const cellKey = (w: Issue['where']): string =>
  w?.key !== undefined ? `k${w.layer}:${w.key}` : `e${w?.layer}:${w?.enc}:${w?.dir}`;

const NS = 'http://www.w3.org/2000/svg';
const VIEWBOX = '0 0 132 132';
/** Arcs of the circle the knob turns on: r=48 about (66,66) of a 132 square. */
const ARC = {
  ccw: 'M 26 92 A 48 48 0 0 1 26 40',
  cw: 'M 106 40 A 48 48 0 0 1 106 92',
  track: 'M 66 18 A 48 48 0 1 1 65.9 18',
} as const;
// Each arc button owns the 42% slice of the square it sits in; same aspect, so nothing letterboxes.
const HALF_VIEWBOX = { ccw: '0 0 55.4 132', cw: '76.6 0 55.4 132' } as const;

function arcSvg(viewBox: string, d: string, cls: string): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d);
  svg.appendChild(path);
  return svg;
}

function eyebrow(text: string): HTMLElement {
  const s = document.createElement('span');
  s.className = 'dial-eyebrow';
  s.textContent = text;
  return s;
}

export function createPad(kb: KeyboardJson, layoutName: string, index: KeycodeIndex, onPick: (t: Target) => void): Pad {
  const layout: LayoutEntry[] = kb.layouts?.[layoutName]?.layout ?? [];
  const root = document.createElement('div');
  root.className = 'pad';
  root.style.width = `${Math.max(...layout.map((e) => e.x + (e.w ?? 1)), 1) * UNIT}px`;
  root.style.height = `${Math.max(...layout.map((e) => e.y + (e.h ?? 1)), 1) * UNIT}px`;

  const place = (el: HTMLElement, x: number, y: number, w = 1, h = 1) => {
    el.style.left = `${x * UNIT}px`;
    el.style.top = `${y * UNIT}px`;
    el.style.width = `${w * UNIT - GAP}px`;
    el.style.height = `${h * UNIT - GAP}px`;
  };

  // The 2x1 hole at x:0..1,y:0 is where the 128x32 panel physically sits.
  const oled = document.createElement('div');
  oled.className = 'oled';
  place(oled, 0, 0, 2, 1);
  const oledLines = [0, 1, 2, 3, 4].map(() => {
    const line = document.createElement('div');
    line.className = 'oled-line';
    oled.appendChild(line);
    return line;
  });
  root.appendChild(oled);

  const slots: Slot[] = [];
  const caps: { el: HTMLElement; text: HTMLElement; slot: Slot }[] = [];

  layout.forEach((entry, i) => {
    if (entry.encoder !== undefined) {
      const enc = entry.encoder;
      const dial = document.createElement('div');
      dial.className = 'dial';
      place(dial, entry.x, entry.y, entry.w, entry.h);
      dial.appendChild(arcSvg(VIEWBOX, ARC.track, 'dial-track'));

      const add = (el: HTMLElement, text: HTMLElement, make: (layer: number) => Target) => {
        const slot: Slot = { el, target: null, make };
        el.addEventListener('click', () => slot.target && onPick(slot.target));
        slots.push(slot);
        caps.push({ el, text, slot });
        dial.appendChild(el);
      };

      for (const dir of ['ccw', 'cw'] as const) {
        const b = document.createElement('button');
        b.className = `dial-btn dial-${dir}`;
        b.setAttribute('aria-label', `knob ${enc} ${dir === 'ccw' ? 'counter-clockwise' : 'clockwise'}`);
        const val = document.createElement('span');
        val.className = 'dial-val';
        // The half viewBox is what lets a button-sized box hold its own full-circle arc.
        // The eyebrow matches the centre cap's "press": without it, nothing but left/right
        // position says which arc is which direction.
        b.append(arcSvg(HALF_VIEWBOX[dir], ARC[dir], 'dial-arc'), eyebrow(dir), val);
        add(b, val, (layer) => ({ kind: 'enc', layer, enc, dir }));
      }

      // The press is an ordinary key in LAYOUT, so it carries the entry's own index.
      const press = document.createElement('button');
      press.className = 'dial-press';
      const pressText = document.createElement('span');
      pressText.className = 'slot-label';
      press.append(eyebrow('press'), pressText);
      add(press, pressText, (layer) => ({ kind: 'key', layer, index: i }));

      root.appendChild(dial);
      return;
    }

    const b = document.createElement('button');
    b.className = 'slot cap';
    place(b, entry.x, entry.y, entry.w, entry.h);
    const hint = document.createElement('span');
    hint.className = 'cap-hint';
    hint.textContent = entry.label ?? '';
    const text = document.createElement('span');
    text.className = 'slot-label';
    b.append(hint, text);
    root.appendChild(b);
    const slot: Slot = { el: b, target: null, make: (layer) => ({ kind: 'key', layer, index: i }) };
    b.addEventListener('click', () => slot.target && onPick(slot.target));
    slots.push(slot);
    caps.push({ el: b, text, slot });
  });

  function paint(km: KeymapJson, layer: number, issues: Issue[], selected: Target | null) {
    const worst = new Map<string, 'error' | 'warning'>();
    for (const it of issues) {
      if (it.where?.layer !== layer) continue;
      if (it.where.key === undefined && it.where.enc === undefined) continue;
      const k = cellKey(it.where);
      if (it.severity === 'error' || !worst.has(k)) worst.set(k, it.severity);
    }

    const raw = (t: Target): string => {
      if (t.kind === 'key') return km.layers?.[t.layer]?.[t.index] ?? '';
      const pair = km.encoders?.[t.layer]?.[t.enc];
      return (t.dir === 'ccw' ? pair?.ccw : pair?.cw) ?? '';
    };

    for (const { el, text, slot } of caps) {
      const t = slot.make(layer);
      slot.target = t;
      const value = raw(t);
      const sev = worst.get(cellKey(t.kind === 'key' ? { layer, key: t.index } : { layer, enc: t.enc, dir: t.dir }));
      text.textContent = capLabel(value, index);
      el.title = value ? `${value}${sev ? ' — see issues' : ''}` : 'unassigned';
      el.classList.toggle('is-error', sev === 'error');
      el.classList.toggle('is-warn', sev === 'warning');
      el.classList.toggle('is-trans', isTrans(value, index));
      el.classList.toggle('is-no', isNo(value, index));
      el.classList.toggle('is-selected', sameTarget(t, selected));
    }

    const errs = issues.filter((i) => i.severity === 'error').length;
    const lines = [
      km.keyboard?.split('/').pop() ?? 'candypad',
      `layer ${layer} of ${km.layers?.length ?? 0}`,
      errs ? `${errs} error${errs === 1 ? '' : 's'}` : 'ok',
      `${km.layers?.[layer]?.length ?? 0} keys`,
      '—'.repeat(12),
    ];
    oledLines.forEach((l, i) => (l.textContent = lines[i] ?? ''));
  }

  return { el: root, paint };
}

export interface LayerTabs {
  el: HTMLElement;
  paint(count: number, active: number, issues: Issue[]): void;
}

export function createLayerTabs(handlers: {
  onSelect: (n: number) => void;
  onAdd: () => void;
  onRemove: (n: number) => void;
}): LayerTabs {
  const root = document.createElement('div');
  root.className = 'layerbar';
  const strip = document.createElement('div');
  strip.className = 'tab-strip';
  const actions = document.createElement('div');
  actions.className = 'layerbar-actions';
  const add = document.createElement('button');
  add.className = 'icon-btn';
  add.textContent = '+';
  add.title = 'add a layer';
  add.addEventListener('click', handlers.onAdd);
  const del = document.createElement('button');
  del.className = 'icon-btn danger';
  del.textContent = '−';
  del.title = 'remove the current layer';
  actions.append(add, del);
  root.append(strip, actions);

  let active = 0;
  del.addEventListener('click', () => handlers.onRemove(active));

  function paint(count: number, current: number, issues: Issue[]) {
    active = current;
    const bad = new Set(issues.filter((i) => i.severity === 'error' && i.where?.layer !== undefined).map((i) => i.where!.layer!));
    strip.textContent = '';
    for (let l = 0; l < count; l++) {
      const b = document.createElement('button');
      b.className = 'pill';
      b.textContent = `Layer ${l}`;
      b.classList.toggle('is-active', l === current);
      b.classList.toggle('is-error', bad.has(l));
      if (bad.has(l)) b.title = 'this layer has validation errors';
      b.addEventListener('click', () => handlers.onSelect(l));
      strip.appendChild(b);
    }
    del.disabled = count <= 1;
  }

  return { el: root, paint };
}
