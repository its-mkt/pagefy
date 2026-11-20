// 작업 목록 — 새로고침·탭 닫힘에 대비해 이 브라우저(IndexedDB)에 저장한다. 서버로는 보내지 않는다.
// PSD 원본도 함께 저장해 다시 올리지 않고 이어서 할 수 있게 한다 (최근 MAX_JOBS 개만 보관).
import type { GenerateMeta, PlanBundle, UsageInfo } from '../../shared/types';
import type { Settings } from '../components/SettingsPanel';
import type { SectionOut } from './assemble';

export type JobState = 'ready' | 'running' | 'stopped' | 'error' | 'done';

export interface Job {
  id: string;
  createdAt: number;
  updatedAt: number;
  fileKey: string;
  fileName: string;
  fileSize: number;
  /** PSD 원본을 저장하지 못함 (용량 부족 등) → 다시 올려야 열 수 있다 */
  noFile?: boolean;
  settings: Settings;
  state: JobState;
  error?: string;
  /** 계획을 만들 때 쓴 값 — 설정이 이와 같아야 이어서 만들 수 있다 */
  meta?: GenerateMeta;
  baseUrl?: string;
  extra?: string;
  plan?: { bundle: PlanBundle; report: string; raw: string };
  /** 성공한 섹션만 (id → 결과) */
  sections: Record<string, SectionOut>;
  /** 실패한 섹션 (id → 오류) */
  failed: Record<string, string>;
  usage?: UsageInfo;
  model?: string;
  revisionCount: number;
}

const DB = 'pagefy';
const MAX_JOBS = 8;

let dbp: Promise<IDBDatabase> | null = null;
function db() {
  return (dbp ||= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('jobs', { keyPath: 'id' });
      r.result.createObjectStore('files');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}

function req<T>(r: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function store(name: 'jobs' | 'files', mode: IDBTransactionMode = 'readonly') {
  return (await db()).transaction(name, mode).objectStore(name);
}

export const fileKeyOf = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;

export async function listJobs(): Promise<Job[]> {
  const all = await req((await store('jobs')).getAll() as IDBRequest<Job[]>);
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function putJob(job: Job) {
  await req((await store('jobs', 'readwrite')).put(job));
}

export async function getFile(key: string): Promise<File | undefined> {
  return req((await store('files')).get(key) as IDBRequest<File | undefined>);
}

/** PSD 원본 저장. 이미 있으면 건너뛴다. 실패하면 false */
export async function saveFile(file: File): Promise<boolean> {
  const key = fileKeyOf(file);
  try {
    const s = await store('files', 'readwrite');
    if (await req(s.count(key))) return true;
    await req((await store('files', 'readwrite')).put(file, key));
    return true;
  } catch (e) {
    console.warn('[jobs] PSD 저장 실패', e);
    return false;
  }
}

export async function deleteJob(id: string) {
  await req((await store('jobs', 'readwrite')).delete(id));
  await cleanFiles();
}

/** 오래된 작업을 MAX_JOBS 개까지 줄이고, 어느 작업도 쓰지 않는 PSD 를 지운다 */
export async function prune(keepId?: string) {
  const jobs = await listJobs();
  const drop = jobs.filter((j) => j.id !== keepId).slice(MAX_JOBS - 1);
  for (const j of drop) await req((await store('jobs', 'readwrite')).delete(j.id));
  await cleanFiles();
}

async function cleanFiles() {
  const used = new Set((await listJobs()).map((j) => j.fileKey));
  const keys = (await req((await store('files')).getAllKeys())) as string[];
  for (const k of keys) if (!used.has(k)) await req((await store('files', 'readwrite')).delete(k));
}

/** 앞서 열려 있던 탭이 새로고침·닫힘으로 끊긴 작업은 "중단됨" 으로 */
export async function markInterrupted() {
  for (const j of await listJobs()) if (j.state === 'running') await putJob({ ...j, state: 'stopped' });
}

export const sameMeta = (a: GenerateMeta, b: GenerateMeta) =>
  a.productName === b.productName && a.channel === b.channel && a.slug === b.slug && a.rev === b.rev && a.publicRoot === b.publicRoot;

/** 브라우저가 공간이 모자랄 때 임의로 지우지 않게 요청 (거절돼도 동작은 같다) */
export function requestPersist() {
  navigator.storage?.persist?.().catch(() => {});
}
