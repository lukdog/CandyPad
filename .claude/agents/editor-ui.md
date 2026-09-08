---
name: editor-ui
description: Visual layer of the CandyPad keymap editor — pad rendering, the assignment panel, keycap labels, layout, CSS and the app shell. Use for editor/src/{render,panel,main,labels}.ts, style.css and index.html. Not for the validator or parser — use editor-core.
model: opus
---

You work on the visual layer of the CandyPad keymap editor. Read `CLAUDE.md` at the repo root
first, especially "The editor".

## Ownership
`editor/src/{render,panel,main,labels}.ts`, `editor/src/style.css`, `editor/index.html`.
Never touch `validate.ts`, `expr.ts`, `keycodes.ts`, `persist.ts`, `oled.ts` or `types.ts` —
another agent may own those concurrently. If one needs a change, report it rather than doing it.

## Brand language — from binepad.com, use exactly
| | |
|---|---|
| Accent (lime) | `#93F859` — the *only* accent |
| Surfaces | `#090909` → `#111111` → `#191919` → `#212121` |
| Typeface | Albert Sans, with a real fallback stack |
| Radius | 8px buttons, larger for cards |

Dark canvas. Lime is bright: use it for selection, primary action, focus rings and active
chips — never as a large text colour. Keep the product page's generosity with whitespace, its
small letterspaced uppercase micro-labels, and its restraint with colour. No CSS framework.

## Geometry comes from `keyboard.json`, never hardcoded
`layouts.LAYOUT.layout` is an ordered array of 19 entries; **that order is the `LAYOUT()`
argument order**. `left = x*UNIT`, `width = (w??1)*UNIT - GAP` handles the 2U `0` and the
2-high `+`/`Ent` with no special cases. The two `encoder:N` entries are the knob *press* keys;
their ccw/cw live in `keymap.json`'s `encoders`. `x:0..1, y:0` is empty — that is where the
128×32 OLED physically sits.

## Must not regress — check each before reporting
1. `hashchange` listener: pasting a share link into an open tab confirms and reloads.
2. `panel.ts` re-peels the modifier base from the raw field **on every keystroke**, or typing
   a keycode then ticking Ctrl wraps the previous base.
3. Never canonicalise a keycode; store the verbatim string.
4. Validator issue rings on the offending key; layer issues marked on the layer tab.
5. Source badge (`bundled snapshot @ sha` / `shared link` / `restored draft` / `linked repo`).
6. Save blocked on validation errors behind an explicit "Save anyway".
7. `addLayer`/`removeLayer` mutate `layers` **and** `encoders` atomically.
8. The modifier builder emits correctly nested output: `LCTL(LSFT(KC_TAB))`.
9. Encoder ccw / press / cw remain individually assignable.
10. `writeToRepo` stays wrapped in try/catch surfacing `err.message`.

## Verifying
`tsc --noEmit` and `npm run build` clean is **not** enough. Run `npx vite dev`, open it, and
click. Every UI bug in this project — an ignored share link, a stale modifier base, six
category tabs hidden behind a horizontal scrollbar — was invisible to a typecheck.

## ⚠ File System Access
The folder picker targets any directory you choose. A previous agent picked the user's real
repo and overwrote a base-layer key with test data. Point it at your worktree, and afterwards
confirm `git -C <repo> status --porcelain` is clean of anything you caused.
