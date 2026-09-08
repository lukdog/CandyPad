// Recursive-descent parser for QMK keycode expressions. No dependencies, never throws.
import { MOD_TAP_FNS, PARAM_FNS, type ArgKind } from './keycodes';
import type { Expr, KeycodeIndex } from './types';

export interface ParseError {
  code: string;
  message: string;
}

export interface ParseResult {
  expr: Expr;
  errors: ParseError[];
}

type TokKind = 'ident' | '(' | ')' | ',' | '|';
interface Tok {
  kind: TokKind;
  value: string;
}

const IDENT = /[A-Za-z0-9_]/;

function tokenize(src: string, errors: ParseError[]): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i++;
    } else if (IDENT.test(ch)) {
      let j = i;
      while (j < src.length && IDENT.test(src[j]!)) j++;
      toks.push({ kind: 'ident', value: src.slice(i, j) });
      i = j;
    } else if (ch === '(' || ch === ')' || ch === ',' || ch === '|') {
      toks.push({ kind: ch, value: ch });
      i++;
    } else {
      errors.push({ code: 'E_PARSE_UNEXPECTED', message: `unexpected character ${JSON.stringify(ch)}` });
      i++;
    }
  }
  return toks;
}

type Arg = { kind: 'expr'; expr: Expr } | { kind: 'modmask'; mods: string[] };

/** Parses a keycode string. Always returns an Expr; unrecognised input becomes `unknown`. */
export function parse(src: string): ParseResult {
  const errors: ParseError[] = [];
  const toks = tokenize(src, errors);
  let p = 0;
  const peek = () => toks[p];

  function parseExpr(): Expr {
    const head = peek();
    if (head?.kind !== 'ident') {
      errors.push({
        code: 'E_PARSE_UNEXPECTED',
        message: head ? `expected a keycode name, found ${JSON.stringify(head.value)}` : 'expected a keycode name',
      });
      return { kind: 'unknown', raw: src };
    }
    p++;
    if (peek()?.kind !== '(') return { kind: 'plain', name: head.value };

    p++; // '('
    const args: Arg[] = [];
    if (peek()?.kind !== ')') {
      for (;;) {
        args.push(parseArg());
        if (peek()?.kind === ',') {
          p++;
          continue;
        }
        break;
      }
    }
    if (peek()?.kind !== ')') {
      errors.push({ code: 'E_PARSE_UNBALANCED', message: `unbalanced parentheses in ${JSON.stringify(src)}` });
    } else {
      p++;
    }
    return build(head.value, args);
  }

  function parseArg(): Arg {
    const expr = parseExpr();
    if (peek()?.kind !== '|') return { kind: 'expr', expr };
    const mods: string[] = expr.kind === 'plain' ? [expr.name] : [];
    if (expr.kind !== 'plain') {
      errors.push({ code: 'E_PARSE_UNEXPECTED', message: 'only plain modifier names may be OR-ed with |' });
    }
    while (peek()?.kind === '|') {
      p++;
      const next = peek();
      if (next?.kind !== 'ident') {
        errors.push({ code: 'E_PARSE_UNEXPECTED', message: 'expected a modifier name after |' });
        break;
      }
      p++;
      mods.push(next.value);
    }
    return { kind: 'modmask', mods };
  }

  function build(fn: string, args: Arg[]): Expr {
    // An unknown node keeps only its own sub-text, so serialize() round-trips a nested one.
    const rawCall = (): Expr => ({
      kind: 'unknown',
      raw: `${fn}(${args.map((a) => (a.kind === 'expr' ? serialize(a.expr) : a.mods.join('|'))).join(',')})`,
    });

    const sig = PARAM_FNS[fn];
    if (!sig) {
      // A warning, not an error: TD(), community-module and custom functions are legitimate
      // and we cannot enumerate them, exactly as for unknown bare keycodes.
      errors.push({
        code: 'W_UNKNOWN_FN',
        message: `unknown keycode function ${fn}(); it will fail at the C compiler unless defined in the keymap sources`,
      });
      return rawCall();
    }
    if (args.length !== sig.arity) {
      errors.push({
        code: 'E_ARITY',
        message: `${fn}() takes ${sig.arity} argument${sig.arity === 1 ? '' : 's'}, got ${args.length}`,
      });
      return rawCall();
    }

    const asExpr = (a: Arg | undefined): Expr =>
      a === undefined ? { kind: 'unknown', raw: src } : a.kind === 'expr' ? a.expr : { kind: 'plain', name: a.mods.join('|') };
    const asMods = (a: Arg | undefined): string[] =>
      a === undefined ? [] : a.kind === 'modmask' ? a.mods : a.expr.kind === 'plain' ? [a.expr.name] : [];
    const asToken = (a: Arg | undefined, what: ArgKind): string => {
      const e = asExpr(a);
      if (e.kind === 'plain') return e.name;
      errors.push({ code: 'E_ARITY', message: `${fn}() expects a ${what} as argument, got an expression` });
      return '';
    };

    if (fn === 'ANY') return asExpr(args[0]);
    if (fn === 'LT') return { kind: 'layerTap', fn, layer: asToken(args[0], 'layer'), inner: asExpr(args[1]) };
    if (fn === 'LM') return { kind: 'layer', fn, layer: asToken(args[0], 'layer'), mods: asMods(args[1]) };
    if (fn === 'MT') return { kind: 'modTap', fn, mods: asMods(args[0]), inner: asExpr(args[1]) };
    if (fn === 'OSM') return { kind: 'mods', fn, mods: asMods(args[0]) };
    if (sig.args[0] === 'layer') return { kind: 'layer', fn, layer: asToken(args[0], 'layer') };
    if (MOD_TAP_FNS.has(fn)) return { kind: 'modTap', fn, mods: [], inner: asExpr(args[0]) };
    return { kind: 'wrap', fn, inner: asExpr(args[0]) };
  }

  if (toks.length === 0) {
    errors.push({ code: 'E_PARSE_EMPTY', message: 'empty keycode' });
    return { expr: { kind: 'unknown', raw: src }, errors };
  }

  const expr = parseExpr();
  if (p < toks.length) {
    const kind = peek()?.kind;
    errors.push(
      kind === ')'
        ? { code: 'E_PARSE_UNBALANCED', message: `unbalanced parentheses in ${JSON.stringify(src)}` }
        : { code: 'E_PARSE_UNEXPECTED', message: `trailing input in ${JSON.stringify(src)}` },
    );
  }
  return { expr, errors };
}

/** Only for builders that construct an Expr; never applied to a string loaded from disk. */
export function serialize(e: Expr): string {
  switch (e.kind) {
    case 'plain':
      return e.name;
    case 'wrap':
      return `${e.fn}(${serialize(e.inner)})`;
    case 'layer':
      return e.mods?.length ? `${e.fn}(${e.layer},${e.mods.join('|')})` : `${e.fn}(${e.layer})`;
    case 'layerTap':
      return `${e.fn}(${e.layer},${serialize(e.inner)})`;
    case 'modTap':
      return e.mods.length ? `${e.fn}(${e.mods.join('|')},${serialize(e.inner)})` : `${e.fn}(${serialize(e.inner)})`;
    case 'mods':
      return `${e.fn}(${e.mods.join('|')})`;
    case 'unknown':
      return e.raw;
  }
}

const TRANS_GLYPH = '▽';

const MOD_SYMBOL: Record<string, string> = {
  LCTL: '^', RCTL: '^', C: '^', CTL: '^',
  LSFT: '+', RSFT: '+', S: '+', SFT: '+',
  LALT: '⌥', RALT: '⌥', A: '⌥', ALT: '⌥', ALGR: '⌥',
  LGUI: '⌘', RGUI: '⌘', G: '⌘', GUI: '⌘', CMD: '⌘', WIN: '⌘',
  SGUI: '+⌘', SCMD: '+⌘', SWIN: '+⌘',
  HYPR: '*', ALL: '*', MEH: '#', LCAG: '¤', RCAG: '¤',
  LCA: '^⌥', LSA: '+⌥', LSG: '+⌘', LAG: '⌥⌘',
  RCS: '^+', RSA: '+⌥', RAG: '⌥⌘',
};

const SHORT: Record<string, string> = {
  KC_NO: '',
  KC_TRANSPARENT: TRANS_GLYPH,
  KC_TRNS: TRANS_GLYPH,
};

function shortPlain(name: string, index: KeycodeIndex): string {
  const kc = index.byName.get(name);
  const canonical = kc?.key ?? name;
  return SHORT[canonical] ?? SHORT[name] ?? kc?.label ?? name.replace(/^(KC_|QK_)/, '');
}

/** Compact key-cap label: LCTL(LSFT(KC_TAB)) -> "^+Tab", LT(2,KC_A) -> "LT2/A". */
export function formatShort(src: string, index: KeycodeIndex): string {
  const { expr } = parse(src);
  const fmt = (e: Expr): string => {
    switch (e.kind) {
      case 'plain':
        return shortPlain(e.name, index);
      case 'wrap':
        return (MOD_SYMBOL[e.fn] ?? `${e.fn}/`) + fmt(e.inner);
      case 'layer':
        if (e.fn === 'LM') return `LM${e.layer}/${(e.mods ?? []).map(shortMod).join('')}`;
        return `${e.fn}${e.layer}`;
      case 'layerTap':
        return `LT${e.layer}/${fmt(e.inner)}`;
      case 'modTap': {
        const mods = e.mods.length ? e.mods.map(shortMod).join('') : (MOD_SYMBOL[e.fn.replace(/_T$/, '')] ?? e.fn);
        return `${mods}/${fmt(e.inner)}`;
      }
      case 'mods':
        return `OS${e.mods.map(shortMod).join('')}`;
      case 'unknown':
        return e.raw;
    }
  };
  return fmt(expr);
}

function shortMod(mod: string): string {
  return MOD_SYMBOL[mod.replace(/^MOD_/, '')] ?? mod.replace(/^MOD_/, '');
}
