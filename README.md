# CandyPad — QMK userspace

Firmware for the [CandyPad](https://candykeys.com/product/candypad-keyboard) macropad
(19 keys, 2 rotary encoders, 128x32 OLED), built as a **QMK userspace** against the
binepad QMK fork.

The layout lives in a single JSON file:

```
keyboards/binepad/candypad/keymaps/candypad_keymap/keymap.json
```

Edit it, commit it on any branch, push. GitHub Actions compiles the `.bin` and
attaches it to the run.

## Hardware

| | |
|---|---|
| MCU | STM32F103 (`development_board: bluepill`) |
| Board | `STM32_F103_STM32DUINO` |
| Bootloader | `stm32duino` |
| Flash | 64 KB total, app region starts at `0x08002000` |
| Usable flash | **~54 KB** (55296 bytes) — see below |
| USB VID:PID | `0x4249:0x4350` |

### The flash budget

64 KB of flash, minus the 8 KB stm32duino bootloader at the bottom, minus a 2 KB
wear-levelling EEPROM region at the top, leaves **55296 bytes** for the firmware.
CI enforces this: the build fails over budget and warns at 90%.

The current firmware is about 28.6 KB, roughly 52% of the budget.

## Building

There is no local toolchain in this repo's workflow — **CI is the build**.

1. Push a branch (any branch; the workflow has no branch filter).
2. Open the run under **Actions → Build QMK firmware**.
3. Download the `candypad-firmware` artifact. It contains the `.bin`, the `.elf`,
   and `generated_keymap.c` (the C that QMK generated from your JSON, useful when
   a keycode does not behave as you expected).

The workflow pins the QMK fork by commit SHA, not by branch, so a force-push
upstream cannot silently change your firmware.

If you do want to build locally, you need `qmk`, `arm-none-eabi-gcc` and the
ChibiOS submodules; read `.github/workflows/build.yml`, which is the authoritative
recipe.

## Flashing

Enter the bootloader with **FN + Enter** (`QK_BOOT` on layer 1), or by holding the
boot button while plugging in USB.

```bash
dfu-util -d 1EAF:0003 -a 2 -R -D binepad_candypad_candypad_keymap.bin
```

This is a **stm32duino** DFU device, not the STM32 ROM DFU. Anything telling you to
use `-d 0483:DF11 -s 0x08000000` is wrong for this board: that is the built-in ROM
bootloader, it would overwrite the stm32duino bootloader at `0x08000000`, and the
app region here starts at `0x08002000`.

[QMK Toolbox](https://github.com/qmk/qmk_toolbox/releases) also works — pick the
`.bin` and flash while the board is in DFU mode.

## Editing the keymap

`keymap.json` is the single source of truth for the layout. It holds:

- `layers` — one array per layer, 19 entries each, in `LAYOUT()` order.
- `encoders` — **exactly one entry per layer**, each with `ccw` and `cw` for both
  encoders. A count mismatch is not caught by the JSON schema; it fails at compile
  time on `STATIC_ASSERT(NUM_KEYMAP_LAYERS_RAW == NUM_ENCODERMAP_LAYERS_RAW)`.
- `config` — build settings, see below.

### Any `LAYOUT()`-valid expression works

The layer strings are interpolated **verbatim** into the generated
`LAYOUT(...)` call. QMK does not validate keycodes during `qmk compile` or
`qmk json2c`, so anything the C preprocessor accepts is fair game:

```json
"LCTL(KC_LEFT)", "LCTL(LSFT(KC_TAB))", "MO(1)", "QK_BOOT", "LT(1, KC_SPC)"
```

The flip side: a typo is not a validation error, it is a compile error (or worse,
a silently wrong keycode). Check `generated_keymap.c` in the build artifact when
in doubt.

### Build settings in `keymap.json`

`config` accepts the whole keyboard JSON schema. Two things worth knowing:

- `config.features.<name>: true` generates `<NAME>_ENABLE = yes` **after** the
  keymap's own `rules.mk`, so JSON wins over `rules.mk`.
- `lto` is **rejected** inside `features`. It belongs in `config.build.lto`.
  This matters: if LTO silently fails to apply, the firmware grows 6-10 KB and
  may still fit, so nothing visibly breaks. CI checks for `.gnu.lto_*` sections
  in the object files to prove `-flto` really applied.

## Why not VIA?

VIA would let the layout be changed without recompiling, which is genuinely nicer.
It is not used here on purpose:

- VIA needs `RAW_ENABLE`, plus the dynamic-keymap machinery, plus the EEPROM layout
  to hold the keymap: **5-8 KB of flash**.
- The ceiling is ~54 KB, shared with the OLED driver, mousekey, NKRO and extrakey.
  Spending 10-15% of the total budget on a configuration transport is a poor trade
  on this MCU.
- A static editor that emits `keymap.json` costs **zero bytes of flash** and keeps
  the layout in version control, where it can be reviewed and reverted.

So: recompiling is the cost, and CI makes it a 90-second cost. Please do not
re-suggest VIA without a flash-budget argument.

## Layout

Layer 0 is a numpad. Encoder 1 is volume, encoder 2 is the mouse wheel.

Hold **FN** (the key next to the mute encoder) for layer 1, which currently has
`Ctrl+Left` / `Ctrl+Right` / `Ctrl+Shift+Tab` on the top row and `QK_BOOT` on
Enter.

## Repository layout

```
keyboards/binepad/candypad/keymaps/candypad_keymap/
├── keymap.json   # layout + build config: the source of truth
├── config.h      # a couple of #defines the JSON cannot express
└── README.md
qmk.json          # userspace build targets
.github/workflows/build.yml
```

Only the keymap is kept here. Every board file (`keyboard.json`, `config.h`,
`halconf.h`, `mcuconf.h`, `rules.mk`, `candypad_oled.c`) comes from the pinned
upstream fork — they were byte-identical copies, so vendoring them only risked
silent drift.

## Licence

GPL-2.0-or-later, see [LICENSE](LICENSE).
