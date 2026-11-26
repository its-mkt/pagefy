// 작업 목록
// - 작업 기록(설정·계획·결과·비용·상태): 배포 화면(로그인)에서는 로그인한 계정(Supabase public.pagefy_jobs, 본인 행만)에 저장하고,
//   이 브라우저(IndexedDB)에도 사본을 둔다. 로컬 개발(yarn dev, 로그인 없음)이나 표를 못 쓸 때는 브라우저에만.
// - PSD 원본: 너무 커서(수십~수백 MB) 계정에 올리지 않고 이 브라우저에만 둔다 (최근 MAX_JOBS 개 작업의 PSD 만 보관).
//   다른 PC 에서 열면 같은 PSD(이름·크기)를 다시 골라야 이미지 자르기·이어서 만들기가 된다.
// - 생성 중 표시: 같은 브라우저 탭끼리는 Web Lock, 다른 PC·브라우저끼리는 running_until(3분, 생성 중 1분마다 연장).
import { CHANNEL_LABEL, type Channel, type GenerateMeta, type PlanBundle, type UsageInfo } from '../../shared/types';
import { MARKETS, normMarket, type Market } from '../../shared/markets';
import { rangeMs, type DayRange } from './dayRange';
import type { Settings } from '../components/SettingsPanel';
import type { SectionOut } from './assemble';
import { AUTH } from './api';
import { supabase } from './supabase';

export type JobState = 'ready' | 'running' | 'stopped' | 'error' | 'done';

/** 작업 기록 — 변환 내역에만 보인다 (Claude 에 보내지 않고 마크업에 영향 없음) */
export interface JobNote {
  /** 담당자 (디자이너·요청자 등) — 비우면 만든 사람 */
  assignee?: string;
  /** 한 줄 메모 (예: 리뉴얼 시안 2차) */
  memo?: string;
  /** 테스트용 작업 — 변환 내역에 「테스트」 표시, 거르기로 뺄 수 있다 */
  test?: boolean;
  /** 쇼핑몰에 등록한 상품 페이지 주소 — 있으면 변환 내역에 「등록됨」 링크 (고도몰은 등록 확인이 맞으면 자동으로 채움) */
  link?: string;
  /** 잠금 — 변환 내역 ⋯ 메뉴에서 켠다. 휴지통으로 옮기기·이미지 서버에서 지우기·일괄 선택을 막는다 (실수로 지우지 않게) */
  locked?: boolean;
}

/** 등록 페이지 주소로 쓸 수 있는지 (비어 있으면 됨 — 선택 칸) */
export const okLink = (v?: string) => !v?.trim() || /^https?:\/\/\S+$/i.test(v.trim());
/** 쇼핑몰에 등록한 페이지 주소가 있는 작업 (빈 칸은 아님) — 변환 내역의 「등록」 표시·거르기 기준 */
export const registered = (x: Pick<Job, 'note'>) => !!x.note?.link?.trim() && okLink(x.note.link);

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
  /** 만든 사람 (작업을 만든 로그인 계정 이름·이메일). 담당자(note.assignee)를 비우면 이 사람이 담당. 예전 작업엔 없다 */
  creator?: string;
  /** 작업 기록 (담당자·메모·테스트) — 만들기 설정과 따로 둔다: 결과·이어서 만들기와 상관없고, 설정 자동 저장이 건드리지 않는다 */
  note?: JobNote;
  state: JobState;
  error?: string;
  /** 계획을 만들 때 쓴 값 — 설정이 이와 같아야 이어서 만들 수 있다 */
  meta?: GenerateMeta;
  baseUrl?: string;
  /** 이미지 서버에 결과 이미지를 다 올린 시각 — 목록의 「완료」 기준 (없으면 「올리기 전」). 다시 만들거나 이미지를 지우면 비운다 */
  uploadedAt?: number;
  extra?: string;
  plan?: { bundle: PlanBundle; report: string; raw: string };
  /** 성공한 섹션만 (id → 결과) */
  sections: Record<string, SectionOut>;
  /** 실패한 섹션 (id → 오류) */
  failed: Record<string, string>;
  /** 마지막으로 만든 완성 HTML (이미지 서버 주소) — PSD 원본이 없는 PC 에서도 결과를 보고 받을 수 있게 */
  html?: string;
  /**
   * 결과 화면 「손보기」에서 저장한 복사 구간 HTML (2026-11-25). base = 손보기 전 복사 구간의 표시값(editBase) —
   * 결과가 다시 만들어져 원본이 바뀌면 맞지 않으므로 버린다 (옛 결과 위에서 고친 것을 새 결과에 붙이지 않게)
   */
  edited?: { html: string; base: string; at: number };
  usage?: UsageInfo;
  model?: string;
  revisionCount: number;
  /** (계정 저장) 다른 곳에서 생성 중이면 그 표시가 유효한 시각 — 저장하지 않고 읽을 때만 채운다 */
  runningUntil?: number;
  /** 목록용 가벼운 사본 (계정에서 계획·결과 없이 읽음) — 열 때 fullJob 으로 전체를 받는다 */
  lite?: boolean;
  /** 목록 표시용 요약 (계정에 함께 저장해 목록을 가볍게 읽는다) */
  info?: ListInfo;
  /** 휴지통으로 옮긴 시각 — 사용자가 휴지통에서 영구 삭제할 때까지 남는다 */
  deletedAt?: number;
  /** (브라우저 사본) 계정에 올라간 적이 있음 — 계정에서 사라졌으면 다른 곳에서 영구 삭제한 것이라 다시 올리지 않는다 */
  syncedAt?: number;
  /** (브라우저 사본) 이 사본을 만든 로그인 계정 id — 한 PC 를 여러 계정이 쓸 때 남의 작업을 보이거나 올리지 않게 */
  owner?: string;
}

/** 휴지통 보관 기간 (일) */
/** 휴지통 작업의 PSD 원본(브라우저 사본)을 남겨 두는 시간 — cleanFiles */
const TRASH_KEEP_FILE_MS = 86_400_000;

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
let cloudOff = !AUTH;

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
const LIST_COLS = 'id,created_at,updated_at,file_key,file_name,file_size,state,running_until,deleted_at,cost_usd,model,settings:data->settings,creator:data->>creator,note:data->note,error:data->>error,info:data->info,revisionCount:data->revisionCount,uploadedAt:data->uploadedAt';
interface LiteRow extends Omit<Row, 'data'> {
  settings: Settings;
  creator: string | null;
  note: JobNote | null;
  error: string | null;
  info: ListInfo | null;
  revisionCount: number | null;
  uploadedAt: number | null;
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
  creator: r.creator ?? undefined,
  note: r.note ?? undefined,
  error: r.error ?? undefined,
  sections: {},
  failed: {},
  revisionCount: r.revisionCount ?? 0,
  lite: true,
  info: r.info ?? undefined,
  uploadedAt: r.uploadedAt ?? undefined,
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
let lastCloud: { rows: Job[]; limit: number; filter: string; offset: number; total?: number } | null = null;

/** 변환 내역 거르기 — 비어 있으면 전체. 계정 목록은 서버에서 거른 뒤 20개씩 읽으므로 「더 보기」로 빠짐없이 이어진다 */
export interface JobFilter {
  /** godo = 고도몰 전체(아이티켓·온코어) */
  channel?: Channel | 'godo';
  /** 오픈마켓 플랫폼 (channel 이 openmarket 일 때만) */
  market?: Market;
  /** ready = 준비(PSD 만 열고 아직 안 만든 것), pending = 올리기 전(만들었지만 이미지 서버에 안 올림), done = 완료(이미지 올림, 아직 등록 전), reg = 등록(등록한 페이지 주소 있음), problem = 오류·중단 */
  state?: 'ready' | 'pending' | 'done' | 'reg' | 'problem';
  /** 최근 n일 안에 작업한 것 (마지막 수정 기준) — 기간 선택의 빠른 선택(오늘·7일·30일). 날이 바뀌어도 「최근 n일」로 따라간다 */
  days?: number;
  /** 달력에서 고른 날·기간 (마지막 수정 기준, 양 끝 날 포함) — days 와 함께 쓰지 않는다 */
  range?: DayRange;
  /** 제품명·PSD 파일명·담당자·메모 검색 */
  q?: string;
  /** 테스트용 작업 (note.test) — hide = 빼기, only = 테스트만 */
  test?: 'hide' | 'only';
}
export const filterOn = (f: JobFilter) => !!(f.channel || f.state || f.days || f.range || f.test || f.q?.trim());
const PROBLEM: JobState[] = ['error', 'stopped'];
/** 고도몰 채널 */
const GODO: Channel[] = ['itket', 'oncore', 'zbyhp', 'cadkorea'];
/** 검색어에서 PostgREST 필터 문법을 깨는 글자를 뺀다 */
const cleanQ = (q?: string) => (q ?? '').replace(/[,()*%\\]/g, ' ').trim();
const sinceMs = (days: number) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0); // 「오늘」= 오늘 0시부터, 「7일」= 6일 전 0시부터
  return d.getTime() - (days - 1) * 86_400_000;
};
/** 계정 목록 조회 (휴지통 제외) — 거르기 규칙이 조건을 덧붙인다 */
// count = 전체 개수도 같이 받기 (변환 내역 페이지 번호용)
const listQuery = (count = false) => supabase.from(TABLE).select(LIST_COLS, count ? { count: 'exact' } : undefined).is('deleted_at', null);
type ListQuery = ReturnType<typeof listQuery>;
/** 거르기 조건 하나 = 브라우저 사본 판정 + 계정 조회 조건 (둘이 같은 뜻이 되게 한곳에 둔다 — 새 조건은 여기에만 추가) */
interface FilterRule {
  local: (j: Job) => boolean;
  cloud: (q: ListQuery) => ListQuery;
}
const iso = (ms: number) => new Date(ms).toISOString();
function filterRules(f: JobFilter): FilterRule[] {
  const rules: FilterRule[] = [];
  if (f.channel === 'godo') rules.push({ local: (j) => GODO.includes(j.settings?.channel as Channel), cloud: (q) => q.in('data->settings->>channel', GODO) });
  else if (f.channel) rules.push({ local: (j) => j.settings?.channel === f.channel, cloud: (q) => q.eq('data->settings->>channel', f.channel!) });
  if (f.channel === 'openmarket' && f.market) rules.push({ local: (j) => j.settings?.market === f.market, cloud: (q) => q.eq('data->settings->>market', f.market!) });
  if (f.state === 'ready') rules.push({ local: (j) => j.state === 'ready', cloud: (q) => q.eq('state', 'ready') });
  // 완료 / 등록 — 등록 = 완료 + 작업 기록에 등록한 페이지 주소(http…)가 있는 것. 목록 상태 칸 표시와 같은 기준 (상태 값 자체는 둘 다 done)
  // 올리기 전 / 완료 — 둘 다 등록 전. 이미지 서버에 올렸는지(uploadedAt)로 나눈다 (목록 상태 칸과 같은 기준)
  const notReg = (q: ListQuery) => q.eq('state', 'done').or('data->note->>link.is.null,data->note->>link.not.ilike.http%');
  if (f.state === 'pending') rules.push({ local: (j) => j.state === 'done' && !registered(j) && !j.uploadedAt, cloud: (q) => notReg(q).is('data->uploadedAt', null) });
  if (f.state === 'done') rules.push({ local: (j) => j.state === 'done' && !registered(j) && !!j.uploadedAt, cloud: (q) => notReg(q).not('data->uploadedAt', 'is', null) });
  if (f.state === 'reg') rules.push({ local: (j) => j.state === 'done' && registered(j), cloud: (q) => q.eq('state', 'done').ilike('data->note->>link', 'http%') });
  if (f.state === 'problem') rules.push({ local: (j) => PROBLEM.includes(j.state), cloud: (q) => q.in('state', PROBLEM) });
  if (f.days) {
    const since = sinceMs(f.days);
    rules.push({ local: (j) => j.updatedAt >= since, cloud: (q) => q.gte('updated_at', iso(since)) });
  }
  if (f.range) {
    const { start, end } = rangeMs(f.range);
    rules.push({ local: (j) => j.updatedAt >= start && j.updatedAt < end, cloud: (q) => q.gte('updated_at', iso(start)).lt('updated_at', iso(end)) });
  }
  // 테스트 여부 — 기록이 없는 작업(note 없음)도 「빼기」에 남도록 늘 있는 data 칸이 {note:{test:true}} 를 품는지로 고른다 (note 값 비교면 null 이 빠진다)
  if (f.test) {
    const only = f.test === 'only';
    rules.push({ local: (j) => !!j.note?.test === only, cloud: (q) => (only ? q.contains('data', { note: { test: true } }) : q.not('data', 'cs', '{"note":{"test":true}}')) });
  }
  const q = cleanQ(f.q);
  if (q) {
    const lower = q.toLowerCase();
    rules.push({
      // 담당 = 담당자 칸, 비어 있으면 만든 사람 (목록 「담당」 칸과 같은 기준) — 그래서 만든 사람 이름으로도 찾는다
      local: (j) => `${j.settings?.productName ?? ''} ${j.fileName} ${j.note?.assignee ?? ''} ${j.creator ?? ''} ${j.note?.memo ?? ''}`.toLowerCase().includes(lower),
      cloud: (qq) => qq.or(`file_name.ilike.%${q}%,data->settings->>productName.ilike.%${q}%,data->note->>assignee.ilike.%${q}%,data->>creator.ilike.%${q}%,data->note->>memo.ilike.%${q}%`),
    });
  }
  return rules;
}
/** 브라우저 사본이 거르기에 맞는지 (계정 목록은 같은 규칙의 cloud 조건으로 서버에서 거른다) */
export const matchFilter = (j: Job, f: JobFilter) => filterRules(f).every((r) => r.local(j));

/**
 * offset = 건너뛸 개수 (변환 내역 페이지: (페이지-1)×limit). total = 거르기에 맞는 전체 개수 (페이지 번호용).
 * 둘째 페이지부터는 계정 목록만 그대로 보여 준다 — 브라우저 사본 합치기·올리기는 첫 페이지를 읽을 때 한다 (최근 것이라 첫 페이지에 있음)
 */
export async function listJobsPage(limit = 20, quick = false, onLocal?: (p: { jobs: Job[]; more: boolean; total?: number }) => void, filter: JobFilter = {}, offset = 0): Promise<{ jobs: Job[]; more: boolean; total?: number }> {
  const cloud = await cloudReady(); // 계정 id 를 먼저 알아야 이 계정의 브라우저 사본만 고른다
  const [all, keyList] = await Promise.all([listLocal(), store('files').then((s) => req(s.getAllKeys()))]);
  const local = all.filter((j) => !j.deletedAt && matchFilter(j, filter));
  const fkey = JSON.stringify(filter);
  const keys = new Set(keyList as string[]);
  const mark = (j: Job): Job => ({ ...j, noFile: !keys.has(j.fileKey) });
  const localPage = { jobs: local.slice(offset, offset + limit).map(mark), more: local.length > offset + limit, total: local.length };
  if (!cloud) return localPage;
  // 계정 목록을 받는 동안 이 브라우저 사본을 먼저 보여 준다
  if (!quick && local.length && offset === 0) onLocal?.(localPage);

  let rows: Job[];
  let total: number | undefined;
  if (quick && lastCloud && lastCloud.limit === limit && lastCloud.filter === fkey && lastCloud.offset === offset) {
    rows = lastCloud.rows;
    total = lastCloud.total;
  } else {
    const query = filterRules(filter).reduce((q, r) => r.cloud(q), listQuery(true));
    // limit 보다 하나 더 받아 「다음이 있음」을 안다 (range 는 양 끝 포함)
    const { data, error, count } = await query.order('updated_at', { ascending: false }).range(offset, offset + limit);
    if (error) {
      cloudFailed(error, '읽기');
      return localPage;
    }
    rows = (data as unknown as LiteRow[]).map(fromLite);
    await fillOldInfo(rows);
    total = count ?? undefined;
    lastCloud = { rows, limit, filter: fkey, offset, total };
  }
  const more = rows.length > limit;
  if (offset > 0) return { jobs: rows.slice(0, limit).map(mark), more, total };
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
  return { jobs, more, total };
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

/** 휴지통 목록 (최근에 지운 순). 기간이 지나도 저절로 지우지 않는다 — 영구 삭제는 사용자가 휴지통에서 (2026-11-26 사용자) */
export async function listTrash(): Promise<Job[]> {
  const local = (await listLocal()).filter((j) => j.deletedAt);
  const byId = new Map(local.map((j) => [j.id, { ...j, noFile: true }]));
  if (await cloudReady()) {
    const { data, error } = await supabase.from(TABLE).select(LIST_COLS).not('deleted_at', 'is', null).order('deleted_at', { ascending: false }).limit(500);
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

/**
 * 주소(?job=…)로 연 작업 찾기. 계정이면 계정에서(이 브라우저 사본보다 새로울 수 있음), 아니면 브라우저 사본.
 * 휴지통에 있거나 없는 작업(다른 계정 것 포함)은 null. noFile = 이 브라우저에 PSD 원본이 없음
 */
export async function jobById(id: string): Promise<Job | null> {
  const cloud = await cloudReady();
  const keys = new Set((await req((await store('files')).getAllKeys())) as string[]);
  const local = await getLocal(id);
  const mark = (j: Job): Job => ({ ...j, noFile: !keys.has(j.fileKey) });
  const usableLocal = local && !local.deletedAt && (!uid || !local.owner || local.owner === uid) ? mark(local) : null;
  if (!cloud) return usableLocal;
  // 계정 사본과 비교해 더 새로운 쪽을 쓴다 — 아직 못 올린 수정이 있는 브라우저 사본을 계정의 옛 사본으로 덮어쓰지 않게
  const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
  if (error || !data) return usableLocal; // 네트워크 오류·아직 계정에 안 올라간 작업 → 브라우저 사본
  const remote = fromRow(data as Row);
  if (remote.deletedAt) return null;
  if (usableLocal && usableLocal.updatedAt > remote.updatedAt) return usableLocal;
  await putLocal(remote).catch(() => {});
  return mark(remote);
}

/**
 * 주소(?markup=<슬러그>&rev=<rev>&ch=<채널>&pf=<플랫폼>)로 연 작업 찾기. count = 맞는 작업 수
 * 슬러그는 이미지 서버 폴더 이름(규칙 6-1, 한 번 정하면 안 바뀜)이라 주소가 오래 유지된다
 * - ch(·오픈마켓은 pf)가 있으면 그 판매처 작업만 본다 — 같은 제품을 고도몰·쿠팡 등으로 따로 만들면 슬러그·rev 가 같기 때문 (2026-11-26)
 * - ch 가 없는 예전 주소는 고도몰 작업을 먼저, 그 안에서 가장 최근 것
 */
export async function jobBySlug(slug: string, rev?: string, ch?: string, pf?: string): Promise<{ job: Job | null; count: number }> {
  type Hit = { id: string; channel?: string; market?: string };
  let hits: Hit[] = [];
  let cloudOk = false;
  if (await cloudReady()) {
    let q = supabase.from(TABLE).select('id,channel:data->settings->>channel,market:data->settings->>market').is('deleted_at', null).eq('data->settings->>slug', slug);
    if (rev) q = q.eq('data->settings->>rev', rev);
    const { data, error } = await q.order('updated_at', { ascending: false }).limit(20);
    if (error) cloudFailed(error, '주소로 찾기');
    else { hits = data as Hit[]; cloudOk = true; }
  }
  if (!cloudOk || !hits.length)
    hits = (await listLocal())
      .filter((j) => !j.deletedAt && j.settings?.slug === slug && (!rev || j.settings.rev === rev))
      .map((j) => ({ id: j.id, channel: j.settings?.channel, market: j.settings?.market }));
  if (ch) hits = hits.filter((h) => h.channel === ch && (ch !== 'openmarket' || !pf || h.market === pf));
  else hits = [...hits.filter((h) => GODO.includes(h.channel as Channel)), ...hits.filter((h) => !GODO.includes(h.channel as Channel))];
  return { job: hits.length ? await jobById(hits[0].id) : null, count: hits.length };
}

/**
 * 저장된 HTML 이 있는 작업 찾기 (에디터 테스트 「변환 내역에서 불러오기」) — 최근 순, offset 부터 limit 개씩.
 * 변환 내역 화면에 읽어 둔 목록(20개)과 따로, 계정에서 바로 찾는다 → 작업이 많아도 검색·더 보기로 모두 고를 수 있다.
 * q 는 변환 내역 검색과 같은 규칙 (제품명·파일명·담당·메모). 목록 칸만 받고 HTML 은 고를 때 fullJob 으로 받는다.
 * 목록 화면의 캐시(lastCloud)·브라우저 사본 올리기는 건드리지 않는 읽기 전용
 */
export async function findJobsWithHtml(q: string, offset: number, limit = 20): Promise<{ jobs: Job[]; more: boolean }> {
  const f: JobFilter = { q };
  const cloud = await cloudReady();
  if (cloud) {
    const query = filterRules(f).reduce((qq, r) => r.cloud(qq), listQuery()).not('data->>html', 'is', null);
    const { data, error } = await query.order('updated_at', { ascending: false }).range(offset, offset + limit); // 하나 더 받아 「더 있음」 판단
    if (error) throw new Error(`작업 목록을 읽지 못했습니다 (${error.message})`);
    const rows = (data as unknown as LiteRow[]).map(fromLite);
    return { jobs: rows.slice(0, limit), more: rows.length > limit };
  }
  const local = (await listLocal()).filter((j) => !j.deletedAt && !!j.html && matchFilter(j, f));
  return { jobs: local.slice(offset, offset + limit), more: local.length > offset + limit };
}

/** 같은 폴더 확인에서 한 번에 받는 최대 작업 수 — 이만큼 꽉 차면 다 봤다고 할 수 없어 지우기를 막는다 */
const FOLDER_CHECK_MAX = 200;

/**
 * 같은 슬러그(이미지 서버 폴더)를 쓰는 다른 작업 — 휴지통 것은 빼고, HTML 까지 받는다.
 * 「이미지 서버에서 지우기」가 다른 작업도 쓰는 파일을 지우지 않으려고 쓴다. 실제로 같은 파일을 쓰는지는 HTML 주소로 가린다(imageDelete.ts).
 *  - 슬러그는 마크업을 만들 때 값(meta)과 지금 설정(settings) 둘 다로 찾는다 — 만든 뒤 설정의 슬러그만 고친 작업도 HTML 은 옛 폴더를 가리킨다
 *  - 다 보지 못하면 던진다 (계정 저장 중인데 로그인이 안 됨·읽기 실패·최대 수 도달). 덜 보고 지우면 남이 쓰는 파일을 지울 수 있다
 *  - scope: 'account' = 내 계정 작업 전부 · 'browser' = 계정 저장을 안 써서 이 브라우저 작업만 (다른 사람 작업은 어느 쪽도 볼 수 없음)
 */
export async function jobsInFolder(slug: string, exceptId: string): Promise<{ jobs: Job[]; scope: 'account' | 'browser' }> {
  const out = new Map<string, Job>();
  const cloud = await cloudReady(); // 계정 id 를 먼저 알아야 이 계정의 브라우저 사본만 고른다
  if (!cloud && savesToAccount()) throw new Error('계정에 로그인되어 있지 않아 같은 폴더를 쓰는 작업을 다 확인할 수 없습니다. 로그인한 뒤 다시 열어 주세요.');
  // 목록 칸 + HTML 만 (계획·섹션 결과까지 받으면 작업당 수십~수백 KB). 계정·브라우저 사본은 동시에 읽는다
  // 슬러그는 6-1 규칙상 영문 소문자·숫자·하이픈뿐이라 or 필터 문자열에 그대로 넣어도 된다
  const safe = /^[a-z0-9-]+$/.test(slug) ? slug : '';
  const [remote, local] = await Promise.all([
    cloud && safe
      ? supabase.from(TABLE).select(`${LIST_COLS},html:data->>html`).is('deleted_at', null).or(`data->meta->>slug.eq.${safe},data->settings->>slug.eq.${safe}`).neq('id', exceptId).limit(FOLDER_CHECK_MAX)
      : null,
    listLocal(),
  ]);
  if (cloud && !safe) throw new Error('서버 폴더 이름(제품슬러그)이 올바르지 않습니다.');
  if (remote?.error) throw new Error(`같은 폴더를 쓰는 작업을 확인하지 못했습니다 (${remote.error.message})`);
  const rows = (remote?.data ?? []) as unknown as (LiteRow & { html: string | null })[];
  if (rows.length >= FOLDER_CHECK_MAX) throw new Error(`같은 슬러그를 쓰는 작업이 ${FOLDER_CHECK_MAX}개를 넘어 다 확인할 수 없습니다. 관리자에게 문의해 주세요.`);
  for (const r of rows) out.set(r.id, { ...fromLite(r), html: r.html ?? undefined });
  for (const j of local) if (!j.deletedAt && j.id !== exceptId && (j.meta?.slug === slug || j.settings?.slug === slug) && !out.has(j.id)) out.set(j.id, j);
  return { jobs: [...out.values()], scope: cloud ? 'account' : 'browser' };
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

/** 작업 기록을 같은지 비교 (빈 글자·없음은 같은 것으로) */
export const sameNote = (a: JobNote = {}, b: JobNote = {}) =>
  (a.assignee ?? '') === (b.assignee ?? '') && (a.memo ?? '') === (b.memo ?? '') && !!a.test === !!b.test && (a.link ?? '') === (b.link ?? '') && (a.locked ?? null) === (b.locked ?? null); // 잠금은 없음·켬·끔(등록 작업을 직접 푼 것)을 구분

/**
 * 작업 기록(담당자·메모·테스트) 저장 — 변환 내역 「작업 정보 편집」·만들기 화면의 작업 기록 칸이 같이 쓴다 (PSD 없이, 결과에는 영향 없음).
 * 목록의 작업은 계획·결과를 뺀 가벼운 사본이라 그대로 저장하면 계정의 계획·HTML 이 지워진다 → 반드시 전체를 받은 뒤 고친다.
 * 수정 시각은 1ms 만 올린다 — 기록만 고쳤는데 목록 맨 위로 올라가지 않게, 그러면서도 다른 사본보다 새것으로 보이게
 */
export async function saveJobNote(job: Job, note: JobNote): Promise<Job> {
  const full = await fullJob(job);
  if (full.state === 'running') throw new Error('만드는 중인 작업은 끝난 뒤에 고칠 수 있습니다.');
  // 같은 기록이면 아무것도 쓰지 않는다 — 수정 시각·목록 순서가 그대로 (변환 내역에서 「저장」만 누른 경우)
  if (sameNote(full.note, note)) return full;
  const next: Job = { ...full, note, updatedAt: full.updatedAt + 1 };
  await putJob(next);
  return next;
}

/**
 * 이미지 서버에 올렸는지 기록 (at = 올린 시각, undefined = 비움) — 목록 순서가 바뀌지 않게 수정 시각은 1ms 만 올린다 (작업 기록 저장과 같음).
 * 같은 값이면 아무것도 쓰지 않는다
 */
export async function setUploaded(job: Job, at: number | undefined): Promise<Job> {
  const full = await fullJob(job);
  if (full.state === 'running' || !!full.uploadedAt === !!at) return full;
  const next: Job = { ...full, uploadedAt: at, updatedAt: full.updatedAt + 1 };
  await putJob(next);
  return next;
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
  const jobs = (await listLocal()).filter((j) => !j.deletedAt); // 휴지통 항목은 사용자가 휴지통에서 영구 삭제할 때까지 둔다
  // 계정 저장 중이면 계정에 올라간 것만 브라우저에서 정리한다 (못 올린 작업을 지우면 영영 사라짐)
  const drop = jobs.filter((j) => j.id !== keepId).slice(MAX_JOBS - 1).filter((j) => cloudOff || j.syncedAt);
  for (const j of drop) if (!pending.has(j.id)) await req((await store('jobs', 'readwrite')).delete(j.id));
  await cleanFiles();
}

async function cleanFiles() {
  // 다른 계정의 브라우저 사본 PSD 도 지키도록 계정 구분 없이 전부 본다
  const all = await req((await store('jobs')).getAll() as IDBRequest<Job[]>);
  // 휴지통으로 옮긴 지 하루가 안 된 작업의 PSD 는 남긴다 — 지운 직후 「되돌리기」·복원하면 PSD 를 다시 고르지 않고 바로 연다
  // (PSD 는 수백 MB 라 30일 내내 두지는 않는다. 하루 지나 복원하면 「PSD 고르기」로 다시 연다)
  const keepTrash = Date.now() - TRASH_KEEP_FILE_MS;
  const used = new Set(all.filter((j) => !j.deletedAt || j.deletedAt > keepTrash).map((j) => j.fileKey));
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
  a.productName === b.productName && a.channel === b.channel && a.slug === b.slug && a.rev === b.rev && a.publicRoot === b.publicRoot && (a.market ?? '') === (b.market ?? '');
/** 같은 묶음(고도몰끼리 · 오픈마켓끼리) — 구조 계획은 고도몰/오픈마켓 방식에만 달려 있어 묶음이 같으면 계획을 다시 쓸 수 있다 */
export const sameGroup = (a: Pick<GenerateMeta, 'channel'>, b: Pick<GenerateMeta, 'channel'>) => (a.channel === 'openmarket') === (b.channel === 'openmarket');

/** 판매처 하나 (채널 + 오픈마켓이면 플랫폼) */
export type Platform = { channel: Channel; market?: Market };
/** 같은 판매처 — 고도몰은 채널만, 오픈마켓은 플랫폼까지 본다 (고도몰 작업의 settings.market 은 쓰지 않는 값) */
export const samePlatform = (a: Platform, b: Platform) => a.channel === b.channel && (a.channel !== 'openmarket' || normMarket(a.market) === normMarket(b.market));
/** 판매처 이름 — 고도몰은 채널(아이티켓·온코어), 오픈마켓은 플랫폼(쿠팡·11번가). 변환 내역 배지·복제 메뉴가 같이 쓴다 */
export const platformLabel = (p: Platform) => (p.channel === 'openmarket' ? MARKETS[normMarket(p.market)].label : CHANNEL_LABEL[p.channel].replace(/\s*\(.*\)$/, ''));
/** 묶음 이름 (고도몰 · 오픈마켓) */
export const groupLabel = (c: Channel) => (c === 'openmarket' ? '오픈마켓' : '고도몰');

// ── 판매처는 작업의 고정 값 ──
// 계획을 받은 작업(meta 있음)의 판매처는 바꾸지 않는다. 같은 PSD 를 다른 판매처로 만들려면 새 작업으로 가른다(forkJob) — 원래 결과를 덮어쓰지 않게.
// 설정 자동 저장 · 다시 만들기(갈라 저장) · 화면 안내가 모두 아래 두 함수로 같은 판단을 한다

/** 지금 설정의 판매처가 이 작업의 고정 판매처와 다른가 (계획 전 작업은 아직 고정되지 않음 → false) */
export const platformMoved = (j: Pick<Job, 'meta'>, p: Platform) => !!j.meta && !samePlatform(j.meta, p);
/** 설정 자동 저장 값 — 판매처를 바꿔 놓았어도 작업에는 고정 판매처를 남긴다 (바뀐 판매처는 다시 만들 때 새 작업으로 간다) */
export const settingsToSave = (j: Pick<Job, 'meta' | 'settings'>, s: Settings): Settings =>
  platformMoved(j, s) ? { ...s, channel: j.meta!.channel, market: j.meta!.market ?? j.settings.market } : s;

/**
 * 같은 PSD 를 다른 판매처로 만들 새 작업 (변환 내역의 「복제」 · 판매처를 바꿔 다시 만들 때) — 원래 작업은 그대로 둔다.
 * 같은 묶음(고도몰끼리 · 오픈마켓끼리)이고 코드 생성 계획이 있으면 계획을 그대로 옮겨 비용 없이 다시 계산하고,
 * 묶음이 다르면 HTML 방식이 달라 계획 없이 시작한다 (「마크업 만들기」로 Claude 1회).
 * planMeta: 옮긴 계획에 붙일 설정 — 생략하면 원래 작업 것 (다시 계산할 때 generate 가 지금 설정으로 바꾼다)
 */
export function forkJob(src: Job, settings: Settings, opt: { keepPlan: boolean; planMeta?: GenerateMeta; creator?: string }): Job {
  const now = Date.now();
  const keep = opt.keepPlan && !!src.plan && !!src.meta && src.plan.bundle.plan.engine === 'code' && sameGroup(src.meta, settings);
  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    fileKey: src.fileKey,
    fileName: src.fileName,
    fileSize: src.fileSize,
    noFile: src.noFile,
    settings,
    // 복제한 사람이 새 작업을 만든 사람 (담당자·메모·테스트 표시는 그대로 옮긴다).
    // 등록한 페이지는 옮기지 않는다 — 복제본은 아직 그 판매처에 올리지 않은 새 결과
    creator: opt.creator ?? src.creator,
    note: src.note && { ...src.note, link: undefined, locked: undefined }, // 잠금도 옮기지 않는다 (복제본은 새 결과)
    state: 'ready',
    extra: src.extra,
    sections: {},
    failed: {},
    revisionCount: 0,
    ...(keep ? { plan: src.plan, meta: opt.planMeta ?? src.meta, model: src.model } : {}),
  };
}

/** 브라우저가 공간이 모자랄 때 임의로 지우지 않게 요청 (거절돼도 동작은 같다) */
export function requestPersist() {
  navigator.storage?.persist?.().catch(() => {});
}

/** 손보기 원본 표시값 — 복사 구간 HTML 의 길이 + 간단한 해시 (같은 결과인지만 가린다, 보안 용도 아님) */
export function editBase(copyHtml: string): string {
  let h = 2166136261;
  for (let i = 0; i < copyHtml.length; i++) h = Math.imul(h ^ copyHtml.charCodeAt(i), 16777619);
  return `${copyHtml.length}:${(h >>> 0).toString(36)}`;
}

/** 이 결과(복사 구간)에 맞는 저장된 손보기가 있으면 그 HTML, 없거나 결과가 바뀌었으면 null */
export const savedEditFor = (job: Pick<Job, 'edited'> | null | undefined, copyHtml: string) => (job?.edited && job.edited.base === editBase(copyHtml) ? job.edited.html : null);
