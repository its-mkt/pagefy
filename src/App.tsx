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
import Header from './components/Header';
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

  async function openPsd(file: File) {
    setLoadError(null);
    setResult(null);
    setRevisionCount(0);
    setRun(emptyRun());
    if (loaded) {
      URL.revokeObjectURL(loaded.compositeUrl);
      URL.revokeObjectURL(loaded.notextUrl);
    }
    setLoaded(null);
    workerRef.current?.dispose();
    const worker = new PsdWorker();
    workerRef.current = worker;
    try {
      const t0 = performance.now();
      const opened = await worker.open(file, setLoading);
      setLoading('미리보기 만드는 중…');
      const [compositeUrl, notextUrl] = await Promise.all([bitmapToUrl(opened.composite), bitmapToUrl(opened.notext)]);
      setLoaded({ file, ...opened, compositeUrl, notextUrl });
      if (import.meta.env.DEV) (window as unknown as { __pagefy: unknown }).__pagefy = { ...opened, compositeUrl, notextUrl }; // 개발 점검용
      const name = productNameFromFile(file.name);
      // 규칙 6-1: 슬러그는 한 번 정하면 바꾸지 않는다 → 이 PC 에서 그 제품에 썼던 슬러그를 다시 쓴다
      const savedSlug = readLocal<Record<string, string>>('pagefy.slugs', {})[name];
      setSettings((s) => ({ ...s, productName: name, slug: savedSlug || toSlug(name), rev: todayRev() }));
      console.info(`[psd] ${file.name} ${Math.round(performance.now() - t0)}ms`);
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
    const L = loaded!;
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
    const p = parseSectionOutput(out.text);
    if (p.error) throw new Error(p.error);
    setSection(id, { state: 'done' });
    return { id, name: sec.name, html: p.html, css: p.css, notes: p.notes, raw: out.text };
  }

  /** 섹션 결과를 합치고 점검까지 */
  async function finalize(m: GenerateMeta, base: string, bundle: PlanBundle, planReport: string, planRaw: string, sections: SectionOut[], images: CutImage[], extraChecks: Check[]) {
    const L = loaded!;
    const html = assembleHtml(m, bundle, sections);
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

  async function generate() {
    if (!loaded || !workerRef.current) return;
    const ac = new AbortController();
    abortRef.current = ac;
    const m = meta;
    const base = baseUrl;
    setResult(null);
    setRevisionCount(0);
    setRun({ ...emptyRun(), phase: 'running', status: ['PSD 렌더 타일 만드는 중…'] });
    writeLocal('pagefy.slugs', { ...readLocal<Record<string, string>>('pagefy.slugs', {}), [m.productName]: m.slug });
    try {
      // 1) 계획
      const tiles = await workerRef.current.tiles();
      pushStatus(`① 계획: 타일 ${tiles.length}장 + 레이어 정보 전송`);
      const planOut = await collect(
        'plan',
        { meta: m, summary: loaded.summary, tiles, extra: settings.extra },
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
      const bundle: PlanBundle = { plan: pp.plan, style: pp.style, notes: pp.notes };
      pushStatus(`① 계획 완료: 섹션 ${pp.plan.sections.length}개, 이미지 ${pp.plan.images.length}장`);

      // 이미지 자르기 (워커)
      const cut = await cutImages(pp.plan, workerRef.current);
      const extraChecks: Check[] = cut.errors.map((msg) => ({ level: 'error', message: `이미지 자르기 실패 ${msg}` }));

      // 2) 섹션별 (동시에)
      pushStatus(`② 섹션 ${pp.plan.sections.length}개를 ${CONCURRENCY}개씩 동시에 작성`);
      setRun((r) => ({ ...r, thinking: '', sections: pp.plan!.sections.map((s) => ({ id: s.id, name: s.name, state: 'wait', chars: 0 })) }));
      const outs = new Map<string, SectionOut>();
      await pool(pp.plan.sections, CONCURRENCY, async (s) => {
        try {
          outs.set(s.id, await runSection(m, bundle, s.id, ac.signal));
        } catch (e) {
          if (ac.signal.aborted) throw e;
          setSection(s.id, { state: 'error', error: (e as Error).message });
          outs.set(s.id, { id: s.id, name: s.name, html: '', css: '', notes: `생성 실패: ${(e as Error).message}`, raw: '' });
          extraChecks.push({ level: 'error', message: `${s.id} ${s.name} 생성 실패: ${(e as Error).message} — 해당 섹션을 골라 "수정 요청"으로 다시 만드세요.` });
        }
      });
      const sections = pp.plan.sections.map((s) => outs.get(s.id)!);
      await finalize(m, base, bundle, pp.report, planOut.text, sections, cut.images, extraChecks);
      setRun((r) => ({ ...r, phase: 'done' }));
    } catch (e) {
      setRun((r) => ({ ...r, phase: 'error', error: ac.signal.aborted ? '취소했습니다.' : (e as Error).message }));
    } finally {
      abortRef.current = null;
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
    } catch (e) {
      setRun((r) => ({ ...r, phase: 'error', error: ac.signal.aborted ? '취소했습니다.' : (e as Error).message }));
    } finally {
      abortRef.current = null;
    }
  }

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
            <UploadPanel onFile={openPsd} loading={loading} error={loadError} fileName={loaded?.file.name} />
            {loaded && <SummaryPanel loaded={loaded} />}
            {loaded && (
              <SettingsPanel
                settings={settings}
                onChange={setSettings}
                baseUrl={baseUrl}
                canGenerate={canGenerate}
                running={run.phase === 'running'}
                onGenerate={generate}
                onCancel={() => abortRef.current?.abort()}
                health={health}
                tileCount={Math.ceil(loaded.summary.height / Math.floor(1560 / Math.min(1, 1000 / loaded.summary.width)))}
              />
            )}
            {(run.phase !== 'idle' || result) && loaded && (
              <ResultPanel run={run} result={result} loaded={loaded} revisionCount={revisionCount} onRevise={revise} onCancel={() => abortRef.current?.abort()} />
            )}
          </>
        )}
      </main>
    </div>
  );
}
