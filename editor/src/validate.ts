// The only keycode/consistency check that exists for this keymap: QMK itself
// interpolates keymap.json strings into LAYOUT() verbatim and validates nothing.
// Pure by design — every input is an argument, so browser and CI share it.
import { parse } from './expr';
import { HARDWARE_FEATURES, LAYER_FNS, featureFor } from './keycodes';
import type { Expr, Issue, KeyboardJson, KeycodeIndex, KeymapJson, Target } from './types';

export interface ValidateOptions {
  allowUnreachable?: boolean;
  rulesMk?: string;
}

const IDENTIFIER = /^[A-Z][A-Z0-9_]*$/;
const MAX_LAYERS = 32;

interface Cell {
  target: Target;
  raw: string;
}

export function validate(
  km: KeymapJson,
  kb: KeyboardJson,
  index: KeycodeIndex,
  opts: ValidateOptions = {},
): Issue[] {
  const issues: Issue[] = [];
  const add = (severity: Issue['severity'], code: string, message: string, where?: Issue['where']) =>
    issues.push(where ? { severity, code, message, where } : { severity, code, message });

  const layers = km.layers ?? [];
  const effective = { ...(kb.features ?? {}), ...(km.config?.features ?? {}) };

  // ── Structure ────────────────────────────────────────────
  if (layers.length < 1 || layers.length > MAX_LAYERS) {
    add('error', 'E_LAYER_COUNT', `keymap has ${layers.length} layers; QMK allows 1..${MAX_LAYERS}`);
  }

  const layoutDef = kb.layouts?.[km.layout];
  if (!layoutDef) {
    add(
      'error',
      'E_LAYOUT_MISSING',
      `layout "${km.layout}" is not defined in keyboard.json (has: ${Object.keys(kb.layouts ?? {}).join(', ')})`,
    );
  }
  const keyCount = layoutDef?.layout.length ?? 0;
  if (layoutDef) {
    layers.forEach((layer, l) => {
      if (layer.length !== keyCount) {
        const delta = layer.length - keyCount;
        add(
          'error',
          'E_LAYER_LENGTH',
          `layer ${l} has ${layer.length} keys, ${km.layout} needs ${keyCount} (${delta > 0 ? `${delta} too many` : `${-delta} missing`})`,
          { layer: l },
        );
      }
    });
  }

  // QMK identifies a board by its directory path, so only the last segment is checkable.
  const board = km.keyboard?.split('/').pop()?.toLowerCase();
  if (kb.keyboard_name && board !== kb.keyboard_name.toLowerCase()) {
    add('error', 'E_KEYBOARD_MISMATCH', `keymap targets "${km.keyboard}" but keyboard.json describes "${kb.keyboard_name}"`);
  }

  const encoderCount = kb.encoder?.rotary.length ?? 0;
  if (km.encoders) {
    if (km.encoders.length !== layers.length) {
      add(
        'error',
        'E_ENCODERS_LAYER_COUNT',
        `"encoders" has ${km.encoders.length} rows but there are ${layers.length} layers; ` +
          'QMK asserts NUM_KEYMAP_LAYERS_RAW == NUM_ENCODERMAP_LAYERS_RAW at compile time',
      );
    }
    km.encoders.forEach((row, l) => {
      if (row.length !== encoderCount) {
        add(
          'error',
          'E_ENCODERS_ROW_LENGTH',
          `encoders row ${l} has ${row.length} entries, the board has ${encoderCount} rotary encoder(s)`,
          { layer: l },
        );
      }
    });
    if (!effective['encoder_map']) {
      add(
        'error',
        'E_ENCODERS_WITHOUT_MAP',
        '"encoders" is present but feature encoder_map is not enabled; the #if defined(ENCODER_MAP_ENABLE) guard drops the whole map silently',
      );
    }
  } else if (effective['encoder_map']) {
    add(
      'error',
      'E_ENCODER_MAP_WITHOUT_ENCODERS',
      'feature encoder_map is enabled but the keymap has no "encoders"; the layer-count assertion fails at 0 rows',
    );
  }
  if (effective['encoder_map'] && !effective['encoder']) {
    add('error', 'E_ENCODER_MAP_WITHOUT_ENCODER', 'encoder_map only takes effect when the encoder feature is enabled too');
  }

  // ── Per-cell syntax, layer range, feature coherence ──────
  const cells = collectCells(km);
  const kbFeatures = kb.features ?? {};

  for (const { target, raw } of cells) {
    const where = whereOf(target);
    const at = describe(target);
    const { expr, errors } = parse(raw);

    for (const e of errors) add('error', e.code, `${at}: ${e.message} — "${raw}"`, where);

    for (const layerToken of layerTargets(expr)) {
      if (/^\d+$/.test(layerToken)) {
        const n = Number(layerToken);
        if (n >= layers.length) {
          add('error', 'E_LAYER_OUT_OF_RANGE', `${at}: "${raw}" targets layer ${n}, keymap has ${layers.length} layers`, where);
        }
      } else {
        add(
          'warning',
          'W_UNKNOWN_LAYER_NAME',
          `${at}: "${raw}" uses a non-numeric layer "${layerToken}"; it must be defined in the keymap sources`,
          where,
        );
      }
    }

    for (const name of plainLeaves(expr)) {
      const kc = index.byName.get(name);
      if (!kc) {
        if (IDENTIFIER.test(name)) {
          add(
            'warning',
            'W_UNKNOWN_KEYCODE',
            `${at}: "${name}" is not a known QMK keycode; it will fail at the C compiler unless defined in the keymap sources`,
            where,
          );
        } else {
          add('error', 'E_BAD_KEYCODE', `${at}: "${name}" is not a valid keycode identifier`, where);
        }
      }

      const required = featureFor(name, kc);
      if (!required) continue;
      if (HARDWARE_FEATURES.has(required) && !(required in kbFeatures)) {
        add(
          'error',
          'E_FEATURE_NO_HARDWARE',
          `${at}: "${name}" needs ${required}, which keyboard.json does not declare at all — this hardware cannot do it`,
          where,
        );
      } else if (effective[required] === false) {
        add('error', 'E_FEATURE_DISABLED', `${at}: "${name}" needs feature ${required}, which is set to false — the key compiles but is inert`, where);
      } else if (!(required in effective)) {
        add('warning', 'W_FEATURE_UNDECLARED', `${at}: "${name}" needs feature ${required}, which is not declared in keyboard.json or the keymap`, where);
      }
    }
  }

  // ── Reachability ─────────────────────────────────────────
  const edges: Set<number>[] = layers.map(() => new Set<number>());
  let anySwitch = false;
  for (const { target, raw } of cells) {
    const { expr } = parse(raw);
    for (const token of layerTargets(expr)) {
      anySwitch = true;
      if (!/^\d+$/.test(token)) continue;
      const to = Number(token);
      const from = target.layer;
      if (to < layers.length && from < layers.length) edges[from]!.add(to);
    }
  }
  if (layers.length > 1 && !anySwitch) {
    add('error', 'E_NO_LAYER_SWITCH', `keymap has ${layers.length} layers but no layer-switch keycode anywhere; only layer 0 can ever be active`);
  }

  const reachable = new Set<number>([0]);
  const queue = [0];
  while (queue.length) {
    for (const to of edges[queue.shift()!] ?? []) {
      if (!reachable.has(to)) {
        reachable.add(to);
        queue.push(to);
      }
    }
  }
  for (let l = 0; l < layers.length; l++) {
    if (!reachable.has(l) && !opts.allowUnreachable) {
      add('error', 'E_LAYER_UNREACHABLE', `layer ${l} cannot be reached from layer 0 by any layer-switch key or encoder`, { layer: l });
    }
    if (reachable.has(l) && isAllTransparent(km, l, index)) {
      add('warning', 'W_LAYER_ALL_TRANS', `layer ${l} is entirely KC_TRNS and does nothing`, { layer: l });
    }
  }

  // ── rules.mk cross-check ─────────────────────────────────
  if (opts.rulesMk !== undefined) {
    opts.rulesMk.split('\n').forEach((line, i) => {
      if (/^\s*[A-Z0-9_]+_ENABLE\s*=/.test(line)) {
        add(
          'error',
          'E_RULES_MK_FEATURE_FLAG',
          `rules.mk:${i + 1}: "${line.trim()}" — feature flags belong in keymap.json config.features; ` +
            'the generated rules are included after this file, so this line is silently overridden and merely lies about the build',
        );
      }
    });
  }

  return issues;
}

function collectCells(km: KeymapJson): Cell[] {
  const cells: Cell[] = [];
  (km.layers ?? []).forEach((layer, l) =>
    layer.forEach((raw, index) => cells.push({ target: { kind: 'key', layer: l, index }, raw })),
  );
  (km.encoders ?? []).forEach((row, l) =>
    row.forEach((pair, enc) => {
      cells.push({ target: { kind: 'enc', layer: l, enc, dir: 'ccw' }, raw: pair.ccw });
      cells.push({ target: { kind: 'enc', layer: l, enc, dir: 'cw' }, raw: pair.cw });
    }),
  );
  return cells;
}

function whereOf(t: Target): Issue['where'] {
  return t.kind === 'key' ? { layer: t.layer, key: t.index } : { layer: t.layer, enc: t.enc, dir: t.dir };
}

function describe(t: Target): string {
  return t.kind === 'key' ? `layer ${t.layer} key ${t.index}` : `layer ${t.layer} encoder ${t.enc} ${t.dir}`;
}

/** Layer arguments of every layer-switch keycode in the expression, verbatim. */
function layerTargets(e: Expr): string[] {
  switch (e.kind) {
    case 'layer':
      return LAYER_FNS.includes(e.fn) ? [e.layer] : [];
    case 'layerTap':
      return [e.layer, ...layerTargets(e.inner)];
    case 'wrap':
    case 'modTap':
      return layerTargets(e.inner);
    default:
      return [];
  }
}

/** Every actual keycode name in the expression; modifier masks are not keycodes. */
function plainLeaves(e: Expr): string[] {
  switch (e.kind) {
    case 'plain':
      return [e.name];
    case 'wrap':
    case 'modTap':
    case 'layerTap':
      return plainLeaves(e.inner);
    default:
      return [];
  }
}

function isAllTransparent(km: KeymapJson, l: number, index: KeycodeIndex): boolean {
  const trans = (raw: string) => index.byName.get(raw)?.key === 'KC_TRANSPARENT';
  const keys = km.layers[l] ?? [];
  if (keys.length === 0 || !keys.every(trans)) return false;
  return (km.encoders?.[l] ?? []).every((p) => trans(p.ccw) && trans(p.cw));
}
