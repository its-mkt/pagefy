import { useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { GenerateMeta, HealthInfo, PlanBundle, PsdSummary, SectionRequest, UsageInfo } from '../shared/types';
import { CLOUD, collect, fetchHealth } from './lib/api';
import { canUse, fetchRole, supabase, type Role } from './lib/supabase';
import { bitmapToUrl, cutImages, localizeHtml, type CutImage } from './lib/images';
import { checkOutput, parsePlanOutput, parseSectionOutput, type Check, type ParsedOutput } from './lib/output';
import { assembleHtml, assembleReport, type SectionOut } from './lib/assemble';
import { checkLayout, type LayoutResult } from './lib/layoutCheck';
import { PsdWorker } from './lib/psd/client';
import { kstDate, productNameFromFile, readLocal, todayRev, toSlug, writeLocal } from './lib/util';
import { deleteJob, fileKeyOf, getFile, listJobs, markInterrupted, prune, putJob, requestPersist, saveFile, sameMeta, type Job } from './lib/jobs';
import Header from './components/Header';
import JobsPanel from './components/JobsPanel';
import LoginPanel from './components/LoginPanel';
import UploadPanel from './components/UploadPanel';
import SummaryPanel from './components/SummaryPanel';
import SettingsPanel, { type Settings } from './components/SettingsPanel';
import ResultPanel from './components/ResultPanel';

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
  return release;
}

const failedSection = (s: { id: string; name: string }, msg: string): SectionOut => ({ id: s.id, name: s.name, html: '', css: '', notes: `생성 실패: ${msg}`, raw: '' });

/** 작업들을 n 개씩 동시에 */
async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    for (let it = queue.shift(); it !== undefined; it = queue.shift()) await fn(it);
  }));
}

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
  const [revisionCount, setRevisionCount] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  // 작업 목록 (IndexedDB) — 화면에 보이는 목록과, 지금 열린 작업의 최신본
  const [jobs, setJobs] = useState<Job[]>([]);
  const jobRef = useRef<Job | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  // 비동기 함수 안에서 최신 PSD·잘라 둔 이미지를 쓰기 위해
  const loadedRef = useRef<Loaded | null>(null);
  const cutRef = useRef<{ images: CutImage[]; errors: string[] } | null>(null);

  const refreshJobs = () => listJobs().then(setJobs, (e) => console.warn('[jobs]', e));
  /** 지금 작업을 고쳐 저장 (섹션이 동시에 끝나도 ref 에서 이어 붙여 잃지 않는다) */
  function updateJob(patch: Partial<Job> | ((j: Job) => Partial<Job>)) {
    const cur = jobRef.current;
    if (!cur) return;
    const next = { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch), updatedAt: Date.now() };
    jobRef.current = next;
    putJob(next).then(refreshJobs, (e) => console.warn('[jobs] 저장 실패', e));
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
    if (!CLOUD) return;
    setRole(null);
    if (session) fetchRole(session.access_token).then((r) => setRole(r ?? 'invalid'));
    else setRole('guest');
  }, [session?.access_token]); // eslint-disable-line react-hooks/exhaustive-deps

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
    markInterrupted().catch(() => {}).finally(refreshJobs);
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
  async function openJob(job: Job) {
    const file = await getFile(job.fileKey).catch(() => undefined);
    if (!file) {
      setLoadError('이 작업의 PSD 원본이 브라우저에 저장돼 있지 않습니다. 같은 PSD를 다시 올려 주세요.');
      return;
    }
    await openPsd(file, job);
  }

  async function restoreJob(job: Job) {
    if (!job.plan || !job.meta) {
      if (job.state === 'stopped' || job.state === 'error')
        setRun({ ...emptyRun(), phase: 'error', usage: job.usage, model: job.model, error: job.state === 'stopped' ? '계획을 받는 중에 중단된 작업입니다. 「마크업 생성」으로 다시 만드세요.' : job.error });
      return;
    }
    setLoading('저장된 작업 불러오는 중…');
    const secs = job.plan.bundle.plan.sections;
    const cut = await cutImages(job.plan.bundle.plan, workerRef.current!);
    cutRef.current = cut;
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

  async function openPsd(file: File, job?: Job) {
    setLoadError(null);
    setResult(null);
    setRevisionCount(0);
    setRun(emptyRun());
    if (loaded) {
      URL.revokeObjectURL(loaded.compositeUrl);
      URL.revokeObjectURL(loaded.notextUrl);
    }
    setLoaded(null);
    loadedRef.current = null;
    cutRef.current = null;
    jobRef.current = null;
    setJobId(null);
    workerRef.current?.dispose();
    const worker = new PsdWorker();
    workerRef.current = worker;
    try {
      const t0 = performance.now();
      const opened = await worker.open(file, setLoading);
      setLoading('미리보기 만드는 중…');
      const [compositeUrl, notextUrl] = await Promise.all([bitmapToUrl(opened.composite), bitmapToUrl(opened.notext)]);
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
      // 새 작업으로 저장 (PSD 원본은 뒤에서 천천히)
      const now = Date.now();
      const nj: Job = { id: crypto.randomUUID(), createdAt: now, updatedAt: now, fileKey: fileKeyOf(file), fileName: file.name, fileSize: file.size, settings: next, state: 'ready', sections: {}, failed: {}, revisionCount: 0 };
      jobRef.current = nj;
      setJobId(nj.id);
      putJob(nj)
        .then(() => prune(nj.id))
        .then(refreshJobs)
        .then(() => saveFile(file))
        .then((ok) => !ok && updateJob({ noFile: true }))
        .catch((e) => console.warn('[jobs]', e));
    } catch (e) {
      setLoadError(`PSD를 읽지 못했습니다: ${(e as Error).message}`);
    } finally {
      setLoading(null);
    }
  }

  const meta: GenerateMeta = useMemo(
    () => ({ productName: settings.productName.trim(), channel: settings.channel, slug: settings.slug, rev: settings.rev, publicRoot: settings.publicRoot.trim(), date: kstDate() }),
    [settings],
  );
  const baseUrl = `${meta.publicRoot.replace(/\/+$/, '')}/${meta.channel}/${meta.slug}/${meta.rev}`;

  const pushStatus = (m: string) => setRun((r) => ({ ...r, status: [...r.status, m] }));
  const setSection = (id: string, patch: Partial<SectionProgress>) => setRun((r) => ({ ...r, sections: r.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));

  /** 섹션 하나 요청 */
  async function runSection(m: GenerateMeta, bundle: PlanBundle, id: string, signal: AbortSignal, revision?: SectionRequest['revision']): Promise<SectionOut> {
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
    const out = await collect('section', req, { text: (all) => setSection(id, { chars: all.length }) }, signal);
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
    pushStatus('PSD 위치 대조 중 (PSD 폭 렌더·모바일 360px)…');
    try {
      layout = await checkLayout(previewHtml, L.summary);
    } catch (e) {
      extraChecks.push({ level: 'warn', message: `위치 대조 실패: ${(e as Error).message}` });
    }
    const checks = [...extraChecks, ...(layout?.checks ?? []), ...checkOutput(parsed, L.summary, base)];
    setResult({ meta: m, baseUrl: base, bundle, planReport, planRaw, sections, parsed, images, previewHtml, checks, layout });
  }

  /** 마크업 생성. 저장된 계획이 지금 설정과 같으면 계획을 건너뛰고 남은 섹션만 만든다 (fresh = 처음부터) */
  async function generate(fresh = false) {
    const L = loadedRef.current;
    if (!L || !workerRef.current || !jobRef.current) return;
    const ac = new AbortController();
    abortRef.current = ac;
    const m = meta;
    const base = baseUrl;
    const saved = !fresh && resume ? jobRef.current : null;
    setResult(null);
    setRevisionCount(0);
    writeLocal('pagefy.slugs', { ...readLocal<Record<string, string>>('pagefy.slugs', {}), [m.productName]: m.slug });
    const release = holdLock(jobRef.current.id);
    try {
      let bundle: PlanBundle, planReport: string, planRaw: string;
      if (saved?.plan) {
        // 0) 저장된 계획에서 이어서
        ({ bundle, report: planReport, raw: planRaw } = saved.plan);
        setRun({ ...emptyRun(), phase: 'running', usage: saved.usage, model: saved.model, status: [`저장된 계획으로 이어서 (섹션 ${Object.keys(saved.sections).length}/${bundle.plan.sections.length}개 완료)`] });
        updateJob({ state: 'running', error: undefined, failed: {} });
      } else {
        setRun({ ...emptyRun(), phase: 'running', status: ['PSD 렌더 타일 만드는 중…'] });
        updateJob({ state: 'running', error: undefined, meta: m, baseUrl: base, extra: settings.extra, plan: undefined, sections: {}, failed: {}, usage: undefined, model: undefined, revisionCount: 0 });
        // 1) 계획
        const tiles = await workerRef.current.tiles();
        pushStatus(`① 계획: 타일 ${tiles.length}장 + 레이어 정보 전송`);
        const planOut = await collect(
          'plan',
          { meta: m, summary: L.summary, tiles, extra: settings.extra },
          {
            status: (msg) => pushStatus(`① ${msg}`),
            thinking: (t) => setRun((r) => ({ ...r, thinking: (r.thinking + t).slice(-4000) })),
            text: (all) => setRun((r) => ({ ...r, planChars: all.length })),
          },
          ac.signal,
        );
        setRun((r) => ({ ...r, usage: addUsage(r.usage, planOut.usage), model: planOut.model }));
        const pp = parsePlanOutput(planOut.text);
        if (!pp.plan) throw new Error(pp.error || '계획을 읽지 못했습니다.');
        bundle = { plan: pp.plan, style: pp.style, notes: pp.notes };
        planReport = pp.report;
        planRaw = planOut.text;
        updateJob((j) => ({ plan: { bundle, report: planReport, raw: planRaw }, usage: addUsage(j.usage, planOut.usage), model: planOut.model }));
        pushStatus(`① 계획 완료: 섹션 ${pp.plan.sections.length}개, 이미지 ${pp.plan.images.length}장`);
      }
      const plan = bundle.plan;

      // 이미지 자르기 (워커) — 이어서 할 땐 불러올 때 잘라 둔 것을 쓴다
      const cut = saved && cutRef.current ? cutRef.current : await cutImages(plan, workerRef.current);
      cutRef.current = cut;
      const extraChecks: Check[] = cut.errors.map((msg) => ({ level: 'error', message: `이미지 자르기 실패 ${msg}` }));

      // 2) 섹션별 (동시에)
      const outs = new Map<string, SectionOut>(Object.entries(saved?.sections ?? {}));
      const todo = plan.sections.filter((s) => !outs.has(s.id));
      pushStatus(`② 섹션 ${todo.length}개를 ${CONCURRENCY}개씩 동시에 작성${outs.size ? ` (완료된 ${outs.size}개는 건너뜀)` : ''}`);
      setRun((r) => ({ ...r, thinking: '', sections: plan.sections.map((s) => ({ id: s.id, name: s.name, state: outs.has(s.id) ? 'done' : 'wait', chars: outs.get(s.id)?.raw.length ?? 0 })) }));
      await pool(todo, CONCURRENCY, async (s) => {
        try {
          outs.set(s.id, await runSection(m, bundle, s.id, ac.signal));
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
      setRun((r) => ({ ...r, phase: 'done' }));
      updateJob({ state: 'done' });
    } catch (e) {
      const msg = ac.signal.aborted ? '취소했습니다.' : (e as Error).message;
      setRun((r) => ({ ...r, phase: 'error', error: msg }));
      updateJob({ state: ac.signal.aborted ? 'stopped' : 'error', error: msg });
    } finally {
      abortRef.current = null;
      release();
    }
  }

  /** 고를 섹션만 다시 만든다 (feedback: 섹션 id → 고칠 내용) */
  async function revise(feedback: Record<string, string>) {
    if (!result || !loaded) return;
    const ac = new AbortController();
    abortRef.current = ac;
    const ids = Object.keys(feedback);
    setRun((r) => ({
      ...r,
      phase: 'running',
      error: undefined,
      status: [...r.status, `수정 요청: ${ids.join(', ')}`],
      sections: result.sections.map((s) => ({ id: s.id, name: s.name, state: ids.includes(s.id) ? 'wait' : 'done', chars: s.raw.length })),
    }));
    const extraChecks: Check[] = [];
    const release = jobRef.current ? holdLock(jobRef.current.id) : () => {};
    updateJob({ state: 'running', error: undefined });
    try {
      const next = [...result.sections];
      await pool(ids, CONCURRENCY, async (id) => {
        const i = next.findIndex((s) => s.id === id);
        const prev = next[i];
        try {
          next[i] = await runSection(result.meta, result.bundle, id, ac.signal, prev.raw ? { previous: prev.raw, feedback: feedback[id] } : undefined);
        } catch (e) {
          if (ac.signal.aborted) throw e;
          setSection(id, { state: 'error', error: (e as Error).message });
          extraChecks.push({ level: 'error', message: `${id} 수정 실패: ${(e as Error).message} (이전 결과 유지)` });
        }
      });
      await finalize(result.meta, result.baseUrl, result.bundle, result.planReport, result.planRaw, next, result.images, extraChecks);
      setRevisionCount((n) => n + 1);
      setRun((r) => ({ ...r, phase: 'done' }));
      updateJob((j) => ({ state: 'done', revisionCount: j.revisionCount + 1 }));
    } catch (e) {
      // 수정 중 취소·오류여도 이전 결과는 그대로 있으므로 작업은 완료 상태로 둔다
      setRun((r) => ({ ...r, phase: 'error', error: ac.signal.aborted ? '취소했습니다.' : (e as Error).message }));
      updateJob({ state: 'done' });
    } finally {
      abortRef.current = null;
      release();
    }
  }

  async function removeJob(id: string) {
    if (jobRef.current?.id === id) {
      jobRef.current = null;
      setJobId(null);
    }
    await deleteJob(id).catch((e) => console.warn('[jobs]', e));
    refreshJobs();
  }

  // 이어서 만들 수 있는지: 저장된 계획이 있고, 계획 때 설정과 지금 설정이 같고, 남은 섹션이 있을 때
  const cur = jobId ? jobs.find((j) => j.id === jobId) ?? jobRef.current : null;
  const resumeInfo = (() => {
    if (!cur?.plan || !cur.meta || cur.state === 'done' || cur.state === 'running') return null;
    const total = cur.plan.bundle.plan.sections.length;
    const missing = total - Object.keys(cur.sections).length;
    if (!missing) return null;
    const same = sameMeta(cur.meta, meta) && (cur.extra ?? '') === settings.extra;
    return { missing, total, same };
  })();
  const resume = resumeInfo?.same ? resumeInfo : null;

  const ready = !!health && (health.mock || health.hasKey);
  const canGenerate = !!loaded && !!meta.productName && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(meta.slug) && /^\d{8}(-\d+)?$/.test(meta.rev) && /^https:\/\//.test(meta.publicRoot) && run.phase !== 'running' && ready;

  return (
    <div className="app">
      <Header health={health} error={healthError} email={CLOUD ? session?.user.email : undefined} onLogout={CLOUD && session ? () => supabase.auth.signOut() : undefined} />
      <main className="app__main">
        {CLOUD && authReady && !allowed ? (
          <LoginPanel session={session} role={role} />
        ) : (
          <>
            {jobs.length > 0 && <JobsPanel jobs={jobs} currentId={jobId} busy={!!loading || running} onOpen={openJob} onRemove={removeJob} />}
            <UploadPanel onFile={(f) => openPsd(f)} loading={loading} error={loadError} fileName={loaded?.file.name} />
            {loaded && <SummaryPanel loaded={loaded} />}
            {loaded && (
              <SettingsPanel
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
            {(run.phase !== 'idle' || result) && loaded && (
              <ResultPanel
                run={run}
                result={result}
                loaded={loaded}
                revisionCount={revisionCount}
                onRevise={revise}
                onCancel={() => abortRef.current?.abort()}
                onResume={resume && canGenerate ? () => generate() : undefined}
                resumeLabel={resume ? `이어서 만들기 (남은 섹션 ${resume.missing}개)` : undefined}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
