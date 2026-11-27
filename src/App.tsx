import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from './components/Button';
import type { Session } from '@supabase/supabase-js';
import { GODO_TARGET_LABEL, boardIdOk, boardLabel, pickBoard, type GenerateMeta, type HealthInfo, type PlanBundle, type PsdSummary, type SectionRequest, type UsageInfo, imageBaseUrl } from '../shared/types';
import { AUTH, CLOUD, collect, fetchHealth, isNoResponse, uploadCheck, uploadFiles, uploadTargetFor, uploadRemove, uploadVerify, type UploadedItem, type UploadTarget } from './lib/api';
import { canUse, fetchRole, supabase, type Role } from './lib/supabase';
import { bitmapToUrl, cutImages, localizeHtml, type CutImage } from './lib/images';
import { checkOutput, copySection, parsePlanOutput, parseSectionOutput, type Check, type ParsedOutput } from './lib/output';
import { fixRequest, fixScore, fmtScore, improved } from './lib/autofix';
import { assembleHtml, assembleReport, type SectionOut } from './lib/assemble';
import { generateMarkup, keepMap } from './lib/codegen';
import { measureTexts } from './lib/lsAdjust';
import { checkLayout, type LayoutResult } from './lib/layoutCheck';
import { PsdWorker } from './lib/psd/client';
import { SLUG_BLOCK, fmtBytes, kstDate, productNameFromFile, readLocal, todayRev, toSlug, writeLocal } from './lib/util';
import { busyJobIds, deleteJob, editBase, filterOn, fileKeyOf, findJobsWithHtml, savedEditFor, fullJob, jobById, jobBySlug, listInfo, listTrash, markInterruptedLocal, trashCount, trashJob, untrashJob, getFile, listJobsPage, markInterrupted, prune, putJob, requestPersist, forkJob, jobsForProduct, replacePsdJob, sameFile, sameGroup, sameMeta, samePlatform, saveFile, saveJobNote, sameNote, setUploaded, settingsToSave, platformMoved, platformLabel, savesToAccount, touchRunning, type Job, type JobFilter, type JobNote, type Platform, type PrevPlan } from './lib/jobs';
import Header, { type View } from './components/Header';
import HelpPanel from './components/HelpPanel';
import TesterPanel, { type TesterSource } from './components/TesterPanel';
import { editorFor } from './lib/editorSim';
import AdminPanel from './components/AdminPanel';
import { BUDGET_WARN_RATIO } from '../shared/ops';
import { CHANNEL_LABEL } from '../shared/types';
import { MARKETS } from '../shared/markets';
import ReplacePsdDialog from './components/ReplacePsdDialog';
import JobsPanel from './components/JobsPanel';
import SavedView from './components/SavedView';
import LoginPanel from './components/LoginPanel';
import UploadPanel from './components/UploadPanel';
import DropGuard from './components/DropGuard';
import SummaryPanel from './components/SummaryPanel';
import SettingsPanel, { type Settings } from './components/SettingsPanel';
import ResultPanel, { type UploadState } from './components/ResultPanel';
import Stepper from './components/Stepper';
import { DEFAULT_MARKET, marketWidth, normMarket } from '../shared/markets';

/** 로컬 개발 화면(yarn dev)의 자리 표시 프로필 — 배포는 로그인한 광고 인사이트 계정. 머리 프로필 메뉴 모양을 로컬에서도 보려고 */
const LOCAL_USER = { email: 'local-dev@pagefy', name: '로컬 확인용' };

export interface Loaded {
  file: File;
  summary: PsdSummary;
  composite: ImageBitmap;
  /** 글자 뺀 배경 — PSD 를 먼저 보여 주는 동안(합성 중)에는 null · '' */
  notext: ImageBitmap | null;
  compositeUrl: string;
  notextUrl: string;
}

export interface SectionProgress {
  id: string;
  name: string;
  state: 'wait' | 'run' | 'done' | 'error';
  chars: number;
  error?: string;
}

export interface RunState {
  phase: 'idle' | 'running' | 'done' | 'error';
  status: string[];
  thinking: string;
  /** 계획 단계 받은 글자 수 */
  planChars: number;
  sections: SectionProgress[];
  error?: string;
  /** 서버가 응답을 시작하지 못하고 끊김 (Claude 미실행·비용 없음) — 결과 화면이 「다시 시도」를 보여 준다 */
  noResponse?: boolean;
  usage?: UsageInfo;
  model?: string;
  /** 이번 만들기·수정 요청을 시작한 시각 (Date.now) — 소요 시간 표시용. 저장된 작업을 불러온 것엔 없음 */
  startedAt?: number;
  /** 구조 계획(Claude)을 받는 데 걸린 시간 ms — 저장된 계획으로 이어서 만들면 없음 */
  planMs?: number;
  /** 끝난 시각 (성공했을 때만) */
  endedAt?: number;
}

export interface Result {
  meta: GenerateMeta;
  baseUrl: string;
  bundle: PlanBundle;
  planReport: string;
  planRaw: string;
  sections: SectionOut[];
  parsed: ParsedOutput;
  images: CutImage[];
  previewHtml: string;
  checks: Check[];
  layout?: LayoutResult;
}

// ───── 주소(쿼리) ↔ 화면 ─────
// GitHub Pages 라 경로(/pagefy/job/…)는 새로고침하면 404 → 쿼리로 둔다
//   /pagefy/                    첫 화면
//   /pagefy/?markup=<제품 슬러그>&rev=<rev>   작업 열기 — 슬러그는 이미지 서버 폴더 이름(규칙 6-1)이라 영문이고 안 바뀐다
//                                          (새로고침해도 다시 열림 — 저장된 계획으로 다시 만들어 Claude 비용 없음)
//   … &ch=<채널>[&pf=<플랫폼>]               판매처 — 같은 제품을 고도몰·오픈마켓 플랫폼별로 따로 만들면 슬러그·rev 가 같아서 (2026-11-26)
//                                          ch 없는 예전 주소는 고도몰 작업을 먼저 연다
//   … &view=html                            PSD 없이 저장된 HTML 결과 보기
//   /pagefy/?trash                          휴지통
//   /pagefy/?job=<작업 id>                   슬러그가 없는 작업·예전 주소용
interface Route {
  markup?: string;
  rev?: string;
  /** 판매처 채널 (settings.channel) */
  ch?: string;
  /** 오픈마켓 플랫폼 (settings.market) — ch=openmarket 일 때만 */
  pf?: string;
  job?: string;
  html?: boolean;
  trash?: boolean;
}
function readRoute(): Route {
  const q = new URLSearchParams(window.location.search);
  return {
    markup: q.get('markup') || undefined,
    rev: q.get('rev') || undefined,
    ch: q.get('ch') || undefined,
    pf: q.get('pf') || undefined,
    job: q.get('job') || undefined,
    html: q.get('view') === 'html',
    trash: q.has('trash'),
  };
}
/** 메뉴 화면 (#jobs · #tester · #help · #admin) — 작업 주소(?markup=…)와 따로 움직인다 */
/** 변환 내역 한 페이지 작업 수 */
const JOB_PAGE = 20;
const VIEW_OF_HASH: Record<string, View> = { '#jobs': 'jobs', '#job': 'job', '#tester': 'tester', '#help': 'help', '#admin': 'admin' };
const viewOfHash = (): View => VIEW_OF_HASH[window.location.hash] ?? 'work';
function routeUrl(r: Route) {
  const view = r.html ? '&view=html' : '';
  const q = r.markup
    ? `?markup=${encodeURIComponent(r.markup)}${r.rev ? `&rev=${encodeURIComponent(r.rev)}` : ''}${r.ch ? `&ch=${encodeURIComponent(r.ch)}` : ''}${r.ch === 'openmarket' && r.pf ? `&pf=${encodeURIComponent(r.pf)}` : ''}${view}`
    : r.job
      ? `?job=${encodeURIComponent(r.job)}${view}`
      : r.trash
        ? '?trash'
        : '';
  return window.location.pathname + q;
}
/** 작업 → 주소 (슬러그가 있으면 슬러그·rev·판매처, 없으면 id) */
const routeOf = (j: Job, html = false): Route =>
  j.settings?.slug
    ? {
        markup: j.settings.slug,
        rev: j.settings.rev || undefined,
        ch: j.settings.channel || undefined,
        pf: j.settings.channel === 'openmarket' ? j.settings.market || undefined : undefined,
        html,
      }
    : { job: j.id, html };
/** 주소가 이 작업을 가리키는지 (ch·pf 가 없는 예전 주소는 판매처를 따지지 않는다) */
const routeIs = (r: Route, j: Job | null | undefined) =>
  !!j &&
  (r.job
    ? r.job === j.id
    : !!r.markup &&
      r.markup === j.settings?.slug &&
      (!r.rev || r.rev === j.settings.rev) &&
      (!r.ch || r.ch === j.settings.channel) &&
      (r.ch !== 'openmarket' || !r.pf || r.pf === j.settings.market));

/** 마지막으로 확인한 권한 (계정 id 와 함께) — 다음 접속 때 화면을 바로 열기 위함 */
const ROLE_KEY = 'pagefy.role';
/** 계획 요청에 보낼 타일 이미지 합계 상한 (base64 글자 수) — core/validate.ts 의 MAX_TILE_B64 와 같게 (Claude API 요청 한도 32MB) */
const MAX_TILE_B64 = 24 * 1024 * 1024;
/** 너무 크면 보내기 전에 막는다 (수십 MB 를 올린 뒤에야 거절되지 않게) */
function checkTileSize(tiles: { data: string }[]) {
  const total = tiles.reduce((n, t) => n + t.data.length, 0);
  if (total > MAX_TILE_B64)
    throw new Error(`PSD 가 너무 길거나 사진이 많아 한 번에 보낼 수 없습니다 (이미지 ${(total / 1048576).toFixed(0)}MB, 한도 ${MAX_TILE_B64 / 1048576}MB). PSD 를 두 개로 나눠서 만들어 주세요.`);
}
const DEFAULT_PUBLIC_ROOT = 'https://itketweb.hgodo.com/data/detail';
/** 섹션을 동시에 몇 개씩 만들지 (API 요청 한도 고려) */
const CONCURRENCY = 4;

const emptyRun = (): RunState => ({ phase: 'idle', status: [], thinking: '', planChars: 0, sections: [] });

function addUsage(a: UsageInfo | undefined, b: UsageInfo | undefined): UsageInfo | undefined {
  if (!b) return a;
  if (!a) return b;
  return { input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite, costUsd: Math.round((a.costUsd + b.costUsd) * 1000) / 1000 };
}

/** 생성하는 동안 "이 작업은 살아 있음" 표시 — 다른 탭이 새로 열릴 때 중단됨으로 잘못 바꾸지 않게 (jobs.markInterrupted) */
function holdLock(jobId: string) {
  let release = () => {};
  const p = new Promise<void>((r) => (release = r));
  navigator.locks?.request(`pagefy-job-${jobId}`, () => p).catch(() => {});
  // 다른 PC·브라우저용 생성 중 표시(계정 저장)를 1분마다 연장 — 끊기면 3분 뒤 풀린다
  const beat = window.setInterval(() => touchRunning(jobId).catch(() => {}), 60_000);
  return () => {
    window.clearInterval(beat);
    release();
  };
}

/** 멈춘 뒤에도 '작성 중'으로 남지 않게 — 끝나지 않은 섹션은 대기로 되돌린다 */
const stopRunning = (secs: SectionProgress[]) => secs.map((s) => (s.state === 'run' ? { ...s, state: 'wait' as const, chars: 0 } : s));

const failedSection = (s: { id: string; name: string }, msg: string): SectionOut => ({ id: s.id, name: s.name, html: '', css: '', notes: `생성 실패: ${msg}`, raw: '' });

/** 작업들을 n 개씩 동시에 */
async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    for (let it = queue.shift(); it !== undefined; it = queue.shift()) await fn(it);
  }));
}

/**
 * 첫 작업이 응답을 받기 시작한 뒤에 나머지를 시작한다 — 섹션 요청은 규칙·계획이 같은 앞부분을 공유하므로
 * 첫 요청이 프롬프트 캐시를 만든 뒤에 보내면 나머지는 캐시를 읽는다 (동시에 보내면 캐시를 n 번 새로 씀)
 */
async function poolWarm<T>(items: T[], n: number, fn: (item: T, onStart: () => void) => Promise<void>) {
  if (items.length < 2 || n < 2) return pool(items, n, (it) => fn(it, () => {}));
  const [first, ...rest] = items;
  let go = () => {};
  const started = new Promise<void>((r) => (go = r));
  const firstRun = fn(first, go).finally(go);
  await started;
  await Promise.all([firstRun, pool(rest, n - 1, (it) => fn(it, () => {}))]);
}

const BUSY_MSG = '다른 탭(창)이나 다른 PC에서 이 작업을 만들고 있습니다. 그곳에서 이어서 보거나, 끝난 뒤 다시 시도하세요. (그쪽 창을 닫았다면 3분 뒤 다시 할 수 있습니다)';

export default function App() {
  // 로그인 (배포, 또는 개발 중 VITE_PAGEFY_LOGIN=1 — 광고 인사이트 계정)
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!AUTH);
  /** 만든 사람 — 작업에 남기는 이름 (광고 인사이트 계정 이름, 없으면 이메일 앞부분). 로컬 개발은 확인용 이름 */
  const me = AUTH ? (session ? session.user.user_metadata?.name || session.user.email?.split('@')[0] : undefined) : LOCAL_USER.name;
  const [role, setRole] = useState<Role | null>(AUTH ? null : 'admin');

  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const workerRef = useRef<PsdWorker | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  /** 저장된 작업을 여는 중 — ② 화면에서 설정 칸 대신 파일 카드의 불러오기 진행만 보인다 (열자마자 설정이 펼쳐졌다 사라지지 않게) */
  const [restoring, setRestoring] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [settings, setSettings] = useState<Settings>(() => ({
    productName: '',
    channel: readLocal('pagefy.channel', 'itket'),
    market: normMarket(readLocal<string>('pagefy.market', DEFAULT_MARKET)),
    slug: '',
    rev: todayRev(),
    publicRoot: readLocal('pagefy.publicRoot', DEFAULT_PUBLIC_ROOT),
    extra: '',
  }));
  /** 지금 작업의 기록 (담당자·메모·테스트) — 설정과 따로 작업의 note 에 저장. 새 PSD 는 빈 기록으로 시작한다 (담당자도 이어 쓰지 않음, 사용자 지시 2026-11-27) */
  const [note, setNote] = useState<JobNote>({});
  const [run, setRun] = useState<RunState>(emptyRun);
  const [result, setResult] = useState<Result | null>(null);
  /** PSD 원본 없이 보는 저장된 결과 */
  const [viewJob, setViewJob] = useState<Job | null>(null);
  /** 메뉴 화면. 만들기 화면은 숨기기만 하고 그대로 둔다 (도움말을 보고 와도 작업·결과가 그대로) */
  const [view, setViewState] = useState<View>(viewOfHash);
  /** 목록 읽기(refreshJobs)가 지금 화면을 알도록 — 거르기는 변환 내역 화면에서만 건다 */
  const viewRef = useRef(view);
  viewRef.current = view;
  const setView = (v: View) => {
    if (v === view) return;
    // 작업 페이지(변환 내역에서 연 작업)에서 「만들기」로 가면 새 PSD 올리기 화면 — 연 작업은 닫는다 (변환 내역에 저장돼 있어 다시 열 수 있음).
    // 만드는 중·읽는 중에는 잃지 않게 그대로 둔다 (goHome 과 같은 기준)
    const leaveJob = view === 'job' && v === 'work' && !running && !loading;
    if (leaveJob) {
      closeCurrent();
      setViewJob(null);
    }
    window.history.pushState(null, '', window.location.pathname + (leaveJob ? '' : window.location.search) + (v === 'work' ? '' : `#${v}`));
    setViewState(v);
    window.scrollTo({ top: 0 });
  };
  const [revisionCount, setRevisionCount] = useState(0);
  /** 「문제 자동 수정」 결과 안내 (나아져서 바꿈 / 나아지지 않아 이전 결과 유지) — 새로 만들거나 다른 PSD 를 열면 지운다 */
  const [autoFix, setAutoFix] = useState<{ ok: boolean; text: string } | null>(null);
  // 이미지 서버 업로드 진행 (결과가 바뀌면 처음 상태로)
  const [upload, setUpload] = useState<UploadState>({ phase: 'idle', done: 0, total: 0 });
  const uploadRunRef = useRef(0);
  const uploadAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    // 결과가 바뀌면(수정·새 rev·다른 작업) 진행 중 업로드를 멈추고 처음 상태로
    const runId = ++uploadRunRef.current;
    uploadAbortRef.current?.abort();
    setUpload({ phase: 'idle', done: 0, total: 0 });
    // 다시 연 작업: 이미지 서버 제품 폴더에 이 결과 이미지가 이름·크기 모두 같게 있으면 「올려 둔 상태」로 보여 준다 (표시용 —
    // 「HTML 복사」를 누르면 내용(SHA-256)을 다시 확인해 다른 것만 덮어쓰기 확인 후 올린다). 조용히 확인하고 실패해도 화면은 그대로
    const r = result;
    if (!r || !health?.upload || r.bundle.plan.engine !== 'code' || !r.images.length) return;
    const ac = new AbortController();
    uploadAbortRef.current = ac;
    (async () => {
      const remote = await uploadCheck(uploadTargetOf(r), ac.signal);
      if (runId !== uploadRunRef.current || ac.signal.aborted || !remote.exists) return;
      const sizes = new Map(remote.files.map((f) => [f.file, f.size]));
      const all = r.images.every((im) => sizes.get(im.file) === im.blob.size);
      if (all) setUpload({ phase: 'done', done: r.images.length, total: r.images.length, restored: true });
      // 서버에 다 있는데 기록이 없으면(예전 작업) 기록해 둔다 — 변환 내역에서 「완료」로 보이게
      const cur = jobRef.current;
      if (all && cur && !cur.uploadedAt)
        setUploaded(cur, Date.now())
          .then((j) => {
            if (jobRef.current?.id === j.id) jobRef.current = j;
            refreshJobs(true);
          })
          .catch(() => {});
    })().catch(() => {});
  }, [result?.baseUrl, result?.images, health?.upload]);
  const abortRef = useRef<AbortController | null>(null);
  // 작업 목록 (IndexedDB) — 화면에 보이는 목록과, 지금 열린 작업의 최신본
  const [jobs, setJobs] = useState<Job[]>([]);
  const jobRef = useRef<Job | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  // 비동기 함수 안에서 최신 PSD·잘라 둔 이미지를 쓰기 위해
  const loadedRef = useRef<Loaded | null>(null);
  /** PSD 열기 순번 — 늦게 끝난 이전 열기를 버린다 */
  const openSeq = useRef(0);
  const cutRef = useRef<{ images: CutImage[]; errors: string[] } | null>(null);
  /** 잘라 둔 이미지를 바꾸거나 버릴 때 이전 미리보기 주소(blob URL)를 놓는다 */
  const setCut = (cut: { images: CutImage[]; errors: string[] } | null) => {
    if (cutRef.current && cutRef.current !== cut) for (const im of cutRef.current.images) URL.revokeObjectURL(im.url);
    cutRef.current = cut;
  };
  const dropCut = () => setCut(null);

  // 작업 목록: 계정 저장이면 최근 20개씩 ("더 보기"로 늘림). quick = 방금 저장한 것만 반영 (계정을 다시 읽지 않음)
  const [moreJobs, setMoreJobs] = useState(false);
  const jobLimitRef = useRef(20);
  // 변환 내역 페이지 (0부터) · 거르기에 맞는 전체 개수 — 한 페이지 JOB_PAGE 개. 만들기 화면의 「최근 작업」은 늘 첫 페이지
  const jobPageRef = useRef(0);
  const [jobPage, setJobPage] = useState(0);
  const [jobsTotal, setJobsTotal] = useState<number | undefined>(undefined);
  // 계정에서 목록을 읽는 동안 (처음 열 때·더 보기) 작업 목록에 불러오는 중 표시. quick 은 브라우저 사본만 합쳐 금방 끝나 표시하지 않는다
  const [jobsLoading, setJobsLoading] = useState(true);
  // 휴지통: 열면 목록(trash), 닫혀 있으면 null. 개수는 최근 작업 머리에 표시
  const [trash, setTrash] = useState<Job[] | null>(null);
  const [trashN, setTrashN] = useState(0);
  const [trashLoading, setTrashLoading] = useState(false);
  const refreshTrashN = () => trashCount().then(setTrashN, () => {});
  async function openTrash() {
    setTrash((t) => t ?? []);
    setTrashLoading(true);
    try {
      const list = await listTrash();
      setTrash(list);
      setTrashN(list.length);
    } catch (e) {
      console.warn('[jobs] 휴지통', e);
    } finally {
      setTrashLoading(false);
    }
  }
  async function restoreFromTrash(ids: string | string[]) {
    try {
      for (const id of Array.isArray(ids) ? ids : [ids]) await untrashJob(id);
    } catch (e) {
      setLoadError((e as Error).message);
    }
    // 휴지통 화면에서 복원하면 휴지통을 다시 읽고, 목록의 「되돌리기」(지운 직후 알림)면 목록에 머문다
    if (trash) await openTrash();
    else refreshTrashN();
    refreshJobs();
  }
  /** 휴지통에서 영구 삭제 (여러 개) — 이미지 서버 정리는 휴지통 화면의 확인 창에서 먼저 한다 */
  async function purgeFromTrash(ids: string[]) {
    for (const id of ids) await deleteJob(id).catch((e) => setLoadError(`영구 삭제하지 못했습니다 (${(e as Error).message})`));
    await openTrash();
  }
  // 늦게 끝난 옛 요청이 새 목록을 덮지 않게 순번을 매긴다 (불러오는 중 표시는 마지막 전체 읽기가 끝날 때 끈다)
  const listSeq = useRef(0);
  const fullSeq = useRef(0);
  const refreshJobs = (quick = false) => {
    const seq = ++listSeq.current;
    const full = quick ? 0 : ++fullSeq.current;
    if (!quick) setJobsLoading(true);
    const inJobs = viewRef.current === 'jobs';
    const page = inJobs ? jobPageRef.current : 0;
    const show = (p: { jobs: Job[]; more: boolean; total?: number }) => {
      if (seq !== listSeq.current) return;
      // 지우거나 거른 뒤 지금 페이지가 비면 마지막 페이지로 (빈 페이지에 머물지 않게)
      if (inJobs && page > 0 && !p.jobs.length && p.total !== undefined) {
        const last = Math.max(0, Math.ceil(p.total / JOB_PAGE) - 1);
        if (last < page) {
          jobPageRef.current = last;
          setJobPage(last);
          refreshJobs();
          return;
        }
      }
      setJobs(p.jobs);
      setMoreJobs(p.more);
      setJobsTotal(p.total);
    };
    // 만들기 화면의 「최근 작업」은 거르기 없이 최근 것부터 (변환 내역 화면에서 걸어 둔 조건이 5건 목록에 걸리지 않게)
    return listJobsPage(inJobs ? JOB_PAGE : jobLimitRef.current, quick, show, inJobs ? jobFilterRef.current : {}, page * JOB_PAGE)
      .then(show, (e) => console.warn('[jobs]', e))
      .finally(() => full && full === fullSeq.current && setJobsLoading(false));
  };
  const showMoreJobs = () => {
    jobLimitRef.current += 20;
    refreshJobs();
  };
  /** 변환 내역 페이지 이동 — 목록 맨 위(거르기 줄)로 올린다 */
  const goJobPage = (n: number) => {
    jobPageRef.current = n;
    setJobPage(n);
    refreshJobs();
    requestAnimationFrame(() => document.querySelector('.jobs')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  };
  // 변환 내역 거르기 (채널·플랫폼·상태·기간·검색) — 바꾸면 처음 20개부터 다시 읽는다
  const [jobFilter, setJobFilterState] = useState<JobFilter>({});
  const jobFilterRef = useRef<JobFilter>({});
  const setJobFilter = (f: JobFilter) => {
    jobFilterRef.current = f;
    setJobFilterState(f);
    jobLimitRef.current = 20;
    jobPageRef.current = 0;
    setJobPage(0);
    refreshJobs();
  };
  const showJobs = jobs.length > 0 || jobsLoading || trashN > 0 || !!trash || filterOn(jobFilter);
  // 변환 내역 화면에 들어가고 나올 때 목록을 다시 읽는다 (거르기 조건을 걸고/빼고, 처음 20개부터)
  const prevView = useRef(view);
  useEffect(() => {
    const was = prevView.current;
    prevView.current = view;
    if ((was === 'jobs') === (view === 'jobs') || !allowed) return;
    jobLimitRef.current = 20;
    jobPageRef.current = 0;
    setJobPage(0);
    refreshJobs();
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps
  // 변환 내역에 들어가면 목록이 다 그려진 뒤 맨 위로 — 들어가자마자 살짝 내려간 채로 열리던 문제 (2026-11-26).
  // 브라우저의 스크롤 복원(뒤로 가기·새로고침 때 예전 위치로)이 목록이 늦게 그려지는 동안 끼어들 수 있어 끄고, 화면이 직접 맨 위로 둔다.
  // 거르기·페이지 이동으로 다시 읽을 때는 올리지 않는다 (들어온 직후 한 번만)
  useEffect(() => {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
  }, []);
  // 0 = 할 일 없음 · 1 = 막 들어옴(읽기 시작 기다림) · 2 = 읽는 중 → 읽기가 끝나면 맨 위로
  const enteredJobs = useRef<0 | 1 | 2>(0);
  const prevJobsView = useRef(view);
  useEffect(() => {
    const entered = view === 'jobs' && prevJobsView.current !== 'jobs';
    prevJobsView.current = view;
    if (view !== 'jobs') {
      enteredJobs.current = 0;
      return;
    }
    if (entered) enteredJobs.current = 1;
    if (enteredJobs.current === 1 && jobsLoading) enteredJobs.current = 2;
    else if (enteredJobs.current === 2 && !jobsLoading) {
      enteredJobs.current = 0;
      requestAnimationFrame(() => window.scrollTo({ top: 0 }));
    }
  }, [view, jobsLoading]);
  // 화면(만들기·변환 내역 등)을 바꾸면 보던 저장 결과는 닫는다 — 두 화면에 같이 남지 않게.
  // 작업 페이지로 들어갈 때는 닫지 않는다 (목록에서 고른 저장 결과를 그 페이지에서 연다)
  useEffect(() => {
    if (view !== 'job') setViewJob(null);
  }, [view]);
  // 예전 작업(올린 기록 없음): 변환 내역의 지금 페이지에서만, 이미지 서버의 그 제품 폴더에 파일이 있으면 「올림」으로 기록한다.
  // 결과 이미지 목록이 목록 사본에는 없어 폴더에 파일이 있는지로 본다 (근사). 작업마다 한 번만 확인 (이 화면을 연 동안)
  const uploadChecked = useRef(new Set<string>());
  useEffect(() => {
    if (view !== 'jobs' || !health?.upload) return;
    const todo = jobs.filter((j) => j.state === 'done' && !j.uploadedAt && j.settings?.slug && !uploadChecked.current.has(j.id));
    if (!todo.length) return;
    for (const j of todo) uploadChecked.current.add(j.id);
    let stop = false;
    (async () => {
      let marked = 0;
      for (const j of todo) {
        if (stop) return;
        const s = j.settings;
        const target: UploadTarget = uploadTargetFor(s);
        try {
          const remote = await uploadCheck(target);
          if (remote.exists && remote.files.length) {
            await setUploaded(j, Date.now());
            marked++;
          }
        } catch {
          // 확인 못 하면 그대로 (「올리기 전」)
        }
      }
      if (marked && !stop) refreshJobs(true);
    })();
    return () => {
      stop = true;
    };
  }, [jobs, view, health?.upload]); // eslint-disable-line react-hooks/exhaustive-deps
  /** 지금 작업을 고쳐 저장 (섹션이 동시에 끝나도 ref 에서 이어 붙여 잃지 않는다) */
  function updateJob(patch: Partial<Job> | ((j: Job) => Partial<Job>)) {
    const cur = jobRef.current;
    if (!cur) return;
    const add = typeof patch === 'function' ? patch(cur) : patch;
    // 바뀐 게 없으면 저장하지 않는다 — 작업을 열거나 설정이 그대로 다시 적힐 때 수정 시각이 올라가 목록 맨 위로 가는 것을 막는다
    const same = Object.keys(add).every((k) => JSON.stringify((cur as unknown as Record<string, unknown>)[k]) === JSON.stringify((add as unknown as Record<string, unknown>)[k]));
    if (same) return;
    const next = { ...cur, ...add, updatedAt: Date.now() };
    jobRef.current = next;
    putJob(next).then(() => refreshJobs(true), (e) => console.warn('[jobs] 저장 실패', e));
  }

  useEffect(() => {
    if (!AUTH) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    // 로그인 상태를 읽기 전(authReady 전)에는 판정하지 않는다 — 안 그러면 첫 화면에 몇 초간 "승인된 계정만" 안내가 잘못 뜬다
    if (!AUTH || !authReady) return;
    // 약 1시간마다 토큰이 갱신될 때 role 을 null 로 비우면 작업 화면이 로그인 화면으로 바뀌어 결과가 사라진다 → 확인이 끝날 때까지 이전 역할 유지
    // 확인 요청이 잠깐 실패(null)하면, 이미 승인된 역할이 있었을 때는 그대로 둔다 (처음 확인일 때만 invalid)
    // 권한 확인(구글 Apps Script)은 1~3초 걸린다 → 이 계정이 지난번에 승인돼 있었으면 그 역할로 먼저 화면을 열고, 확인 결과로 바로잡는다
    // (화면만 먼저 여는 것 — 생성·저장 요청은 서버·DB 가 매번 권한을 다시 확인한다)
    if (session) {
      const uid = session.user.id;
      const cached = readLocal<{ uid: string; role: Role } | null>(ROLE_KEY, null);
      if (cached?.uid === uid && canUse(cached.role)) setRole((prev) => prev ?? cached.role);
      fetchRole(session.access_token).then((r) => {
        setRole((prev) => r ?? (canUse(prev) ? prev : 'invalid'));
        if (r) writeLocal(ROLE_KEY, { uid, role: r });
      });
    } else setRole('guest');
  }, [authReady, session?.access_token]); // eslint-disable-line react-hooks/exhaustive-deps

  const allowed = canUse(role);
  useEffect(() => {
    if (!allowed) return;
    fetchHealth().then(setHealth, (e) => setHealthError(CLOUD ? `생성 서버 확인 실패: ${e.message}` : `API 서버에 연결하지 못했습니다 (${e.message}). yarn dev 로 켰는지 확인하세요.`));
  }, [allowed]);

  useEffect(() => () => workerRef.current?.dispose(), []);
  useEffect(() => {
    writeLocal('pagefy.channel', settings.channel);
    writeLocal('pagefy.market', settings.market);
    writeLocal('pagefy.publicRoot', settings.publicRoot);
  }, [settings.channel, settings.market, settings.publicRoot]);

  // 작업 목록 불러오기 — 새로고침으로 끊긴 작업은 "중단됨"
  useEffect(() => {
    if (!allowed) return;
    requestPersist();
    // 브라우저 사본의 끊긴 작업 표시(금방 끝남) → 목록. 계정 쪽 끊긴 작업 표시는 따로 (바뀐 게 있을 때만 목록을 한 번 더 맞춘다)
    markInterruptedLocal()
      .catch(() => {})
      .finally(() => refreshJobs().then(refreshTrashN));
    markInterrupted().then(
      (changed) => {
        if (changed) refreshJobs(true);
      },
      () => {},
    );
  }, [allowed]); // eslint-disable-line react-hooks/exhaustive-deps

  // 설정을 바꾸면 작업에도 저장 (입력 중엔 잠깐 기다렸다가) — 판매처는 작업의 고정 값이라 그대로 둔다 (settingsToSave, lib/jobs.ts)
  useEffect(() => {
    const j = jobRef.current;
    if (!j || j.id !== jobId) return;
    const t = setTimeout(() => updateJob((cur) => ({ settings: settingsToSave(cur, settings) })), 500);
    return () => clearTimeout(t);
  }, [settings, jobId]); // eslint-disable-line react-hooks/exhaustive-deps
  // 작업 기록도 따로 저장 — 이미 같은 값이면 쓰지 않는다 (작업을 열 때마다 수정 시각이 바뀌지 않게)
  useEffect(() => {
    const j = jobRef.current;
    if (!j || j.id !== jobId || sameNote(j.note, note)) return;
    const t = setTimeout(() => updateJob({ note }), 500);
    return () => clearTimeout(t);
  }, [note, jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  const running = run.phase === 'running';
  // 생성이 끝날 때마다 이번 달 사용액(상한 경고)을 다시 읽는다
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running && allowed) fetchHealth().then(setHealth, () => {});
    wasRunning.current = running;
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  // 생성 중에 새로고침·닫기를 누르면 브라우저가 한 번 묻는다
  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [running]);

  /** 저장된 작업 열기: PSD 를 다시 읽고 계획·완료한 섹션을 되살린다 (API 호출 없음) */
  // picked: 다른 PC 등 이 브라우저에 PSD 원본이 없을 때 사용자가 고른 PSD
  async function openJob(job: Job, picked?: File) {
    if (loading || running) return;
    // 여는 동안(②)은 설정 칸을 펼치지 않고 파일 카드의 불러오기 진행만 — 단계 표시는 실제 진행대로 ②→③→④ (2026-11-25 의견)
    setRestoring(true);
    try {
      await openJobInner(job, picked);
    } finally {
      setRestoring(false);
    }
  }
  async function openJobInner(job: Job, picked?: File) {
    // 계정에서 작업 전체를 받는 동안에도 다른 버튼을 막는다 (두 번 눌러 둘이 동시에 열리지 않게)
    setLoading('작업 불러오는 중…');
    try {
      job = await fullJob(job);
    } catch (e) {
      setLoading(null);
      setLoadError((e as Error).message);
      return;
    }
    let file = picked ?? (await getFile(job.fileKey).catch(() => undefined));
    if (!file) {
      setLoading(null);
      setLoadError('이 작업의 PSD 원본이 이 브라우저에 없습니다. 변환 이력의 「PSD 선택」로 같은 PSD를 골라 주세요.');
      return;
    }
    if (picked) {
      if (!sameFile(job, picked)) {
        setLoading(null);
        setLoadError(`고른 파일이 이 작업의 PSD와 다릅니다 (작업: ${job.fileName}, ${fmtBytes(job.fileSize)} / 고른 파일: ${picked.name}, ${fmtBytes(picked.size)}).`);
        return;
      }
      // 이 브라우저에 PSD 를 저장하고, 수정 시각이 달라 키가 바뀌었으면 작업에도 새 키를 적는다
      await saveFile(picked);
      const key = fileKeyOf(picked);
      if (key !== job.fileKey) {
        job = { ...job, fileKey: key, updatedAt: Date.now() };
        await putJob(job).catch(() => {});
      }
      file = picked;
    }
    await openPsd(file, job);
  }

  /** 변환 내역 「⋯ → 작업 정보 편집」 저장 (담당자·메모·테스트) — 어느 작업이든 같은 저장. 지금 열린 작업이면 화면의 작업 기록 칸도 맞춘다 */
  async function editJobNote(job: Job, n: JobNote) {
    const open = jobRef.current?.id === job.id;
    const saved = await saveJobNote(open ? jobRef.current! : job, n);
    if (open && jobRef.current?.id === job.id) {
      jobRef.current = saved;
      setNote(n);
    }
    refreshJobs(true);
  }

  /**
   * 「PSD 교체」: 같은 작업에 디자인을 고친 PSD 를 넣고 연다 (2026-11-27). 설정·작업 기록은 그대로, 옛 계획·결과는 비운다 (replacePsdJob).
   * 새 PSD 로 「마크업 만들기」를 누르면 계획부터 다시 만든다
   */
  async function replacePsd(job: Job, file: File) {
    if (loading || running) return;
    let src: Job;
    try {
      // 지금 열린 작업이면 화면의 최신 사본 (방금 고친 설정·기록이 아직 계정에 안 올라갔을 수 있음)
      src = jobRef.current?.id === job.id ? { ...jobRef.current, settings: settingsToSave(jobRef.current, settings), note } : await fullJob(job);
    } catch (e) {
      setLoadError((e as Error).message);
      return;
    }
    if (src.state === 'running' || (await busyJobIds()).has(src.id)) {
      setLoadError('만드는 중인 작업은 PSD 를 바꿀 수 없습니다. 끝나거나 멈춘 뒤에 다시 해 주세요.');
      return;
    }
    const nj = replacePsdJob(src, file);
    try {
      await putJob(nj);
    } catch (e) {
      setLoadError(`PSD 를 바꾸지 못했습니다: ${(e as Error).message}`);
      return;
    }
    // PSD 원본은 이 브라우저에 — 저장한 뒤 정리(prune)로 쓰는 작업이 없어진 옛 PSD 사본(수백 MB)을 바로 치운다
    saveFile(file)
      .then((ok) => (ok ? prune(nj.id).then(() => refreshJobs(true)) : jobRef.current?.id === nj.id && updateJob({ noFile: true })))
      .catch((e) => console.warn('[jobs]', e));
    refreshJobs(true);
    await openPsd(file, nj);
  }

  /** 새 PSD 를 올리면 같은 제품명의 작업이 있는지 먼저 본다 — 있으면 「기존 작업의 PSD 교체 / 새 작업」을 묻는다 */
  const [swapAsk, setSwapAsk] = useState<{ file: File; jobs: Job[] } | null>(null);
  async function pickPsd(file: File) {
    if (loading || running) return;
    const found = await jobsForProduct(productNameFromFile(file.name)).catch(() => [] as Job[]);
    if (found.length) setSwapAsk({ file, jobs: found });
    else await openPsd(file);
  }

  /** 변환 내역의 「복제」: 같은 PSD 로 다른 판매처용 새 작업을 만들어 연다 (원래 작업은 그대로) */
  async function copyToPlatform(job: Job, to: Platform) {
    if (loading || running) return;
    let src: Job;
    try {
      src = await fullJob(job);
    } catch (e) {
      setLoadError((e as Error).message);
      return;
    }
    const settings: Settings = { ...src.settings, channel: to.channel, market: to.channel === 'openmarket' ? normMarket(to.market) : normMarket(src.settings.market) };
    // 같은 묶음이면 계획을 옮기고 설정만 새 판매처로 → 열자마자 비용 없이 그 판매처 마크업이 계산된다
    // 올릴 곳(게시판)은 고도몰끼리만 따라간다 — 오픈마켓에는 게시판이 없다
    const planMeta: GenerateMeta | undefined = src.meta && { ...src.meta, channel: to.channel, market: to.channel === 'openmarket' ? settings.market : undefined, target: to.channel === 'openmarket' ? undefined : src.meta.target, board: to.channel === 'openmarket' ? undefined : src.meta.board };
    const nj = forkJob(src, settings, { keepPlan: true, planMeta, creator: me });
    await putJob(nj).catch((e) => console.warn('[jobs]', e));
    refreshJobs(true);
    // 같은 PSD 가 이미 열려 있으면 다시 읽지 않는다 (수십~수백 MB PSD 를 또 풀고 문서 크기 비트맵을 새로 만드는 데 몇 초) — 결과만 비우고 새 작업으로 바꿔 끼운다
    const L = loadedRef.current;
    if (L && sameFile(nj, L.file)) {
      setViewJob(null);
      setLoadError(null);
      setResult(null);
      setRevisionCount(0);
      setAutoFix(null);
      setRun(emptyRun());
      jobRef.current = nj;
      setJobId(nj.id);
      setSettings({ ...nj.settings, market: normMarket(nj.settings.market) });
      setNote(nj.note ?? {});
      // 여는 동안 설정 칸을 펼치지 않는다 (openJob 과 같게)
      setRestoring(true);
      try {
        await restoreJob(nj);
      } finally {
        setRestoring(false);
      }
      return;
    }
    await openJob(nj);
  }

  async function showSaved(job: Job) {
    try {
      job = await fullJob(job);
    } catch (e) {
      setLoadError((e as Error).message);
      return;
    }
    setViewJob(job);
    requestAnimationFrame(() => document.querySelector(".saved")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  // PSD 없이 연 저장 결과의 「수정」 저장 — 작업(edited)에 남기고 화면도 바로 맞춘다 (복사 구간 기준 editBase, 결과 화면 saveEdit 과 같은 규칙)
  const saveViewEdit = (html: string | null) => {
    if (!viewJob) return;
    const next: Job = { ...viewJob, edited: html ? { html, base: editBase(copySection(viewJob.html ?? '')), at: Date.now() } : undefined, updatedAt: Date.now() };
    setViewJob(next);
    putJob(next).then(() => refreshJobs(true), (e) => console.warn('[jobs] 저장 실패', e));
  };

  async function restoreJob(job: Job) {
    if (!job.plan || !job.meta) {
      if (job.state === 'stopped' || job.state === 'error')
        setRun({ ...emptyRun(), phase: 'error', usage: job.usage, model: job.model, error: job.state === 'stopped' ? '계획을 받는 중에 중단된 작업입니다. 「마크업 만들기」로 다시 만드세요.' : job.error });
      return;
    }
    setLoading('저장된 작업 불러오는 중…');
    if (job.plan.bundle.plan.engine === 'code') {
      // 코드 생성 방식은 계획만 있으면 마크업을 다시 만들 수 있다 (API 호출 없음)
      setRun({ ...emptyRun(), phase: 'running', usage: job.usage, model: job.model, status: ['저장된 구조 계획으로 마크업을 다시 만듭니다.'] });
      try {
        // 이미지 주소는 지금 규칙(날짜 폴더 없음, 6-1)으로 다시 만든다 — 예전 작업은 .../<슬러그>/<rev> 로 저장돼 있다
        const base = imageBaseUrl(job.meta);
        await buildFromPlan(job.meta, base, job.plan.bundle, job.plan.report, job.plan.raw);
        setRevisionCount(job.revisionCount);
        setRun((r) => ({ ...r, phase: 'done' }));
        if (job.state !== 'done' || job.baseUrl !== base) updateJob({ state: 'done', error: undefined, baseUrl: base });
      } catch (e) {
        setRun((r) => ({ ...r, phase: 'error', error: (e as Error).message }));
      }
      return;
    }
    const secs = job.plan.bundle.plan.sections;
    const cut = await cutImages(job.plan.bundle.plan, workerRef.current!);
    setCut(cut);
    const missing = secs.filter((s) => !job.sections[s.id]);
    const sections = secs.map((s) => ({ id: s.id, name: s.name, state: job.sections[s.id] ? 'done' : job.failed[s.id] ? 'error' : 'wait', chars: job.sections[s.id]?.raw.length ?? 0, error: job.failed[s.id] }) as SectionProgress);
    if (job.state === 'done' || !missing.length) {
      const checks: Check[] = [
        ...cut.errors.map((msg) => ({ level: 'error', message: `이미지 자르기 실패 ${msg}` }) as Check),
        ...missing.map((s) => ({ level: 'error', message: `${s.id} ${s.name} 생성 실패: ${job.failed[s.id] ?? '저장된 결과 없음'} — 해당 섹션을 골라 "수정 요청"으로 다시 만드세요.` }) as Check),
      ];
      setRun({ ...emptyRun(), phase: 'running', usage: job.usage, model: job.model, sections, status: ['저장된 작업을 불러왔습니다.'] });
      await finalize(job.meta, job.baseUrl!, job.plan.bundle, job.plan.report, job.plan.raw, secs.map((s) => job.sections[s.id] ?? failedSection(s, job.failed[s.id] ?? '저장된 결과 없음')), cut.images, checks);
      setRevisionCount(job.revisionCount);
      setRun((r) => ({ ...r, phase: 'done' }));
      if (job.state !== 'done') updateJob({ state: 'done' });
    } else {
      setRun({
        ...emptyRun(),
        phase: 'error',
        usage: job.usage,
        model: job.model,
        sections,
        status: [`저장된 작업: 계획 완료, 섹션 ${secs.length - missing.length}/${secs.length}개 완료`],
        error: `${job.state === 'stopped' ? '중간에 끊긴 작업입니다 (새로고침·창 닫기 등). ' : job.error ? `${job.error} ` : ''}「이어서 만들기」를 누르면 남은 섹션 ${missing.length}개만 만듭니다.`,
      });
    }
  }

  /**
   * 새 작업으로 저장 (PSD 원본은 뒤에서 천천히). 기록은 n — 없으면 빈 기록 (freshNote).
   * 로컬에서 로그인해 MOCK(가짜 결과)으로 만든 작업은 배포 화면과 같은 계정 표에 쌓이므로 「테스트」로 표시해 둔다 (변환 내역 「테스트 제외」로 걸러짐)
   */
  /** 새 PSD 의 작업 기록 — 이전 작업의 담당자·메모를 가져오지 않는다 (2026-11-27). 로컬 MOCK 으로 계정에 쌓이는 작업만 「테스트」 표시 */
  const freshNote = (): JobNote => (AUTH && !CLOUD && health?.mock ? { test: true, memo: '로컬 MOCK' } : {});
  function newJob(file: File, s: Settings, n: JobNote = freshNote()) {
    const now = Date.now();
    const nj: Job = { id: crypto.randomUUID(), createdAt: now, updatedAt: now, fileKey: fileKeyOf(file), fileName: file.name, fileSize: file.size, settings: s, creator: me, note: n, state: 'ready', sections: {}, failed: {}, revisionCount: 0 };
    setNote(n);
    jobRef.current = nj;
    setJobId(nj.id);
    putJob(nj)
      .then(() => prune(nj.id))
      .then(() => refreshJobs(true))
      .then(() => saveFile(file))
      // 저장되면 목록의 「이 PC에 PSD 없음」 표시를 바로 지운다 (안 하면 다음 새로고침까지 남음)
      .then((ok) => (ok ? refreshJobs(true) : updateJob({ noFile: true })))
      .catch((e) => console.warn('[jobs]', e));
  }

  /** 지금 연 PSD·결과를 닫는다 (메모리도 바로 놓음) — 다른 PSD 열기·첫 화면으로 가기 공용 */
  function closeCurrent() {
    setViewJob(null);
    // 생성 중에 다른 PSD 를 열면 이전 섹션 결과가 새 작업에 섞이므로 먼저 멈춘다 (화면에서도 생성 중엔 업로드를 막음)
    abortRef.current?.abort();
    setLoadError(null);
    setResult(null);
    setRevisionCount(0);
    setAutoFix(null);
    setRun(emptyRun());
    openSeq.current++; // 읽는 중이던 PSD 가 있으면 그 결과는 버린다
    // 화면 상태(loaded)는 늦게 바뀔 수 있어 ref 의 최신 값을 놓는다
    const prev = loadedRef.current;
    if (prev) {
      URL.revokeObjectURL(prev.compositeUrl);
      if (prev.notextUrl) URL.revokeObjectURL(prev.notextUrl);
      // 문서 크기 비트맵(장당 수십~수백 MB)은 GC 를 기다리지 않고 바로 놓는다
      prev.composite.close();
      prev.notext?.close();
    }
    setLoaded(null);
    loadedRef.current = null;
    dropCut();
    jobRef.current = null;
    setJobId(null);
    workerRef.current?.dispose();
    workerRef.current = null;
  }

  // ───── 주소 ↔ 화면 맞추기 ─────
  /** 주소를 읽어 화면을 맞춘 뒤부터 화면 → 주소 반영 (처음 열 때 주소의 ?job 을 지우지 않게) */
  const routeReady = useRef(false);
  /** 주소대로 화면을 바꾸는 중 — 그동안 바뀌는 중간 상태를 주소에 쓰지 않는다 */
  const routeBusy = useRef(false);
  const viewJobRef = useRef(viewJob);
  viewJobRef.current = viewJob;
  const trashOpenRef = useRef(false);
  trashOpenRef.current = trash !== null;
  /** 지금 화면에 맞는 주소 */
  // 연 작업의 주소는 지금 화면 설정(슬러그·rev)으로 만든다 — 작업 기록(jobRef)의 설정은 0.5초 늦게 저장된다
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const currentRoute = (): Route =>
    viewJobRef.current ? routeOf(viewJobRef.current, true) : jobRef.current ? routeOf({ ...jobRef.current, settings: settingsRef.current }) : trashOpenRef.current ? { trash: true } : {};
  function syncUrl(replace = false) {
    const want = routeUrl(currentRoute());
    if (want === window.location.pathname + window.location.search) return;
    // 작업 페이지로 막 넘어온 빈 주소(#job, 작업 없음)는 그 작업 주소로 바꿔 쓴다 — 뒤로 가기 한 번에 목록으로 (빈 작업 페이지를 거치지 않게)
    const bareJob = !window.location.search && window.location.hash === '#job';
    if (replace || bareJob) window.history.replaceState(null, '', want + window.location.hash);
    else window.history.pushState(null, '', want + window.location.hash);
  }
  // 화면이 바뀌면 주소에 쌓는다 (뒤로 가기로 돌아올 수 있게)
  useEffect(() => {
    if (routeReady.current && !routeBusy.current) syncUrl();
  }, [viewJob, jobId, trash !== null]); // eslint-disable-line react-hooks/exhaustive-deps
  // 같은 작업에서 슬러그·rev·판매처만 바뀌면(「새 rev」·설정 고침) 기록을 쌓지 않고 주소만 바꾼다 — 안 바꾸면 새로고침 때 옛 값으로 찾다 못 찾음
  useEffect(() => {
    if (routeReady.current && !routeBusy.current && jobRef.current) syncUrl(true);
  }, [settings.slug, settings.rev, settings.channel, settings.market]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 주소대로 화면 맞추기 (처음 열 때·뒤로/앞으로 가기) */
  async function applyRoute(r: Route) {
    // 메뉴(#help·#admin)만 바뀐 뒤로/앞으로 가기 — 작업 화면은 그대로
    if (routeUrl(r) === routeUrl(currentRoute())) return;
    if (running || loading) {
      // 만드는 중엔 떠나지 않는다 — 주소를 지금 화면으로 되돌린다 (기록을 새로 쌓지 않고 바꿔서 「앞으로」가 끊기지 않게)
      syncUrl(true);
      setLoadError('만드는 중에는 다른 화면으로 갈 수 없습니다. 멈추거나 끝난 뒤에 이동하세요.');
      return;
    }
    routeBusy.current = true;
    try {
      // 작업 주소(?job·?markup)는 작업 페이지에서 연다 — 예전에 공유한 주소(#job 없음)도 「변환 내역」 아래 작업 페이지로
      if ((r.job || r.markup) && viewRef.current === 'work') {
        window.history.replaceState(null, '', window.location.pathname + window.location.search + '#job');
        setViewState('job');
      }
      if (!r.job && !r.markup) {
        if (loadedRef.current || viewJobRef.current) closeCurrent();
        if (r.trash) {
          setViewState('jobs'); // 휴지통은 변환 이력 화면에만 있다
          await openTrash();
        }
        else setTrash(null);
        return;
      }
      if (!r.html && routeIs(r, jobRef.current) && loadedRef.current) {
        setViewJob(null);
        return;
      }
      if (r.html && routeIs(r, viewJobRef.current)) return;
      let job: Job | null;
      let note = '';
      if (r.job) job = await jobById(r.job);
      else {
        const found = await jobBySlug(r.markup!, r.rev, r.ch, r.pf);
        job = found.job;
        if (found.count > 1) note = (`같은 제품(${r.markup}${r.rev ? ` · rev ${r.rev}` : ''})의 작업이 ${found.count}개라 ${r.ch ? '' : '고도몰 작업을 우선해 '}가장 최근 것을 열었습니다. 다른 것은 최근 작업 목록에서 고르세요.`);
      }
      if (!job) {
        setLoadError('주소의 작업을 찾지 못했습니다 (지워졌거나 휴지통에 있는 작업, 또는 다른 계정의 작업).');
        return;
      }
      if (r.html) {
        if (loadedRef.current) closeCurrent();
        await showSaved(job);
      } else if (!job.noFile) {
        await openJob(job);
        if (note) setLoadError(note); // 여는 동안 지워지지 않게 연 뒤에 알린다
      }
      else if (listInfo(job).html) {
        // 이 PC 에 PSD 원본이 없으면 저장된 결과(HTML)라도 보여 준다
        if (loadedRef.current) closeCurrent();
        await showSaved(job);
        setLoadError('이 PC 브라우저에 PSD 원본이 없어 저장된 결과를 보여 줍니다. 고치려면 변환 이력의 「PSD 선택」로 같은 PSD를 골라 주세요.');
      } else setLoadError('이 작업의 PSD 원본이 이 브라우저에 없습니다. 변환 이력의 「PSD 선택」로 같은 PSD를 골라 주세요.');
    } finally {
      routeBusy.current = false;
      // 화면이 다 바뀐 뒤 주소를 실제 화면에 맞춘다 (못 연 작업이면 첫 화면 주소로)
      requestAnimationFrame(() => syncUrl(true));
    }
  }
  const applyRouteRef = useRef(applyRoute);
  applyRouteRef.current = applyRoute;
  // 처음 열 때: 권한 확인·작업 목록을 읽은 뒤 주소대로
  useEffect(() => {
    if (!allowed || jobsLoading || routeReady.current) return;
    routeReady.current = true;
    const r = readRoute();
    if (r.job || r.markup || r.trash) applyRouteRef.current(r);
  }, [allowed, jobsLoading]);
  // 뒤로/앞으로 가기
  useEffect(() => {
    const onPop = () => {
      setViewState(viewOfHash());
      if (routeReady.current) applyRouteRef.current(readRoute());
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  /** 머리의 Pagefy 를 누르면 첫 화면(PSD 올리기 + 최근 작업)으로. 생성 중·읽는 중엔 작업을 잃지 않게 그대로 둔다 */
  function goHome() {
    if (view !== 'work') return setView('work');
    if (running || loading) return;
    closeCurrent();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function openPsd(file: File, job?: Job) {
    closeCurrent();
    // 연달아 열면(두 번 누름·읽는 중 새 PSD) 마지막 것만 화면에 둔다
    const seq = openSeq.current;
    const stale = () => seq !== openSeq.current;
    const worker = new PsdWorker();
    workerRef.current = worker;
    try {
      const t0 = performance.now();
      // 이 PSD 의 설정 (제품명·슬러그) — 미리보기를 먼저 띄울 때도 같은 값을 쓴다
      const name = productNameFromFile(file.name);
      // 규칙 6-1: 슬러그는 한 번 정하면 바꾸지 않는다 → 이 PC 에서 그 제품에 썼던 슬러그를 다시 쓴다
      const savedSlug = readLocal<Record<string, string>>('pagefy.slugs', {})[name];
      // 추가 지시는 그 PSD 에만 쓰는 값이라 새 PSD 로 가져오지 않는다 (채널·판매처·주소 루트만 이어 쓴다, 2026-11-27)
      // 올릴 곳(게시판)은 이어받지 않는다 — 대부분 상품 상세라 새 PSD 는 기본값으로 (2026-11-27)
      const next: Settings = { ...settings, productName: name, slug: savedSlug || toSlug(name), rev: todayRev(), extra: '', target: undefined, board: undefined };
      // 새 PSD 면 읽는 동안 보이는 설정 칸에도 이전 작업의 담당자·메모가 남지 않게 바로 비운다
      if (!job) setNote(freshNote());
      /** 먼저 띄운 화면 (PSD 확인·합성 미리보기) — 글자 뺀 배경은 아직 */
      let early: { composite: ImageBitmap; url: string } | null = null;
      const opened = await worker.open(
        file,
        (m) => !stale() && setLoading(m),
        async ({ summary, composite }) => {
          const url = await bitmapToUrl(composite);
          if (stale() || loadedRef.current) {
            URL.revokeObjectURL(url);
            composite.close();
            return;
          }
          early = { composite, url };
          const L0: Loaded = { file, summary, composite, notext: null, compositeUrl: url, notextUrl: '' };
          loadedRef.current = L0;
          setLoaded(L0);
          setSettings(job ? { ...job.settings, market: normMarket(job.settings.market) } : next);
          console.info(`[psd] ${file.name} 미리보기 ${Math.round(performance.now() - t0)}ms`);
        },
      );
      const first = early as { composite: ImageBitmap; url: string } | null;
      if (stale()) {
        opened.composite.close();
        opened.notext?.close();
        return;
      }
      setLoading('미리보기 만드는 중…');
      // 먼저 띄운 합성 이미지가 있으면 그대로 쓰고(다시 만들지 않음), 글자 뺀 배경만 만든다
      if (first) opened.composite.close();
      const [compositeUrl, notextUrl] = await Promise.all([first ? Promise.resolve(first.url) : bitmapToUrl(opened.composite), bitmapToUrl(opened.notext!)]);
      if (stale()) {
        URL.revokeObjectURL(compositeUrl);
        URL.revokeObjectURL(notextUrl);
        (first ? first.composite : opened.composite).close();
        opened.notext?.close();
        return;
      }
      const L: Loaded = { file, ...opened, composite: first ? first.composite : opened.composite, compositeUrl, notextUrl };
      loadedRef.current = L;
      setLoaded(L);
      if (import.meta.env.DEV) (window as unknown as { __pagefy: unknown }).__pagefy = { ...opened, compositeUrl, notextUrl }; // 개발 점검용
      console.info(`[psd] ${file.name} ${Math.round(performance.now() - t0)}ms`);
      if (job) {
        // 저장된 작업 이어서
        jobRef.current = job;
        setJobId(job.id);
        setSettings({ ...job.settings, market: normMarket(job.settings.market) }); // 예전 작업엔 market 이 없다
        setNote(job.note ?? {});
        await restoreJob(job);
        return;
      }
      setSettings(next);
      newJob(file, next);
    } catch (e) {
      if (!stale()) setLoadError(`PSD를 읽지 못했습니다: ${(e as Error).message}`); // 다음 PSD 를 여느라 끊은 것이면 알리지 않음
    } finally {
      if (!stale()) setLoading(null);
    }
  }

  const meta: GenerateMeta = useMemo(
    () => ({ productName: settings.productName.trim(), channel: settings.channel, ...(settings.channel === 'openmarket' ? { market: settings.market } : settings.target === 'board' ? { target: 'board' as const, board: pickBoard(settings.channel, settings.board) } : {}), slug: settings.slug, rev: settings.rev, publicRoot: settings.publicRoot.trim(), date: kstDate() }),
    [settings],
  );
  const baseUrl = imageBaseUrl(meta);

  const pushStatus = (m: string) => setRun((r) => ({ ...r, status: [...r.status, m] }));
  const setSection = (id: string, patch: Partial<SectionProgress>) => setRun((r) => ({ ...r, sections: r.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));

  /** Claude 요청이 실패해도(거절·시간 초과·출력 한도 등) 이미 쓴 비용은 화면과 작업 비용에 더한다 */
  async function charged<T>(p: Promise<T>): Promise<T> {
    try {
      return await p;
    } catch (e) {
      const { usage, model } = e as { usage?: UsageInfo; model?: string };
      if (usage) {
        setRun((r) => ({ ...r, usage: addUsage(r.usage, usage), model: model ?? r.model }));
        updateJob((j) => ({ usage: addUsage(j.usage, usage), model: model ?? j.model }));
      }
      throw e;
    }
  }

  /** 섹션 하나 요청 */
  async function runSection(m: GenerateMeta, bundle: PlanBundle, id: string, signal: AbortSignal, revision?: SectionRequest['revision'], onStart?: () => void): Promise<SectionOut> {
    const L = loadedRef.current!;
    const sec = bundle.plan.sections.find((s) => s.id === id)!;
    const tiles = await workerRef.current!.tiles({ y0: sec.y0, y1: sec.y1 });
    const texts = L.summary.texts.filter((t) => t.lineTop >= sec.y0 && t.lineTop < sec.y1);
    const layers = L.summary.layers.filter((l) => l.b[3] > sec.y0 && l.b[1] < sec.y1 && l.kind !== 'group');
    const s = L.summary;
    const req: SectionRequest = {
      meta: m,
      doc: { fileName: s.fileName, width: s.width, height: s.height, dpi: s.dpi, fonts: s.fonts, warnings: s.warnings },
      bundle,
      sectionId: id,
      texts,
      layers,
      tiles,
      extra: settings.extra,
      revision,
    };
    setSection(id, { state: 'run', chars: 0, error: undefined });
    const out = await charged(collect('section', req, { status: onStart, thinking: onStart, text: (all) => (onStart?.(), setSection(id, { chars: all.length })) }, signal));
    setRun((r) => ({ ...r, usage: addUsage(r.usage, out.usage), model: out.model ?? r.model }));
    updateJob((j) => ({ usage: addUsage(j.usage, out.usage), model: out.model ?? j.model }));
    const p = parseSectionOutput(out.text);
    if (p.error) throw new Error(p.error);
    setSection(id, { state: 'done' });
    const done: SectionOut = { id, name: sec.name, html: p.html, css: p.css, notes: p.notes, raw: out.text };
    // 섹션이 끝날 때마다 저장 → 새로고침해도 이 섹션은 다시 만들지 않는다
    updateJob((j) => {
      const { [id]: _, ...failed } = j.failed;
      return { sections: { ...j.sections, [id]: done }, failed };
    });
    return done;
  }

  const sectionFailed = (id: string, msg: string) => updateJob((j) => ({ failed: { ...j.failed, [id]: msg } }));

  /** 섹션 결과를 합치고 점검까지 */
  /** 결과를 화면에 보이고, 완성 HTML 도 작업에 저장 → PSD 원본이 없는 PC 에서도 「결과 보기」로 볼 수 있다 (같으면 다시 저장하지 않음) */
  function showResult(next: Result) {
    setResult(next);
    // 결과가 바뀌면(다시 만들기·다시 계산) 서버의 이미지는 예전 것 → 「올리기 전」으로
    if (jobRef.current && jobRef.current.html !== next.parsed.html) updateJob({ html: next.parsed.html, uploadedAt: undefined });
  }

  /** commit=false 면 화면·작업에 반영하지 않고 결과만 돌려준다 (「문제 자동 수정」이 나아졌는지 본 뒤에 반영) */
  async function finalize(m: GenerateMeta, base: string, bundle: PlanBundle, planReport: string, planRaw: string, sections: SectionOut[], images: CutImage[], extraChecks: Check[], commit = true) {
    const L = loadedRef.current!;
    const html = assembleHtml(m, bundle, sections, L.summary);
    const parsed: ParsedOutput = { plan: bundle.plan, html, report: assembleReport(planReport, sections) };
    const previewHtml = localizeHtml(html, base, images);
    let layout: LayoutResult | undefined;
    // 코드 생성 방식은 이미지에 일부러 남긴 글자를 대조·누락 검사에서 뺀다 (HTML 에 없는 게 맞음 — 미리보기의 「이미지에 남긴 글자」로 따로 보여 줌)
    const kept = bundle.plan.engine === 'code' ? new Set(keepMap(L.summary, bundle.plan, m.channel === 'openmarket').keys()) : undefined;
    pushStatus('PSD 위치 대조 중 (PSD 폭 렌더·모바일 360px)…');
    try {
      layout = await checkLayout(previewHtml, L.summary, kept, marketWidth(m.market, L.summary.width), m.target);
    } catch (e) {
      extraChecks.push({ level: 'warn', message: `위치 대조 실패: ${(e as Error).message}` });
    }
    const checks = [...extraChecks, ...(layout?.checks ?? []), ...checkOutput(parsed, L.summary, base, kept, m.target)];
    const next: Result = { meta: m, baseUrl: base, bundle, planReport, planRaw, sections, parsed, images, previewHtml, checks, layout };
    if (commit) showResult(next);
    return next;
  }

  /**
   * 코드 생성 방식: 구조 계획 → 자간 측정 → 마크업 생성(PSD 값) → 이미지 자르기 → 점검. API 호출 없음 (몇 초)
   * psd2html build.js 와 같은 방식이라, Claude 는 구조만 정하고 위치·크기·자간은 여기서 계산한다
   */
  async function buildFromPlan(m: GenerateMeta, base: string, planBundle: PlanBundle, planReport: string, planRaw: string, extraChecks: Check[] = [], signal?: AbortSignal, commit = true) {
    const L = loadedRef.current!;
    const plan = planBundle.plan;
    pushStatus('② 마크업 만들기: 글자 폭 재서 자간 보정 → PSD 값으로 글자 배치');
    const ls = await measureTexts(L.summary, new Set(keepMap(L.summary, plan, m.channel === "openmarket").keys()));
    signal?.throwIfAborted();
    if (ls.error) extraChecks.push({ level: 'warn', message: `${ls.error} — 자간 보정 없이 만들었습니다.` });
    const gen = generateMarkup(m, L.summary, plan, ls.adj, ls.wraps);
    pushStatus(`② 글자 ${L.summary.texts.length - gen.kept.length}개 배치 (자간 보정 ${Object.keys(ls.adj).length}개, 이미지에 남긴 글자 ${gen.kept.length}개) · 이미지 ${gen.bundle.plan.images.length}장 자르는 중…`);
    const cut = await cutImages(gen.bundle.plan, workerRef.current!);
    signal?.throwIfAborted();
    setCut(cut);
    extraChecks.push(...cut.errors.map((msg) => ({ level: 'error', message: `이미지 자르기 실패 ${msg}` }) as Check));
    extraChecks.push(...gen.warnings);
    setRun((r) => ({ ...r, thinking: '', sections: gen.sections.map((s) => ({ id: s.id, name: s.name, state: 'done', chars: s.html.length })) }));
    const report = [planReport.trim(), gen.bundle.notes].filter(Boolean).join('\n\n');
    return finalize(m, base, gen.bundle, report, planRaw, gen.sections, cut.images, extraChecks, commit);
  }

  /** 계획 응답을 읽는다. 새 계획은 모두 코드 생성 방식으로 본다 (섹션별 Claude 작성은 저장된 옛 작업에만) */
  function readPlan(text: string) {
    const pp = parsePlanOutput(text);
    if (!pp.plan) throw new Error(pp.error || '계획을 읽지 못했습니다.');
    const bundle: PlanBundle = { plan: { ...pp.plan, engine: 'code' }, style: pp.style, notes: pp.notes };
    return { bundle, report: pp.report };
  }

  /** 「다시 변환」에서 적은 내용을 이번 요청의 추가 지시 뒤에 붙인다 */
  const withWish = (extra: string, wish: string) => (wish.trim() ? [extra.trim(), `[다시 변환 — 직전 결과에서 마음에 안 든 점] ${wish.trim()}`].filter(Boolean).join('\n\n') : extra);

  /** 지금 계획을 「이전 결과」로 남길 모양 (코드 생성 계획만 — 옛 방식은 섹션 결과가 있어야 해 비용 없이 되살릴 수 없다). 없으면 있던 것 그대로 */
  const prevOf = (j: Job): PrevPlan | undefined =>
    j.plan && j.meta && j.plan.bundle.plan.engine === 'code' ? { plan: j.plan, meta: j.meta, baseUrl: j.baseUrl, extra: j.extra, revisionCount: j.revisionCount, at: Date.now() } : j.prevPlan;

  /**
   * 마크업 생성. 저장된 계획이 지금 설정과 같으면 계획을 건너뛰고 남은 섹션만 만든다 (fresh = 처음부터).
   * wish = 「다시 변환」에서 적은 마음에 안 드는 점 — 이번 구조 계획 요청에만 추가 지시로 붙이고 설정(추가 지시)에는 남기지 않는다
   */
  async function generate(fresh = false, wish = '') {
    const L = loadedRef.current;
    if (!L || !workerRef.current) return;
    // 지금 열린 작업을 목록에서 지운 뒤에도 버튼이 먹히게 새 작업으로 다시 저장
    if (!jobRef.current) newJob(L.file, settings, note);
    if (!jobRef.current) return;
    // 같은 작업을 두 탭에서 만들면 같은 섹션을 두 번 요청(비용 2배)하고 서로 결과를 덮어쓴다
    if ((await busyJobIds()).has(jobRef.current.id)) {
      setRun({ ...emptyRun(), phase: 'error', error: BUSY_MSG });
      return;
    }
    const m = meta;
    // 이미 만든 작업을 다른 판매처로 만들면 새 작업으로 갈라 저장한다 (같은 PSD 를 고도몰·스마트스토어·쿠팡에 모두 올리는 경우 — 원래 결과를 덮어쓰지 않게)
    // 같은 묶음이면 계획을 옮겨 비용 없이 다시 계산, 묶음이 다르면 새 작업에서 계획부터 (Claude 1회)
    const src = jobRef.current;
    if (platformMoved(src, m)) {
      const nj = forkJob({ ...src, note }, settings, { keepPlan: !fresh && !!resume?.code, creator: me });
      jobRef.current = nj;
      setJobId(nj.id);
      // 기다리지 않는다 — 곧 생성 상태로 다시 저장하므로 계정 쓰기 한 번을 생성 시작 앞에 두지 않는다
      putJob(nj).then(() => refreshJobs(true), (e) => console.warn('[jobs]', e));
    }
    const ac = new AbortController();
    abortRef.current = ac;
    const base = baseUrl;
    const saved = !fresh && resume ? jobRef.current : null;
    // 처음부터 다시 만들 때 실패해도 이전 결과·계획이 남게 (새 계획을 받기 전까지는 작업 기록을 지우지 않는다)
    const prevResult = result;
    const prevRevisions = revisionCount;
    let planReady = !!saved?.plan;
    setResult(null);
    setRevisionCount(0);
    setAutoFix(null);
    writeLocal('pagefy.slugs', { ...readLocal<Record<string, string>>('pagefy.slugs', {}), [m.productName]: m.slug });
    const release = holdLock(jobRef.current.id);
    const t0 = Date.now();
    try {
      let bundle: PlanBundle, planReport: string, planRaw: string;
      if (saved?.plan) {
        // 0) 저장된 계획에서 이어서
        ({ bundle, report: planReport, raw: planRaw } = saved.plan);
        const code = bundle.plan.engine === 'code';
        const recalc = code && !!saved.meta && !sameMeta(saved.meta, m);
        setRun({
          ...emptyRun(),
          phase: 'running',
          startedAt: t0,
          usage: saved.usage,
          model: saved.model,
          status: [recalc ? '저장된 구조 계획으로 지금 설정(판매처·이름)에 맞춰 다시 계산 — Claude 를 부르지 않아 비용 없음' : `저장된 계획으로 이어서 (섹션 ${Object.keys(saved.sections).length}/${bundle.plan.sections.length}개 완료)`],
        });
        // 코드 생성은 계획 + 지금 설정으로 마크업을 다시 계산하므로 작업의 설정도 지금 것으로 바꾼다
        updateJob({ state: 'running', error: undefined, failed: {}, ...(code ? { meta: m, baseUrl: base } : {}) });
      } else {
        setRun({ ...emptyRun(), phase: 'running', startedAt: t0, status: ['PSD 렌더 타일 만드는 중…'] });
        // 이전 계획이 있으면 그 설정·계획은 새 계획을 받은 뒤에 바꾼다 (실패하면 이전 것 그대로)
        updateJob({ state: 'running', error: undefined, ...(jobRef.current?.plan ? {} : { meta: m, baseUrl: base, extra: settings.extra }) });
        // 1) 계획
        const tiles = await workerRef.current.tiles();
        checkTileSize(tiles);
        pushStatus(`① 계획: 타일 ${tiles.length}장 + 레이어 정보 전송`);
        const planOut = await charged(
          collect(
            'plan',
            { meta: m, summary: L.summary, tiles, extra: withWish(settings.extra, wish) },
            {
              status: (msg) => pushStatus(`① ${msg}`),
              thinking: (t) => setRun((r) => ({ ...r, thinking: (r.thinking + t).slice(-4000) })),
              text: (all) => setRun((r) => ({ ...r, planChars: all.length })),
            },
            ac.signal,
          ),
        );
        setRun((r) => ({ ...r, usage: addUsage(r.usage, planOut.usage), model: planOut.model, planMs: Date.now() - t0 }));
        try {
          ({ bundle, report: planReport } = readPlan(planOut.text));
        } catch (e) {
          // 계획을 못 읽어도 쓴 비용은 작업 기록에 남긴다 (원문은 화면 진행 기록에서 볼 수 있게)
          updateJob((j) => ({ usage: addUsage(j.usage, planOut.usage), model: planOut.model }));
          console.warn('[plan] 읽지 못한 응답 원문:\n', planOut.text);
          throw new Error(`구조 계획 형식이 깨져 읽지 못했습니다 (${(e as Error).message}). 「마크업 만들기」를 다시 눌러 주세요 — 계속되면 관리자에게 알려 주세요.`);
        }
        planRaw = planOut.text;
        planReady = true;
        // 바로 전 결과의 계획은 「이전 결과로 되돌리기」용으로 남긴다
        updateJob((j) => ({ meta: m, baseUrl: base, extra: settings.extra, plan: { bundle, report: planReport, raw: planRaw }, prevPlan: prevOf(j), sections: {}, failed: {}, revisionCount: 0, usage: addUsage(j.usage, planOut.usage), model: planOut.model }));
        pushStatus(`① 구조 계획 완료: 섹션 ${bundle.plan.sections.length}개, 사진 ${bundle.plan.photos?.length ?? 0}장`);
      }
      const plan = bundle.plan;

      if (plan.engine === 'code') {
        await buildFromPlan(m, base, bundle, planReport, planRaw, [], ac.signal);
        setRun((r) => ({ ...r, phase: 'done', endedAt: Date.now() }));
        updateJob({ state: 'done' });
        return;
      }

      // 이미지 자르기 (워커) — 이어서 할 땐 불러올 때 잘라 둔 것을 쓴다
      const cut = saved && cutRef.current ? cutRef.current : await cutImages(plan, workerRef.current);
      setCut(cut);
      const extraChecks: Check[] = cut.errors.map((msg) => ({ level: 'error', message: `이미지 자르기 실패 ${msg}` }));

      // 2) 섹션별 (동시에)
      const outs = new Map<string, SectionOut>(Object.entries(saved?.sections ?? {}));
      const todo = plan.sections.filter((s) => !outs.has(s.id));
      pushStatus(`② 섹션 ${todo.length}개를 ${CONCURRENCY}개씩 동시에 작성${outs.size ? ` (완료된 ${outs.size}개는 건너뜀)` : ''}`);
      setRun((r) => ({ ...r, thinking: '', sections: plan.sections.map((s) => ({ id: s.id, name: s.name, state: outs.has(s.id) ? 'done' : 'wait', chars: outs.get(s.id)?.raw.length ?? 0 })) }));
      await poolWarm(todo, CONCURRENCY, async (s, onStart) => {
        try {
          outs.set(s.id, await runSection(m, bundle, s.id, ac.signal, undefined, onStart));
        } catch (e) {
          if (ac.signal.aborted) throw e;
          setSection(s.id, { state: 'error', error: (e as Error).message });
          sectionFailed(s.id, (e as Error).message);
          outs.set(s.id, failedSection(s, (e as Error).message));
          extraChecks.push({ level: 'error', message: `${s.id} ${s.name} 생성 실패: ${(e as Error).message} — 해당 섹션을 골라 "수정 요청"으로 다시 만드세요.` });
        }
      });
      const sections = plan.sections.map((s) => outs.get(s.id)!);
      await finalize(m, base, bundle, planReport, planRaw, sections, cut.images, extraChecks);
      setRun((r) => ({ ...r, phase: 'done', endedAt: Date.now() }));
      updateJob({ state: 'done' });
    } catch (e) {
      // 생성 중에 다른 PSD 를 열어 멈춘 경우: 이 오류를 새로 연 작업에 적지 않는다
      if (loadedRef.current !== L) return;
      const msg = ac.signal.aborted ? '취소했습니다.' : (e as Error).message;
      const noResp = !ac.signal.aborted && isNoResponse(e);
      // 새 계획을 받기 전에 실패했으면 이전 결과를 그대로 보여 주고 작업도 완료 상태로 둔다 (다시 만들기·수정 요청 가능)
      if (!planReady && prevResult) {
        setResult(prevResult);
        setRevisionCount(prevRevisions);
        setRun((r) => ({ ...r, phase: 'error', error: `${msg} — 이전 결과는 그대로 남아 있습니다.`, noResponse: noResp, sections: stopRunning(r.sections) }));
        updateJob({ state: 'done', error: undefined });
        return;
      }
      setRun((r) => ({ ...r, phase: 'error', error: msg, noResponse: noResp, sections: stopRunning(r.sections) }));
      updateJob({ state: ac.signal.aborted ? 'stopped' : 'error', error: msg });
    } finally {
      abortRef.current = null;
      release();
    }
  }

  /** 「문제 자동 수정」: 점검 결과 중 구조 계획으로 고칠 수 있는 것만 모아 Claude 1회 → 나아졌을 때만 바꾼다 */
  async function restorePrev() {
    const j = jobRef.current;
    const p = j?.prevPlan;
    if (!j || !p || !loaded || !workerRef.current || run.phase === 'running') return;
    if ((await busyJobIds()).has(j.id)) {
      setRun((r) => ({ ...r, phase: 'error', error: BUSY_MSG }));
      return;
    }
    const L0 = loadedRef.current;
    const ac = new AbortController();
    abortRef.current = ac;
    const release = holdLock(j.id);
    // 지금 결과의 이미지 미리보기 주소(blob URL)는 성공할 때까지 놓지 않는다 (실패하면 그대로 되살림 — 자동 수정과 같은 방식)
    const prevCut = cutRef.current;
    cutRef.current = null;
    setAutoFix(null);
    setRun({ ...emptyRun(), phase: 'running', startedAt: Date.now(), status: ['이전 결과로 되돌리는 중 — 남겨 둔 구조 계획으로 마크업을 다시 계산 (Claude 호출 없음)'] });
    updateJob({ state: 'running', error: undefined });
    try {
      const { bundle, report, raw } = p.plan;
      // 실패하면 finalize 까지 가지 않아 화면 결과·작업 계획은 지금 것 그대로 남는다
      await buildFromPlan(p.meta, p.baseUrl ?? imageBaseUrl(p.meta), bundle, report, raw, [], ac.signal);
      if (prevCut) for (const im of prevCut.images) URL.revokeObjectURL(im.url);
      // 맞바꾼다 — 방금까지의 결과가 「이전 결과」가 되어 다시 되돌릴 수 있다
      updateJob((cur) => ({ plan: p.plan, meta: p.meta, baseUrl: p.baseUrl, extra: p.extra, revisionCount: p.revisionCount, prevPlan: prevOf(cur), state: 'done' }));
      setRevisionCount(p.revisionCount);
      pushStatus('이전 결과로 되돌렸습니다 — 방금 결과는 「이전 결과」로 남아 다시 되돌릴 수 있습니다.');
      setRun((r) => ({ ...r, phase: 'done', endedAt: Date.now() }));
    } catch (e) {
      if (loadedRef.current !== L0) {
        if (prevCut) for (const im of prevCut.images) URL.revokeObjectURL(im.url);
        return;
      }
      setCut(prevCut); // 이번에 자른 이미지는 놓고 지금 결과의 이미지를 되살린다
      const msg = ac.signal.aborted ? '취소했습니다.' : (e as Error).message;
      setRun((r) => ({ ...r, phase: 'error', error: `되돌리지 못했습니다: ${msg} — 지금 결과는 그대로 남아 있습니다.` }));
      updateJob({ state: 'done' });
    } finally {
      abortRef.current = null;
      release();
    }
  }

  async function runAutoFix() {
    if (!result || !loaded || result.bundle.plan.engine !== 'code') return;
    const req = fixRequest(result.checks, result.layout);
    if (!req) return;
    if (jobRef.current && (await busyJobIds()).has(jobRef.current.id)) {
      setRun((r) => ({ ...r, phase: 'error', error: BUSY_MSG }));
      return;
    }
    setAutoFix(null);
    await revisePlan(req, true);
  }

  /** 고를 섹션만 다시 만든다 (feedback: 섹션 id → 고칠 내용) */
  async function revise(feedback: Record<string, string>) {
    if (!result || !loaded) return;
    setAutoFix(null);
    if (jobRef.current && (await busyJobIds()).has(jobRef.current.id)) {
      setRun((r) => ({ ...r, phase: 'error', error: BUSY_MSG }));
      return;
    }
    if (result.bundle.plan.engine === 'code') return revisePlan(feedback);
    const ac = new AbortController();
    abortRef.current = ac;
    const ids = Object.keys(feedback);
    const L0 = loadedRef.current;
    setRun((r) => ({
      ...r,
      phase: 'running',
      error: undefined,
      startedAt: Date.now(),
      planMs: undefined,
      endedAt: undefined,
      status: [...r.status, `수정 요청: ${ids.join(', ')}`],
      sections: result.sections.map((s) => ({ id: s.id, name: s.name, state: ids.includes(s.id) ? 'wait' : 'done', chars: s.raw.length })),
    }));
    const extraChecks: Check[] = [];
    const release = jobRef.current ? holdLock(jobRef.current.id) : () => {};
    updateJob({ state: 'running', error: undefined });
    try {
      const next = [...result.sections];
      await poolWarm(ids, CONCURRENCY, async (id, onStart) => {
        const i = next.findIndex((s) => s.id === id);
        const prev = next[i];
        try {
          next[i] = await runSection(result.meta, result.bundle, id, ac.signal, prev.raw ? { previous: prev.raw, feedback: feedback[id] } : undefined, onStart);
        } catch (e) {
          if (ac.signal.aborted) throw e;
          setSection(id, { state: 'error', error: (e as Error).message });
          extraChecks.push({ level: 'error', message: `${id} 수정 실패: ${(e as Error).message} (이전 결과 유지)` });
        }
      });
      await finalize(result.meta, result.baseUrl, result.bundle, result.planReport, result.planRaw, next, result.images, extraChecks);
      setRevisionCount((n) => n + 1);
      setRun((r) => ({ ...r, phase: 'done', endedAt: Date.now() }));
      updateJob((j) => ({ state: 'done', revisionCount: j.revisionCount + 1 }));
    } catch (e) {
      if (loadedRef.current !== L0) return; // 다른 PSD 를 열어 멈춘 경우
      // 수정 중 취소·오류여도 이전 결과는 그대로 있으므로 작업은 완료 상태로 둔다
      setRun((r) => ({ ...r, phase: 'error', sections: stopRunning(r.sections), error: ac.signal.aborted ? '취소했습니다.' : (e as Error).message }));
      updateJob({ state: 'done' });
    } finally {
      abortRef.current = null;
      release();
    }
  }

  /**
   * 코드 생성 방식의 수정: 고칠 내용을 구조 계획 수정으로 보내고(Claude 1회), 마크업은 다시 계산한다.
   * request: 섹션 id → 고칠 내용, 또는 그대로 보낼 글 하나.
   * autoFix: 「문제 자동 수정」 — 새 결과는 점검이 나아졌을 때만 화면·작업에 반영하고, 아니면 이전 결과·이미지·계획을 그대로 둔다.
   *   이전 이미지 미리보기 주소(blob URL)는 결정이 날 때까지 놓지 않도록 cutRef 에서 떼어 둔다.
   */
  async function revisePlan(request: Record<string, string> | string, autoFix = false) {
    if (!result || !loaded || !workerRef.current) return;
    const before = result;
    const prevCut = autoFix ? cutRef.current : null;
    if (autoFix) cutRef.current = null;
    const ac = new AbortController();
    abortRef.current = ac;
    const L0 = loadedRef.current!;
    let text: string;
    if (typeof request === 'string') text = request;
    else {
      const ids = Object.keys(request);
      text =
        ids.length === result.sections.length
          ? [...new Set(Object.values(request))].join('\n')
          : ids.map((id) => `- 섹션 ${id} ${result.sections.find((s) => s.id === id)?.name ?? ''}: ${request[id]}`).join('\n');
    }
    const t0 = Date.now();
    setRun((r) => ({ ...r, phase: 'running', error: undefined, startedAt: t0, planMs: undefined, endedAt: undefined, planChars: 0, sections: [], status: [...r.status, `수정 요청 → 구조 계획 다시 받기: ${text.slice(0, 80)}`] }));
    const release = jobRef.current ? holdLock(jobRef.current.id) : () => {};
    updateJob({ state: 'running', error: undefined });
    try {
      const tiles = await workerRef.current.tiles();
      checkTileSize(tiles);
      const out = await charged(
        collect(
          'plan',
          { meta: result.meta, summary: L0.summary, tiles, extra: settings.extra, revision: { previous: result.planRaw, feedback: text } },
          {
            status: (msg) => pushStatus(`① ${msg}`),
            thinking: (t) => setRun((r) => ({ ...r, thinking: (r.thinking + t).slice(-4000) })),
            text: (all) => setRun((r) => ({ ...r, planChars: all.length })),
          },
          ac.signal,
        ),
      );
      setRun((r) => ({ ...r, usage: addUsage(r.usage, out.usage), model: out.model ?? r.model, planMs: Date.now() - t0 }));
      // 계획을 못 읽어도 쓴 비용은 남도록 읽기 전에 저장한다
      updateJob((j) => ({ usage: addUsage(j.usage, out.usage), model: out.model ?? j.model }));
      const { bundle, report } = readPlan(out.text);
      const next = await buildFromPlan(result.meta, result.baseUrl, bundle, report, out.text, [], ac.signal, !autoFix);
      // 위치 대조 중에 다른 PSD 를 열었으면(closeCurrent 가 abort) 이 결과를 새 작업에 쓰지 않는다
      ac.signal.throwIfAborted();
      if (autoFix) {
        // 이미지에 남긴 글자 수 (finalize 의 대조 제외 목록과 같은 기준)
        const kept = (r: Result) => keepMap(L0.summary, r.bundle.plan, r.meta.channel === 'openmarket').size;
        const a = fixScore(next.checks, next.layout, kept(next));
        const b = fixScore(before.checks, before.layout, kept(before));
        if (!improved(a, b)) {
          // 나아지지 않음 → 반영하지 않았으므로 이전 이미지만 되돌린다 (이번에 자른 이미지 주소는 setCut 이 놓는다)
          setCut(prevCut);
          setAutoFix({ ok: false, text: `나아지지 않아 이전 결과를 그대로 뒀습니다 (${fmtScore(b)} → 고친 결과 ${fmtScore(a)}). 남은 문제는 미리보기에서 확인하거나 「수정 요청」에 직접 적어 주세요.` });
          pushStatus(`자동 수정: 나아지지 않아 이전 결과 유지 (${fmtScore(b)} → ${fmtScore(a)})`);
          setRun((r) => ({ ...r, phase: 'done', endedAt: Date.now() }));
          updateJob({ state: 'done' });
          return;
        }
        if (prevCut) for (const im of prevCut.images) URL.revokeObjectURL(im.url);
        showResult(next);
        setAutoFix({ ok: true, text: `자동 수정으로 나아졌습니다: ${fmtScore(b)} → ${fmtScore(a)}` });
        pushStatus(`자동 수정: ${fmtScore(b)} → ${fmtScore(a)}`);
      }
      // 새 계획은 마크업까지 성공한 뒤에 저장한다 (실패하면 이전 계획·결과를 그대로 둔다)
      updateJob((j) => ({ plan: { bundle, report, raw: out.text }, prevPlan: prevOf(j) }));
      setRevisionCount((n) => n + 1);
      setRun((r) => ({ ...r, phase: 'done', endedAt: Date.now() }));
      updateJob((j) => ({ state: 'done', revisionCount: j.revisionCount + 1 }));
    } catch (e) {
      if (loadedRef.current !== L0) {
        // 다른 PSD 를 열어 멈춤: 떼어 둔 이전 이미지는 새 작업에 되돌리지 않고 놓는다
        if (prevCut) for (const im of prevCut.images) URL.revokeObjectURL(im.url);
        return;
      }
      // 실패해도 이전 결과는 그대로 둔다 (자동 수정은 결과를 반영하기 전이므로 떼어 둔 이전 이미지만 되돌린다)
      if (autoFix) setCut(prevCut);
      setRun((r) => ({ ...r, phase: 'error', error: ac.signal.aborted ? '취소했습니다.' : `수정 실패 (이전 결과 유지): ${(e as Error).message}` }));
      updateJob({ state: 'done' });
    } finally {
      abortRef.current = null;
      release();
    }
  }

  /**
   * 이미지 서버에 올리기 (규칙 6절·6-1): 서버가 FTP 로 <채널>/<슬러그>/ 에 올리고 공개 주소를 열어 확인한다.
   * - 서버에 같은 이름 파일이 있으면 내용(SHA-256)을 비교해 같은 것은 건너뛴다
   * - 내용이 다른 같은 이름 파일이 있으면 바로 올리지 않고 「덮어쓰기 안내」(phase 'confirm')를 띄운다.
   *   담당자가 확인하면(confirmOverwrite) 그 파일들만 덮어쓴다 — 서버는 옛 파일을 숨김 백업으로 남긴다 (되돌리기에 씀)
   * - 결과가 바뀌면(수정·다른 작업) 진행 중인 업로드를 멈추고, 늦게 온 응답은 버린다
   */
  async function uploadImages(confirmOverwrite = false): Promise<boolean> {
    if (!result) return false;
    const runId = ++uploadRunRef.current;
    uploadAbortRef.current?.abort();
    const ac = new AbortController();
    uploadAbortRef.current = ac;
    const live = () => runId === uploadRunRef.current && !ac.signal.aborted;
    const set = (u: UploadState | ((u: UploadState) => UploadState)) => live() && setUpload(u);
    const r = result;
    const total = r.images.length;
    try {
      const big = r.images.find((im) => im.blob.size > 5 * 1024 * 1024);
      if (big) throw new Error(`${big.file} 이(가) 5MB 를 넘어 올릴 수 없습니다 (규칙 6절 목표 1MB). 그 섹션을 나누거나 사진을 줄여 다시 만드세요.`);
      const target = uploadTargetOf(r);
      // HTML 이 가리키는 주소와 올릴 곳이 같아야 한다 (예전 주소 규칙 — 날짜 폴더·플랫폼 폴더 없는 오픈마켓 — 으로 만든 결과는 다시 만들어야 함)
      if (r.baseUrl !== imageBaseUrl(r.meta)) throw new Error('예전 주소 규칙(날짜 폴더, 플랫폼 폴더 없는 오픈마켓 등)으로 만든 결과입니다. 「다시 만들기」로 지금 규칙의 주소로 HTML 을 만든 뒤 올려 주세요.');
      set({ phase: 'checking', done: 0, total });
      const want = await Promise.all(r.images.map(async (im) => ({ file: im.file, size: im.blob.size, sha256: await sha256Hex(im.blob) })));
      const remote = await uploadCheck(target, ac.signal);
      // 안전장치: 서버가 올릴 폴더가 HTML 속 이미지 주소와 다르면 멈춘다 — 다른 작업(예: 같은 슬러그의 상품 상세) 이미지를 덮어쓰지 않게.
      // 2026-11-27 게시판 결과가 /data/detail/ 로 올라가려던 일 (화면 코드가 옛 것이었던 것으로 보임) 뒤에 넣음
      if (remote.base.replace(/\/+$/, '') !== r.baseUrl.replace(/\/+$/, ''))
        throw new Error(`올릴 폴더(${remote.base}/)가 HTML 이미지 주소(${r.baseUrl}/)와 달라 올리지 않았습니다. 화면을 새로고침(Ctrl+Shift+R)한 뒤 다시 눌러 주세요. 그래도 같으면 서버(yarn dev)를 껐다 켜 주세요.`);
      const onServer = new Set(remote.files.map((f) => f.file));
      // 같은 이름이 서버에 있는 것: 내용이 같으면 건너뛰고, 다르면 덮어쓸 목록
      const same = new Set<string>();
      const clash = want.filter((w) => onServer.has(w.file));
      for (let i = 0; i < clash.length; i += 12) {
        for (const x of (await uploadVerify(target, clash.slice(i, i + 12), ac.signal)).results) if (x.ok) same.add(x.file);
      }
      const overwrite = clash.filter((w) => !same.has(w.file)).map((w) => w.file);
      /** 서버 제품 폴더에 있는데 이 HTML 이 쓰지 않는 파일 (지우지 않고 그대로 둔다) */
      const unused = remote.files.filter((f) => !want.some((w) => w.file === f.file)).length;
      if (overwrite.length && !confirmOverwrite) {
        // 덮어쓰기 안내: 무엇을 덮어쓰는지, 그림 크기가 바뀌는지(이미 붙여 둔 옛 HTML 과 어긋남) 보여 주고 확인받는다
        const items = await Promise.all(
          overwrite.map(async (file) => {
            const im = r.images.find((x) => x.file === file)!;
            const old = await imageSize(`${remote.base}/${file}?v=${Date.now()}`);
            const to = `${im.width}×${im.height}`;
            return { file, from: old ? `${old.w}×${old.h}` : undefined, to, sizeChanged: !old || old.w !== im.width || old.h !== im.height };
          }),
        );
        set({ phase: 'confirm', done: 0, total, overwrite: items, unused, folder: `${remote.base}/` });
        return false;
      }
      let done = same.size;
      const record: UploadedItem[] = [];
      set({ phase: 'uploading', done, total });
      // 4MB·40장 안쪽으로 묶어 보낸다 (서버는 한 번에 60장까지) (함수 요청 크기·150초 제한). 서버가 시간 때문에 남긴 파일(left)은 다음 묶음으로
      const queue = r.images.filter((im) => !same.has(im.file));
      while (queue.length) {
        const batch: { file: string; data: string }[] = [];
        let bytes = 0;
        while (queue.length && batch.length < 40 && (!batch.length || bytes + queue[0].blob.size <= 4 * 1024 * 1024)) {
          const im = queue.shift()!;
          batch.push({ file: im.file, data: await blobToBase64(im.blob) });
          bytes += im.blob.size;
        }
        const out = await uploadFiles(target, batch, overwrite, ac.signal);
        record.push(...out.done.map((d) => ({ file: d.file, ...(d.backup ? { backup: d.backup } : {}) })));
        if (out.refused.length) {
          // 확인한 뒤 다른 사람이 같은 이름으로 올린 경우 등 — 올린 것까지는 되돌릴 수 있게 기록을 남긴다
          set((u) => ({ ...u, record }));
          throw new Error(out.refused.map((x) => `${x.file}: ${x.error}`).join(' / '));
        }
        done += out.done.length;
        set((u) => ({ ...u, done, record }));
        if (out.left?.length) {
          if (!out.done.length) throw new Error('서버 시간 안에 한 장도 올리지 못했습니다. 잠시 뒤 다시 올리기를 누르세요.');
          queue.unshift(...r.images.filter((im) => out.left!.includes(im.file)));
        }
      }
      set((u) => ({ ...u, phase: 'verifying' }));
      const results: { file: string; status: number; ok: boolean; checked: boolean }[] = [];
      for (let i = 0; i < want.length; i += 12) results.push(...(await uploadVerify(target, want.slice(i, i + 12), ac.signal)).results);
      // 서버 시간 제한으로 확인하지 못한 것(checked=false)은 실패가 아니다 → 한 번 더 확인 요청
      const unchecked = new Set(results.filter((x) => !x.checked).map((x) => x.file));
      if (unchecked.size) {
        const again = (await uploadVerify(target, want.filter((w) => unchecked.has(w.file)), ac.signal)).results;
        for (const x of again) results[results.findIndex((y) => y.file === x.file)] = x;
      }
      const bad = results.filter((x) => !x.ok).map((x) => ({ file: x.file, status: x.status }));
      set({
        phase: bad.length ? 'error' : 'done',
        done,
        total,
        bad,
        record,
        overwritten: record.filter((x) => x.backup).length,
        unused,
        message: bad.length ? `올린 뒤 ${bad.length}장이 열리지 않거나 내용이 다릅니다. 잠시 뒤 「이미지 올리고 HTML 복사」로 다시 확인하세요.` : undefined,
      });
      // 다 올리고 확인까지 됐으면 작업에 기록 — 변환 내역 「완료」 기준
      if (!bad.length && live()) updateJob({ uploadedAt: Date.now() });
      return !bad.length && live();
    } catch (e) {
      if (ac.signal.aborted) return false;
      set((u) => ({ ...u, phase: 'error', message: `업로드 실패: ${(e as Error).message}` }));
      return false;
    }
  }

  /**
   * 잘못 올린 것 되돌리기 — 이번 화면에서 올린 파일만 (upload.record).
   * 덮어쓴 파일은 서버의 숨김 백업으로 되돌리고, 새로 올린 파일은 지운다. 다 끝나면 업로드 전 상태로 돌아가 「HTML 복사」를 누르면 다시 올린다
   */
  async function undoUpload() {
    if (!result || !upload.record?.length) return;
    const runId = ++uploadRunRef.current;
    uploadAbortRef.current?.abort();
    const ac = new AbortController();
    uploadAbortRef.current = ac;
    const live = () => runId === uploadRunRef.current && !ac.signal.aborted;
    const set = (u: UploadState | ((u: UploadState) => UploadState)) => live() && setUpload(u);
    const r = result;
    let items = upload.record;
    const total = items.length;
    try {
      set({ phase: 'removing', done: 0, total, record: items });
      let restored = 0;
      let removed = 0;
      const failed: string[] = [];
      // 함수 시간 제한으로 남긴 것이 있으면 이어서 요청 (조금도 못 하면 멈춤)
      for (let i = 0; i < 10 && items.length; i++) {
        const out = await uploadRemove(uploadTargetOf(r), items, ac.signal);
        restored += out.restored.length;
        removed += out.removed.length;
        failed.push(...out.failed.map((f) => `${f.file}(${f.error})`));
        set((u) => ({ ...u, done: restored + removed }));
        if (out.left.length && !out.restored.length && !out.removed.length) break;
        items = out.left;
      }
      if (items.length) throw new Error('서버 시간 안에 다 되돌리지 못했습니다. 잠시 뒤 다시 눌러 주세요.');
      const parts = [restored && `덮어쓴 ${restored}장은 예전 이미지로 되돌렸고`, removed && `새로 올린 ${removed}장은 지웠습니다`].filter(Boolean).join(', ');
      set({
        phase: failed.length ? 'error' : 'removed',
        done: restored + removed,
        total,
        message: failed.length ? `되돌리기 일부 실패: ${failed.join(', ')}` : `이미지 서버에서 ${parts || '되돌렸습니다'}.`,
      });
      // 올린 것을 되돌렸으면 「올리기 전」으로
      if (!failed.length) updateJob({ uploadedAt: undefined });
    } catch (e) {
      if (ac.signal.aborted) return;
      set((u) => ({ ...u, phase: 'error', message: `되돌리기 실패: ${(e as Error).message}` }));
    }
  }

  async function removeJob(id: string) {
    setViewJob((v) => (v?.id === id ? null : v));
    if (jobRef.current?.id === id) {
      jobRef.current = null;
      setJobId(null);
    }
    // 지우기 = 휴지통으로 (언제든 복원). 영구 삭제는 휴지통에서
    try {
      await trashJob(id);
    } catch (e) {
      setLoadError((e as Error).message);
    }
    refreshJobs();
    refreshTrashN();
  }

  // 이어서 만들 수 있는지: 저장된 계획이 있고, 계획 때 설정과 지금 설정이 같고, 남은 섹션이 있을 때
  // 목록 쪽은 가벼운 사본일 수 있어 지금 연 작업(jobRef)을 먼저 본다
  const cur = jobId ? (jobRef.current?.id === jobId ? jobRef.current : jobs.find((j) => j.id === jobId)) ?? null : null;
  const resumeInfo = (() => {
    if (!cur?.plan || !cur.meta || cur.state === 'running') return null;
    const total = cur.plan.bundle.plan.sections.length;
    const extraSame = (cur.extra ?? '') === settings.extra;
    if (cur.plan.bundle.plan.engine === 'code') {
      // 코드 생성: Claude 계획은 고도몰/오픈마켓 방식에만 달려 있고 폭·플랫폼 규칙·이미지 주소는 코드가 지금 설정으로 계산한다
      // → 같은 묶음 안에서 판매처(아이티켓↔온코어, 쿠팡↔스마트스토어)·이름을 바꾸면 계획을 다시 써서 비용 없이 다시 계산
      const changed = !sameMeta(cur.meta, meta);
      if (cur.state === 'done' && !changed && extraSame) return null; // 이미 지금 설정으로 만든 결과
      return { missing: total, total, same: extraSame && sameGroup(cur.meta, meta), code: true, changed };
    }
    if (cur.state === 'done') return null;
    const missing = total - Object.keys(cur.sections).length;
    if (!missing) return null;
    const same = sameMeta(cur.meta, meta) && extraSame;
    return { missing, total, same, code: false, changed: false };
  })();
  const resume = resumeInfo?.same ? resumeInfo : null;

  const ready = !!health && (health.mock || health.hasKey);
  const budget = health?.budget;
  // 결과를 만든 뒤 설정(채널·제품명·이미지 폴더)을 바꾸면 결과에는 반영되지 않는다 → 엉뚱한 곳에 붙여넣지 않게 알린다
  const metaDiff = result && run.phase !== 'running' && !sameMeta(result.meta, meta)
    ? [
        result.meta.channel !== meta.channel || (result.meta.market ?? '') !== (meta.market ?? '')
          ? `채널 ${CHANNEL_LABEL[result.meta.channel]}${result.meta.market ? ` · ${MARKETS[result.meta.market].label}` : ''} → ${CHANNEL_LABEL[meta.channel]}${meta.market ? ` · ${MARKETS[meta.market].label}` : ''}`
          : '',
        result.meta.productName !== meta.productName ? `제품명 「${result.meta.productName}」 → 「${meta.productName}」` : '',
        result.meta.slug !== meta.slug || result.meta.publicRoot !== meta.publicRoot ? '이미지 폴더·주소' : '',
        result.meta.rev !== meta.rev ? '작업 판(rev)' : '',
        (result.meta.target ?? '') !== (meta.target ?? '') || (result.meta.board ?? '') !== (meta.board ?? '')
          ? `올릴 곳 ${GODO_TARGET_LABEL[result.meta.target ?? 'detail']}${result.meta.target === 'board' ? ` · ${boardLabel(result.meta.channel, result.meta.board)}` : ''} → ${GODO_TARGET_LABEL[meta.target ?? 'detail']}${meta.target === 'board' ? ` · ${boardLabel(meta.channel, meta.board)}` : ''}`
          : '',
      ].filter(Boolean)
    : [];
  // 만들기 버튼이 왜 안 눌리는지 담당자에게 알려 준다 — 계속 막는 이유(blockers)와 몇 초면 풀리는 상태(waiting)를 나눈다
  const blockers = [
    !meta.productName && '제품명을 입력하세요.',
    meta.target === 'board' && !boardIdOk(meta.board) && '게시판 폴더 이름을 영문 소문자·숫자·하이픈으로 넣으세요.',
    !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(meta.slug) && SLUG_BLOCK,
    !/^https:\/\//.test(meta.publicRoot) && '이미지 공개 주소 루트는 https:// 로 시작해야 합니다.',
    healthError && '생성 서버에 연결하지 못했습니다. 위쪽 빨간 표시를 확인하세요.',
    health && !ready && '생성 서버에 Claude API 키가 없습니다. 관리자에게 알려 주세요.',
    budget?.blocked && '이번 달 사용 한도에 도달했습니다. Pagefy 관리자에게 한도 해제를 요청하세요.',
  ].filter((b): b is string => !!b);
  const waiting = [
    loaded && !loaded.notext && '글자 뺀 배경을 합성하는 중입니다 — 몇 초 뒤 만들 수 있습니다.',
    !health && !healthError && '생성 서버 연결을 확인하는 중입니다…',
  ].filter((b): b is string => !!b);
  // PSD 를 먼저 보여 주는 동안(글자 뺀 배경 합성 중)에는 만들 수 없다 — 다 읽으면 notext 가 생긴다
  const canGenerate = !!loaded?.notext && !blockers.length && !waiting.length && run.phase !== 'running';
  const hasResult = run.phase !== 'idle' || !!result;
  const step = !loaded ? 1 : result && !running ? 4 : hasResult ? 3 : 2;
  // 단계 표시에서 고른 지난 단계 (완료한 ② 를 눌러 설정을 다시 볼 때) — 진행 단계가 바뀌면 지금 단계로 돌아온다
  const [pickedStep, setPickedStep] = useState<number | null>(null);
  useEffect(() => setPickedStep(null), [step]);
  const shown = pickedStep ?? step;
  // 단계마다 그 단계의 칸만 (2026-11-25 의견 — 여러 단계 칸이 한꺼번에 쌓였다 접히며 화면이 흔들리지 않게). 파일 카드는 ②~④ 머리로 늘 둔다
  //  ② 확인·설정: PSD 요약 + 설정 (저장된 작업을 여는 중이면 둘 다 숨기고 파일 카드의 불러오기 진행만)
  //  ③ 마크업 만들기: 진행 상황 (오류로 멈췄으면 다시 만들 수 있게 설정도)
  //  ④ 복사해 붙여넣기: 결과 — 설정을 바꾸려면 단계 표시의 ② 를 누른다
  const showSettings = !!loaded && !restoring && (shown === 2 || (shown === 3 && run.phase === 'error'));
  const showResultPanel = hasResult && !!loaded && !restoring && shown >= 3;
  // 생성을 시작하면 진행 상황이 보이게 결과 칸으로 내린다
  useEffect(() => {
    if (running) document.getElementById('result')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [running]);

  // 토큰 갱신 중(role 확인 중)이라도 이미 로그인돼 있으면 작업 화면을 유지한다
  const showLogin = AUTH && authReady && !allowed && !(session && (role === null || role === 'guest'));

  // 에디터 테스트(#tester)의 「지금 결과 불러오기」 — 복사 구간 + 채널에 맞는 에디터, 업로드 전 이미지는 미리보기에서만 브라우저 안 그림으로
  // 결과 화면 「손보기」에서 저장한 고침 — 작업(job.edited)에 남기고, 결과가 다시 만들어져 원본이 바뀌면 버린다 (savedEditFor)
  const [savedEdit, setSavedEdit] = useState<string | null>(null);
  useEffect(() => {
    setSavedEdit(result?.parsed.html ? savedEditFor(jobRef.current, copySection(result.parsed.html)) : null);
  }, [result?.parsed.html]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveEdit = (html: string | null) => {
    if (!result) return;
    setSavedEdit(html);
    updateJob({ edited: html ? { html, base: editBase(copySection(result.parsed.html)), at: Date.now() } : undefined });
  };
  const resultTester = useMemo<TesterSource | null>(
    // 손보기에서 저장한 고침이 있으면 에디터 미리보기도 그것으로 (복사할 HTML 과 같게)
    () => (result?.parsed.html ? testerSourceOf(savedEdit ?? result.parsed.html, result.meta, result.images.map((im) => [`${result.baseUrl}/${im.file}`, im.url] as [string, string])) : null),
    [result, savedEdit],
  );
  // 에디터 테스트의 「변환 내역에서 불러오기」 — 계정에서 바로 찾는다(findJobsWithHtml, 검색·더 보기). 고르면 그 작업의 HTML 로
  const pickForTester = async (j: Job): Promise<TesterSource | null> => {
    // 지금 열린 작업이면 지금 결과 그대로 (아직 안 올린 그림도 미리보기에 보이게)
    if (j.id === jobId && resultTester) return resultTester;
    const full = await fullJob(j);
    return full.html && full.meta ? testerSourceOf(full.html, full.meta, []) : null;
  };
  // 「에디터 미리보기」로 넘어갈 때 에디터 테스트가 이것으로 시작한다 (지금 결과 또는 PSD 없이 연 저장된 결과). 에디터 테스트가 받으면 비운다 → 메뉴로 다시 들어오면 임시 저장본
  const [testerStart, setTesterStart] = useState<TesterSource | null>(null);
  const openTester = (src: TesterSource) => {
    setTesterStart(src);
    setView('tester');
  };

  // 변환 내역 — 머리말 메뉴 「변환 내역」(#jobs) 전용 화면 + 만들기 첫 화면의 「최근 작업」(최근 5건, 2026-11-24)
  const jobsProps = { jobs, filter: jobFilter, onFilter: setJobFilter, currentId: jobId, busy: !!loading || running, account: savesToAccount(), more: moreJobs, loading: jobsLoading, onMore: showMoreJobs, page: jobPage, total: jobsTotal, pageSize: JOB_PAGE, onPage: goJobPage, onRefresh: () => refreshJobs(true), onRemove: removeJob, trash, trashN, trashLoading, onTrashOpen: openTrash, onTrashClose: () => setTrash(null), onRestore: restoreFromTrash, onPurge: purgeFromTrash, imageServer: !!health?.upload, onEditInfo: editJobNote };
  // 「⋯ → PSD 교체…」 — 작업 페이지(#job)에서 새 PSD 로 연다
  const replaceFromList = (j: Job, f: File) => {
    setView('job');
    replacePsd(j, f);
  };
  // 저장된 결과 보기 (PSD 없이) — 변환 내역에서 고르면 변환 내역 화면 안에서, 만들기 화면의 최근 작업에서 고르면 만들기 화면에서 연다
  const savedView = viewJob && (
    <SavedView
      job={viewJob}
      onClose={() => setViewJob(null)}
      imageServer={!!health?.upload}
      godo={!!health?.godo && viewJob.meta?.channel === 'itket'}
      onOpenTester={viewJob.html && viewJob.meta ? () => openTester(testerSourceOf(viewJob.html!, viewJob.meta!, [])) : undefined}
      // PSD 를 골라 이어서 작업 — 같은 작업 페이지에서 PSD 로 연다
      onPickPsd={(f) => {
        setView('job');
        openJob(viewJob, f);
      }}
      onSaveEdit={saveViewEdit}
      // 고도몰 등록 확인이 맞으면 등록 페이지 주소를 작업 기록에 남긴다 (변환 내역 「등록됨」)
      onSaveLink={(url) => {
        const j = viewJob;
        const n = { ...(j.note ?? {}), link: url };
        setViewJob((v) => (v?.id === j.id ? { ...v, note: n } : v));
        editJobNote(j, n).catch((e) => console.warn('[jobs] 등록 페이지 저장 실패', e));
      }}
    />
  );
  // 목록(변환 내역·최근 작업)에서 작업을 열면 작업 페이지(#job)로 — 메뉴의 「만들기」가 아니라 「변환 내역」 아래 화면 (2026-11-26 사용자)
  const openJobPage = {
    onOpen: (j: Job, f?: File) => {
      setView('job');
      openJob(j, f);
    },
    onCopy: (j: Job, to: Platform) => {
      setView('job');
      copyToPlatform(j, to);
    },
    onView: (j: Job) => {
      setView('job');
      showSaved(j);
    },
  };
  const recentJobs = showJobs && <JobsPanel {...jobsProps} mode="recent" {...openJobPage} onReplace={replaceFromList} onShowAll={() => setView('jobs')} />;
  const jobsPage = (
    <JobsPanel
      {...jobsProps}
      mode="page"
      // 지금 열린 작업은 작업 페이지에 그대로 있다 → 그 페이지로 (결과가 있으면 결과 칸으로)
      onGoCurrent={() => {
        setView('job');
        requestAnimationFrame(() => document.getElementById('result')?.scrollIntoView({ block: 'start' }));
      }}
      {...openJobPage}
      onReplace={replaceFromList}
    />
  );

  return (
    <div className="app">
      <Header
        health={health}
        error={healthError}
        user={
          AUTH && session
            ? { email: session.user.email ?? '', name: session.user.user_metadata?.name, avatarUrl: session.user.user_metadata?.avatar_url || undefined }
            : !AUTH
              ? LOCAL_USER
              : undefined
        }
        // 로컬은 로그인이 없어 로그아웃해도 아무 일도 없다 (메뉴 모양 확인용으로 항목만 보인다)
        onLogout={AUTH && session ? () => supabase.auth.signOut() : !AUTH ? () => console.info('[로컬] 로그인이 없어 로그아웃할 것이 없습니다') : undefined}
        // 첫 화면(PSD 올리기 칸이 크게 보임)에선 숨기고, PSD 를 연 뒤·저장된 결과를 볼 때만
        // 작업 페이지에서 새 PSD 를 열면 만들기 화면으로 (새 작업은 만들기에서 시작)
        onNewPsd={allowed && (loaded || viewJob) ? (f) => (view === 'job' && setView('work'), window.scrollTo({ top: 0, behavior: 'smooth' }), pickPsd(f)) : undefined}
        newPsdDisabled={running || !!loading}
        onHome={goHome}
        homeBusy={(view === 'work' || view === 'job') && (running || !!loading)}
        view={allowed && !showLogin ? view : undefined}
        onView={setView}
        showAdmin={role === 'admin'}
        budgetAlert={!!budget && budget.spentUsd >= budget.capUsd * BUDGET_WARN_RATIO}
      />
      {/* 파일은 놓는 칸에서만 받는다 — 그 밖에 떨어뜨리면 무시 (실수로 다른 PSD 가 열리지 않게). PSD 를 연 뒤 다른 PSD 는 머리의 「새 PSD」로 */}
      <DropGuard />
      {/* 새 PSD 를 올렸는데 같은 제품명 작업이 있을 때 — 기존 작업의 PSD 교체 · 같은 PSD 면 그 작업 열기 · 새 작업 */}
      <ReplacePsdDialog
        file={swapAsk?.file ?? null}
        jobs={swapAsk?.jobs ?? []}
        onClose={() => setSwapAsk(null)}
        onReplace={(j, f) => replacePsd(j, f)}
        onOpen={(j, f) => {
          setView('job');
          openJob(j, f);
        }}
        onNew={(f) => openPsd(f)}
      />
      <main className="app__main">
        {showLogin ? (
          <LoginPanel session={session} role={role} />
        ) : (
          <>
            {/* 월 상한: 80% 넘으면 경고, 다 쓰면 막힘 (모든 사용자에게 — 관리자에게 미리 알리게) */}
            {budget && (budget.blocked || (!budget.unblocked && budget.spentUsd >= budget.capUsd * BUDGET_WARN_RATIO)) && (
              <p className={`budget${budget.blocked ? ' budget--blocked' : ''}`} role={budget.blocked ? 'alert' : 'status'}>
                <b>{budget.blocked ? '이번 달 사용 한도에 도달해 새로 만들 수 없습니다.' : '이번 달 사용 한도가 얼마 남지 않았습니다.'}</b>
                <span>
                  팀 전체 사용 ${budget.spentUsd.toFixed(2)} / 한도 ${budget.capUsd}
                  {budget.blocked ? ' — 이미 만든 결과는 열고 복사할 수 있습니다. Pagefy 관리자에게 한도 해제를 요청하세요.' : ' — 한도에 닿으면 새로 만들 수 없습니다.'}
                </span>
                {role === 'admin' && view !== 'admin' && (
                  <button type="button" className="link-btn" onClick={() => setView('admin')}>
                    관리자 화면에서 보기
                  </button>
                )}
              </p>
            )}
            {view === 'jobs' && allowed && jobsPage}
            {view === 'tester' && allowed && <TesterPanel current={resultTester} start={testerStart} onStarted={() => setTesterStart(null)} findJobs={findJobsWithHtml} onPick={pickForTester} />}
            {view === 'help' && <HelpPanel />}
            {view === 'admin' && role === 'admin' && <AdminPanel onChanged={() => fetchHealth().then(setHealth, () => {})} />}
            {view === 'admin' && role !== 'admin' && <p className="msg msg--error">관리자 화면은 관리자만 볼 수 있습니다.</p>}
            {/* 만들기 화면 = 작업 페이지(job)와 같은 칸을 쓴다. 작업 페이지에 따로 제목은 두지 않는다 — 제품명은 저장 결과 패널 제목·PSD 파일 카드에 있다 (2026-11-26 사용자). 목록으로는 메뉴 「변환 내역」 */}
            <div className="app__view" hidden={view !== 'work' && view !== 'job'}>
            {/* 저장된 결과만 보는 동안은 단계 표시·PSD 올리기를 숨긴다 (만드는 흐름이 아니라 보기).
                PSD 를 열기 전(만들기 첫 화면)에도 숨긴다 — 큰 PSD 올리기 칸이 있어 ① 만 켜진 단계 표시는 정보가 없다. 여는 중·작업 불러오는 중부터 보인다 */}
            {!viewJob && (loaded || !!loading || restoring) && <Stepper step={step} shown={shown} onPick={(n) => setPickedStep(n === step ? null : n)} />}
            {/* PSD 파일 카드 + PSD 확인을 가로로 나란히 (넓은 화면) — 좁으면 한 줄씩 */}
            {/* PSD 파일 카드는 결과를 보는 4단계에서 숨긴다 (단계 표시 ①을 누르면 다시 보임) · 저장 결과만 볼 때도 숨김 */}
            <div className={`prep${loaded && shown === 2 && !restoring ? ' prep--pair' : ''}`} hidden={!!viewJob || (shown === 4 && !restoring)}>
              <UploadPanel
                onFile={(f) => pickPsd(f)}
                loading={loading}
                error={loadError}
                disabled={running}
                file={loaded ? { name: loaded.file.name, size: loaded.file.size, width: loaded.summary.width, height: loaded.summary.height, thumbUrl: loaded.compositeUrl } : null}
              />
              {loaded && shown === 2 && !restoring && <SummaryPanel loaded={loaded} />}
            </div>
            {savedView}
            {/* 최근 작업은 만들기 첫 화면에만 — 작업 상세 페이지(목록에서 연 작업)에서는 숨긴다 */}
            {view === 'work' && !loaded && !restoring && allowed && recentJobs}
            {showSettings && loaded && (
              <SettingsPanel
                collapsed={false}
                blockers={blockers}
                waiting={waiting}
                note={note}
                onNoteChange={setNote}
                me={jobRef.current?.creator ?? me}
                settings={settings}
                onChange={setSettings}
                baseUrl={baseUrl}
                canGenerate={canGenerate}
                running={running}
                resume={resume}
                resumeChanged={!!resumeInfo && !resumeInfo.same}
                onGenerate={generate}
                onCancel={() => abortRef.current?.abort()}
                health={health}
                tileCount={Math.ceil(loaded.summary.height / Math.floor(1560 / Math.min(1, 1000 / loaded.summary.width)))}
              />
            )}
            {metaDiff.length > 0 && result && !restoring && shown === 4 && (
              <div className="metadiff" role="alert">
                <b>설정이 결과와 다릅니다 — 아래 결과는 바뀌기 전 설정({CHANNEL_LABEL[result.meta.channel]}{result.meta.market ? ` · ${MARKETS[result.meta.market].label}` : ''})으로 만든 것입니다.</b>
                <span>바뀐 것: {metaDiff.join(' · ')}. {resume?.code ? '같은 묶음 안에서 바꿔 저장된 구조 계획으로 비용 없이 다시 계산할 수 있습니다.' : '고도몰과 오픈마켓은 HTML 방식이 달라 구조 계획부터 다시 만들어야 합니다 (Claude 1회).'}
                  {!samePlatform(result.meta, meta) && ' 판매처가 바뀌어 새 작업으로 저장되고, 원래 작업은 변환 이력에 그대로 남습니다.'}</span>
                <span className="metadiff__actions">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setSettings((s) => ({ ...s, productName: result.meta.productName, channel: result.meta.channel, ...(result.meta.market ? { market: result.meta.market } : {}), slug: result.meta.slug, rev: result.meta.rev, publicRoot: result.meta.publicRoot, target: result.meta.target, board: result.meta.board }))}
                  >
                    설정을 결과대로 되돌리기
                  </Button>
                  <Button type="button" size="sm" variant="primary" disabled={!canGenerate} onClick={() => generate()}>
                    {resume?.code ? '지금 설정으로 다시 계산 (비용 없음)' : '지금 설정으로 다시 만들기'}
                  </Button>
                </span>
                {/* 다시 만들기가 막힌 이유 — 설정 칸은 결과가 있으면 접혀 있어 거기 안내가 안 보인다 */}
                {!canGenerate && (blockers[0] ?? waiting[0]) && <small className="metadiff__why">다시 만들 수 없는 이유: {blockers[0] ?? waiting[0]}</small>}
              </div>
            )}
            {showResultPanel && loaded && (
              <div id="result" className="app__anchor">
              <ResultPanel
                run={run}
                result={result}
                loaded={loaded}
                revisionCount={revisionCount}
                onRevise={revise}
                onAutoFix={runAutoFix}
                autoFix={autoFix}
                onCancel={() => abortRef.current?.abort()}
                onResume={resume && canGenerate ? () => generate() : undefined}
                onRetry={canGenerate ? () => generate() : undefined}
                // 「다시 변환」: 구조 계획부터 새로 (Claude 1회). 막혀 있으면 이유를 함께 보여 준다
                onReconvert={(wish) => generate(true, wish)}
                reconvertBlocked={canGenerate ? undefined : (blockers[0] ?? waiting[0] ?? '지금은 다시 변환할 수 없습니다.')}
                prevAt={cur?.prevPlan && cur.prevPlan.plan.bundle.plan.engine === 'code' ? cur.prevPlan.at : undefined}
                onRestorePrev={restorePrev}
                upload={health?.upload && result?.bundle.plan.engine === 'code' ? upload : undefined}
                godo={!!health?.godo && result?.meta.channel === 'itket'}
                // 작업 기록(note)은 바뀌면 잠시 뒤 저장된다 — 등록 페이지 주소도 같은 길로
                regLink={note.link}
                onRegLink={(url) => setNote((n) => ({ ...n, link: url }))}
                savedEdit={savedEdit}
                onSaveEdit={saveEdit}
                onUpload={uploadImages}
                onUploadReset={() => {
                  ++uploadRunRef.current;
                  uploadAbortRef.current?.abort();
                  setUpload({ phase: 'idle', done: 0, total: 0 });
                }}
                onUndoUpload={undoUpload}
                onOpenTester={
                  resultTester ? () => openTester(resultTester) : undefined
                }
                resumeLabel={resume ? (resume.code ? (resume.changed ? '지금 설정으로 다시 계산 (비용 없음)' : '저장된 계획으로 마무리 (비용 없음)') : `이어서 만들기 (남은 섹션 ${resume.missing}개)`) : undefined}
              />
              </div>
            )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

async function blobToBase64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function sha256Hex(b: Blob): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', await b.arrayBuffer());
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * 에디터 테스트(#tester)에 넘길 HTML — 복사 구간 + 채널에 맞는 에디터.
 * images = [이미지 서버 주소, 미리보기 주소] (업로드 전 이미지는 브라우저 안 그림으로 보이게. 저장된 결과는 서버 주소 그대로라 빈 목록)
 */
function testerSourceOf(html: string, m: GenerateMeta, images: [string, string][]): TesterSource {
  return { html: copySection(html), label: `${m.productName} · ${platformLabel(m)}`, product: m.productName, editor: editorFor(m), images, ...(m.target === 'board' ? { target: 'board' as const } : {}) };
}

/** 업로드할 곳: <채널>/<슬러그>/, 오픈마켓은 openmarket/<플랫폼>/<슬러그>/ (규칙 6-1 — shared/types.ts imageFolder 와 같은 규칙) */
function uploadTargetOf(r: { meta: GenerateMeta }): UploadTarget {
  return uploadTargetFor(r.meta);
}

/** 이미 서버에 있는 그림의 크기 (덮어쓰기 안내에서 크기가 바뀌는지 보려고). 열리지 않으면 null */
function imageSize(url: string): Promise<{ w: number; h: number } | null> {
  return new Promise((res) => {
    const img = new Image();
    const timer = window.setTimeout(() => res(null), 15_000);
    img.onload = () => (window.clearTimeout(timer), res({ w: img.naturalWidth, h: img.naturalHeight }));
    img.onerror = () => (window.clearTimeout(timer), res(null));
    img.src = url;
  });
}
