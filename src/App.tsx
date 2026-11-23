import { useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { GenerateMeta, HealthInfo, PlanBundle, PsdSummary, SectionRequest, UsageInfo } from '../shared/types';
import { CLOUD, collect, fetchHealth, uploadCheck, uploadFiles, uploadRemove, uploadVerify, type UploadTarget } from './lib/api';
import { canUse, fetchRole, supabase, type Role } from './lib/supabase';
import { bitmapToUrl, cutImages, localizeHtml, type CutImage } from './lib/images';
import { checkOutput, parsePlanOutput, parseSectionOutput, type Check, type ParsedOutput } from './lib/output';
import { assembleHtml, assembleReport, type SectionOut } from './lib/assemble';
import { generateMarkup, keepMap } from './lib/codegen';
import { measureTexts } from './lib/lsAdjust';
import { checkLayout, type LayoutResult } from './lib/layoutCheck';
import { PsdWorker } from './lib/psd/client';
import { fmtBytes, kstDate, productNameFromFile, readLocal, todayRev, toSlug, writeLocal } from './lib/util';
import { busyJobIds, deleteJob, fileKeyOf, fullJob, listTrash, markInterruptedLocal, trashCount, trashJob, untrashJob, getFile, listJobsPage, markInterrupted, prune, putJob, requestPersist, sameFile, sameMeta, saveFile, savesToAccount, touchRunning, type Job } from './lib/jobs';
import Header from './components/Header';
import JobsPanel from './components/JobsPanel';
import SavedView from './components/SavedView';
import LoginPanel from './components/LoginPanel';
import UploadPanel from './components/UploadPanel';
import DropOverlay from './components/DropOverlay';
import SummaryPanel from './components/SummaryPanel';
import SettingsPanel, { type Settings } from './components/SettingsPanel';
import ResultPanel, { type UploadState } from './components/ResultPanel';
import Stepper from './components/Stepper';

export interface Loaded {
  file: File;
  summary: PsdSummary;
  composite: ImageBitmap;
  notext: ImageBitmap;
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
  // 로그인 (배포 모드에서만 — 광고 인사이트 계정)
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!CLOUD);
  const [role, setRole] = useState<Role | null>(CLOUD ? null : 'admin');

  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const workerRef = useRef<PsdWorker | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [settings, setSettings] = useState<Settings>(() => ({
    productName: '',
    channel: readLocal('pagefy.channel', 'itket'),
    slug: '',
    rev: todayRev(),
    publicRoot: readLocal('pagefy.publicRoot', DEFAULT_PUBLIC_ROOT),
    extra: '',
  }));
  const [run, setRun] = useState<RunState>(emptyRun);
  const [result, setResult] = useState<Result | null>(null);
  /** PSD 원본 없이 보는 저장된 결과 */
  const [viewJob, setViewJob] = useState<Job | null>(null);
  const [revisionCount, setRevisionCount] = useState(0);
  // 이미지 서버 업로드 진행 (결과가 바뀌면 처음 상태로)
  const [upload, setUpload] = useState<UploadState>({ phase: 'idle', done: 0, total: 0 });
  const uploadRunRef = useRef(0);
  const uploadAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    // 결과가 바뀌면(수정·새 rev·다른 작업) 진행 중 업로드를 멈추고 처음 상태로
    const runId = ++uploadRunRef.current;
    uploadAbortRef.current?.abort();
    setUpload({ phase: 'idle', done: 0, total: 0 });
    // 다시 연 작업: 이미지 서버에 이 작업이 올린 폴더가 그대로 있으면 「올려 둔 상태」로 보여 준다 → 되돌리기 링크가 다시 보임.
    // 이름·크기가 이 결과 이미지와 모두 같을 때만 (일부만 있으면 「HTML 복사」가 이어서 올림). 조용히 확인하고 실패해도 화면은 그대로
    const r = result;
    if (!r || !health?.upload || r.bundle.plan.engine !== 'code' || !r.images.length) return;
    const ac = new AbortController();
    uploadAbortRef.current = ac;
    (async () => {
      const token = await uploadToken(jobRef.current?.id ?? r.baseUrl, r.meta.rev);
      const remote = await uploadCheck({ channel: r.meta.channel, slug: r.meta.slug, rev: r.meta.rev, publicRoot: r.meta.publicRoot, token }, ac.signal);
      if (runId !== uploadRunRef.current || ac.signal.aborted || !remote.exists || !remote.owned) return;
      const sizes = new Map(remote.files.map((f) => [f.file, f.size]));
      const all = r.images.length === remote.files.length && r.images.every((im) => sizes.get(im.file) === im.blob.size);
      if (all) setUpload({ phase: 'done', done: r.images.length, total: r.images.length, restored: true });
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
  async function restoreFromTrash(id: string) {
    try {
      await untrashJob(id);
    } catch (e) {
      setLoadError((e as Error).message);
    }
    await openTrash();
    refreshJobs();
  }
  async function purgeFromTrash(id: string) {
    await deleteJob(id).catch((e) => setLoadError(`영구 삭제하지 못했습니다 (${(e as Error).message})`));
    await openTrash();
  }
  // 늦게 끝난 옛 요청이 새 목록을 덮지 않게 순번을 매긴다 (불러오는 중 표시는 마지막 전체 읽기가 끝날 때 끈다)
  const listSeq = useRef(0);
  const fullSeq = useRef(0);
  const refreshJobs = (quick = false) => {
    const seq = ++listSeq.current;
    const full = quick ? 0 : ++fullSeq.current;
    if (!quick) setJobsLoading(true);
    const show = (p: { jobs: Job[]; more: boolean }) => {
      if (seq !== listSeq.current) return;
      setJobs(p.jobs);
      setMoreJobs(p.more);
    };
    return listJobsPage(jobLimitRef.current, quick, show)
      .then(show, (e) => console.warn('[jobs]', e))
      .finally(() => full && full === fullSeq.current && setJobsLoading(false));
  };
  const showMoreJobs = () => {
    jobLimitRef.current += 20;
    refreshJobs();
  };
  /** 지금 작업을 고쳐 저장 (섹션이 동시에 끝나도 ref 에서 이어 붙여 잃지 않는다) */
  function updateJob(patch: Partial<Job> | ((j: Job) => Partial<Job>)) {
    const cur = jobRef.current;
    if (!cur) return;
    const next = { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch), updatedAt: Date.now() };
    jobRef.current = next;
    putJob(next).then(() => refreshJobs(true), (e) => console.warn('[jobs] 저장 실패', e));
  }

  useEffect(() => {
    if (!CLOUD) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    // 로그인 상태를 읽기 전(authReady 전)에는 판정하지 않는다 — 안 그러면 첫 화면에 몇 초간 "승인된 계정만" 안내가 잘못 뜬다
    if (!CLOUD || !authReady) return;
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
    writeLocal('pagefy.publicRoot', settings.publicRoot);
  }, [settings.channel, settings.publicRoot]);

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

  // 설정을 바꾸면 작업에도 저장 (입력 중엔 잠깐 기다렸다가)
  useEffect(() => {
    if (!jobRef.current || jobRef.current.id !== jobId) return;
    const t = setTimeout(() => updateJob({ settings }), 500);
    return () => clearTimeout(t);
  }, [settings, jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 생성 중에 새로고침·닫기를 누르면 브라우저가 한 번 묻는다
  const running = run.phase === 'running';
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
      setLoadError('이 작업의 PSD 원본이 이 브라우저에 없습니다. 작업 목록의 「PSD 고르기」로 같은 PSD를 골라 주세요.');
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
        await buildFromPlan(job.meta, job.baseUrl!, job.plan.bundle, job.plan.report, job.plan.raw);
        setRevisionCount(job.revisionCount);
        setRun((r) => ({ ...r, phase: 'done' }));
        if (job.state !== 'done') updateJob({ state: 'done', error: undefined });
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

  /** 새 작업으로 저장 (PSD 원본은 뒤에서 천천히) */
  function newJob(file: File, s: Settings) {
    const now = Date.now();
    const nj: Job = { id: crypto.randomUUID(), createdAt: now, updatedAt: now, fileKey: fileKeyOf(file), fileName: file.name, fileSize: file.size, settings: s, state: 'ready', sections: {}, failed: {}, revisionCount: 0 };
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
    setRun(emptyRun());
    openSeq.current++; // 읽는 중이던 PSD 가 있으면 그 결과는 버린다
    // 화면 상태(loaded)는 늦게 바뀔 수 있어 ref 의 최신 값을 놓는다
    const prev = loadedRef.current;
    if (prev) {
      URL.revokeObjectURL(prev.compositeUrl);
      URL.revokeObjectURL(prev.notextUrl);
      // 문서 크기 비트맵(장당 수십~수백 MB)은 GC 를 기다리지 않고 바로 놓는다
      prev.composite.close();
      prev.notext.close();
    }
    setLoaded(null);
    loadedRef.current = null;
    dropCut();
    jobRef.current = null;
    setJobId(null);
    workerRef.current?.dispose();
    workerRef.current = null;
  }

  /** 머리의 Pagefy 를 누르면 첫 화면(PSD 올리기 + 최근 작업)으로. 생성 중·읽는 중엔 작업을 잃지 않게 그대로 둔다 */
  function goHome() {
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
      const opened = await worker.open(file, (m) => !stale() && setLoading(m));
      if (stale()) {
        opened.composite.close();
        opened.notext.close();
        return;
      }
      setLoading('미리보기 만드는 중…');
      const [compositeUrl, notextUrl] = await Promise.all([bitmapToUrl(opened.composite), bitmapToUrl(opened.notext)]);
      if (stale()) {
        URL.revokeObjectURL(compositeUrl);
        URL.revokeObjectURL(notextUrl);
        opened.composite.close();
        opened.notext.close();
        return;
      }
      const L: Loaded = { file, ...opened, compositeUrl, notextUrl };
      loadedRef.current = L;
      setLoaded(L);
      if (import.meta.env.DEV) (window as unknown as { __pagefy: unknown }).__pagefy = { ...opened, compositeUrl, notextUrl }; // 개발 점검용
      console.info(`[psd] ${file.name} ${Math.round(performance.now() - t0)}ms`);
      if (job) {
        // 저장된 작업 이어서
        jobRef.current = job;
        setJobId(job.id);
        setSettings(job.settings);
        await restoreJob(job);
        return;
      }
      const name = productNameFromFile(file.name);
      // 규칙 6-1: 슬러그는 한 번 정하면 바꾸지 않는다 → 이 PC 에서 그 제품에 썼던 슬러그를 다시 쓴다
      const savedSlug = readLocal<Record<string, string>>('pagefy.slugs', {})[name];
      const next: Settings = { ...settings, productName: name, slug: savedSlug || toSlug(name), rev: todayRev() };
      setSettings(next);
      newJob(file, next);
    } catch (e) {
      if (!stale()) setLoadError(`PSD를 읽지 못했습니다: ${(e as Error).message}`); // 다음 PSD 를 여느라 끊은 것이면 알리지 않음
    } finally {
      if (!stale()) setLoading(null);
    }
  }

  const meta: GenerateMeta = useMemo(
    () => ({ productName: settings.productName.trim(), channel: settings.channel, slug: settings.slug, rev: settings.rev, publicRoot: settings.publicRoot.trim(), date: kstDate() }),
    [settings],
  );
  const baseUrl = `${meta.publicRoot.replace(/\/+$/, '')}/${meta.channel}/${meta.slug}/${meta.rev}`;

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
  async function finalize(m: GenerateMeta, base: string, bundle: PlanBundle, planReport: string, planRaw: string, sections: SectionOut[], images: CutImage[], extraChecks: Check[]) {
    const L = loadedRef.current!;
    const html = assembleHtml(m, bundle, sections, L.summary);
    const parsed: ParsedOutput = { plan: bundle.plan, html, report: assembleReport(planReport, sections) };
    const previewHtml = localizeHtml(html, base, images);
    let layout: LayoutResult | undefined;
    // 코드 생성 방식은 이미지에 일부러 남긴 글자를 대조·누락 검사에서 뺀다 (HTML 에 없는 게 맞음 — 미리보기의 「이미지에 남긴 글자」로 따로 보여 줌)
    const kept = bundle.plan.engine === 'code' ? new Set(keepMap(L.summary, bundle.plan, m.channel === 'openmarket').keys()) : undefined;
    pushStatus('PSD 위치 대조 중 (PSD 폭 렌더·모바일 360px)…');
    try {
      layout = await checkLayout(previewHtml, L.summary, kept);
    } catch (e) {
      extraChecks.push({ level: 'warn', message: `위치 대조 실패: ${(e as Error).message}` });
    }
    const checks = [...extraChecks, ...(layout?.checks ?? []), ...checkOutput(parsed, L.summary, base, kept)];
    setResult({ meta: m, baseUrl: base, bundle, planReport, planRaw, sections, parsed, images, previewHtml, checks, layout });
    // 완성 HTML 도 작업에 저장 → PSD 원본이 없는 PC 에서도 「결과 보기」로 볼 수 있다 (같으면 다시 저장하지 않음)
    if (jobRef.current && jobRef.current.html !== html) updateJob({ html });
  }

  /**
   * 코드 생성 방식: 구조 계획 → 자간 측정 → 마크업 생성(PSD 값) → 이미지 자르기 → 점검. API 호출 없음 (몇 초)
   * psd2html build.js 와 같은 방식이라, Claude 는 구조만 정하고 위치·크기·자간은 여기서 계산한다
   */
  async function buildFromPlan(m: GenerateMeta, base: string, planBundle: PlanBundle, planReport: string, planRaw: string, extraChecks: Check[] = [], signal?: AbortSignal) {
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
    extraChecks.push(...gen.warnings.map((message) => ({ level: 'warn', message }) as Check));
    setRun((r) => ({ ...r, thinking: '', sections: gen.sections.map((s) => ({ id: s.id, name: s.name, state: 'done', chars: s.html.length })) }));
    const report = [planReport.trim(), gen.bundle.notes].filter(Boolean).join('\n\n');
    await finalize(m, base, gen.bundle, report, planRaw, gen.sections, cut.images, extraChecks);
  }

  /** 계획 응답을 읽는다. 새 계획은 모두 코드 생성 방식으로 본다 (섹션별 Claude 작성은 저장된 옛 작업에만) */
  function readPlan(text: string) {
    const pp = parsePlanOutput(text);
    if (!pp.plan) throw new Error(pp.error || '계획을 읽지 못했습니다.');
    const bundle: PlanBundle = { plan: { ...pp.plan, engine: 'code' }, style: pp.style, notes: pp.notes };
    return { bundle, report: pp.report };
  }

  /** 마크업 생성. 저장된 계획이 지금 설정과 같으면 계획을 건너뛰고 남은 섹션만 만든다 (fresh = 처음부터) */
  async function generate(fresh = false) {
    const L = loadedRef.current;
    if (!L || !workerRef.current) return;
    // 지금 열린 작업을 목록에서 지운 뒤에도 버튼이 먹히게 새 작업으로 다시 저장
    if (!jobRef.current) newJob(L.file, settings);
    if (!jobRef.current) return;
    // 같은 작업을 두 탭에서 만들면 같은 섹션을 두 번 요청(비용 2배)하고 서로 결과를 덮어쓴다
    if ((await busyJobIds()).has(jobRef.current.id)) {
      setRun({ ...emptyRun(), phase: 'error', error: BUSY_MSG });
      return;
    }
    const ac = new AbortController();
    abortRef.current = ac;
    const m = meta;
    const base = baseUrl;
    const saved = !fresh && resume ? jobRef.current : null;
    // 처음부터 다시 만들 때 실패해도 이전 결과·계획이 남게 (새 계획을 받기 전까지는 작업 기록을 지우지 않는다)
    const prevResult = result;
    const prevRevisions = revisionCount;
    let planReady = !!saved?.plan;
    setResult(null);
    setRevisionCount(0);
    writeLocal('pagefy.slugs', { ...readLocal<Record<string, string>>('pagefy.slugs', {}), [m.productName]: m.slug });
    const release = holdLock(jobRef.current.id);
    const t0 = Date.now();
    try {
      let bundle: PlanBundle, planReport: string, planRaw: string;
      if (saved?.plan) {
        // 0) 저장된 계획에서 이어서
        ({ bundle, report: planReport, raw: planRaw } = saved.plan);
        setRun({ ...emptyRun(), phase: 'running', startedAt: t0, usage: saved.usage, model: saved.model, status: [`저장된 계획으로 이어서 (섹션 ${Object.keys(saved.sections).length}/${bundle.plan.sections.length}개 완료)`] });
        updateJob({ state: 'running', error: undefined, failed: {} });
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
            { meta: m, summary: L.summary, tiles, extra: settings.extra },
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
        updateJob((j) => ({ meta: m, baseUrl: base, extra: settings.extra, plan: { bundle, report: planReport, raw: planRaw }, sections: {}, failed: {}, revisionCount: 0, usage: addUsage(j.usage, planOut.usage), model: planOut.model }));
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
      // 새 계획을 받기 전에 실패했으면 이전 결과를 그대로 보여 주고 작업도 완료 상태로 둔다 (다시 만들기·수정 요청 가능)
      if (!planReady && prevResult) {
        setResult(prevResult);
        setRevisionCount(prevRevisions);
        setRun((r) => ({ ...r, phase: 'error', error: `${msg} — 이전 결과는 그대로 남아 있습니다.`, sections: stopRunning(r.sections) }));
        updateJob({ state: 'done', error: undefined });
        return;
      }
      setRun((r) => ({ ...r, phase: 'error', error: msg, sections: stopRunning(r.sections) }));
      updateJob({ state: ac.signal.aborted ? 'stopped' : 'error', error: msg });
    } finally {
      abortRef.current = null;
      release();
    }
  }

  /** 고를 섹션만 다시 만든다 (feedback: 섹션 id → 고칠 내용) */
  async function revise(feedback: Record<string, string>) {
    if (!result || !loaded) return;
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

  /** 코드 생성 방식의 수정: 고칠 내용을 구조 계획 수정으로 보내고(Claude 1회), 마크업은 다시 계산한다 */
  async function revisePlan(feedback: Record<string, string>) {
    if (!result || !loaded || !workerRef.current) return;
    const ac = new AbortController();
    abortRef.current = ac;
    const L0 = loadedRef.current!;
    const ids = Object.keys(feedback);
    const allSecs = ids.length === result.sections.length;
    const text = allSecs
      ? [...new Set(Object.values(feedback))].join('\n')
      : ids.map((id) => `- 섹션 ${id} ${result.sections.find((s) => s.id === id)?.name ?? ''}: ${feedback[id]}`).join('\n');
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
      await buildFromPlan(result.meta, result.baseUrl, bundle, report, out.text, [], ac.signal);
      // 새 계획은 마크업까지 성공한 뒤에 저장한다 (실패하면 이전 계획·결과를 그대로 둔다)
      updateJob({ plan: { bundle, report, raw: out.text } });
      setRevisionCount((n) => n + 1);
      setRun((r) => ({ ...r, phase: 'done', endedAt: Date.now() }));
      updateJob((j) => ({ state: 'done', revisionCount: j.revisionCount + 1 }));
    } catch (e) {
      if (loadedRef.current !== L0) return;
      // 실패해도 이전 결과는 그대로 둔다
      setRun((r) => ({ ...r, phase: 'error', error: ac.signal.aborted ? '취소했습니다.' : `수정 실패 (이전 결과 유지): ${(e as Error).message}` }));
      updateJob({ state: 'done' });
    } finally {
      abortRef.current = null;
      release();
    }
  }

  /**
   * 이미지 서버에 올리기 (규칙 6절): 서버가 FTP 로 올리고 공개 주소를 열어 확인한다.
   * - 이 작업의 표시(token)가 있는 rev 폴더만 쓴다 (같은 작업이 끊겼다 이어 올리면 같은 크기 파일은 건너뜀)
   * - 표시가 없는 폴더(다른 작업·사람)가 이미 있으면 덮어쓰지 않고 새 번호 rev 로 다시 만들라고 안내한다
   * - 결과가 바뀌면(수정·새 rev) 진행 중인 업로드를 멈추고, 늦게 온 응답은 버린다
   */
  async function uploadImages(): Promise<boolean> {
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
      const token = await uploadToken(jobRef.current?.id ?? r.baseUrl, r.meta.rev);
      const target: UploadTarget = { channel: r.meta.channel, slug: r.meta.slug, rev: r.meta.rev, publicRoot: r.meta.publicRoot, token };
      set({ phase: 'checking', done: 0, total });
      const remote = await uploadCheck(target, ac.signal);
      if (remote.exists && !remote.owned) {
        set({
          phase: 'conflict',
          done: 0,
          total,
          nextRev: nextRev(r.meta.rev),
          message: `서버에 ${r.meta.rev} 폴더가 이미 있습니다 (다른 작업이 올린 이미지 ${remote.files.length}개). 판매 중인 페이지가 바뀌지 않게 덮어쓰지 않습니다.`,
        });
        return false;
      }
      // 같은 작업이 끊겼다 이어 올리는 경우: 같은 이름·크기 파일은 건너뛴다 (내용은 아래 확인에서 SHA-256 으로 다시 본다)
      const sizes = new Map(r.images.map((im) => [im.file, im.blob.size]));
      const skip = new Set(remote.files.filter((f) => sizes.get(f.file) === f.size).map((f) => f.file));
      const stray = remote.files.filter((f) => !skip.has(f.file));
      if (stray.length) {
        set({ phase: 'conflict', done: 0, total, nextRev: nextRev(r.meta.rev), message: `서버의 ${r.meta.rev} 폴더에 이 결과와 다른 파일이 있습니다 (${stray.map((f) => f.file).slice(0, 3).join(', ')}…). 덮어쓰지 않습니다.` });
        return false;
      }
      let done = skip.size;
      set({ phase: 'uploading', done, total });
      // 4MB·40장 안쪽으로 묶어 보낸다 (서버는 한 번에 60장까지) (함수 요청 크기·150초 제한). 서버가 시간 때문에 남긴 파일(left)은 다음 묶음으로
      const queue = r.images.filter((im) => !skip.has(im.file));
      while (queue.length) {
        const batch: { file: string; data: string }[] = [];
        let bytes = 0;
        while (queue.length && batch.length < 40 && (!batch.length || bytes + queue[0].blob.size <= 4 * 1024 * 1024)) {
          const im = queue.shift()!;
          batch.push({ file: im.file, data: await blobToBase64(im.blob) });
          bytes += im.blob.size;
        }
        const out = await uploadFiles(target, batch, ac.signal);
        if (out.refused.length) throw new Error(out.refused.map((x) => `${x.file}: ${x.error}`).join(' / '));
        done += out.done.length;
        set((u) => ({ ...u, done }));
        if (out.left?.length) {
          if (!out.done.length) throw new Error('서버 시간 안에 한 장도 올리지 못했습니다. 잠시 뒤 다시 올리기를 누르세요.');
          queue.unshift(...r.images.filter((im) => out.left!.includes(im.file)));
        }
      }
      set((u) => ({ ...u, phase: 'verifying' }));
      const want = await Promise.all(r.images.map(async (im) => ({ file: im.file, size: im.blob.size, sha256: await sha256Hex(im.blob) })));
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
        message: bad.length ? `올린 뒤 ${bad.length}장이 열리지 않거나 내용이 다릅니다. 잠시 뒤 「다시 올리기」로 다시 확인하고, 계속 다르면 새 번호 rev 로 다시 만드세요.` : undefined,
      });
      return !bad.length && live();
    } catch (e) {
      if (ac.signal.aborted) return false;
      set((u) => ({ ...u, phase: 'error', message: `업로드 실패: ${(e as Error).message}` }));
      return false;
    }
  }

  /** 같은 날짜 폴더를 다른 작업이 쓰고 있을 때: rev 를 다음 번호로 바꾸고 저장된 구조 계획으로 다시 만든다 (Claude 호출 없음) */
  /**
   * 잘못 올린 것 되돌리기 — 방금 이 작업이 올린 rev 폴더를 지운다 (서버가 이 작업 폴더인지·다른 파일이 없는지 다시 확인).
   * 다 지우면 업로드 전 상태로 돌아가 「HTML 복사」를 누르면 다시 올린다
   */
  async function undoUpload() {
    if (!result) return;
    const runId = ++uploadRunRef.current;
    uploadAbortRef.current?.abort();
    const ac = new AbortController();
    uploadAbortRef.current = ac;
    const live = () => runId === uploadRunRef.current && !ac.signal.aborted;
    const set = (u: UploadState | ((u: UploadState) => UploadState)) => live() && setUpload(u);
    const r = result;
    const total = r.images.length;
    try {
      const token = await uploadToken(jobRef.current?.id ?? r.baseUrl, r.meta.rev);
      const target: UploadTarget = { channel: r.meta.channel, slug: r.meta.slug, rev: r.meta.rev, publicRoot: r.meta.publicRoot, token };
      set({ phase: 'removing', done: 0, total });
      const files = r.images.map((im) => im.file);
      let removed = 0;
      // 함수 시간 제한으로 남긴 파일이 있으면 이어서 요청 (조금도 못 지우면 멈춤)
      for (let i = 0; i < 10; i++) {
        const out = await uploadRemove(target, files, ac.signal);
        removed += out.removed.length;
        set((u) => ({ ...u, done: removed }));
        if (out.folderRemoved) {
          set({ phase: 'removed', done: removed, total, message: `이미지 서버에서 ${r.meta.rev} 폴더(이미지 ${removed}장)를 지웠습니다.` });
          return;
        }
        if (!out.removed.length) break;
      }
      throw new Error('서버 시간 안에 다 지우지 못했습니다. 잠시 뒤 다시 눌러 주세요.');
    } catch (e) {
      if (ac.signal.aborted) return;
      set((u) => ({ ...u, phase: 'error', message: `되돌리기 실패: ${(e as Error).message}` }));
    }
  }

  async function rebuildWithNextRev() {
    if (!result || !loadedRef.current || running) return;
    const plan = jobRef.current?.plan ?? { bundle: result.bundle, report: result.planReport, raw: result.planRaw };
    if (plan.bundle.plan.engine !== 'code') return;
    uploadAbortRef.current?.abort();
    const rev = nextRev(result.meta.rev);
    const m = { ...result.meta, rev };
    const base = `${m.publicRoot.replace(/\/+$/, '')}/${m.channel}/${m.slug}/${rev}`;
    setRun((r) => ({ ...r, phase: 'running', error: undefined, status: [...r.status, `rev 를 ${rev} 로 바꿔 다시 만듭니다 (비용 없음) — 전에 복사해 둔 HTML 이 있으면 새로 복사하세요`] }));
    try {
      await buildFromPlan(m, base, plan.bundle, plan.report, plan.raw);
      // 다시 만들기가 끝난 뒤에만 설정·작업 기록을 바꾼다 (실패하면 이전 rev 그대로)
      setSettings((st) => ({ ...st, rev }));
      updateJob({ meta: m, baseUrl: base, state: 'done' });
      setRun((r) => ({ ...r, phase: 'done' }));
    } catch (e) {
      setRun((r) => ({ ...r, phase: 'error', error: (e as Error).message }));
    }
  }

  async function removeJob(id: string) {
    setViewJob((v) => (v?.id === id ? null : v));
    if (jobRef.current?.id === id) {
      jobRef.current = null;
      setJobId(null);
    }
    // 지우기 = 휴지통으로 (30일 안에 복원). 영구 삭제는 휴지통에서
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
    if (!cur?.plan || !cur.meta || cur.state === 'done' || cur.state === 'running') return null;
    const total = cur.plan.bundle.plan.sections.length;
    const missing = total - Object.keys(cur.sections).length;
    if (!missing) return null;
    const same = sameMeta(cur.meta, meta) && (cur.extra ?? '') === settings.extra;
    return { missing, total, same, code: cur.plan.bundle.plan.engine === "code" };
  })();
  const resume = resumeInfo?.same ? resumeInfo : null;

  const ready = !!health && (health.mock || health.hasKey);
  // 만들기 버튼이 왜 안 눌리는지 담당자에게 알려 준다
  const blockers = [
    !meta.productName && '제품명을 입력하세요.',
    !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(meta.slug) && '고급 설정에서 제품슬러그를 영문 소문자·숫자·하이픈으로 입력하세요.',
    !/^\d{8}(-\d+)?$/.test(meta.rev) && '고급 설정의 rev 는 20261123 처럼 날짜 8자리여야 합니다.',
    !/^https:\/\//.test(meta.publicRoot) && '고급 설정의 이미지 공개 주소는 https:// 로 시작해야 합니다.',
    !health && !healthError && '생성 서버 연결을 확인하는 중입니다…',
    healthError && '생성 서버에 연결하지 못했습니다. 위쪽 빨간 표시를 확인하세요.',
    health && !ready && '생성 서버에 Claude API 키가 없습니다. 관리자에게 알려 주세요.',
  ].filter((b): b is string => !!b);
  const canGenerate = !!loaded && !blockers.length && run.phase !== 'running';
  const hasResult = run.phase !== 'idle' || !!result;
  const step = !loaded ? 1 : result && !running ? 4 : hasResult ? 3 : 2;

  // 생성을 시작하면 진행 상황이 보이게 결과 칸으로 내린다
  useEffect(() => {
    if (running) document.getElementById('result')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [running]);

  // 토큰 갱신 중(role 확인 중)이라도 이미 로그인돼 있으면 작업 화면을 유지한다
  const showLogin = CLOUD && authReady && !allowed && !(session && (role === null || role === 'guest'));

  return (
    <div className="app">
      <Header
        health={health}
        error={healthError}
        user={
          CLOUD && session
            ? { email: session.user.email ?? '', name: session.user.user_metadata?.name, avatarUrl: session.user.user_metadata?.avatar_url || undefined }
            : undefined
        }
        onLogout={CLOUD && session ? () => supabase.auth.signOut() : undefined}
        // 첫 화면(PSD 올리기 칸이 크게 보임)에선 숨기고, PSD 를 연 뒤·저장된 결과를 볼 때만
        onNewPsd={allowed && (loaded || viewJob) ? (f) => (window.scrollTo({ top: 0, behavior: 'smooth' }), openPsd(f)) : undefined}
        newPsdDisabled={running || !!loading}
        onHome={goHome}
        homeBusy={running || !!loading}
      />
      {/* 화면 어디에 PSD 를 놓아도 연다 — PSD 를 연 뒤엔 끌고 있는 동안만 화면 전체 안내판 */}
      <DropOverlay
        enabled={allowed && !showLogin}
        cover={!!loaded}
        disabled={running || !!loading}
        onFile={(f) => (window.scrollTo({ top: 0, behavior: 'smooth' }), openPsd(f))}
      />
      <main className="app__main">
        {showLogin ? (
          <LoginPanel session={session} role={role} />
        ) : (
          <>
            <Stepper step={step} />
            <UploadPanel
              onFile={(f) => openPsd(f)}
              loading={loading}
              error={loadError}
              disabled={running}
              file={loaded ? { name: loaded.file.name, size: loaded.file.size, width: loaded.summary.width, height: loaded.summary.height, thumbUrl: loaded.compositeUrl } : null}
            />
            {viewJob && <SavedView job={viewJob} onClose={() => setViewJob(null)} />}
            {!loaded && allowed && (jobs.length > 0 || jobsLoading || trashN > 0 || !!trash) && <JobsPanel jobs={jobs} currentId={jobId} busy={!!loading || running} account={savesToAccount()} more={moreJobs} loading={jobsLoading} onMore={showMoreJobs} onOpen={openJob} onRemove={removeJob} onView={showSaved} trash={trash} trashN={trashN} trashLoading={trashLoading} onTrashOpen={openTrash} onTrashClose={() => setTrash(null)} onRestore={restoreFromTrash} onPurge={purgeFromTrash} />}
            {loaded && !hasResult && <SummaryPanel loaded={loaded} />}
            {loaded && (
              <SettingsPanel
                collapsed={hasResult && run.phase !== 'error'}
                blockers={blockers}
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
            {hasResult && loaded && (
              <div id="result" className="app__anchor">
              <ResultPanel
                run={run}
                result={result}
                loaded={loaded}
                revisionCount={revisionCount}
                onRevise={revise}
                onCancel={() => abortRef.current?.abort()}
                onResume={resume && canGenerate ? () => generate() : undefined}
                upload={health?.upload && result?.bundle.plan.engine === 'code' ? upload : undefined}
                onUpload={uploadImages}
                onNewRev={rebuildWithNextRev}
                onUndoUpload={undoUpload}
                resumeLabel={resume ? (resume.code ? "저장된 계획으로 마무리 (비용 없음)" : `이어서 만들기 (남은 섹션 ${resume.missing}개)`) : undefined}
              />
              </div>
            )}
            {loaded && (jobs.length > 0 || jobsLoading || trashN > 0 || !!trash) && <JobsPanel jobs={jobs} currentId={jobId} busy={!!loading || running} account={savesToAccount()} more={moreJobs} loading={jobsLoading} onMore={showMoreJobs} onOpen={openJob} onRemove={removeJob} onView={showSaved} trash={trash} trashN={trashN} trashLoading={trashLoading} onTrashOpen={openTrash} onTrashClose={() => setTrash(null)} onRestore={restoreFromTrash} onPurge={purgeFromTrash} />}
          </>
        )}
      </main>
    </div>
  );
}

/** 20261123 → 20261123-2, 20261123-2 → 20261123-3 (규칙 6-1: 같은 날 다시 올리면 -2, -3 …) */
function nextRev(rev: string) {
  const m = /^(\d{8})(?:-(\d+))?$/.exec(rev);
  if (!m) return rev;
  return `${m[1]}-${m[2] ? Number(m[2]) + 1 : 2}`;
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

/** 업로드 표시: 같은 작업·같은 rev 면 늘 같은 값 (끊겼다 이어 올릴 때 자기 폴더를 알아본다) */
async function uploadToken(jobKey: string, rev: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`pagefy:${jobKey}:${rev}`));
  return [...new Uint8Array(h)].slice(0, 12).map((x) => x.toString(16).padStart(2, '0')).join('');
}
