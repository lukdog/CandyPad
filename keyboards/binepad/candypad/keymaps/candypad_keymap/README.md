# candypad_keymap

| File | Purpose |
|------|---------|
| `keymap.json` | **Source of truth.** Layers, encoders and feature flags. Edited by the visual editor. |
| `config.h` | OLED `#define`s only. The marked block is written by the editor. |

`keymap.json` accepts any expression valid inside QMK's `LAYOUT()` macro — QMK does not
validate keycodes, it interpolates the strings verbatim. So `LCTL(KC_LEFT)`,
`LCTL(LSFT(KC_TAB))` and `LT(1, KC_A)` all work.

Two invariants the build enforces via `STATIC_ASSERT`, and the validator checks first:

- every layer has exactly 19 entries (the `LAYOUT` arity from `keyboard.json`)
- `encoders` has exactly one entry per layer, each with one object per encoder
