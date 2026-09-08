// Everything that leaves or enters the page: shared links, downloads, the localStorage
// draft, and File System Access writes into a local clone of the repo.
import type { KeymapJson } from './types';
import { applyOledBlock, applyOledC, applyRulesMk, parseOledBlock, parseOledC } from './oled';

declare const __COMMIT__: string;

export interface OledSettings {
  brightness: number;
  timeout: number;
}

export type LoadSource = 'bundled' | 'shared-link' | 'local-file' | 'autosave' | 'linked-repo';

export interface Loaded {
  km: KeymapJson;
  source: LoadSource;
  label: string;
  /** Read back from the linked clone's config.h; undefined when no repo is linked. */
  oled?: OledSettings;
  /** Body of candypad_render_default_user() found in the clone's oled.c; '' when there is none. */
  code: string;
}

/** Everything the editor owns inside the linked clone, as it is on disk right now. */
export interface RepoState {
  km: KeymapJson;
  oled: OledSettings;
  code: string;
  /** keymap.json's mtime, so a newer autosaved draft can win at cold start. */
  modifiedAt: number;
}

export const LINKED_REPO_LABEL = 'linked repo — the live keymap.json in your clone';

const DRAFT_KEY = 'candypad.draft.v1';
const REPO_PATH = ['keyboards', 'binepad', 'candypad', 'keymaps', 'candypad_keymap'];
/** Cheap sanity bound on untrusted input — the real keymap is ~1 KB. */
const MAX_BYTES = 512 * 1024;

// ---------------------------------------------------------------- serialising

/** The on-disk shape: 4-space indent plus a trailing newline, as QMK writes it. */
function serialize(km: KeymapJson): string {
  return `${JSON.stringify(km, null, 4)}\n`;
}

export function downloadKeymap(km: KeymapJson): void {
  const url = URL.createObjectURL(new Blob([serialize(km)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'keymap.json';
  a.click();
  // Revoking synchronously can cancel the download in some builds; one tick is enough.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// ------------------------------------------------------------- shared links

export function shareLink(km: KeymapJson): string {
  const { origin, pathname, search } = location;
  return `${origin}${pathname}${search}#km=u${b64urlEncode(new TextEncoder().encode(JSON.stringify(km)))}`;
}

/** Reads the payload back; returns null for anything corrupt, truncated or unrecognised. */
function decodeShared(payload: string): KeymapJson | null {
  const tag = payload[0];
  if (tag !== 'u') return null; // no other encoding is emitted yet; see shareLink
  try {
    const bytes = b64urlDecode(payload.slice(1));
    if (bytes.length > MAX_BYTES) return null;
    return parseKeymap(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// -------------------------------------------------------------- validation

function parseKeymap(text: string): KeymapJson | null {
  if (text.length > MAX_BYTES) return null;
  try {
    return asKeymap(JSON.parse(text));
  } catch {
    return null;
  }
}

/** A shared link is a file written by someone else: check every field we rely on. */
function asKeymap(v: unknown): KeymapJson | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.keyboard !== 'string' || typeof o.keymap !== 'string') return null;
  if (typeof o.layout !== 'string' || o.layout === '') return null;
  if (typeof o.version !== 'number') return null;
  if (!Array.isArray(o.layers) || o.layers.length === 0) return null;
  for (const layer of o.layers) {
    if (!Array.isArray(layer) || layer.length === 0) return null;
    if (layer.some((k) => typeof k !== 'string')) return null;
  }
  if (o.encoders !== undefined) {
    if (!Array.isArray(o.encoders)) return null;
    for (const layer of o.encoders) {
      if (!Array.isArray(layer)) return null;
      for (const pair of layer) {
        if (typeof pair !== 'object' || pair === null) return null;
        const p = pair as Record<string, unknown>;
        if (typeof p.ccw !== 'string' || typeof p.cw !== 'string') return null;
      }
    }
  }
  return v as KeymapJson;
}

// ------------------------------------------------------------------ loading

/** Resolution order: shared link, then a draft newer than the clone, then the clone, then bundled. */
export async function loadInitial(bundled: KeymapJson): Promise<Loaded> {
  const sha = __COMMIT__.slice(0, 7);
  const repo = await readFromRepo();
  // Even when the content comes from elsewhere, the firmware settings shown must be the
  // clone's real ones — otherwise the next save silently overwrites them with our defaults.
  const rest = { ...(repo ? { oled: repo.oled } : {}), code: repo?.code ?? '' };

  const payload = new URLSearchParams(location.hash.replace(/^#/, '')).get('km');
  if (payload !== null) {
    const km = decodeShared(payload);
    // Consume the fragment either way: without this, editing a shared link and then
    // refreshing would replay the link and shadow the edits the draft just saved.
    history.replaceState(null, '', location.pathname + location.search);
    if (km) return { km, source: 'shared-link', label: 'from a shared link — not saved anywhere yet', ...rest };
    return { km: bundled, source: 'bundled', label: `link could not be read — bundled snapshot @ ${sha}`, ...rest };
  }

  const draft = readDraft();
  if (draft && serialize(draft.km) !== serialize(bundled) && (!repo || draft.savedAt > repo.modifiedAt)) {
    const newer = repo ? ', newer than the file in your linked clone' : '';
    const label =
      draft.commit === __COMMIT__
        ? `restored draft — unsaved local edits from ${ago(draft.savedAt)}${newer}`
        : `restored draft from ${ago(draft.savedAt)} — the bundled keymap has changed since (now @ ${sha})`;
    return { km: draft.km, source: 'autosave', label, ...rest };
  }

  if (repo) return { km: repo.km, source: 'linked-repo', label: LINKED_REPO_LABEL, ...rest };

  return { km: bundled, source: 'bundled', label: `bundled snapshot @ ${sha}`, ...rest };
}

/** The linked clone as it is on disk, or null when nothing is linked, permission is not
 *  granted, or keymap.json is missing or unreadable. Query-only: prompting needs a gesture. */
export async function readFromRepo(): Promise<RepoState | null> {
  try {
    const root = await idbGet();
    if (!root || (await root.queryPermission({ mode: 'read' })) !== 'granted') return null;
    const dir = await keymapDir(root);
    const file = await (await dir.getFileHandle('keymap.json')).getFile();
    const km = parseKeymap(await file.text());
    if (!km) return null;
    return {
      km,
      oled: parseOledBlock((await readFile(dir, 'config.h')) ?? ''),
      code: parseOledC((await readFile(dir, 'oled.c')) ?? ''),
      modifiedAt: file.lastModified,
    };
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------- autosave

interface Draft {
  km: KeymapJson;
  savedAt: number;
  commit: string;
}

export function autosave(km: KeymapJson): void {
  try {
    const draft: Draft = { km, savedAt: Date.now(), commit: __COMMIT__ };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Private windows and storage-blocking settings throw on the accessor itself.
  }
}

function readDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Record<string, unknown>;
    const km = asKeymap(d.km);
    if (!km || typeof d.savedAt !== 'number') return null;
    return { km, savedAt: d.savedAt, commit: typeof d.commit === 'string' ? d.commit : '' };
  } catch {
    return null;
  }
}

function ago(ts: number): string {
  const min = Math.round((Date.now() - ts) / 60000);
  if (min < 1) return 'a moment ago';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

// -------------------------------------------------------- drag-and-drop

export function onDropFile(el: HTMLElement, cb: (km: KeymapJson) => void): void {
  const allow = (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };
  el.addEventListener('dragenter', allow);
  el.addEventListener('dragover', allow);
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files[0];
    if (!file) return;
    void file.text().then((text) => {
      const km = parseKeymap(text);
      if (km) cb(km);
      else console.warn('CandyPad: dropped file is not a valid keymap.json');
    });
  });
}

// ------------------------------------------------- File System Access

export function fsaAvailable(): boolean {
  return 'showDirectoryPicker' in window;
}

export async function pickRepoDir(): Promise<boolean> {
  if (!fsaAvailable()) return false;
  let root: FileSystemDirectoryHandle;
  try {
    root = await window.showDirectoryPicker({ mode: 'readwrite', id: 'candypad-repo' });
  } catch {
    return false; // user cancelled
  }
  try {
    await (await keymapDir(root)).getFileHandle('keymap.json');
  } catch {
    console.warn(`CandyPad: ${REPO_PATH.join('/')}/keymap.json not found — pick the repository root.`);
    return false;
  }
  try {
    await idbPut(root);
    return true;
  } catch {
    return false;
  }
}

export async function repoLinked(): Promise<boolean> {
  const root = await idbGet();
  if (!root) return false;
  try {
    // 'prompt' still counts: the handle survives, writeToRepo re-asks inside the click.
    return (await root.queryPermission({ mode: 'readwrite' })) !== 'denied';
  } catch {
    return false;
  }
}

export async function writeToRepo(km: KeymapJson, oled: OledSettings, code: string): Promise<void> {
  const root = await idbGet();
  if (!root) throw new Error('No repository folder is linked yet.');
  if ((await root.requestPermission({ mode: 'readwrite' })) !== 'granted') {
    throw new Error('Write permission for the repository folder was refused.');
  }
  const dir = await keymapDir(root);
  await writeFile(dir, 'keymap.json', serialize(km));
  await writeFile(dir, 'config.h', applyOledBlock((await readFile(dir, 'config.h')) ?? '', oled));

  // An empty body would leave a function returning nothing behind, so drop the file instead.
  const body = code.trim();
  if (body === '') await removeFile(dir, 'oled.c');
  else await writeFile(dir, 'oled.c', applyOledC((await readFile(dir, 'oled.c')) ?? '', code));
  const rules = applyRulesMk(await readFile(dir, 'rules.mk'), body !== '');
  if (rules === null) await removeFile(dir, 'rules.mk');
  else await writeFile(dir, 'rules.mk', rules);
}

async function keymapDir(root: FileSystemDirectoryHandle): Promise<FileSystemDirectoryHandle> {
  let dir = root;
  for (const seg of REPO_PATH) dir = await dir.getDirectoryHandle(seg);
  return dir;
}

async function writeFile(dir: FileSystemDirectoryHandle, name: string, text: string): Promise<void> {
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await w.write(text);
  await w.close();
}

async function removeFile(dir: FileSystemDirectoryHandle, name: string): Promise<void> {
  try {
    await dir.removeEntry(name);
  } catch {
    // Already absent, which is the state we wanted.
  }
}

async function readFile(dir: FileSystemDirectoryHandle, name: string): Promise<string | null> {
  try {
    return await (await (await dir.getFileHandle(name)).getFile()).text();
  } catch {
    return null;
  }
}

// ------------------------------------------- IndexedDB (handles are cloneable)

const DB_NAME = 'candypad-editor';
const STORE = 'handles';
const HANDLE_KEY = 'repo-root';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbTx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = run(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

async function idbGet(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return (await idbTx('readonly', (s) => s.get(HANDLE_KEY))) ?? null;
  } catch {
    return null;
  }
}

function idbPut(handle: FileSystemDirectoryHandle): Promise<IDBValidKey> {
  return idbTx('readwrite', (s) => s.put(handle, HANDLE_KEY));
}
