# CandyPad — working notes

QMK userspace for a **binepad CandyPad** macropad, plus a static visual keymap editor
deployed to GitHub Pages.

The point of the project: the vendor's web configurator (`candypad.app`) cannot express
modified keycodes like `LCTL(KC_LEFT)`, and it shipped firmware with real bugs. This repo
replaces it with a `keymap.json` source of truth, a validator that catches the bugs the
vendor tool did not, and an editor at **https://lukdog.com/CandyPad/**.

---

## Hardware — verified on the physical unit

| | |
|---|---|
| MCU | STM32F103 (bluepill), **not** RP2040 |
| Bootloader | **stm32duino**, `1EAF:0003` (reported as `LeafLabs Maple 003`) |
| Flash | 64 KB total, app region starts `0x08002000` |
| Usable | **55296 bytes** (64K − 8K bootloader − 2K wear-levelling EEPROM) |
| Matrix | 5 rows × 4 cols, 19 keys, 2 rotary encoders, 128×32 OLED, **no LEDs** |
| USB | `0x4249:0x4350` |

**There are two CandyPad revisions.** `sr-candykeys-candypad` in the binepad fork is the
**RP2040** one (6-row matrix, `.uf2`). Ours is `sr-candykeys-candypad-rev-b` — STM32,
5-row, `.bin` over DFU. Getting this wrong silently produces a firmware for the wrong board.

Flash with:
```bash
dfu-util -d 1EAF:0003 -a 2 -R -D binepad_candypad_candypad_keymap.bin
```
**Never** use `-d 0483:DF11 -s 0x08000000`. That is the chip's ROM DFU and would overwrite
the stm32duino bootloader. The vendor's generated README had this wrong.

QMK Toolbox also works and is safer — it detects `1EAF:0003` and passes the right arguments
itself. Enter the bootloader with **FN + Enter** (`QK_BOOT`), the PCB reset button, or
bootmagic (hold the top-left key while plugging in).

---

## Architecture

**`keymaps/candypad_keymap/keymap.json` is the single source of truth.** There is no code
generator: QMK interpolates layer strings *verbatim* into `LAYOUT()`, so the editor writes
the exact file QMK compiles.

The keymap directory holds only what we own:
```
keyboards/binepad/candypad/keymaps/candypad_keymap/
├── keymap.json    layers, encoders, feature flags
├── config.h       OLED #defines, inside editor-generated markers
├── oled.c         optional custom OLED rendering (only when non-empty)
└── rules.mk       only ever `SRC += oled.c`, only when oled.c exists
```

**Board files are deliberately NOT vendored.** They were byte-identical to upstream, so they
were deleted; QMK takes them from the pinned fork via `overlay_dir`. Re-adding one would
recreate a silent fork. The geometry the editor needs lives at
`editor/src/data/keyboard.json` instead — under `editor/` specifically so QMK's `overlay_dir`
cannot consume it and shadow the fork's copy. CI diffs it against the pinned SHA.

---

## Hard-won QMK facts

These each cost real time. Do not re-derive them.

1. **`keymap.json` performs zero keycode validation.** `lib/python/qmk/keymap.py` string-
   interpolates layer entries into `LAYOUT()`. `LCTL(LSFT(KC_TAB))` works; so does a typo,
   which fails only at the C compiler. Our validator is the only check that exists.
2. **`config.features` beats the keymap's `rules.mk`.** Generated rules are included *after*
   it, so a flag in both places is silently won by the JSON. Keep feature flags in exactly
   one place: `keymap.json`.
3. **`lto` is rejected inside `features`** — it must be `config.build.lto`.
4. **`encoders` must have exactly one entry per layer.** `STATIC_ASSERT` at
   `quantum/keymap_introspection.c:65`. The JSON schema does *not* catch a mismatch.
5. **`lib/lufa` IS required for a ChibiOS/STM32 build.** LUFA is the AVR stack, but
   `tmk_core/protocol/chibios/lufa_utils` reuses its USB class headers. Pruning it as
   "AVR-only" cost five red CI runs. Needed submodules: `chibios`, `chibios-contrib`,
   `printf`, `lufa`.
6. **`qmk userspace-compile` exits non-zero after printing `[OK]`.** The workflow re-runs a
   single-target `qmk compile` whose exit code is authoritative.
7. **Legacy keycode names are not in the constants JSON.** `keycodes_0.0.7.json` lists only
   modern names (`MS_BTN3`, `UG_TOGG`), but `quantum/quantum_keycodes_legacy.h` still
   `#define`s `KC_BTN3`, `RGB_TOG` etc., so they compile fine. The 52 aliases are vendored at
   `editor/src/data/legacy-aliases.ts` so the validator resolves them.
8. **The board's own `config.h` defines `OLED_TIMEOUT`.** Redefining it without `#undef`
   first warns on every build.
9. **`keymap.json` and `keymap.c` cannot coexist.** QMK's `OTHER_KEYMAP_C` path `#include`s
   the `.c` into the generated keymap and double-defines `keymaps[]`.
10. **QMK's `group` field is useless as a picker taxonomy.** `basic:161` lumps letters,
    digits, navigation, F-keys and numpad together; `midi:144` and `joystick:32` are
    irrelevant here. There is no `keypad` and no `layer` group. Hence the hand-curated
    categories in `editor/src/categories.ts`.
11. **CandyPad is not in upstream QMK.** PR qmk/qmk_firmware#25223 was closed, not merged,
    despite the vendor changelog claiming otherwise.

---

## Build and CI

**There is no local toolchain** — no `qmk`, no `arm-none-eabi-gcc`. **CI is the build.**

`.github/workflows/build.yml` — pinned to a QMK fork **SHA**, not a branch (a fork branch can
be force-pushed under you). Two jobs:

- **validate** (~25s) — `tsc --noEmit`, asserts `editor/src/data/keyboard.json` still matches
  the pinned upstream, validates every `keymap.json`, and asserts the validator still
  *rejects* `editor/fixtures/broken.keymap.json`. A validator never observed failing is a
  validator that does not work.
- **build** (~65s) — `needs: validate`. Shallow clone, `qmk userspace-compile`, size report
  against `FLASH_BUDGET=55296`, artifact with `.bin` + `.elf`.

`push` has **no branch filter** on purpose: the workflow is "commit an edited keymap on a
branch, grab the `.bin` from that branch's run".

Do **not** add `actions/cache` for the QMK tree — tarring ~1 GB costs more than the shallow
fetch and the cache is branch-scoped.

`.github/workflows/pages.yml` deploys `editor/` to Pages. `concurrency.cancel-in-progress` is
`false` there: cancelling a half-applied Pages deploy is worse than a slow one.

---

## The editor

Vite + TypeScript, **zero runtime dependencies**, no framework, no state library.

```
editor/src/
├── types.ts       interfaces only; the model IS the verbatim keymap.json
├── keycodes.ts    index over the vendored 0.0.7 table + legacy aliases
├── categories.ts  hand-curated task categories for the picker
├── expr.ts        recursive-descent keycode parser; never throws
├── validate.ts    PURE — no DOM, no fetch. Shared with the CI CLI
├── labels.ts      short keycap labels (the table's `label` is a display label)
├── render.ts      keyboard.json geometry → DOM
├── panel.ts       assignment panel
├── persist.ts     share links, downloads, drafts, File System Access
├── oled.ts        marker-delimited config.h / oled.c writers
└── main.ts        state, undo, wiring
```

**Design rules that must not be broken:**

- **Store the user's verbatim string.** Never canonicalise `KC_BTN3` → `MS_BTN3`. Both
  compile; rewriting destroys the round-trip guarantee and produces diffs nobody asked for.
- **The `Expr` AST is derived, never stored.** That is what lets an expression the parser does
  not understand round-trip byte-for-byte.
- **`validate.ts` stays pure.** Every input is an argument. That is the only reason the
  browser and CI can share one implementation.
- **Unknown bare keycodes and unknown functions are warnings, not errors.** `QK_*` names,
  community modules, `TD()` and custom keycodes are all legitimate and unenumerable.
- **Unreachable layers are an error.** A warning would not have stopped the firmware the
  vendor tool shipped.
- `layers` and `encoders` must be mutated atomically — see fact 4.

Cold-start source order: shared link → newer local draft → linked repo → bundled snapshot.
The source badge is a safety feature; it is what stops a stale page overwriting newer edits.

### Sharing with someone else
No accounts, no tokens. Share button encodes the keymap into the URL fragment (~960 chars).
They edit, send it back, you download the JSON, commit it on a branch and build from there.
`shareLink()` is synchronous, so it cannot use `CompressionStream`; the payload is tagged
(`#km=u…`) so a compressed `d` encoding can be added later without invalidating sent links.

### ⚠ File System Access hazard
The folder picker has no notion of "the right repo" and will target whatever you choose. An
agent testing in a browser once picked the real repo and overwrote a base-layer key with test
data. **Always check what you are pointing at**, and after any agent session that ran the
editor, check `git status`.

---

## Conventions

- **Tests:** the repo has no test suite; do not introduce one. Cover security-critical or
  genuinely tricky logic only. `editor/fixtures/broken.keymap.json` as a must-fail CI fixture
  is worth more here than a test framework.
- **Comments:** sparse. One short header per file, at most one line per function, only for
  the non-obvious *why*.
- **KISS:** simplest thing that works. No abstractions, options or config before they are
  needed.
- **Deps:** do not add or bump without strong reason. The editor has zero runtime deps.
- **Commits:** explain *why*, especially when the change encodes a QMK gotcha.

---

## Commands

```bash
# validate the keymap exactly as CI does
./editor/node_modules/.bin/tsx editor/scripts/validate.ts \
  keyboards/binepad/candypad/keymaps/candypad_keymap/keymap.json \
  --keyboard editor/src/data/keyboard.json

# editor
cd editor && npm ci && npx tsc --noEmit && npm run build
cd editor && npx vite dev

# CI
gh run list --branch main --limit 5
gh run view <id> --log-failed
gh run download <id> -n candypad-firmware
```

---

## How this was built

Waves of parallel agents in **separate git worktrees** with disjoint file ownership, each
given a frozen interface to code against so neither blocks the other (the validator CLI
contract in wave 1; the `persist.ts` signature list in wave 3). Agent definitions live in
`.claude/agents/`.

What actually worked:

- **Freeze the interface first.** Two agents built against a nine-function `persist.ts`
  signature list without ever seeing each other's code, and the merge was conflict-free.
- **Give agents the verified facts** in the prompt. Left to re-derive them, they get them
  wrong — and three "authoritative" facts handed down in wave 1 were themselves wrong
  (see fact 5), so state them as falsifiable and expect pushback.
- **Demand pushback.** The best findings came from agents arguing with the brief:
  the legacy-keycode gap, the `shareLink` sync/async conflict, and the hand-aligned
  `keymap.json` that the editor would have reformatted.
- **Drive the result in a browser.** Every UI bug in this project — the ignored share link,
  the stale modifier base, the hidden category tabs — was invisible to a typecheck.
