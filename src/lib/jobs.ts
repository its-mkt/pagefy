// 작업 목록
// - 작업 기록(설정·계획·결과·비용·상태): 배포 화면(로그인)에서는 로그인한 계정(Supabase public.pagefy_jobs, 본인 행만)에 저장하고,
//   이 브라우저(IndexedDB)에도 사본을 둔다. 로컬 개발(yarn dev, 로그인 없음)이나 표를 못 쓸 때는 브라우저에만.
// - PSD 원본: 너무 커서(수십~수백 MB) 계정에 올리지 않고 이 브라우저에만 둔다 (최근 MAX_JOBS 개 작업의 PSD 만 보관).
//   다른 PC 에서 열면 같은 PSD(이름·크기)를 다시 골라야 이미지 자르기·이어서 만들기가 된다.
// - 생성 중 표시: 같은 브라우저 탭끼리는 Web Lock, 다른 PC·브라우저끼리는 running_until(3분, 생성 중 1분마다 연장).
import type { GenerateMeta, PlanBundle, UsageInfo } from '../../shared/types';
import type { Settings } from '../components/SettingsPanel';
import type { SectionOut } from './assemble';
import { CLOUD } from './api';
import { supabase } from './supabase';

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
  /** (계정 저장) 다른 곳에서 생성 중이면 그 표시가 유효한 시각 — 저장하지 않고 읽을 때만 채운다 */
  runningUntil?: number;
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

/** 이 브라우저에 있는 작업 기록 (최근 순) */
async function listLocal(): Promise<Job[]> {
  const all = await req((await store('jobs')).getAll() as IDBRequest<Job[]>);
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

async function putLocal(job: Job) {
  const { runningUntil: _, ...rest } = job;
  await req((await store('jobs', 'readwrite')).put(rest));
}

// ───────── 계정 저장 (Supabase public.pagefy_jobs) ─────────

const TABLE = 'pagefy_jobs';
/** 생성 중 표시 유효 시간 — 그 안에 갱신이 없으면 끊긴 것으로 본다 */
const RUNNING_TTL = 3 * 60_000;
/** 표가 없거나(아직 적용 전) 권한 오류면 이 화면에서는 계정 저장을 끄고 브라우저에만 저장한다 */
let cloudOff = !CLOUD;

interface Row {
  id: string;
  created_at: string;
  updated_at: string;
  file_name: string;
  file_size: number;
  file_key: string;
  state: JobState;
  running_until: string | null;
  cost_usd: number;
  model: string | null;
  data: Omit<Job, 'id' | 'createdAt' | 'updatedAt' | 'fileKey' | 'fileName' | 'fileSize' | 'state' | 'model' | 'noFile' | 'runningUntil'>;
}

function toRow(j: Job): Omit<Row, 'user_id'> {
  const { id, createdAt, updatedAt, fileKey, fileName, fileSize, state, model, noFile: _n, runningUntil: _r, ...data } = j;
  return {
    id,
    created_at: new Date(createdAt).toISOString(),
    updated_at: new Date(updatedAt).toISOString(),
    file_key: fileKey,
    file_name: fileName,
    file_size: fileSize,
    state,
    running_until: state === 'running' ? new Date(Date.now() + RUNNING_TTL).toISOString() : null,
    cost_usd: data.usage?.costUsd ?? 0,
    model: model ?? null,
    data,
  };
}

const fromRow = (r: Row): Job => ({
  ...r.data,
  id: r.id,
  createdAt: Date.parse(r.created_at),
  updatedAt: Date.parse(r.updated_at),
  fileKey: r.file_key,
  fileName: r.file_name,
  fileSize: Number(r.file_size),
  state: r.state,
  model: r.model ?? undefined,
  runningUntil: r.running_until ? Date.parse(r.running_until) : undefined,
});

/** 계정 저장을 쓸 수 있으면 true (배포 화면 + 로그인 + 표 있음) */
async function cloudReady(): Promise<boolean> {
  if (cloudOff) return false;
  const { data } = await supabase.auth.getSession();
  return !!data.session;
}

/** 표가 없음·권한 없음 같은 "고쳐지지 않는" 오류면 계정 저장을 끈다. 네트워크 오류는 이번만 건너뛴다 */
function cloudFailed(e: { code?: string; message?: string } | null, what: string) {
  if (!e) return;
  if (['42P01', 'PGRST205', '42501', 'PGRST301'].includes(e.code ?? '')) {
    cloudOff = true;
    console.warn(`[jobs] 계정 저장을 쓸 수 없어 이 브라우저에만 저장합니다 (${e.code}: ${e.message})`);
  } else console.warn(`[jobs] 계정 ${what} 실패 — 브라우저 사본으로 계속`, e);
}

export const savesToAccount = () => !cloudOff;

// 섹션이 끝날 때마다 저장되므로 계정 쓰기는 1초 모아서 (같은 작업은 마지막 것만)
const pending = new Map<string, Job>();
let flushTimer: number | undefined;
function queueCloud(job: Job) {
  pending.set(job.id, job);
  clearTimeout(flushTimer);
  flushTimer = window.setTimeout(flushCloud, 1000);
}
async function flushCloud() {
  if (!pending.size || !(await cloudReady())) return pending.clear();
  const rows = [...pending.values()].map(toRow);
  pending.clear();
  const { error } = await supabase.from(TABLE).upsert(rows);
  cloudFailed(error, '저장');
}

/** 작업 목록 한 쪽 (최근 순). more = 더 있음. 계정과 브라우저를 합치고, 브라우저 쪽이 더 새로우면 계정에 올린다 */
/** 마지막으로 계정에서 읽은 목록 — 저장할 때마다 다시 읽지 않고 이것과 브라우저 사본을 합친다 (quick) */
let lastCloud: { rows: Job[]; limit: number } | null = null;

export async function listJobsPage(limit = 20, quick = false): Promise<{ jobs: Job[]; more: boolean }> {
  const local = await listLocal();
  const keys = new Set((await req((await store('files')).getAllKeys())) as string[]);
  const mark = (j: Job): Job => ({ ...j, noFile: !keys.has(j.fileKey) });
  if (!(await cloudReady())) return { jobs: local.slice(0, limit).map(mark), more: local.length > limit };

  let rows: Job[];
  if (quick && lastCloud && lastCloud.limit === limit) rows = lastCloud.rows;
  else {
    const { data, error } = await supabase.from(TABLE).select('*').order('updated_at', { ascending: false }).limit(limit + 1);
    if (error) {
      cloudFailed(error, '읽기');
      return { jobs: local.slice(0, limit).map(mark), more: local.length > limit };
    }
    rows = (data as Row[]).map(fromRow);
    lastCloud = { rows, limit };
  }
  const more = rows.length > limit;
  const byId = new Map(rows.slice(0, limit).map((j) => [j.id, j]));
  // 브라우저에만 있거나 브라우저 쪽이 더 새로운 작업 → 계정에 올린다 (처음 한 번 옮기기 + 저장 실패분 다시 올리기)
  for (const j of local) {
    const c = byId.get(j.id);
    if (!c || j.updatedAt > c.updatedAt) {
      if (!quick) queueCloud(j); // quick(저장 직후)은 putJob 이 이미 올리는 중
      if (c || byId.size < limit) byId.set(j.id, { ...j, runningUntil: c?.runningUntil });
    } else if (!quick && c.updatedAt > j.updatedAt) putLocal(c).catch(() => {}); // 다른 PC 에서 고친 것 → 브라우저 사본도 새로
  }
  const jobs = [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt).map(mark);
  return { jobs, more };
}

/** 지금까지 쓰던 이름 (작업 목록 전체가 필요한 곳) — 첫 쪽만 */
export async function listJobs(): Promise<Job[]> {
  return (await listJobsPage(100)).jobs;
}

export async function putJob(job: Job) {
  await putLocal(job);
  if (cloudOff) return;
  queueCloud(job);
  // 생성이 끝났거나 멈춘 상태는 바로 올린다 — 1초 안에 같은 탭에서 다시 만들면 계정의 "생성 중" 표시가 남아 자기 작업이 막히지 않게
  if (job.state !== 'running') {
    clearTimeout(flushTimer);
    await flushCloud();
  }
}

/** 생성 중 표시 연장 (holdLock 이 1분마다 부른다) — 다른 PC 가 같은 작업을 동시에 만들지 않게 */
export async function touchRunning(id: string) {
  if (!(await cloudReady())) return;
  const { error } = await supabase.from(TABLE).update({ running_until: new Date(Date.now() + RUNNING_TTL).toISOString() }).eq('id', id).eq('state', 'running');
  cloudFailed(error, '생성 중 표시');
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
  pending.delete(id);
  if (lastCloud) lastCloud = { ...lastCloud, rows: lastCloud.rows.filter((j) => j.id !== id) };
  await req((await store('jobs', 'readwrite')).delete(id));
  if (await cloudReady()) {
    const { error } = await supabase.from(TABLE).delete().eq('id', id);
    cloudFailed(error, '삭제');
  }
  await cleanFiles();
}

/**
 * 브라우저 용량 관리: PSD 원본은 최근 MAX_JOBS 개 작업 것만 남긴다.
 * 계정 저장을 쓰면 기록은 계정에 있으므로 브라우저 기록도 MAX_JOBS 개만, 아니면 기록도 MAX_JOBS 개까지 (예전과 같음)
 */
export async function prune(keepId?: string) {
  const jobs = await listLocal();
  const drop = jobs.filter((j) => j.id !== keepId).slice(MAX_JOBS - 1);
  for (const j of drop) if (!pending.has(j.id)) await req((await store('jobs', 'readwrite')).delete(j.id));
  await cleanFiles();
}

async function cleanFiles() {
  const used = new Set((await listLocal()).map((j) => j.fileKey));
  const keys = (await req((await store('files')).getAllKeys())) as string[];
  for (const k of keys) if (!used.has(k)) await req((await store('files', 'readwrite')).delete(k));
}

/** 앞서 열려 있던 탭이 새로고침·닫힘으로 끊긴 작업은 "중단됨" 으로 (다른 탭·다른 PC 가 지금 만드는 중인 것은 그대로) */
export async function markInterrupted() {
  const busy = await busyJobIds();
  for (const j of await listJobs()) if (j.state === 'running' && !busy.has(j.id)) await putJob({ ...j, state: 'stopped', updatedAt: Date.now() });
}

/**
 * 지금 다른 곳에서 생성 중인 작업 id
 * - 같은 브라우저의 다른 탭: App holdLock 이 잡는 Web Lock 'pagefy-job-<id>'
 * - 다른 PC·브라우저 (계정 저장): running_until 이 아직 유효한 작업 (생성 중 1분마다 연장, 끊기면 3분 뒤 풀림)
 */
export async function busyJobIds(): Promise<Set<string>> {
  const q = await navigator.locks?.query?.().catch(() => null);
  const ids = new Set((q?.held ?? []).map((l) => l.name ?? '').filter((n) => n.startsWith('pagefy-job-')).map((n) => n.slice('pagefy-job-'.length)));
  if (await cloudReady()) {
    const { data, error } = await supabase.from(TABLE).select('id').gt('running_until', new Date().toISOString());
    if (error) cloudFailed(error, '생성 중 확인');
    else for (const r of data as { id: string }[]) ids.add(r.id);
  }
  return ids;
}

/** 다른 PC 에서 고른 PSD 가 이 작업의 PSD 인지 (수정 시각은 복사하면 바뀔 수 있어 이름·크기로 본다) */
export const sameFile = (job: Pick<Job, 'fileName' | 'fileSize'>, f: File) => f.name === job.fileName && f.size === job.fileSize;

export const sameMeta = (a: GenerateMeta, b: GenerateMeta) =>
  a.productName === b.productName && a.channel === b.channel && a.slug === b.slug && a.rev === b.rev && a.publicRoot === b.publicRoot;

/** 브라우저가 공간이 모자랄 때 임의로 지우지 않게 요청 (거절돼도 동작은 같다) */
export function requestPersist() {
  navigator.storage?.persist?.().catch(() => {});
}
