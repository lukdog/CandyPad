// Keycode index over the vendored QMK constants table, plus the hand-written
// tables for things the constants file cannot enumerate.
import raw from './data/keycodes-0.0.7.json';
import type { Keycode, KeycodeIndex } from './types';

/** Sentinels QMK uses in its alias diffs; never real keycode names. */
const SENTINELS = new Set(['!reset!', '!delete!']);

/** Valid in a JSON keymap but not always present in the constants table. */
const EXTRA_ALIASES: Record<string, string> = {
  _______: 'KC_TRNS',
  XXXXXXX: 'KC_NO',
};

/** Board-relevant groups first; everything else keeps the table's own order. */
export const GROUP_ORDER = [
  'basic',
  'keypad',
  'media',
  'mouse',
  'modifiers',
  'layer',
  'quantum',
] as const;

/** Constants `group` -> the QMK feature the keycode needs to do anything. */
export const GROUP_FEATURE: Record<string, string> = {
  mouse: 'mousekey',
  media: 'extrakey',
  underglow: 'rgblight',
  rgb: 'rgblight',
  rgb_matrix: 'rgb_matrix',
  led_matrix: 'led_matrix',
  backlight: 'backlight',
  audio: 'audio',
  midi: 'midi',
  joystick: 'joystick',
  steno: 'stenography',
};

/** Features that need LEDs on the PCB: absent from keyboard.json means never. */
export const HARDWARE_FEATURES = new Set(['rgblight', 'rgb_matrix', 'led_matrix', 'backlight']);

/** Fallback for entries whose `group` is unhelpful, and for legacy names absent from the table. */
const NAME_FEATURE: [RegExp, string][] = [
  [/^(RGB_|UG_)/, 'rgblight'],
  [/^(RM_)/, 'rgb_matrix'],
  [/^(BL_)/, 'backlight'],
  [/^(MS_|KC_BTN|KC_MS_|KC_WH_)/, 'mousekey'],
];

/** The feature a keycode needs, by group first then by name shape. Null when it needs none. */
export function featureFor(name: string, kc?: Keycode): string | null {
  const byGroup = kc?.group ? GROUP_FEATURE[kc.group] : undefined;
  if (byGroup) return byGroup;
  for (const [re, feature] of NAME_FEATURE) if (re.test(name)) return feature;
  return null;
}

const MOD_WRAPPERS = [
  'LCTL', 'LSFT', 'LALT', 'LGUI', 'RCTL', 'RSFT', 'RALT', 'RGUI',
  'C', 'S', 'A', 'G', 'HYPR', 'MEH', 'ALL', 'LCAG', 'RCAG', 'ALGR',
  'SGUI', 'SCMD', 'SWIN', 'LCA', 'LSA', 'LSG', 'LAG', 'RCS', 'RSA', 'RAG',
];

const MOD_TAPS = [
  'LCTL_T', 'LSFT_T', 'LALT_T', 'LGUI_T', 'RCTL_T', 'RSFT_T', 'RALT_T', 'RGUI_T',
  'CTL_T', 'SFT_T', 'ALT_T', 'GUI_T', 'CMD_T', 'WIN_T',
  'C_S_T', 'MEH_T', 'HYPR_T', 'ALL_T', 'LCAG_T', 'RCAG_T', 'ALGR_T',
  'SGUI_T', 'SCMD_T', 'SWIN_T', 'LCA_T', 'LSA_T', 'LSG_T', 'LAG_T', 'RCS_T', 'RSA_T', 'RAG_T',
];

export const LAYER_FNS = ['MO', 'TO', 'TG', 'TT', 'OSL', 'DF', 'LT', 'LM'];

export type ArgKind = 'layer' | 'expr' | 'modmask';

export interface ParamFn {
  arity: number;
  args: ArgKind[];
}

/** Parameterised keycodes live in the constants file's `ranges`, so they are modelled by hand. */
export const PARAM_FNS: Record<string, ParamFn> = {
  MO: { arity: 1, args: ['layer'] },
  TO: { arity: 1, args: ['layer'] },
  TG: { arity: 1, args: ['layer'] },
  TT: { arity: 1, args: ['layer'] },
  OSL: { arity: 1, args: ['layer'] },
  DF: { arity: 1, args: ['layer'] },
  LT: { arity: 2, args: ['layer', 'expr'] },
  LM: { arity: 2, args: ['layer', 'modmask'] },
  OSM: { arity: 1, args: ['modmask'] },
  MT: { arity: 2, args: ['modmask', 'expr'] },
  ANY: { arity: 1, args: ['expr'] },
  SH_T: { arity: 1, args: ['expr'] },
  ...Object.fromEntries(MOD_WRAPPERS.map((f) => [f, { arity: 1, args: ['expr'] } as ParamFn])),
  ...Object.fromEntries(MOD_TAPS.map((f) => [f, { arity: 1, args: ['expr'] } as ParamFn])),
};

export const MOD_TAP_FNS = new Set([...MOD_TAPS, 'MT']);

interface RawTable {
  keycodes: Record<string, Keycode>;
}

/** Two passes so an alias can never shadow another entry's canonical name. */
export function buildIndex(table: RawTable = raw as RawTable): KeycodeIndex {
  const entries = Object.values(table.keycodes);
  const byName = new Map<string, Keycode>();

  for (const kc of entries) byName.set(kc.key, kc);
  for (const kc of entries) {
    for (const alias of kc.aliases ?? []) {
      if (SENTINELS.has(alias)) continue;
      if (!byName.has(alias)) byName.set(alias, kc);
    }
  }
  for (const [alias, canonical] of Object.entries(EXTRA_ALIASES)) {
    const kc = byName.get(canonical);
    if (kc && !byName.has(alias)) byName.set(alias, kc);
  }

  const buckets = new Map<string, Keycode[]>();
  for (const kc of entries) {
    const group = kc.group ?? 'other';
    const bucket = buckets.get(group);
    if (bucket) bucket.push(kc);
    else buckets.set(group, [kc]);
  }
  const rank = (g: string) => {
    const i = (GROUP_ORDER as readonly string[]).indexOf(g);
    return i === -1 ? GROUP_ORDER.length : i;
  };
  const groups = [...buckets.entries()]
    .map(([group, keycodes]) => ({ group, keycodes }))
    .sort((a, b) => rank(a.group) - rank(b.group));

  return { byName, groups };
}
