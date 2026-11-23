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
  /** 마지막으로 만든 완성 HTML (이미지 서버 주소) — PSD 원본이 없는 PC 에서도 결과를 보고 받을 수 있게 */
  html?: string;
  usage?: UsageInfo;
  model?: string;
  revisionCount: number;
  /** (계정 저장) 다른 곳에서 생성 중이면 그 표시가 유효한 시각 — 저장하지 않고 읽을 때만 채운다 */
  runningUntil?: number;
  /** 목록용 가벼운 사본 (계정에서 계획·결과 없이 읽음) — 열 때 fullJob 으로 전체를 받는다 */
  lite?: boolean;
  /** 목록 표시용 요약 (계정에 함께 저장해 목록을 가볍게 읽는다) */
  info?: ListInfo;
  /** 휴지통으로 옮긴 시각 — TRASH_DAYS 일 지나면 자동으로 영구 삭제 */
  deletedAt?: number;
  /** (브라우저 사본) 계정에 올라간 적이 있음 — 계정에서 사라졌으면 다른 곳에서 영구 삭제한 것이라 다시 올리지 않는다 */
  syncedAt?: number;
  /** (브라우저 사본) 이 사본을 만든 로그인 계정 id — 한 PC 를 여러 계정이 쓸 때 남의 작업을 보이거나 올리지 않게 */
  owner?: string;
}

/** 휴지통 보관 기간 (일) */
export const TRASH_DAYS = 30;
const TRASH_MS = TRASH_DAYS * 24 * 60 * 60_000;

export interface ListInfo {
  engine?: string;
  /** 계획의 섹션 수 (계획 전이면 0) */
  secs: number;
  /** 완료한 섹션 수 */
  done: number;
  /** 완성 HTML 이 저장돼 있음 */
  html: boolean;
}

/** 목록에 보일 요약 — 가벼운 사본이면 저장된 요약, 아니면 계획·결과에서 계산 */
export function listInfo(j: Job): ListInfo {
  if (j.lite || !j.plan) return j.info ?? { secs: 0, done: 0, html: !!j.html };
  return { engine: j.plan.bundle.plan.engine, secs: j.plan.bundle.plan.sections.length, done: Object.keys(j.sections).length, html: !!j.html };
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
/** 지금 로그인한 계정 id (cloudReady 가 채운다). 없으면 계정 저장을 안 쓰는 중 */
let uid: string | undefined;

/** 이 브라우저에 있는 작업 기록 (최근 순). 다른 계정이 만든 사본은 빼고 (표시 없는 예전 사본은 지금 계정 것으로 본다) */
async function listLocal(): Promise<Job[]> {
  const all = await req((await store('jobs')).getAll() as IDBRequest<Job[]>);
  return all.filter((j) => !uid || !j.owner || j.owner === uid).sort((a, b) => b.updatedAt - a.updatedAt);
}

async function putLocal(job: Job) {
  const { runningUntil: _, lite: _l, ...rest } = job;
  await req((await store('jobs', 'readwrite')).put({ ...rest, owner: rest.owner ?? uid }));
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
  deleted_at: string | null;
  cost_usd: number;
  model: string | null;
  data: Omit<Job, 'id' | 'createdAt' | 'updatedAt' | 'fileKey' | 'fileName' | 'fileSize' | 'state' | 'model' | 'noFile' | 'runningUntil' | 'lite' | 'deletedAt' | 'syncedAt' | 'owner'>;
}

function toRow(j: Job): Omit<Row, 'user_id'> {
  const { id, createdAt, updatedAt, fileKey, fileName, fileSize, state, model, noFile: _n, runningUntil: _r, lite: _l, info: _i, deletedAt, syncedAt: _s, owner: _o, ...rest } = j;
  const data = { ...rest, info: listInfo(j) };
  return {
    id,
    created_at: new Date(createdAt).toISOString(),
    updated_at: new Date(updatedAt).toISOString(),
    file_key: fileKey,
    file_name: fileName,
    file_size: fileSize,
    state,
    running_until: state === 'running' ? new Date(Date.now() + RUNNING_TTL).toISOString() : null,
    deleted_at: deletedAt ? new Date(deletedAt).toISOString() : null,
    cost_usd: data.usage?.costUsd ?? 0,
    model: model ?? null,
    data,
  };
}

const fromRow = (r: Row): Job => ({
  ...r.data,
  lite: undefined,
  id: r.id,
  createdAt: Date.parse(r.created_at),
  updatedAt: Date.parse(r.updated_at),
  fileKey: r.file_key,
  fileName: r.file_name,
  fileSize: Number(r.file_size),
  state: r.state,
  model: r.model ?? undefined,
  runningUntil: r.running_until ? Date.parse(r.running_until) : undefined,
  deletedAt: r.deleted_at ? Date.parse(r.deleted_at) : undefined,
});

/** 목록은 계획·결과(작업당 수십~수백 KB)를 빼고 요약만 읽는다 */
const LIST_COLS = 'id,created_at,updated_at,file_key,file_name,file_size,state,running_until,deleted_at,cost_usd,model,settings:data->settings,error:data->>error,info:data->info,revisionCount:data->revisionCount';
interface LiteRow extends Omit<Row, 'data'> {
  settings: Settings;
  error: string | null;
  info: ListInfo | null;
  revisionCount: number | null;
}
const fromLite = (r: LiteRow): Job => ({
  id: r.id,
  createdAt: Date.parse(r.created_at),
  updatedAt: Date.parse(r.updated_at),
  fileKey: r.file_key,
  fileName: r.file_name,
  fileSize: Number(r.file_size),
  state: r.state,
  model: r.model ?? undefined,
  runningUntil: r.running_until ? Date.parse(r.running_until) : undefined,
  deletedAt: r.deleted_at ? Date.parse(r.deleted_at) : undefined,
  settings: r.settings,
  error: r.error ?? undefined,
  sections: {},
  failed: {},
  revisionCount: r.revisionCount ?? 0,
  lite: true,
  info: r.info ?? undefined,
});

/** 계정 저장을 쓸 수 있으면 true (배포 화면 + 로그인 + 표 있음) */
async function cloudReady(): Promise<boolean> {
  if (cloudOff) return false;
  const { data } = await supabase.auth.getSession();
  uid = data.session?.user.id;
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
// 계정 쓰기는 한 번에 하나씩 (늦게 보낸 옛 상태가 먼저 보낸 새 상태를 덮지 않게)
let flushChain: Promise<void> = Promise.resolve();
function flushCloud() {
  flushChain = flushChain.then(flushNow, flushNow);
  return flushChain;
}
async function flushNow() {
  if (!pending.size || !(await cloudReady())) return pending.clear();
  const rows = [...pending.values()].map(toRow);
  pending.clear();
  const { error } = await supabase.from(TABLE).upsert(rows);
  cloudFailed(error, '저장');
  if (!error) for (const r of rows) markSynced(r.id, Date.parse(r.updated_at)).catch(() => {});
}

/** 브라우저 사본에 "계정에 올라감" 표시 (그 사이 더 고쳐졌으면 그대로 둔다) */
async function markSynced(id: string, updatedAt?: number) {
  const l = await getLocal(id);
  if (l && !l.syncedAt && (updatedAt === undefined || l.updatedAt <= updatedAt)) await putLocal({ ...l, syncedAt: Date.now() });
}

async function getLocal(id: string) {
  return req((await store('jobs')).get(id) as IDBRequest<Job | undefined>);
}

/** 작업 목록 한 쪽 (최근 순). more = 더 있음. 계정과 브라우저를 합치고, 브라우저 쪽이 더 새로우면 계정에 올린다 */
/** 마지막으로 계정에서 읽은 목록 — 저장할 때마다 다시 읽지 않고 이것과 브라우저 사본을 합친다 (quick) */
let lastCloud: { rows: Job[]; limit: number } | null = null;

export async function listJobsPage(limit = 20, quick = false, onLocal?: (p: { jobs: Job[]; more: boolean }) => void): Promise<{ jobs: Job[]; more: boolean }> {
  const cloud = await cloudReady(); // 계정 id 를 먼저 알아야 이 계정의 브라우저 사본만 고른다
  const [all, keyList] = await Promise.all([listLocal(), store('files').then((s) => req(s.getAllKeys()))]);
  const local = all.filter((j) => !j.deletedAt);
  const keys = new Set(keyList as string[]);
  const mark = (j: Job): Job => ({ ...j, noFile: !keys.has(j.fileKey) });
  const localPage = { jobs: local.slice(0, limit).map(mark), more: local.length > limit };
  if (!cloud) return localPage;
  // 계정 목록을 받는 동안 이 브라우저 사본을 먼저 보여 준다
  if (!quick && local.length) onLocal?.(localPage);

  let rows: Job[];
  if (quick && lastCloud && lastCloud.limit === limit) rows = lastCloud.rows;
  else {
    const { data, error } = await supabase.from(TABLE).select(LIST_COLS).is('deleted_at', null).order('updated_at', { ascending: false }).limit(limit + 1);
    if (error) {
      cloudFailed(error, '읽기');
      return localPage;
    }
    rows = (data as unknown as LiteRow[]).map(fromLite);
    await fillOldInfo(rows);
    lastCloud = { rows, limit };
  }
  const more = rows.length > limit;
  const byId = new Map(rows.slice(0, limit).map((j) => [j.id, j]));
  // 계정 목록 쪽에 없는 브라우저 사본: 휴지통·영구 삭제됐는지, 그냥 오래돼서 이 쪽에 없는지 한 번에 확인한다
  // (확인 없이 다시 올리면 다른 곳에서 지운 작업이 되살아난다)
  const { gone, cloudAt } = quick ? { gone: new Set<string>(), cloudAt: new Map<string, number>() } : await settleMissing(local.filter((j) => !byId.has(j.id)));
  // 브라우저에만 있거나 브라우저 쪽이 더 새로운 작업 → 계정에 올린다 (처음 한 번 옮기기 + 저장 실패분 다시 올리기)
  for (const j of local) {
    if (gone.has(j.id)) continue;
    const c = byId.get(j.id);
    if (c && !quick && !j.syncedAt) markSynced(j.id).catch(() => {});
    // 계정에 있는 같은 작업의 수정 시각 (이 쪽 목록 밖의 오래된 작업도 settleMissing 이 알려 준다)
    const at = c?.updatedAt ?? cloudAt.get(j.id);
    if (at === undefined || j.updatedAt > at) {
      if (!quick) queueCloud(j); // quick(저장 직후)은 putJob 이 이미 올리는 중
      if (c || byId.size < limit) byId.set(j.id, { ...j, runningUntil: c?.runningUntil });
    }
    // 계정 쪽이 더 새로우면(다른 PC 에서 고침) 가벼운 사본을 그대로 보여 주고, 열 때 fullJob 이 전체를 받아 브라우저 사본도 새로 한다
  }
  const jobs = [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt).map(mark);
  return { jobs, more };
}

/**
 * 계정 목록 쪽에 없는 브라우저 사본 정리. 돌려주는 id 는 목록에 보이지 않게 한다
 * - 계정에서 휴지통에 있음 → 브라우저 사본도 휴지통 표시
 * - 계정에 아예 없음 + 올라간 적 있음 → 다른 곳에서 영구 삭제 → 브라우저 사본도 지움
 * - 계정에 아예 없음 + 올라간 적 없음 → 아직 안 올라간 작업 (그대로 → 아래에서 올림)
 */
async function settleMissing(missing: Job[]): Promise<{ gone: Set<string>; cloudAt: Map<string, number> }> {
  const gone = new Set<string>();
  const cloudAt = new Map<string, number>();
  if (!missing.length) return { gone, cloudAt };
  const { data, error } = await supabase.from(TABLE).select('id,updated_at,deleted_at').in('id', missing.map((j) => j.id));
  if (error) {
    cloudFailed(error, '확인');
    // 확인 못 했으면 올리지 않는다 (계정 쪽이 더 새로울 수 있음) — 무한대 시각으로 막는다
    for (const j of missing) cloudAt.set(j.id, Infinity);
    return { gone, cloudAt };
  }
  const by = new Map((data as { id: string; updated_at: string; deleted_at: string | null }[]).map((r) => [r.id, r]));
  for (const j of missing) {
    const r = by.get(j.id);
    if (r && !r.deleted_at) cloudAt.set(j.id, Date.parse(r.updated_at));
    if (r?.deleted_at) {
      gone.add(j.id);
      await putLocal({ ...j, deletedAt: Date.parse(r.deleted_at) }).catch(() => {});
    } else if (!r && j.syncedAt) {
      gone.add(j.id);
      await req((await store('jobs', 'readwrite')).delete(j.id)).catch(() => {});
    }
  }
  if (gone.size) await cleanFiles();
  return { gone, cloudAt };
}

// ───────── 휴지통 ─────────

/** 휴지통으로 (계정·브라우저 둘 다). PSD 사본은 바로 지워 브라우저 용량을 비운다 */
export async function trashJob(id: string) {
  const now = Date.now();
  pending.delete(id);
  if (lastCloud) lastCloud = { ...lastCloud, rows: lastCloud.rows.filter((j) => j.id !== id) };
  await flushChain; // 이미 보내는 중인 저장이 휴지통 표시 뒤에 도착해 작업을 되살리지 않게
  const l = await getLocal(id);
  if (l) await putLocal({ ...l, deletedAt: now, updatedAt: now });
  if (await cloudReady()) {
    const iso = new Date(now).toISOString();
    const { error } = await supabase.from(TABLE).update({ deleted_at: iso, updated_at: iso, running_until: null }).eq('id', id);
    cloudFailed(error, '휴지통');
    if (error) {
      if (l) await putLocal(l).catch(() => {}); // 계정에 못 옮겼으면 브라우저 사본도 그대로 (어긋나면 열었을 때 휴지통으로 사라짐)
      throw new Error(`휴지통으로 옮기지 못했습니다 (${error.message})`);
    }
  }
  await cleanFiles();
}

/** 휴지통에서 꺼내기 */
export async function untrashJob(id: string) {
  const now = Date.now();
  const l = await getLocal(id);
  if (l) await putLocal({ ...l, deletedAt: undefined, updatedAt: now });
  if (await cloudReady()) {
    const { error } = await supabase.from(TABLE).update({ deleted_at: null, updated_at: new Date(now).toISOString() }).eq('id', id);
    cloudFailed(error, '복원');
    if (error) throw new Error(`복원하지 못했습니다 (${error.message})`);
  }
  lastCloud = null;
}

/** 보관 기간이 지난 휴지통 항목 영구 삭제 */
async function purgeTrash() {
  const cutoff = Date.now() - TRASH_MS;
  for (const j of await listLocal()) if (j.deletedAt && j.deletedAt < cutoff) await req((await store('jobs', 'readwrite')).delete(j.id));
  if (await cloudReady()) {
    const { error } = await supabase.from(TABLE).delete().not('deleted_at', 'is', null).lt('deleted_at', new Date(cutoff).toISOString());
    cloudFailed(error, '휴지통 비우기');
  }
}

/** 휴지통 목록 (최근에 지운 순). 열 때 기간 지난 것부터 비운다 */
export async function listTrash(): Promise<Job[]> {
  await purgeTrash();
  const local = (await listLocal()).filter((j) => j.deletedAt);
  const byId = new Map(local.map((j) => [j.id, { ...j, noFile: true }]));
  if (await cloudReady()) {
    const { data, error } = await supabase.from(TABLE).select(LIST_COLS).not('deleted_at', 'is', null).order('deleted_at', { ascending: false }).limit(100);
    if (error) cloudFailed(error, '휴지통 읽기');
    else for (const j of (data as unknown as LiteRow[]).map(fromLite)) byId.set(j.id, { ...j, noFile: true });
  }
  return [...byId.values()].sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
}

/** 휴지통 개수 (작업 목록 머리에 표시) */
export async function trashCount(): Promise<number> {
  const cloud = await cloudReady();
  const trashed = (await listLocal()).filter((j) => j.deletedAt);
  if (!cloud) return trashed.length;
  const { count, error } = await supabase.from(TABLE).select('id', { count: 'exact', head: true }).not('deleted_at', 'is', null);
  if (error) {
    cloudFailed(error, '휴지통 개수');
    return trashed.length;
  }
  // 계정에 올라간 적 없는(브라우저에만 있는) 휴지통 항목도 센다 — 안 세면 휴지통 버튼이 숨어 못 꺼낸다
  return (count ?? 0) + trashed.filter((j) => !j.syncedAt).length;
}

/** 요약(info)을 저장하기 전에 만든 작업: 계획의 섹션 수만 따로 읽어 채운다 (다음에 저장되면 요약이 함께 들어감) */
async function fillOldInfo(rows: Job[]) {
  const old = rows.filter((j) => !j.info);
  if (!old.length) return;
  const { data } = await supabase
    .from(TABLE)
    .select('id,engine:data->plan->bundle->plan->>engine,secs:data->plan->bundle->plan->sections')
    .in('id', old.map((j) => j.id));
  const by = new Map(((data ?? []) as unknown as { id: string; engine: string | null; secs: unknown[] | null }[]).map((r) => [r.id, r]));
  for (const j of old) {
    const r = by.get(j.id);
    const secs = r?.secs?.length ?? 0;
    j.info = { engine: r?.engine ?? undefined, secs, done: r?.engine === 'code' ? secs : 0, html: false };
  }
}

/** 열기 전에 전체 작업 받기: 가벼운 사본이면 브라우저 사본(같거나 더 새로우면) 또는 계정에서 전체를 읽는다 */
export async function fullJob(j: Job): Promise<Job> {
  if (!j.lite) return j;
  const local = await getLocal(j.id);
  // 브라우저 사본은 계정보다 확실히 새로울 때만 (아직 못 올린 수정). 같거나 오래됐거나 휴지통 표시면 계정에서 받는다
  const usable = local && !local.deletedAt ? local : undefined;
  if (usable && usable.updatedAt > j.updatedAt) return { ...usable, noFile: j.noFile, runningUntil: j.runningUntil };
  const { data, error } = await supabase.from(TABLE).select('*').eq('id', j.id).maybeSingle();
  if (error && usable) return { ...usable, noFile: j.noFile, runningUntil: j.runningUntil }; // 네트워크 오류면 브라우저 사본이라도
  if (error || !data) throw new Error(`작업을 불러오지 못했습니다${error ? ` (${error.message})` : ' (지워진 작업)'}`);
  const full = fromRow(data as Row);
  await putLocal(full).catch(() => {});
  return { ...full, noFile: j.noFile };
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
    if (error) throw new Error(error.message);
  }
  await cleanFiles();
}

/**
 * 브라우저 용량 관리: PSD 원본은 최근 MAX_JOBS 개 작업 것만 남긴다.
 * 계정 저장을 쓰면 기록은 계정에 있으므로 브라우저 기록도 MAX_JOBS 개만, 아니면 기록도 MAX_JOBS 개까지 (예전과 같음)
 */
export async function prune(keepId?: string) {
  const jobs = (await listLocal()).filter((j) => !j.deletedAt); // 휴지통 항목은 기간이 지나면 purgeTrash 가 지운다
  // 계정 저장 중이면 계정에 올라간 것만 브라우저에서 정리한다 (못 올린 작업을 지우면 영영 사라짐)
  const drop = jobs.filter((j) => j.id !== keepId).slice(MAX_JOBS - 1).filter((j) => cloudOff || j.syncedAt);
  for (const j of drop) if (!pending.has(j.id)) await req((await store('jobs', 'readwrite')).delete(j.id));
  await cleanFiles();
}

async function cleanFiles() {
  // 다른 계정의 브라우저 사본 PSD 도 지키도록 계정 구분 없이 전부 본다
  const all = await req((await store('jobs')).getAll() as IDBRequest<Job[]>);
  const used = new Set(all.filter((j) => !j.deletedAt).map((j) => j.fileKey));
  const keys = (await req((await store('files')).getAllKeys())) as string[];
  for (const k of keys) if (!used.has(k)) await req((await store('files', 'readwrite')).delete(k));
}

/** 앞서 열려 있던 탭이 새로고침·닫힘으로 끊긴 작업은 "중단됨" 으로 (다른 탭·다른 PC 가 지금 만드는 중인 것은 그대로) */
// 상태 칸만 바꾼다 (목록을 전부 읽지 않음 — 첫 화면을 늦추지 않게)
// 브라우저 사본 먼저 (목록을 읽기 전에 — 안 그러면 "생성 중" 사본이 계정에 다시 올라가 3분간 자기 작업이 막힘)
// 수정 시각은 그대로 둔다: 올리면 다른 PC 에서 더 고친 계정 사본보다 새로워 보여 덮어쓴다
export async function markInterruptedLocal() {
  await cloudReady(); // 계정 id
  const q = await navigator.locks?.query?.().catch(() => null);
  const held = new Set((q?.held ?? []).map((l) => l.name ?? ''));
  for (const j of await listLocal()) if (j.state === 'running' && !held.has(`pagefy-job-${j.id}`)) await putLocal({ ...j, state: 'stopped' });
}

/** 계정 쪽: 생성 중 표시가 끊긴 작업을 "중단됨"으로. 바뀐 게 있으면 true */
export async function markInterrupted(): Promise<boolean> {
  const now = Date.now();
  let changed = false;
  if (!(await cloudReady())) return changed;
  // 계정: 생성 중 표시가 끊긴(3분 넘게 갱신 없는) 작업만. 다른 PC 가 만드는 중인 것은 표시가 살아 있어 그대로 둔다
  const { data, error } = await supabase
    .from(TABLE)
    .update({ state: 'stopped', running_until: null, updated_at: new Date(now).toISOString() })
    .eq('state', 'running')
    .or(`running_until.is.null,running_until.lt.${new Date(now).toISOString()}`)
    .select('id');
  if (error) cloudFailed(error, '중단 표시');
  else if (data?.length) {
    lastCloud = null;
    changed = true;
  }
  return changed;
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
