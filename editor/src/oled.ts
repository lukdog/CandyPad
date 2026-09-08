// Owns the marker-delimited block of config.h. Everything outside the markers is preserved
// byte-for-byte so hand-added #defines survive an editor write.
import type { OledSettings } from './persist';

const START = '// >>> editor-generated';
const END = '// <<< editor-generated';

/** QMK's own defaults, reported when config.h defines nothing. */
const DEFAULTS: OledSettings = { brightness: 255, timeout: 60000 };

/** Matches a whole marker block, markers included, at line granularity. */
const BLOCK_RE = /^[ \t]*\/\/ >>> editor-generated[\s\S]*?^[ \t]*\/\/ <<< editor-generated[ \t]*$\n?/m;

const HEADER = '// SPDX-License-Identifier: GPL-2.0-or-later\n#pragma once\n';

export function renderOledBlock(oled: OledSettings): string {
  const brightness = clamp(oled.brightness, 0, 255, DEFAULTS.brightness);
  // One hour is far beyond any useful panel timeout and keeps the literal small.
  const timeout = clamp(oled.timeout, 0, 3_600_000, DEFAULTS.timeout);
  return [
    START,
    "// QMK's default is 255; the CandyPad panel is uncomfortably bright at full.",
    `#define OLED_BRIGHTNESS ${brightness}`,
    '// Milliseconds before the panel sleeps; 0 disables the timeout.',
    `#define OLED_TIMEOUT ${timeout}`,
    END,
    '',
  ].join('\n');
}

export function applyOledBlock(existing: string, oled: OledSettings): string {
  const block = renderOledBlock(oled);
  if (BLOCK_RE.test(existing)) return existing.replace(BLOCK_RE, block);
  // No markers: append rather than clobber whatever the file already holds.
  const base = existing.trim() === '' ? HEADER : existing.replace(/\n*$/, '\n');
  return `${base}\n${block}`;
}

export function parseOledBlock(existing: string): OledSettings {
  // Prefer the editor block: a #define outside it is the user's own and may be commented out.
  const scope = existing.match(BLOCK_RE)?.[0] ?? existing;
  return {
    brightness: readDefine(scope, 'OLED_BRIGHTNESS') ?? DEFAULTS.brightness,
    timeout: readDefine(scope, 'OLED_TIMEOUT') ?? DEFAULTS.timeout,
  };
}

function readDefine(text: string, name: string): number | undefined {
  const m = new RegExp(`^[ \\t]*#define[ \\t]+${name}[ \\t]+(\\d+)`, 'm').exec(text);
  return m?.[1] === undefined ? undefined : Number(m[1]);
}

function clamp(v: number, lo: number, hi: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}
