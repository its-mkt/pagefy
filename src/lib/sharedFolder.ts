// 공유 폴더에 상품 폴더 저장 — \\192.168.1.254\마케팅팀\A_상세페이지\<채널 폴더>\<제품명>\ (PSD · HTML · img\<rev>\)
// 브라우저(크롬·엣지)의 폴더 접근 기능(File System Access)으로 담당자가 고른 A_상세페이지 폴더에 바로 쓴다.
// - 처음 한 번 폴더를 고르면 이 브라우저에 기억 (IndexedDB). 창을 새로 열면 크롬이 "수정 허용?"을 한 번 묻는다
// - 덮어쓰지 않는다: 이미지·PSD 는 있으면 건너뛰고, HTML 은 내용이 다를 때 화면이 물어본 뒤에만 바꾼다. 아무것도 지우지 않는다
import type { Channel } from '../../shared/types';
import type { CutImage } from './images';

/** 채널 → 공유 폴더 안 채널 폴더 이름 */
export const CHANNEL_DIR: Record<Channel, string> = { itket: '아이티켓', oncore: '온코어', openmarket: '오픈마켓' };

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
  if (!ok) throw new Error(`고른 폴더(${h.name}) 안에 아이티켓·온코어·오픈마켓 폴더가 없습니다. \\\\192.168.1.254\\마케팅팀\\A_상세페이지 폴더를 고르세요.`);
  await saveRoot(h);
  return h;
}

/** 윈도우 폴더·파일 이름에 못 쓰는 글자 빼기 (\ / : * ? " < > |, 끝의 점·공백) */
export function safeFolderName(name: string) {
  return name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/[. ]+$/, '')
    .trim();
}

export interface SaveInput {
  channel: Channel;
  productName: string;
  rev: string;
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

async function fileOf(dir: FileSystemDirectoryHandle, name: string): Promise<File | null> {
  try {
    return await (await dir.getFileHandle(name)).getFile();
  } catch {
    return null;
  }
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

  // 이미지: img\<rev>\ — 있는 파일은 건너뜀
  const imgDir = await (await prod.getDirectoryHandle('img', { create: true })).getDirectoryHandle(inp.rev, { create: true });
  let n = 0;
  for (const im of inp.images) {
    onProgress?.(`이미지 저장 중 ${++n}/${inp.images.length}`);
    if (await fileOf(imgDir, im.file)) skipped.push(`img\\${inp.rev}\\${im.file}`);
    else {
      await write(imgDir, im.file, im.blob);
      written.push(`img\\${inp.rev}\\${im.file}`);
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
