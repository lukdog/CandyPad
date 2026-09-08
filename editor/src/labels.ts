// Key-cap labels. The constants table's `label` is a *display* name ("Keypad Plus",
// "Spacebar") which does not fit a 52px cap, so caps get their own override map.
import { formatShort, parse } from './expr';
import type { Expr, KeycodeIndex } from './types';

/** Cap text for keycodes whose constants-file label is too long or too vague. */
export const SHORT_LABELS: Record<string, string> = {
  // internal
  KC_NO: '',
  KC_TRANSPARENT: '▽',
  // numpad — the set this board is built around
  KC_KP_0: '0', KC_KP_1: '1', KC_KP_2: '2', KC_KP_3: '3', KC_KP_4: '4',
  KC_KP_5: '5', KC_KP_6: '6', KC_KP_7: '7', KC_KP_8: '8', KC_KP_9: '9',
  KC_KP_SLASH: '/', KC_KP_ASTERISK: '*', KC_KP_MINUS: '-', KC_KP_PLUS: '+',
  KC_KP_ENTER: 'Ent', KC_KP_DOT: '.', KC_KP_COMMA: ',', KC_KP_EQUAL: '=',
  KC_NUM_LOCK: 'NumL',
  // basic
  KC_SPACE: 'Spc', KC_ENTER: 'Ent', KC_ESCAPE: 'Esc', KC_BACKSPACE: 'Bksp',
  KC_TAB: 'Tab', KC_DELETE: 'Del', KC_INSERT: 'Ins', KC_CAPS_LOCK: 'Caps',
  KC_SCROLL_LOCK: 'ScrL', KC_PRINT_SCREEN: 'PrtSc', KC_PAUSE: 'Pause',
  KC_PAGE_UP: 'PgUp', KC_PAGE_DOWN: 'PgDn', KC_HOME: 'Home', KC_END: 'End',
  KC_GRAVE: '`', KC_MINUS: '-', KC_EQUAL: '=', KC_BACKSLASH: '\\',
  KC_LEFT_BRACKET: '[', KC_RIGHT_BRACKET: ']', KC_SEMICOLON: ';',
  KC_QUOTE: "'", KC_COMMA: ',', KC_DOT: '.', KC_SLASH: '/',
  KC_APPLICATION: 'Menu',
  // arrows
  KC_UP: '↑', KC_DOWN: '↓', KC_LEFT: '←', KC_RIGHT: '→',
  // modifiers
  KC_LEFT_CTRL: 'Ctrl', KC_RIGHT_CTRL: 'RCtrl',
  KC_LEFT_SHIFT: 'Shift', KC_RIGHT_SHIFT: 'RShft',
  KC_LEFT_ALT: 'Alt', KC_RIGHT_ALT: 'AltGr',
  KC_LEFT_GUI: 'Gui', KC_RIGHT_GUI: 'RGui',
  // media / system (extrakey)
  KC_AUDIO_MUTE: 'Mute', KC_AUDIO_VOL_UP: 'Vol+', KC_AUDIO_VOL_DOWN: 'Vol-',
  KC_MEDIA_NEXT_TRACK: '⏭', KC_MEDIA_PREV_TRACK: '⏮',
  KC_MEDIA_PLAY_PAUSE: '⏯', KC_MEDIA_STOP: '⏹',
  KC_BRIGHTNESS_UP: '☀+', KC_BRIGHTNESS_DOWN: '☀-',
  KC_SYSTEM_SLEEP: 'Sleep', KC_SYSTEM_WAKE: 'Wake', KC_SYSTEM_POWER: 'Pwr',
  // mouse (mousekey) — canonical QK_MOUSE_* names; KC_BTN3/MS_BTN3 alias onto these
  QK_MOUSE_BUTTON_1: 'M1', QK_MOUSE_BUTTON_2: 'M2', QK_MOUSE_BUTTON_3: 'M3',
  QK_MOUSE_BUTTON_4: 'M4', QK_MOUSE_BUTTON_5: 'M5',
  QK_MOUSE_CURSOR_UP: 'M↑', QK_MOUSE_CURSOR_DOWN: 'M↓',
  QK_MOUSE_CURSOR_LEFT: 'M←', QK_MOUSE_CURSOR_RIGHT: 'M→',
  QK_MOUSE_WHEEL_UP: 'Wh↑', QK_MOUSE_WHEEL_DOWN: 'Wh↓',
  QK_MOUSE_WHEEL_LEFT: 'Wh←', QK_MOUSE_WHEEL_RIGHT: 'Wh→',
  // quantum
  QK_BOOTLOADER: 'BOOT', QK_REBOOT: 'RESET', QK_CLEAR_EEPROM: 'EEclr',
  QK_DEBUG_TOGGLE: 'Debug',
};

/** Cap glyphs for modifier wrappers; deliberately separate from expr.ts's display set. */
const MOD_GLYPH: Record<string, string> = {
  LCTL: '^', RCTL: '^', C: '^', CTL: '^',
  LSFT: '⇧', RSFT: '⇧', S: '⇧', SFT: '⇧',
  LALT: '⌥', RALT: '⌥', A: '⌥', ALT: '⌥', ALGR: '⌥',
  LGUI: '⌘', RGUI: '⌘', G: '⌘', GUI: '⌘', CMD: '⌘', WIN: '⌘',
  HYPR: '✦', ALL: '✦', MEH: '◆',
};

const MAX_CAP = 7;

function plainLabel(name: string, index: KeycodeIndex): string {
  const kc = index.byName.get(name);
  const canonical = kc?.key ?? name;
  return (
    SHORT_LABELS[canonical] ??
    SHORT_LABELS[name] ??
    (kc?.label && kc.label.length <= MAX_CAP ? kc.label : undefined) ??
    name.replace(/^(KC_|QK_|MS_)/, '')
  );
}

function mod(m: string): string {
  const bare = m.replace(/^MOD_/, '');
  return MOD_GLYPH[bare] ?? bare;
}

/** Cap text for a verbatim keymap string: LCTL(LSFT(KC_TAB)) -> "^⇧Tab". */
export function capLabel(raw: string, index: KeycodeIndex): string {
  const fmt = (e: Expr): string => {
    switch (e.kind) {
      case 'plain':
        return plainLabel(e.name, index);
      case 'wrap':
        return (MOD_GLYPH[e.fn] ?? `${e.fn}/`) + fmt(e.inner);
      case 'layer':
        return e.mods?.length ? `${e.fn}${e.layer}/${e.mods.map(mod).join('')}` : `${e.fn}${e.layer}`;
      case 'layerTap':
        return `LT${e.layer}/${fmt(e.inner)}`;
      case 'modTap':
        return `${(e.mods.length ? e.mods.map(mod) : [mod(e.fn.replace(/_T$/, ''))]).join('')}/${fmt(e.inner)}`;
      case 'mods':
        return `OS${e.mods.map(mod).join('')}`;
      case 'unknown':
        // Anything the parser could not model: fall back to the shared display formatter.
        return formatShort(e.raw, index);
    }
  };
  const text = fmt(parse(raw).expr);
  return text.length > 10 ? `${text.slice(0, 9)}…` : text;
}

/** True when the cell is a pass-through, so the pad can grey it out. */
export function isTrans(raw: string, index: KeycodeIndex): boolean {
  return index.byName.get(raw.trim())?.key === 'KC_TRANSPARENT';
}

/** True when the cell is explicitly dead. */
export function isNo(raw: string, index: KeycodeIndex): boolean {
  return index.byName.get(raw.trim())?.key === 'KC_NO';
}
