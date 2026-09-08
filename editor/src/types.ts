// Data model for the editor. Interfaces only — no logic lives here.

/**
 * Mirrors keymap.json exactly. The stored model is the verbatim keycode strings:
 * an Expr is derived on demand and never persisted, so a hand-written expression
 * the parser does not understand round-trips byte-for-byte.
 */
export interface KeymapJson {
  keyboard: string;
  keymap: string;
  layout: string;
  version: number;
  layers: string[][];
  encoders?: EncoderPair[][];
  config?: KeymapConfig;
}

export interface EncoderPair {
  ccw: string;
  cw: string;
}

export interface KeymapConfig {
  features?: Record<string, boolean>;
  build?: { lto?: boolean };
}

export interface LayoutEntry {
  matrix: number[];
  x: number;
  y: number;
  w?: number;
  h?: number;
  label?: string;
  encoder?: number;
}

export interface KeyboardJson {
  keyboard_name?: string;
  manufacturer?: string;
  features?: Record<string, boolean>;
  encoder?: { rotary: { pin_a: string; pin_b: string }[] };
  layouts: Record<string, { layout: LayoutEntry[] }>;
}

/** One enumerable entry of the vendored QMK constants table. */
export interface Keycode {
  key: string;
  group?: string;
  label?: string;
  aliases?: string[];
}

export interface KeycodeIndex {
  /** Canonical names and aliases -> entry. Canonical names always win. */
  byName: Map<string, Keycode>;
  /** Entries grouped by constants `group`, in GROUP_ORDER. */
  groups: { group: string; keycodes: Keycode[] }[];
}

/** Derived AST of a keycode expression. Never stored. */
export type Expr =
  | { kind: 'plain'; name: string }
  | { kind: 'wrap'; fn: string; inner: Expr }
  | { kind: 'layer'; fn: string; layer: string; mods?: string[] }
  | { kind: 'layerTap'; fn: string; layer: string; inner: Expr }
  | { kind: 'modTap'; fn: string; mods: string[]; inner: Expr }
  | { kind: 'mods'; fn: string; mods: string[] }
  | { kind: 'unknown'; raw: string };

export type Target =
  | { kind: 'key'; layer: number; index: number }
  | { kind: 'enc'; layer: number; enc: number; dir: 'ccw' | 'cw' };

export interface Issue {
  severity: 'error' | 'warning';
  /** Stable machine-readable identifier — safe to grep in CI. */
  code: string;
  message: string;
  where?: { layer?: number; key?: number; enc?: number; dir?: 'ccw' | 'cw' };
}
