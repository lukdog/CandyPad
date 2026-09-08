// Task-oriented picker categories. QMK's own `group` is unusable as a taxonomy here:
// `basic` lumps letters, digits, navigation, F-keys and numpad into 161 entries, while
// midi/joystick/steno/macro are irrelevant to a 19-key macropad. So the lists are curated
// by hand and resolved against the index; names the table does not know are dropped.
import type { Keycode, KeycodeIndex } from './types';

export interface CategoryEntry {
  /** The curated spelling. Assigned verbatim — never rewritten to kc.key. */
  name: string;
  kc: Keycode;
}

export type CategoryKind = 'keycodes' | 'layers' | 'all';

export interface Category {
  id: string;
  label: string;
  kind: CategoryKind;
  entries: CategoryEntry[];
}

const seq = (prefix: string, from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${from + i}`);

const LETTERS = Array.from({ length: 26 }, (_, i) => `KC_${String.fromCharCode(65 + i)}`);

/** Ordered by how often a numpad build needs them; `layers` and `all` carry no list. */
const SPECS: { id: string; label: string; kind?: CategoryKind; names?: string[] }[] = [
  {
    id: 'numpad',
    label: 'Numpad',
    names: [
      'KC_NUM', 'KC_PSLS', 'KC_PAST', 'KC_PMNS',
      'KC_P7', 'KC_P8', 'KC_P9', 'KC_PPLS',
      'KC_P4', 'KC_P5', 'KC_P6', 'KC_PENT',
      'KC_P1', 'KC_P2', 'KC_P3', 'KC_P0',
      'KC_PDOT', 'KC_PCMM', 'KC_PEQL',
    ],
  },
  {
    id: 'nav',
    label: 'Navigation',
    names: [
      'KC_UP', 'KC_DOWN', 'KC_LEFT', 'KC_RGHT',
      'KC_HOME', 'KC_END', 'KC_PGUP', 'KC_PGDN',
      'KC_TAB', 'KC_ESC', 'KC_ENT', 'KC_BSPC',
      'KC_DEL', 'KC_INS', 'KC_SPC', 'KC_APP',
    ],
  },
  { id: 'function', label: 'Function', names: seq('KC_F', 1, 24) },
  {
    id: 'mods',
    label: 'Modifiers',
    names: [
      'KC_LCTL', 'KC_LSFT', 'KC_LALT', 'KC_LGUI',
      'KC_RCTL', 'KC_RSFT', 'KC_RALT', 'KC_RGUI',
      'KC_CAPS',
    ],
  },
  {
    id: 'media',
    label: 'Media',
    names: [
      'KC_MUTE', 'KC_VOLU', 'KC_VOLD',
      'KC_MPLY', 'KC_MSTP', 'KC_MPRV', 'KC_MNXT',
      'KC_MRWD', 'KC_MFFD', 'KC_EJCT', 'KC_MSEL',
      'KC_BRIU', 'KC_BRID',
    ],
  },
  {
    id: 'mouse',
    label: 'Mouse',
    names: [
      'MS_BTN1', 'MS_BTN2', 'MS_BTN3', 'MS_BTN4', 'MS_BTN5',
      'MS_WHLU', 'MS_WHLD', 'MS_WHLL', 'MS_WHLR',
      'MS_UP', 'MS_DOWN', 'MS_LEFT', 'MS_RGHT',
      'MS_ACL0', 'MS_ACL1', 'MS_ACL2',
    ],
  },
  { id: 'letters', label: 'Letters', names: LETTERS },
  {
    id: 'symbols',
    label: 'Numbers & symbols',
    names: [
      ...seq('KC_', 1, 9), 'KC_0',
      'KC_MINS', 'KC_EQL', 'KC_LBRC', 'KC_RBRC', 'KC_BSLS',
      'KC_SCLN', 'KC_QUOT', 'KC_GRV', 'KC_COMM', 'KC_DOT', 'KC_SLSH',
      'KC_NUBS', 'KC_NUHS',
    ],
  },
  { id: 'layers', label: 'Layers', kind: 'layers' },
  {
    id: 'system',
    label: 'System',
    names: [
      'QK_BOOT', 'QK_RBT', 'EE_CLR', 'DB_TOGG', 'QK_MAKE',
      'KC_PWR', 'KC_SLEP', 'KC_WAKE',
      'KC_PSCR', 'KC_SCRL', 'KC_PAUS',
      'NK_TOGG', 'AG_TOGG', 'GU_TOGG', 'CL_TOGG',
    ],
  },
  { id: 'all', label: 'All keycodes', kind: 'all' },
];

/** Every entry in the table, so the search box and the escape hatch reach the whole index. */
function allEntries(index: KeycodeIndex): CategoryEntry[] {
  return index.groups.flatMap((g) => g.keycodes.map((kc) => ({ name: kc.key, kc })));
}

export function buildCategories(index: KeycodeIndex): { categories: Category[]; skipped: string[] } {
  const skipped: string[] = [];
  const categories = SPECS.map(({ id, label, kind, names }) => {
    const entries: CategoryEntry[] = [];
    for (const name of names ?? []) {
      const kc = index.byName.get(name);
      // A name the vendored table does not know is dropped silently rather than
      // rendered as a dead row; the count is reported so curation drift is visible.
      if (kc) entries.push({ name, kc });
      else skipped.push(name);
    }
    return { id, label, kind: kind ?? 'keycodes', entries: kind === 'all' ? allEntries(index) : entries };
  });
  return { categories, skipped };
}

export function matchesQuery(entry: CategoryEntry, q: string): boolean {
  if (!q) return true;
  const { name, kc } = entry;
  return (
    name.toLowerCase().includes(q) ||
    kc.key.toLowerCase().includes(q) ||
    (kc.label ?? '').toLowerCase().includes(q) ||
    (kc.aliases ?? []).some((a) => a.toLowerCase().includes(q))
  );
}
