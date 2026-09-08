// CLI wrapper around the shared validator. Contract (frozen, CI depends on it):
//   npx tsx editor/scripts/validate.ts <keymap.json> --keyboard <keyboard.json> [--allow-unreachable] [--rules-mk <file>]
import { readFileSync } from 'node:fs';
import { buildIndex } from '../src/keycodes';
import { validate } from '../src/validate';
import type { Issue, KeyboardJson, KeymapJson } from '../src/types';

const USAGE =
  'usage: tsx editor/scripts/validate.ts <keymap.json> --keyboard <keyboard.json> [--allow-unreachable] [--rules-mk <file>]';

function main(argv: string[]): number {
  let keymapPath: string | undefined;
  let keyboardPath: string | undefined;
  let rulesMkPath: string | undefined;
  let allowUnreachable = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--keyboard') keyboardPath = argv[++i];
    else if (arg === '--rules-mk') rulesMkPath = argv[++i];
    else if (arg === '--allow-unreachable') allowUnreachable = true;
    else if (arg.startsWith('-')) return fail(`unknown option ${arg}`);
    else if (!keymapPath) keymapPath = arg;
    else return fail(`unexpected argument ${arg}`);
  }
  if (!keymapPath || !keyboardPath) return fail('missing <keymap.json> or --keyboard <keyboard.json>');

  const km = readJson<KeymapJson>(keymapPath);
  const kb = readJson<KeyboardJson>(keyboardPath);
  const issues = validate(km, kb, buildIndex(), {
    allowUnreachable,
    ...(rulesMkPath ? { rulesMk: readFileSync(rulesMkPath, 'utf8') } : {}),
  });

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  print('error', errors);
  print('warning', warnings);
  console.log(
    `${keymapPath}: ${errors.length} error(s), ${warnings.length} warning(s)${errors.length ? '' : ' — OK'}`,
  );
  return errors.length ? 1 : 0;
}

function print(severity: Issue['severity'], issues: Issue[]): void {
  if (issues.length === 0) return;
  console.log(`\n${severity === 'error' ? 'ERRORS' : 'WARNINGS'} (${issues.length})`);
  for (const i of issues) console.log(`  ${severity === 'error' ? 'E' : 'W'} ${i.code}${at(i)}: ${i.message}`);
}

function at(i: Issue): string {
  const w = i.where;
  if (!w) return '';
  const parts = [
    w.layer !== undefined ? `L${w.layer}` : undefined,
    w.key !== undefined ? `K${w.key}` : undefined,
    w.enc !== undefined ? `ENC${w.enc}${w.dir ? `.${w.dir}` : ''}` : undefined,
  ].filter(Boolean);
  return parts.length ? ` [${parts.join(' ')}]` : '';
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function fail(message: string): number {
  console.error(`error: ${message}\n${USAGE}`);
  return 2;
}

process.exit(main(process.argv.slice(2)));
