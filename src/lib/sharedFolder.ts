// 공유 폴더에 상품 폴더 저장 — \\192.168.1.254\마케팅팀\A_상세페이지\<채널 폴더>\<제품명>\ (PSD · HTML · img\)
// 브라우저(크롬·엣지)의 폴더 접근 기능(File System Access)으로 담당자가 고른 A_상세페이지 폴더에 바로 쓴다.
// - 처음 한 번 폴더를 고르면 이 브라우저에 기억 (IndexedDB). 창을 새로 열면 크롬이 "수정 허용?"을 한 번 묻는다
// - 덮어쓰지 않는다: 이미지·PSD 는 있으면 건너뛰고, HTML 은 내용이 다를 때 화면이 물어본 뒤에만 바꾼다. 아무것도 지우지 않는다
import type { Channel } from '../../shared/types';
import type { CutImage } from './images';

/** 상세페이지 공유 폴더 (화면 안내·오류 문구용 표시 경로) */
export const SHARED_ROOT = String.raw`\\192.168.1.254\마케팅팀\A_상세페이지`;

/** 채널 → 공유 폴더 안 채널 폴더 이름 */
export const CHANNEL_DIR: Record<Channel, string> = { itket: '아이티켓', oncore: '온코어', zbyhp: 'zbyhp', cadkorea: 'cadkorea', openmarket: '오픈마켓' };

type Perm = 'granted' | 'denied' | 'prompt';
interface DirHandle extends FileSystemDirectoryHandle {
  queryPermission(o: { mode: 'readwrite' }): Promise<Perm>;
  requestPermission(o: { mode: 'readwrite' }): Promise<Perm>;
}
declare global {
  interface Window {
    showDirectoryPicker?: (o?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
  }
}

/** 이 브라우저가 폴더에 바로 저장할 수 있는지 (크롬·엣지) */
export const canSaveToFolder = () => typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';

// ───── 고른 폴더 기억 (IndexedDB, 작업 목록 DB 와 따로) ─────
const DB = 'pagefy-fs';
const STORE = 'handles';
const KEY = 'shared-root';

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idb<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const d = await db();
  try {
    return await new Promise<T>((resolve, reject) => {
      const q = run(d.transaction(STORE, mode).objectStore(STORE));
      q.onsuccess = () => resolve(q.result as T);
      q.onerror = () => reject(q.error);
    });
  } finally {
    d.close();
  }
}
const loadRoot = () => idb<DirHandle | undefined>('readonly', (s) => s.get(KEY)).catch(() => undefined);
const saveRoot = (h: FileSystemDirectoryHandle) => idb<unknown>('readwrite', (s) => s.put(h, KEY)).catch(() => undefined);

/** 기억해 둔 폴더 이름 (없으면 null) — 화면 안내용 */
export async function rememberedRootName(): Promise<string | null> {
  return (await loadRoot())?.name ?? null;
}

async function hasDir(root: FileSystemDirectoryHandle, name: string) {
  try {
    await root.getDirectoryHandle(name);
    return true;
  } catch {
    return false;
  }
}

/**
 * A_상세페이지 폴더 핸들. 버튼을 누른 순간에 불러야 한다 (권한 묻기·폴더 고르기는 클릭 직후에만 됨).
 * repick = 기억한 폴더 대신 새로 고르기
 */
export async function getSharedRoot(repick = false): Promise<FileSystemDirectoryHandle> {
  let h = repick ? undefined : await loadRoot();
  if (h) {
    const p = (await h.queryPermission({ mode: 'readwrite' })) === 'granted' ? 'granted' : await h.requestPermission({ mode: 'readwrite' });
    if (p !== 'granted') throw new Error('공유 폴더 수정을 허용하지 않아 저장하지 않았습니다. 다시 누르고 「허용」을 고르세요.');
  } else {
    if (!window.showDirectoryPicker) throw new Error('이 브라우저는 폴더에 바로 저장할 수 없습니다. 크롬이나 엣지를 쓰세요.');
    h = (await window.showDirectoryPicker({ id: "pagefy-shared", mode: "readwrite" })) as unknown as DirHandle;
  }
  const ok = (await Promise.all(Object.values(CHANNEL_DIR).map((n) => hasDir(h!, n)))).some(Boolean);
  if (!ok) throw new Error(`고른 폴더(${h.name}) 안에 아이티켓·온코어·오픈마켓 폴더가 없습니다. ${SHARED_ROOT} 폴더를 고르세요.`);
  await saveRoot(h);
  return h;
}

type SavePicker = (o: {
  suggestedName?: string;
  id?: string;
  startIn?: FileSystemHandle | 'downloads';
  types?: { description: string; accept: Record<string, string[]> }[];
}) => Promise<FileSystemFileHandle>;

/**
 * 공유 폴더의 「채널\제품명」 안에서 PSD 를 찾는다 (「공유 폴더에 저장」 때 PSD 가 같은 폴더에 들어간다).
 * - prompt = false: 기억한 폴더 권한이 이미 허용돼 있을 때만 읽는다 (권한 묻기 없음 — 화면을 열 때 쓴다)
 * - prompt = true: 버튼을 누른 직후에만 쓴다 (권한 묻기·폴더 고르기까지 한다)
 * 찾지 못하거나 읽을 수 없으면 null (화면이 「PSD 선택」으로 직접 고르게 한다)
 */
export async function findSharedPsd(inp: { channel: Channel; productName: string; fileName?: string }, prompt = false): Promise<File | null> {
  let root: FileSystemDirectoryHandle;
  try {
    if (prompt) {
      root = await getSharedRoot(false);
    } else {
      const h = await loadRoot();
      if (!h || (await h.queryPermission({ mode: 'readwrite' })) !== 'granted') return null;
      root = h;
    }
  } catch {
    return null;
  }
  try {
    const ch = await root.getDirectoryHandle(CHANNEL_DIR[inp.channel]);
    const prod = await ch.getDirectoryHandle(safeFolderName(inp.productName));
    const psds: FileSystemFileHandle[] = [];
    for await (const e of prod.values()) if (e.kind === 'file' && /\.psd$/i.test(e.name)) psds.push(e as FileSystemFileHandle);
    if (!psds.length) return null;
    const pick = psds.find((f) => f.name === inp.fileName) ?? psds[0];
    return await pick.getFile();
  } catch {
    return null;
  }
}

/**
 * zip 을 저장 창으로 저장 — 창이 공유 폴더(기억한 A_상세페이지 → 채널 폴더)에서 열린다.
 * 웹 페이지는 \\192.168.1.254\… 같은 네트워크 경로를 직접 열 수 없어서(브라우저 보안), 저장 창의 시작 위치로 대신한다.
 * 기억한 폴더가 없으면 지난번에 zip 을 저장한 폴더(id 'pagefy-zip')에서 열리므로, 처음 한 번만 공유 폴더로 옮겨 가면 된다.
 * 저장 창을 쓸 수 없는 브라우저면 'download' (보통 내려받기), 사용자가 창을 닫으면 'cancel'
 */
export async function saveZipToShared(blob: Blob, fileName: string, channel: Channel): Promise<'saved' | 'download' | 'cancel'> {
  const pick = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  if (!pick) return 'download';
  let startIn: FileSystemHandle | undefined;
  const root = await loadRoot();
  if (root) {
    try {
      startIn = await root.getDirectoryHandle(CHANNEL_DIR[channel]);
    } catch {
      startIn = root; // 채널 폴더가 없거나 권한이 아직 없으면 A_상세페이지 에서
    }
  }
  try {
    const fh = await pick({ suggestedName: fileName, id: 'pagefy-zip', startIn, types: [{ description: 'zip 파일', accept: { 'application/zip': ['.zip'] } }] });
    const w = await fh.createWritable();
    await w.write(blob);
    await w.close();
    return 'saved';
  } catch (e) {
    if ((e as Error).name === 'AbortError') return 'cancel';
    throw e;
  }
}

/** 윈도우 폴더·파일 이름에 못 쓰는 글자 빼기 (\ / : * ? " < > |, 끝의 점·공백) */
export function safeFolderName(name: string) {
  const v = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/[. ]+$/, '')
    .trim();
  // 윈도우 예약 이름(CON·AUX·NUL·COM1 …)은 폴더·파일로 못 만든다 → 뒤에 _ 를 붙인다
  return /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(v) ? `${v}_` : v;
}

export interface SaveInput {
  channel: Channel;
  productName: string;
  html: string;
  images: CutImage[];
  /** PSD 원본 (상품 폴더에 PSD 가 없을 때만 복사) */
  psd?: File;
}

export interface SavePlan {
  /** 화면 표시용 경로 (A_상세페이지\아이티켓\제품명) */
  path: string;
  /** 상품 폴더에 같은 이름 HTML 이 있고 내용이 다름 → 화면이 바꿀지 묻는다 */
  htmlDiffers: boolean;
}

export interface SaveResult {
  path: string;
  written: string[];
  skipped: string[];
  html: 'new' | 'same' | 'replaced' | 'kept';
  psd: 'copied' | 'exists' | 'none';
}

/** 파일이 없으면 null. 다른 오류(다른 프로그램이 잠금·네트워크 끊김 등)는 그대로 던진다 — "없음"으로 보면 확인 없이 덮어쓴다 */
async function fileOf(dir: FileSystemDirectoryHandle, name: string): Promise<File | null> {
  try {
    return await (await dir.getFileHandle(name)).getFile();
  } catch (e) {
    if ((e as DOMException)?.name === 'NotFoundError') return null;
    throw new Error(`${name} 을(를) 읽지 못했습니다 (${(e as Error).message}). 다른 프로그램에서 열려 있으면 닫고 다시 저장하세요.`);
  }
}

/** 내용이 같은 파일인지 (크기 → 바이트) */
async function sameContent(a: Blob, b: Blob) {
  if (a.size !== b.size) return false;
  const [x, y] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]);
  const u = new Uint8Array(x);
  const v = new Uint8Array(y);
  for (let i = 0; i < u.length; i++) if (u[i] !== v[i]) return false;
  return true;
}

async function write(dir: FileSystemDirectoryHandle, name: string, data: Blob | string) {
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
  try {
    if (data instanceof Blob) await data.stream().pipeTo(w); // 큰 PSD 도 메모리에 다 올리지 않고 흘려 쓴다 (pipeTo 가 닫음)
    else {
      await w.write(data);
      await w.close();
    }
  } catch (e) {
    await w.abort().catch(() => {});
    throw e;
  }
}

function names(inp: SaveInput) {
  const folder = safeFolderName(inp.productName);
  if (!folder) throw new Error('제품명이 비어 있어 폴더를 만들 수 없습니다.');
  return { folder, htmlName: `${folder}.html`, chDir: CHANNEL_DIR[inp.channel] };
}

/** 저장 전 확인: 경로와, 같은 이름 HTML 이 내용이 다른지 (만들거나 쓰지 않음) */
export async function planSave(root: FileSystemDirectoryHandle, inp: SaveInput): Promise<SavePlan> {
  const { folder, htmlName, chDir } = names(inp);
  const path = `${root.name}\\${chDir}\\${folder}`;
  let ch: FileSystemDirectoryHandle;
  try {
    ch = await root.getDirectoryHandle(chDir);
  } catch {
    throw new Error(`${root.name} 안에 ${chDir} 폴더가 없습니다.`);
  }
  let prod: FileSystemDirectoryHandle | null = null;
  try {
    prod = await ch.getDirectoryHandle(folder);
  } catch {
    // 새 상품 폴더
  }
  const old = prod ? await fileOf(prod, htmlName) : null;
  return { path, htmlDiffers: !!old && (await old.text()) !== inp.html };
}

/** 저장. replaceHtml = 내용이 다른 같은 이름 HTML 을 새 것으로 바꿀지 (planSave 결과로 화면이 물어본 답) */
export async function saveToShared(root: FileSystemDirectoryHandle, inp: SaveInput, replaceHtml: boolean, onProgress?: (msg: string) => void): Promise<SaveResult> {
  const { folder, htmlName, chDir } = names(inp);
  const path = `${root.name}\\${chDir}\\${folder}`;
  const ch = await root.getDirectoryHandle(chDir);
  const prod = await ch.getDirectoryHandle(folder, { create: true });
  const written: string[] = [];
  const skipped: string[] = [];

  // HTML
  let html: SaveResult['html'];
  const old = await fileOf(prod, htmlName);
  if (!old) {
    await write(prod, htmlName, inp.html);
    written.push(htmlName);
    html = 'new';
  } else if ((await old.text()) === inp.html) {
    html = 'same';
  } else if (replaceHtml) {
    await write(prod, htmlName, inp.html);
    written.push(htmlName);
    html = 'replaced';
  } else {
    skipped.push(htmlName);
    html = 'kept';
  }

  // 이미지: img\ (서버 <채널>/<슬러그>/ 와 같은 파일·이름, 규칙 6-1) — 같은 내용이면 건너뜀. 이름은 같은데 내용이 다르면(수정 요청 뒤 다시 저장 등)
  // 폴더의 HTML 이 이번 것일 때만 바꾼다 (HTML 은 옛 것으로 두기로 했으면 이미지도 옛 것을 지켜 서로 맞게)
  const htmlIsNew = html !== 'kept';
  const imgDir = await prod.getDirectoryHandle('img', { create: true });
  let n = 0;
  for (const im of inp.images) {
    onProgress?.(`이미지 저장 중 ${++n}/${inp.images.length}`);
    const rel = `img\\${im.file}`;
    const old = await fileOf(imgDir, im.file);
    if (old && ((await sameContent(old, im.blob)) || !htmlIsNew)) skipped.push(rel);
    else {
      await write(imgDir, im.file, im.blob);
      written.push(old ? `${rel} (바꿈)` : rel);
    }
  }

  // PSD: 상품 폴더에 PSD 가 하나도 없을 때만 복사 (디자이너가 이미 넣어 둔 경우가 많음)
  let psd: SaveResult['psd'] = 'none';
  if (inp.psd) {
    let any = false;
    for await (const e of prod.values()) if (e.kind === 'file' && /\.psd$/i.test(e.name)) any = true;
    if (any) psd = 'exists';
    else {
      onProgress?.(`PSD 복사 중 (${(inp.psd.size / 1024 / 1024).toFixed(0)}MB)…`);
      const name = safeFolderName(inp.psd.name) || `${folder}.psd`;
      await write(prod, name, inp.psd);
      written.push(name);
      psd = 'copied';
    }
  }
  return { path, written, skipped, html, psd };
}
