import { useEffect, useMemo, useRef, useState } from 'react';
import { godoMaxWidth } from '../../shared/width';
import { marketWidth } from '../../shared/markets';
import type { Loaded, Result, RunState } from '../App';
import { copySection, type Check } from '../lib/output';
import { keepMap } from '../lib/codegen';
import { isPlanFixable } from '../lib/autofix';
import { buildZip, download, fmtBytes } from '../lib/util';
import { CHANNEL_DIR, SHARED_ROOT, canSaveToFolder, getSharedRoot, planSave, rememberedRootName, safeFolderName, saveToShared, type SaveResult } from '../lib/sharedFolder';

interface Props {
  run: RunState;
  result: Result | null;
  loaded: Loaded;
  revisionCount: number;
  /** 섹션 id → 고칠 내용 */
  onRevise: (feedback: Record<string, string>) => void;
  onCancel: () => void;
  /** 중단된 작업의 남은 섹션 만들기 */
  onResume?: () => void;
  resumeLabel?: string;
  /** 이미지 서버 업로드 (서버에 접속 정보가 있을 때만) */
  upload?: UploadState;
  /** 끝까지 올리고 모두 열리는 것까지 확인하면 true */
  onUpload?: () => Promise<boolean>;
  /** 같은 rev 폴더에 다른 이미지가 있을 때: 다음 번호 rev 로 다시 만들기 (계획 재사용, 비용 없음) */
  onNewRev?: () => void;
  /** 잘못 올린 것 되돌리기: 방금 이 작업이 올린 rev 폴더를 지운다 */
  onUndoUpload?: () => void;
  /** 「문제 자동 수정」 — 구조 계획으로 고칠 수 있는 점검만 모아 Claude 1회, 나아졌을 때만 바꿈 (코드 생성 방식) */
  onAutoFix?: () => void;
  /** 지난 자동 수정 결과 안내 */
  autoFix?: { ok: boolean; text: string } | null;
}

export interface UploadState {
  phase: 'idle' | 'checking' | 'uploading' | 'verifying' | 'done' | 'error' | 'conflict' | 'removing' | 'removed';
  done: number;
  total: number;
  message?: string;
  /** 확인 실패한 파일 */
  bad?: { file: string; status: number }[];
  nextRev?: string;
  /** 다시 연 작업에서 서버에 이미 올라가 있는 것을 확인함 (이번 화면에서 올린 게 아님 — 복사할 때 한 번 더 내용 확인) */
  restored?: boolean;
}

type Tab = 'preview' | 'code' | 'images' | 'report';

const STATE_LABEL = { wait: '대기', run: '작성 중', done: '완료', error: '실패' } as const;

/** PSD 위치 대조에서 어긋난 텍스트를 섹션별 수정 요청 글로 */
function layoutFeedback(result: Result, loaded: Loaded): Record<string, string> {
  const out: Record<string, string[]> = {};
  const bad = (result.layout?.items || []).filter((i) => i.dy != null && !i.ok);
  for (const it of bad) {
    const t = loaded.summary.texts.find((x) => x.id === it.id);
    const sec = t && result.bundle.plan.sections.find((s) => t.lineTop >= s.y0 && t.lineTop < s.y1);
    if (!sec) continue;
    const y = `세로 ${it.dy! > 0 ? '+' : ''}${it.dy}px`;
    const x = it.dx == null ? '줄바꿈 위치가 PSD와 다름' : `가로 ${it.dx > 0 ? '+' : ''}${it.dx}px`;
    (out[sec.id] ||= []).push(`- #${it.id} "${it.text}": ${y} / ${x}`);
  }
  return Object.fromEntries(
    Object.entries(out).map(([id, lines]) => [
      id,
      `PSD 자동 대조 결과 위치가 다른 텍스트 (기준선 기준, +는 PSD보다 아래·오른쪽):\n${lines.join('\n')}\n위치를 PSD 값(texts 의 baseline·anchorX)에 맞게 고쳐 줘. "줄바꿈 위치가 PSD와 다름"이면 PSD와 같은 위치에서 줄을 바꿔 줘.`,
    ]),
  );
}

/** 복사 버튼 — 누르면 1.5초 동안 "복사됨" */
/** 클립보드에 쓴다. http 주소·권한 거부 등으로 막히면 옛 방식(execCommand)으로 한 번 더, 그래도 안 되면 false */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

/**
 * copied: 복사한 버튼 key, 실패하면 'fail:key'
 * copyLater: 글이 나중에 준비될 때 (이미지 업로드 뒤 HTML 복사). 클릭 직후 ClipboardItem 에 약속(Promise)을 넘겨야
 * 업로드가 오래 걸려도 브라우저가 복사를 막지 않는다. 글이 null(업로드 실패)이면 아무것도 복사하지 않는다
 */
function useCopy(): [string | null, (key: string, text: string) => Promise<void>, (key: string, text: Promise<string | null>) => Promise<void>] {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const mark = (v: string, ms = 1500) => {
    setCopied(v);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(null), ms);
  };
  const copy = async (key: string, text: string) => mark((await copyText(text)) ? key : `fail:${key}`);
  const copyLater = async (key: string, text: Promise<string | null>) => {
    try {
      if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) throw new Error('no ClipboardItem');
      const blob = text.then((t) => {
        if (t == null) throw new Error('skip');
        return new Blob([t], { type: 'text/plain' });
      });
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
      mark(key, 4000);
    } catch {
      const t = await text.catch(() => null);
      if (t == null) return; // 업로드 실패 — 안내는 업로드 상태 줄에
      mark((await copyText(t)) ? key : `fail:${key}`, 4000);
    }
  };
  return [copied, copy, copyLater];
}

type Step = 'plan' | 'sections' | 'check';
const STEPS: [Step, string][] = [
  ['plan', '계획'],
  ['sections', '섹션 작성'],
  ['check', '점검'],
];

/** 진행 단계·퍼센트·상태 한 줄 */
function runProgress(run: RunState): { step: Step; pct: number; label: string } {
  const total = run.sections.length;
  if (!total) return { step: 'plan', pct: Math.min(15, 3 + run.planChars / 400), label: '① 계획 세우는 중…' };
  const done = run.sections.filter((s) => s.state === 'done').length;
  const finished = run.sections.filter((s) => s.state === 'done' || s.state === 'error').length;
  if (finished >= total) return { step: 'check', pct: 97, label: '③ 결과 점검 중…' };
  return { step: 'sections', pct: 15 + (80 * finished) / total, label: `② 섹션 작성 중 ${done}/${total}` };
}

const LEVEL_ORDER = { error: 0, warn: 1, ok: 2 } as const;

/** 3초 → "3초", 83초 → "1분 23초" */
function fmtDur(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}초` : `${Math.floor(s / 60)}분${s % 60 ? ` ${s % 60}초` : ''}`;
}

/** 초 단위로 반올림한 ms — 나눠 보여 줄 때 합이 전체와 맞게 */
const secMs = (ms: number) => Math.round(ms / 1000) * 1000;

/** 만드는 중 흐르는 시간 (1초마다 다시 그림) */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return <span className="progress__time">{fmtDur(now - since)} 지남</span>;
}

/** 자동으로 못 고치는 문제를 관리자에게 넘길 때 붙여넣을 진단 정보 (PSD·계획·점검·위치 어긋남) */
function diagnostics(result: Result, loaded: Loaded, run: RunState) {
  const s = loaded.summary;
  const plan = result.bundle.plan;
  const bad = (result.layout?.items ?? []).filter((i) => i.dy != null && !i.ok);
  return [
    `[Pagefy 진단] ${new Date().toLocaleString('ko-KR')}`,
    `PSD: ${loaded.file.name} · ${fmtBytes(loaded.file.size)} · ${s.width}×${s.height}px · 텍스트 레이어 ${s.texts.length}개`,
    `제품: ${result.meta.productName} (${result.meta.slug}) · 채널 ${result.meta.channel} · rev ${result.meta.rev}`,
    `생성: ${plan.engine === 'code' ? '코드 생성' : '섹션별 Claude'} · 모델 ${run.model ?? '-'} · 섹션 ${plan.sections.length}개 · 사진 ${plan.photos?.length ?? 0}장 · 이미지 ${result.images.length}장`,
    `섹션: ${plan.sections.map((x) => `${x.id} ${x.name} (${x.y0}~${x.y1})`).join(' / ')}`,
    '',
    '점검 (오류·확인):',
    ...result.checks.filter((c) => c.level !== 'ok').map((c) => `- [${c.level === 'error' ? '오류' : '확인'}${isPlanFixable(c) ? '·자동수정대상' : ''}] ${c.message}`),
    ...(bad.length ? ['', `위치 어긋남 ${bad.length}개 (#id "글자" 세로/가로 px, +는 PSD보다 아래·오른쪽):`, ...bad.slice(0, 30).map((i) => `- #${i.id} "${i.text}" ${i.dy}/${i.dx ?? '줄바꿈 다름'}`)] : []),
    '',
    `브라우저: ${navigator.userAgent}`,
  ].join('\n');
}

export default function ResultPanel({ run, result, loaded, revisionCount, onRevise, onCancel, onResume, resumeLabel, upload, onUpload, onNewRev, onUndoUpload, onAutoFix, autoFix }: Props) {
  const [tab, setTab] = useState<Tab>('preview');
  const [feedback, setFeedback] = useState('');
  const [target, setTarget] = useState('all');
  const [copied, copy, copyLater] = useCopy();
  const [zipping, setZipping] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);
  const running = run.phase === 'running';
  const auto = result ? layoutFeedback(result, loaded) : {};
  // 코드 생성 방식은 위치를 PSD 값으로 계산하므로 Claude 에게 위치 수정을 보내지 않는다 (옛 섹션 방식 결과에만)
  const codeEngine = result?.bundle.plan.engine === "code";
  const autoCount = codeEngine ? 0 : Object.keys(auto).length;
  const prog = runProgress(run);
  const pct = Math.round(prog.pct);
  const stepIdx = STEPS.findIndex(([k]) => k === prog.step);

  // 점검 목록은 결과가 바뀔 때만 나눈다 (만드는 중엔 진행 표시 때문에 자주 다시 그려짐)
  const { issues, passed, fixable, codeSide, nErr, nWarn, layoutOff } = useMemo(() => {
    const sorted = result ? [...result.checks].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]) : [];
    const g = { issues: [] as Check[], passed: [] as Check[], fixable: [] as Check[], codeSide: [] as Check[], nErr: 0, nWarn: 0 };
    for (const c of sorted) {
      if (c.level === 'ok') {
        g.passed.push(c);
        continue;
      }
      g.issues.push(c);
      if (c.level === 'error') g.nErr++;
      else g.nWarn++;
      /** 구조 계획으로 고칠 수 있는 문제 / 코드 쪽이라 자동으로 못 고치는 문제 */
      (isPlanFixable(c) ? g.fixable : g.codeSide).push(c);
    }
    return { ...g, layoutOff: !!result?.layout?.items.some((i) => i.dy != null && !i.ok) };
  }, [result]);
  const openmarket = result?.meta.channel === 'openmarket';
  /** 이미지 서버 자동 업로드를 쓸 수 있음 (서버에 접속 정보가 있을 때만 App 이 넘겨준다) */
  const autoUpload = !!(upload && onUpload);
  const upBusy = !!upload && (upload.phase === 'checking' || upload.phase === 'uploading' || upload.phase === 'verifying' || upload.phase === 'removing');
  /** 되돌리기 확인 단계 (지우기 전에 한 번 더 묻는다) */
  const [undoAsk, setUndoAsk] = useState(false);
  const [undoSure, setUndoSure] = useState(false);
  /** 복사하려던 HTML 이 쓰는데 결과에 없는 이미지 (자르기 실패) — 있으면 복사를 막는다 */
  const [missing, setMissing] = useState<string[]>([]);
  /** 직접 올릴 때 쓰는 것: zip 내려받기 + 이미지 주소 */
  const manualTools = result && (
    <span className="getit__tools">
      <button
        className="btn btn--sm"
        disabled={!result.parsed.html || zipping}
        onClick={async () => {
          setZipping(true);
          setZipError(null);
          try {
            download(await buildZip(result.meta.productName, result.meta.rev, result.parsed.html, result.images), `${safeFolderName(result.meta.productName) || 'pagefy'}.zip`);
          } catch (e) {
            setZipError(`zip을 만들지 못했습니다: ${(e as Error).message}`);
          } finally {
            setZipping(false);
          }
        }}
      >
        {zipping ? 'zip 만드는 중…' : 'zip 내려받기 (HTML + 이미지)'}
      </button>
      <span className="getit__url">
        <code className="getit__code">{result.baseUrl}/</code>
        <button className="btn btn--sm" onClick={() => copy('url', `${result.baseUrl}/`)}>{copied === 'url' ? '복사됨' : '이미지 주소 복사'}</button>
      </span>
    </span>
  );

  return (
    <section className="panel">
      <h2 className="panel__title">결과 {revisionCount > 0 && <small>(수정 {revisionCount}회)</small>}</h2>

      {running && (
        <div className="progress">
          <p className="progress__now">
            <span className="spinner" />
            <span className="progress__label">{prog.label}</span>
            <span className="progress__pct">{pct}%</span>
            {run.startedAt && <Elapsed since={run.startedAt} />}
            <button className="btn btn--ghost btn--sm" onClick={onCancel}>취소</button>
          </p>
          <div className="progress__bar" role="progressbar" aria-label="만드는 중" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <span style={{ width: `${pct}%` }} />
          </div>
          <ol className="runsteps" aria-label="진행 단계">
            {STEPS.map(([k, label], i) => (
              <li key={k} className={i < stepIdx ? 'is-done' : i === stepIdx ? 'is-on' : ''} aria-current={i === stepIdx ? 'step' : undefined}>
                {label}
              </li>
            ))}
          </ol>
          <p className="hint progress__hint">창을 닫거나 새로고침해도 끝난 섹션은 저장돼 있어 이어서 만들 수 있습니다.</p>
        </div>
      )}

      {run.phase === 'error' && (
        <div className="progress-error">
          <p className="msg msg--error progress-error__msg">{run.error || '만드는 중 문제가 생겼습니다.'}</p>
          {onResume && (
            <div className="actions">
              <button className="btn btn--primary" onClick={onResume}>{resumeLabel}</button>
            </div>
          )}
        </div>
      )}

      {(running || run.phase === 'error') && (
        <>
          {run.sections.length > 0 && (
            <ul className="secs">
              {run.sections.map((s) => (
                <li key={s.id} className={`sec sec--${s.state}`} title={s.error}>
                  <b>{s.id}</b> {s.name} <small>{STATE_LABEL[s.state]}{s.state === 'run' && s.chars ? ` · ${s.chars.toLocaleString()}자` : ''}</small>
                </li>
              ))}
            </ul>
          )}
          {(run.status.length > 0 || (running && run.thinking)) && (
            <details className="fold">
              <summary>진행 기록 보기</summary>
              <ul className="progress__log">
                {run.status.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
              {running && !run.sections.length && run.thinking && <pre className="progress__thinking">{run.thinking.slice(-600)}</pre>}
            </details>
          )}
        </>
      )}

      {result && !running && (
        <>
          <div className="getit">
            <h3 className="getit__title">
              마크업이 준비됐습니다{nErr > 0 && <em> — 오류 {nErr}건 확인 필요</em>}
            </h3>
            <div className="getit__badges">
              {nErr > 0 && <span className="badge badge--error">오류 {nErr}</span>}
              {nWarn > 0 && <span className="badge badge--warn">확인 {nWarn}</span>}
              <span className="badge badge--ok">통과 {passed.length}</span>
              {/* 이번 변환(또는 수정 요청)에 걸린 시간 — 대부분은 Claude 구조 계획, 나머지는 이 PC 의 코드 생성·점검 */}
              {run.startedAt && run.endedAt && (
                <span
                  className="getit__time"
                  title={run.planMs !== undefined ? `구조 계획(Claude) ${fmtDur(run.planMs)} · 마크업 생성·점검(이 PC) ${fmtDur(secMs(run.endedAt - run.startedAt) - secMs(run.planMs))}` : '저장된 구조 계획으로 만들어 Claude 호출 없음'}
                >
                  {fmtDur(run.endedAt - run.startedAt)} 걸림
                  {run.planMs !== undefined && <small> · 구조 계획 {fmtDur(run.planMs)}</small>}
                </span>
              )}
            </div>
            {/* 담당자가 할 일은 「복사 → 붙여넣기」 하나. 이미지 업로드는 복사 버튼이 알아서 먼저 한다 */}
            <div className="getit__main">
              <button
                className="btn btn--primary getit__copy"
                disabled={!result.parsed.html || upBusy}
                onClick={() => {
                  const html = copySection(result.parsed.html);
                  // HTML 이 가리키는 이미지가 결과에 다 있는지 (자르기에 실패한 이미지가 있으면 붙여넣은 페이지에 빈칸이 생긴다)
                  const have = new Set(result.images.map((im) => im.file));
                  // 이미지 주소 = baseUrl/파일명 — 주소 뒤 따옴표·괄호·공백 앞까지가 파일명
                  const refs = html.split(`${result.baseUrl}/`).slice(1).map((s) => s.split(/['")\s]/)[0]);
                  const lost = [...new Set(refs.filter((f) => !have.has(f)))];
                  setMissing(lost);
                  if (lost.length) return;
                  if (autoUpload && (upload!.phase !== 'done' || upload!.restored)) copyLater('html', onUpload!().then((ok) => (ok ? html : null)));
                  else copy('html', html);
                }}
              >
                {upBusy ? (
                  <>
                    <span className="spinner" />
                    {upload!.phase === 'checking' ? '이미지 서버 확인 중…' : upload!.phase === 'uploading' ? `이미지 올리는 중 ${upload!.done}/${upload!.total}` : upload!.phase === 'removing' ? `이미지 지우는 중 ${upload!.done}/${upload!.total}` : '이미지 주소 확인 중…'}
                  </>
                ) : copied === 'html' ? (
                  '복사됨 ✓ 이제 붙여넣으세요'
                ) : (
                  autoUpload && upload!.phase !== 'done' ? '이미지 올리고 HTML 복사' : 'HTML 복사'
                )}
              </button>
              <p className="getit__paste">
                {openmarket ? '오픈마켓 상세 편집기의 HTML 입력' : '고도몰 상품 상세설명 (HTML 모드)'} {autoUpload ? '에 붙여넣으면 끝입니다.' : '에 붙여넣습니다 — 그 전에 아래 노란 안내대로 이미지를 먼저 올려 주세요.'}
                {autoUpload && upload!.phase !== 'done' && <> 이미지 {result.images.length}장은 복사할 때 이미지 서버에 자동으로 올라갑니다.</>}
                {autoUpload && upload!.phase === 'done' && (
                  <>
                    {" "}이미지 {upload!.total}장은 이미지 서버에 올라가 있습니다{upload!.restored ? ' (전에 올린 것)' : ' (모두 열리는 것 확인)'}.
                    {onUndoUpload && !undoAsk && (
                      <button className="link-btn" onClick={() => { setUndoAsk(true); setUndoSure(false); }}>잘못 올렸으면 되돌리기</button>
                    )}
                  </>
                )}
              </p>
            </div>
            {missing.length > 0 && (
              <p className="msg msg--error">
                복사하지 않았습니다 — 이 HTML 이 쓰는 이미지 {missing.length}장이 만들어지지 않았습니다 ({missing.slice(0, 3).join(', ')}{missing.length > 3 ? ' …' : ''}). 그대로 붙여넣으면 그림이 빈칸으로 나옵니다. 아래 점검의 「이미지 자르기 실패」를 확인하고 다시 만들어 주세요.
              </p>
            )}
            {copied?.startsWith('fail:') && copied !== 'fail:diag' && <p className="msg msg--error">복사하지 못했습니다. 버튼을 한 번 더 누르고, 그래도 안 되면 아래 「HTML」 탭에서 직접 선택해 복사하세요.</p>}
            {autoUpload && onUndoUpload && undoAsk && upload!.phase === 'done' && (
              <div className="getit__undo" role="group" aria-label="올린 이미지 되돌리기">
                <b>
                  이미지 서버에서 {upload!.restored ? '전에 올려 둔' : '방금 올린'} {result.meta.rev} 폴더(이미지 {upload!.total}장)를 지웁니다.
                </b>
                {upload!.restored && (
                  <span className="getit__undo-warn">다시 연 작업입니다. 이 이미지는 이미 판매 중인 상품 페이지에서 쓰고 있을 수 있습니다 — 고도몰 상품 상세에 이 HTML 이 없는지 먼저 확인하세요.</span>
                )}
                <span>이 HTML 을 이미 쇼핑몰에 붙여넣었다면, 지우는 순간 그 상품 페이지 그림이 빈칸이 됩니다. 지운 이미지는 되살릴 수 없습니다.</span>
                <label className="getit__undo-check">
                  <input type="checkbox" checked={undoSure} onChange={(e) => setUndoSure(e.target.checked)} /> 이 HTML 은 아직 쇼핑몰에 붙여넣지 않았습니다
                </label>
                <span className="getit__undo-actions">
                  <button className="btn btn--sm is-danger" disabled={!undoSure} onClick={() => { setUndoAsk(false); onUndoUpload(); }}>이미지 지우기</button>
                  <button className="btn btn--sm btn--ghost" onClick={() => setUndoAsk(false)}>취소</button>
                </span>
              </div>
            )}
            {upload?.phase === 'removed' && (
              <p className="msg getit__removed">{upload.message} 다시 쓰려면 「이미지 올리고 HTML 복사」를 누르세요.</p>
            )}
            {upload && (upload.phase === 'error' || upload.phase === 'conflict') && <UploadStatus upload={upload} onNewRev={onNewRev} />}
            {!autoUpload && (
              <div className="getit__manual">
                <b>붙여넣기 전에 이미지 {result.images.length}장을 먼저 올려 주세요.</b>
                <span className="getit__why">이미지를 올리지 않고 붙여넣으면 상품 페이지에 그림이 빈칸으로 나옵니다.</span>
                <ol className="getit__todo">
                  <li>아래 「zip 내려받기」 → 압축 풀기</li>
                  <li>
                    <code className="getit__code">img/{result.meta.rev}</code> 폴더 안 이미지를 FTP 프로그램으로 아래 주소 폴더에 올리기
                  </li>
                  <li>위 「HTML 복사」 → 붙여넣기</li>
                </ol>
                {manualTools}
                <small className="getit__later">이미지 자동 업로드가 켜지면 이 안내는 사라지고 「HTML 복사」 한 번으로 끝납니다.</small>
              </div>
            )}
            {autoUpload && (
              <details className="fold getit__more">
                <summary>직접 올리기 · zip 내려받기</summary>
                {manualTools}
              </details>
            )}
            {zipError && <p className="msg msg--error">{zipError}</p>}
            {canSaveToFolder() && <SharedSave result={result} loaded={loaded} />}
          </div>

          {issues.length > 0 && (
            <ul className="checks">
              {issues.map((c, i) => (
                <li key={i} className={`check check--${c.level}`}>{c.message}</li>
              ))}
            </ul>
          )}
          {/* 문제 자동 수정: 고칠 수 있는 것(구조 계획)만 Claude 1회로, 나머지(코드 쪽)는 진단 정보 복사 */}
          {codeEngine && (fixable.length > 0 || codeSide.length > 0 || autoFix) && (
            <div className={`autofix ${autoFix ? (autoFix.ok ? 'is-ok' : 'is-kept') : ''}`}>
              {autoFix && <p className="autofix__result">{autoFix.text}</p>}
              {fixable.length > 0 && onAutoFix && (
                <div className="autofix__row">
                  <button className="btn btn--primary btn--sm" disabled={running} onClick={onAutoFix}>
                    문제 자동 수정 ({fixable.length}건)
                  </button>
                  <span className="autofix__note">
                    빠진 글자·제목 구조처럼 구조 계획으로 고칠 수 있는 문제만 고칩니다 · Claude 1회(1~2분, 새로 만들 때와 비슷한 비용) · <b>나아졌을 때만</b> 새 결과로 바꿉니다
                  </span>
                </div>
              )}
              {codeSide.length > 0 && (
                <div className="autofix__row">
                  <button className="btn btn--sm" onClick={() => copy('diag', diagnostics(result, loaded, run))}>
                    {copied === 'diag' ? '복사됨' : copied === 'fail:diag' ? '복사 실패' : '진단 정보 복사'}
                  </button>
                  <span className="autofix__note">
                    나머지 {codeSide.length}건({layoutOff ? '위치 어긋남 등 ' : ''}마크업 코드 쪽 문제)은 Claude 에게 다시 시켜도 바뀌지 않아 자동으로 고치지 않습니다. 진단 정보를 복사해 관리자에게 보내 주세요.
                  </span>
                </div>
              )}
            </div>
          )}
          {passed.length > 0 && (
            <details className="fold">
              <summary>통과한 점검 {passed.length}개</summary>
              <ul className="checks">
                {passed.map((c, i) => (
                  <li key={i} className="check check--ok">{c.message}</li>
                ))}
              </ul>
            </details>
          )}

          <div className="tabs">
            {(
              [
                ['preview', '미리보기'],
                ['code', 'HTML'],
                ['images', `이미지 ${result.images.length}`],
                ['report', '완료 보고'],
              ] as [Tab, string][]
            ).map(([k, label]) => (
              <button key={k} className={tab === k ? 'is-on' : ''} onClick={() => setTab(k)}>{label}</button>
            ))}
          </div>

          {tab === 'preview' && <Preview result={result} loaded={loaded} />}
          {tab === 'code' && <Code html={result.parsed.html} />}
          {tab === 'report' && (
            <>
              {run.usage && (
                <p className="usage">
                  {run.model} · 입력 {run.usage.input.toLocaleString()} / 캐시 {run.usage.cacheRead.toLocaleString()} / 출력 {run.usage.output.toLocaleString()} 토큰 · 약 ${run.usage.costUsd.toFixed(2)}
                </p>
              )}
              <p className="hint">규칙 9절 완료 보고 — 이미지로 구운 텍스트·오탈자·검색 최적화 제안은 디자이너·기획 담당에게 넘깁니다.</p>
              <pre className="pre">{result.parsed.report || '(보고 없음)'}</pre>
              <details className="raw">
                <summary>Claude 응답 원문 (결과가 이상할 때 원인 확인용)</summary>
                <pre className="pre">{[`===== 계획 =====\n${result.planRaw}`, ...result.sections.map((s) => `===== ${s.id} ${s.name} =====\n${s.raw}`)].join('\n\n')}</pre>
              </details>
            </>
          )}
          {tab === 'images' && (
            <div className="images">
              {result.images.map((im) => (
                <figure key={im.file} className={im.blob.size > 1024 * 1024 ? 'is-big' : ''}>
                  <img src={im.url} alt={im.alt || ''} />
                  <figcaption>
                    <b>{im.file}</b> {im.width}×{im.height} · {fmtBytes(im.blob.size)}
                    {im.alt && <span>alt: {im.alt}</span>}
                  </figcaption>
                </figure>
              ))}
            </div>
          )}

          <h3 className="revise__title">고칠 곳이 있으면</h3>
          <div className="revise">
            {autoCount > 0 && (
              <button className="btn btn--sm" onClick={() => onRevise(auto)} title="PSD 위치 대조에서 어긋난 텍스트가 있는 섹션만 골라 고치게 합니다">
                대조 결과로 고치기 (섹션 {autoCount}개)
              </button>
            )}
            <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="고칠 섹션">
              <option value="all">모든 섹션</option>
              {result.sections.map((s) => (
                <option key={s.id} value={s.id}>{s.id} {s.name}</option>
              ))}
            </select>
            <textarea rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder={codeEngine ? "구조를 고칠 내용을 적어 주세요. 위치·크기·자간은 PSD 값으로 자동 계산됩니다. 예) 메인 제목은 이미지로 남겨 줘 / 두 번째 제품 사진을 사진 영역(img)으로 빼 줘 / \"주요 사양\"을 대제목으로" : "고칠 내용을 적고 섹션을 고르면 그 섹션만 다시 만듭니다. 예) 제목 줄바꿈이 PSD와 달라요 / 스펙 영역을 <table>로 바꿔 줘"} />
            <button
              className={`btn ${feedback.trim() ? "btn--primary" : ""}`}
              disabled={!feedback.trim()}
              onClick={() => {
                const ids = target === 'all' ? result.sections.map((s) => s.id) : [target];
                onRevise(Object.fromEntries(ids.map((id) => [id, feedback.trim()])));
                setFeedback('');
              }}
            >
              수정 요청
            </button>
          </div>
        </>
      )}
    </section>
  );
}

type View = 'compare' | 'psd' | 'html';

const VIEW_HINT: Record<View, string> = {
  compare: '왼쪽(회색 이름표) = PSD 원본 이미지, 오른쪽(파란 이름표) = 만들어진 HTML 마크업. 두 쪽이 같아 보이면 잘 된 것입니다. (HTML 의 이미지는 업로드 전이라 이 PC 파일로 표시)',
  psd: 'PSD 원본 이미지만 봅니다 (디자인 그대로의 그림).',
  html: '만들어진 HTML 마크업만 봅니다.',
};

/**
 * 실제 글자 / 이미지에 남긴 글자 — 예전 「글자 전체 선택」 대신 프로그램이 바로 센다.
 * 코드 생성 방식은 keepMap(계획 + 자동 판정)이 정답이고, 옛 방식 결과는 bakeHint 를 기준으로 어림한다
 */
function textSplit(result: Result, loaded: Loaded) {
  const usable = loaded.summary.texts.filter((t) => t.text.trim() && t.b[2] > t.b[0]);
  const keep =
    result.bundle.plan.engine === 'code'
      ? keepMap(loaded.summary, result.bundle.plan, result.meta.channel === 'openmarket')
      : new Map(usable.filter((t) => t.bakeHint).map((t) => [t.id, t.bakeHint!] as const));
  const kept = usable.filter((t) => keep.has(t.id)).map((t) => ({ t, reason: keep.get(t.id)! }));
  return { real: usable.length - kept.length, kept };
}

function Preview({ result, loaded }: { result: Result; loaded: Loaded }) {
  const W = loaded.summary.width;
  const [view, setView] = useState<View>('compare');
  // 모바일은 비율 축소뿐이라(7-5) 따로 보지 않는다 — 모바일 확인(가로 스크롤·비율·가장 작은 글자)은 자동 점검이 한다
  // 고도몰은 상세 영역이 최대 860px(7-2) → 결과물은 860px 로 줄어든다. 미리보기 칸도 그 폭으로 열어 양옆 흰 여백이 생기지 않게 하고,
  // PSD 이미지와 같은 크기로 보이도록 그만큼 키워 보여 준다 (오픈마켓은 PSD 폭 그대로)
  // 오픈마켓은 플랫폼 폭(shared/markets.ts)으로 줄여 만들었으니 그 폭으로 연다 (고도몰은 860 상한)
  const width = result.meta.channel === 'openmarket' ? marketWidth(result.meta.market, W) : godoMaxWidth(W);
  const fit = W / width;
  const [zoom, setZoom] = useState(0.5);
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(1000);
  /** 이미지에 남긴 글자 위치를 PSD 이미지 위에 표시 */
  const [showKept, setShowKept] = useState(false);
  const { real, kept } = textSplit(result, loaded);
  const showHtml = view !== 'psd';
  const showPsd = view !== 'html';

  useEffect(() => {
    const f = frame.current;
    if (!f) return;
    // srcdoc 은 load 가 effect 보다 먼저 끝날 수 있고, 이미지가 늦게 뜨면 높이가 바뀐다 → 잠시 동안 주기적으로 잰다
    const measure = () => {
      // documentElement.scrollHeight 는 iframe 높이보다 작아지지 않아 내용 높이인 body 로 잰다
      const d = f.contentDocument;
      const h = d?.body ? Math.max(Math.ceil(d.documentElement.getBoundingClientRect().height), d.body.scrollHeight) : undefined;
      if (h) setHeight(h);
    };
    let n = 0;
    const timer = window.setInterval(() => {
      measure();
      if (++n > 30) window.clearInterval(timer);
    }, 300);
    f.addEventListener('load', measure);
    return () => {
      f.removeEventListener('load', measure);
      window.clearInterval(timer);
    };
  }, [result.previewHtml, width, showHtml]);

  return (
    <div className="preview">
      <div className="preview__bar">
        <div className="seg" aria-label="미리보기 보기 방식">
          <button className={view === 'compare' ? 'is-on' : ''} onClick={() => setView('compare')}>나란히 비교</button>
          <button className={view === 'psd' ? 'is-on' : ''} onClick={() => setView('psd')}>PSD 이미지</button>
          <button className={view === 'html' ? 'is-on' : ''} onClick={() => setView('html')}>HTML 마크업</button>
        </div>
        <label className="zoom">
          배율
          <select value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
            {[0.25, 0.4, 0.5, 0.75, 1].map((z) => <option key={z} value={z}>{Math.round(z * 100)}%</option>)}
          </select>
        </label>
      </div>
      <div className="preview__bar preview__texts">
        <span>
          실제 글자 <b>{real.toLocaleString()}개</b> · 이미지에 남긴 글자 <b>{kept.length.toLocaleString()}개</b>
        </span>
        {kept.length > 0 && (
          <button
            className={`btn btn--sm ${showKept ? 'btn--primary' : ''}`}
            aria-pressed={showKept}
            onClick={() => {
              setShowKept((v) => !v);
              if (view === 'html') setView('compare');
            }}
          >
            {showKept ? '위치 표시 끄기' : '이미지에 남긴 글자 위치 보기'}
          </button>
        )}
        <span className="hint">이미지에 남긴 글자는 문구를 고치려면 PSD 를 고쳐야 합니다 (완료 보고에 목록).</span>
      </div>
      {showKept && kept.length > 0 && (
        <ul className="preview__kept">
          {kept.map(({ t, reason }) => (
            <li key={t.id}>
              <b>"{t.text.replace(/\s+/g, ' ').trim().slice(0, 30)}"</b> <small>{reason}</small>
            </li>
          ))}
        </ul>
      )}
      <p className="hint preview__hint">{VIEW_HINT[view]}</p>
      <div className="preview__cols">
        {showPsd && (
          <figure className="preview__col preview__col--psd">
            <figcaption className="preview__tag">
              <b>PSD 원본 이미지</b>
              <span>디자인 그대로의 그림{showKept ? ' · 주황 테두리 = 이미지에 남긴 글자' : ''}</span>
            </figcaption>
            <div className="preview__psd" style={{ zoom }}>
              <img src={loaded.compositeUrl} width={W} alt="PSD 합성 렌더" />
              {showKept &&
                kept.map(({ t, reason }) => (
                  <span
                    key={t.id}
                    className="preview__mark"
                    title={`이미지에 남긴 글자: ${t.text.replace(/\s+/g, ' ').trim()} — ${reason}`}
                    style={{ left: t.b[0] - 4, top: t.b[1] - 4, width: t.b[2] - t.b[0] + 8, height: t.b[3] - t.b[1] + 8 }}
                  />
                ))}
            </div>
          </figure>
        )}
        {showHtml && (
          <figure className="preview__col preview__col--html">
            <figcaption className="preview__tag">
              <b>HTML 마크업 (결과물)</b>
              <span>
                쇼핑몰에 들어갈 웹페이지 · {width < W ? `폭 ${width}px (PSD ${W}px 비율 축소)` : `PSD 폭 ${W}px`} · 모바일도 비율대로
              </span>
            </figcaption>
            <div style={{ zoom: zoom * fit }}>
              <iframe ref={frame} title="생성 HTML 미리보기" sandbox="allow-same-origin" scrolling="no" srcDoc={result.previewHtml} style={{ width, height }} />
            </div>
          </figure>
        )}
      </div>
    </div>
  );
}

function Code({ html }: { html: string }) {
  const [which, setWhich] = useState<'copy' | 'full'>('copy');
  const [copied, setCopied] = useState<boolean | null>(false);
  const text = which === 'copy' ? copySection(html) : html;
  return (
    <div className="code">
      <div className="preview__bar">
        <div className="seg">
          <button className={which === 'copy' ? 'is-on' : ''} onClick={() => setWhich('copy')}>복사 구간만 (채널 등록용)</button>
          <button className={which === 'full' ? 'is-on' : ''} onClick={() => setWhich('full')}>전체 문서</button>
        </div>
        <button
          className="btn btn--sm"
          onClick={async () => {
            const ok = await copyText(text);
            setCopied(ok ? true : null);
            if (ok) setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? '복사됨' : copied === null ? '복사 실패 — 아래 글을 직접 선택하세요' : '복사'}
        </button>
        <span className="hint">{text.length.toLocaleString()}자 · 이미지 주소는 업로드 후 실제로 열리는지 확인하세요 (9절 6항)</span>
      </div>
      <pre className="pre pre--code">{text}</pre>
    </div>
  );
}

/** 자동 업로드가 막혔을 때만 보이는 안내 — 실패 이유·같은 날짜 폴더 충돌 (진행 상황은 복사 버튼에 표시) */
function UploadStatus({ upload: u, onNewRev }: { upload: UploadState; onNewRev?: () => void }) {
  return (
    <span className="upbox">
      {u.phase === 'error' && <span className="msg msg--error">{u.message}{u.message?.startsWith('되돌리기') ? '' : ' — 「이미지 올리고 HTML 복사」를 다시 누르면 이어서 올립니다. (HTML 은 복사되지 않았습니다)'}</span>}
      {u.bad?.length ? <span className="msg msg--error">열리지 않는 이미지: {u.bad.map((b) => `${b.file}(${b.status || '응답 없음'})`).join(', ')}</span> : null}
      {u.phase === 'conflict' && (
        <span className="upbox__conflict">
          {u.message}
          {onNewRev && u.nextRev && (
            <button className="btn btn--sm" onClick={onNewRev}>
              새 번호 {u.nextRev} 로 다시 만들기 (비용 없음)
            </button>
          )}
        </span>
      )}
      <small className="hint">같은 이름 파일은 덮어쓰지 않습니다. 이미 판매 중인 페이지 이미지는 바뀌지 않습니다.</small>
    </span>
  );
}

/**
 * 공유 폴더에 저장 — A_상세페이지<채널><제품명> 에 HTML · img<rev> · (없으면) PSD.
 * 처음 한 번 A_상세페이지 폴더를 고르면 기억한다. 덮어쓰지 않고, HTML 이 다르면 물어본 뒤에만 바꾼다
 */
function SharedSave({ result, loaded }: { result: Result; loaded: Loaded }) {
  type St =
    | { s: 'idle' }
    | { s: 'busy'; msg: string }
    | { s: 'ask'; root: FileSystemDirectoryHandle; path: string }
    | { s: 'done'; r: SaveResult }
    | { s: 'error'; msg: string };
  const [st, setSt] = useState<St>({ s: 'idle' });
  const [rootName, setRootName] = useState<string | null>(null);
  useEffect(() => {
    rememberedRootName().then(setRootName);
  }, []);
  // 결과가 바뀌면(수정·새 rev) 처음 상태로
  useEffect(() => setSt({ s: 'idle' }), [result.baseUrl, result.parsed.html]);
  const folder = safeFolderName(result.meta.productName);
  const changed = folder !== result.meta.productName.trim();
  const input = { channel: result.meta.channel, productName: result.meta.productName, rev: result.meta.rev, html: result.parsed.html, images: result.images, psd: loaded.file };

  const write = async (root: FileSystemDirectoryHandle, replaceHtml: boolean) => {
    setSt({ s: 'busy', msg: '저장 중…' });
    try {
      const r = await saveToShared(root, input, replaceHtml, (msg) => setSt({ s: 'busy', msg }));
      setSt({ s: 'done', r });
    } catch (e) {
      setSt({ s: 'error', msg: `저장하지 못했습니다: ${(e as Error).message}` });
    }
  };
  const start = async (repick: boolean) => {
    try {
      const root = await getSharedRoot(repick); // 클릭 직후에 불러야 권한 묻기·폴더 고르기가 된다
      setRootName(root.name);
      setSt({ s: 'busy', msg: '공유 폴더 확인 중…' });
      const plan = await planSave(root, input);
      if (plan.htmlDiffers) setSt({ s: 'ask', root, path: plan.path });
      else await write(root, false);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return setSt({ s: 'idle' }); // 폴더 고르기 창을 닫음
      setSt({ s: 'error', msg: (e as Error).message });
    }
  };
  const busy = st.s === 'busy';
  const where = [rootName ?? 'A_상세페이지', CHANNEL_DIR[result.meta.channel], folder].join('\\');

  return (
    <div className="shared">
      <div className="shared__row">
        <button className="btn btn--sm" disabled={busy || !result.parsed.html} onClick={() => start(false)}>
          {busy ? (
            <>
              <span className="spinner" />
              {st.msg}
            </>
          ) : (
            '공유 폴더에 저장'
          )}
        </button>
        <span className="shared__where">
          <code className="getit__code">{where}</code> 에 HTML · 이미지 · PSD 를 폴더로 저장 (보관용)
        </span>
        {rootName && !busy && (
          <button className="link-btn" onClick={() => start(true)}>
            다른 폴더 고르기
          </button>
        )}
      </div>
      {!rootName && st.s === 'idle' && <small className="hint">처음 한 번 폴더 고르기 창이 열립니다 — {SHARED_ROOT} 폴더를 고르세요.</small>}
      {changed && st.s === 'idle' && <small className="hint">폴더 이름에 쓸 수 없는 글자를 빼고 「{folder}」로 저장합니다.</small>}
      {st.s === 'ask' && (
        <div className="shared__ask" role="group" aria-label="HTML 바꾸기 확인">
          <span>
            <b>{st.path}</b> 에 있는 <b>{folder}.html</b> 이 지금 결과와 다릅니다. 새 것으로 바꿀까요? (공유 폴더 HTML 은 보관용이라 쇼핑몰에는 영향이 없습니다)
          </span>
          <span className="shared__actions">
            <button className="btn btn--sm btn--primary" onClick={() => write(st.root, true)}>새 HTML 로 바꾸기</button>
            <button className="btn btn--sm" onClick={() => write(st.root, false)}>HTML 은 그대로 두고 나머지만 저장</button>
            <button className="btn btn--sm btn--ghost" onClick={() => setSt({ s: 'idle' })}>취소</button>
          </span>
        </div>
      )}
      {st.s === 'done' && (
        <p className="shared__done">
          <b>{st.r.path}</b> 에 저장했습니다 — 새로 쓴 파일 {st.r.written.length}개
          {st.r.skipped.length > 0 && <> · 이미 있어 건너뜀 {st.r.skipped.length}개</>}
          {st.r.html === 'same' && <> · HTML 은 같아서 그대로</>}
          {st.r.html === 'replaced' && <> · HTML 을 새 것으로 바꿈</>}
          {st.r.html === 'kept' && <> · HTML 은 예전 것 그대로 둠</>}
          {st.r.psd === 'copied' && <> · PSD 복사함</>}
          {st.r.psd === 'exists' && <> · PSD 는 이미 있어 복사 안 함</>}
        </p>
      )}
      {st.s === 'error' && <p className="msg msg--error">{st.msg}</p>}
    </div>
  );
}
