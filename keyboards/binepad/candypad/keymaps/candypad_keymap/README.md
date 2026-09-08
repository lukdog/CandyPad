# candypad_keymap

| File | Purpose |
|------|---------|
| `keymap.json` | **Source of truth.** Layers, encoders and feature flags. Edited by the visual editor. |
| `config.h` | OLED `#define`s only. The marked block is written by the editor. |
| `oled.c` | Optional. The body of `candypad_render_default_user()`, written by the editor. Absent when the editor's OLED code box is empty. |
| `rules.mk` | Optional. Exists only to carry `SRC += oled.c`, and is deleted with it. |

Feature flags never belong in `rules.mk`: QMK applies the rules generated from
`keymap.json` *after* it, so a `*_ENABLE` line there is silently overridden. The
validator rejects one with `E_RULES_MK_FEATURE_FLAG`.

`candypad_render_default_user()` is a weak hook the board's `candypad_oled.c` declares.
Return `true` when the body drew the whole panel, `false` to let the board paint its
layer/encoder/NUM dashboard on top — it uses rows 1 and 3 of the 21x4 grid, leaving 0 and 2.

`keymap.json` accepts any expression valid inside QMK's `LAYOUT()` macro — QMK does not
validate keycodes, it interpolates the strings verbatim. So `LCTL(KC_LEFT)`,
`LCTL(LSFT(KC_TAB))` and `LT(1, KC_A)` all work.

Two invariants the build enforces, and the validator checks first:

- every layer has exactly 19 entries — the arity of `LAYOUT()`, which comes from
  upstream's `keyboard.json`. A wrong count is a compile error on the macro call.
- `encoders` has exactly one entry per layer, each with one object per encoder.
  This one is a `STATIC_ASSERT` in `quantum/keymap_introspection.c`; the JSON
  schema does not catch a mismatch, so it fails at compile time instead.
