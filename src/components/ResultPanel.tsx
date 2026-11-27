import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from './Button';
import { Tabs } from 'radix-ui';
import { godoMaxWidth } from '../../shared/width';
import { marketWidth } from '../../shared/markets';
import type { Loaded, Result, RunState } from '../App';
import { copySection, type Check } from '../lib/output';
import { keepMap } from '../lib/codegen';
import { isPlanFixable } from '../lib/autofix';
import { plainCheck } from '../lib/plainCheck';
import GodoCheckBox from './GodoCheckBox';
import { SeEditBox } from './SeEditor';
import { imageKind, imageUse } from '../lib/imageUse';
import { editorIdOf, editorOf } from '../lib/editorSim';
import Select from './Select';
import { buildZip, download, fmtBytes } from '../lib/util';
import { CHANNEL_DIR, SHARED_ROOT, canSaveToFolder, saveZipToShared, getSharedRoot, planSave, rememberedRootName, safeFolderName, saveToShared, type SaveResult } from '../lib/sharedFolder';
import { CheckField, Fold, Seg, Tip, TipWrap } from './ui';
import Elapsed from './Elapsed';
import { Check as CheckMark, ChevronRight, Eye, RefreshCw, RotateCw, Undo2 } from 'lucide-react';
import { copyText, useCopy } from '../lib/clipboard';
import { ago, fmtDur, secMs } from '../lib/time';
import ReconvertDialog from './ReconvertDialog';
import { useFrameHeight } from '../lib/useFrameHeight';

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
  /** 서버 연결 실패(run.noResponse) 때 「다시 시도」 — 같은 설정으로 다시 만든다 */
  onRetry?: () => void;
  resumeLabel?: string;
  /** 이미지 서버 업로드 (서버에 접속 정보가 있을 때만) */
  upload?: UploadState;
  /** 끝까지 올리고 모두 열리는 것까지 확인하면 true. confirmOverwrite = 덮어쓰기 안내에서 확인함 (내용이 다른 같은 이름 파일을 덮어씀) */
  onUpload?: (confirmOverwrite?: boolean) => Promise<boolean>;
  /** 덮어쓰기 안내에서 취소 — 업로드 전 상태로 */
  onUploadReset?: () => void;
  /** 잘못 올린 것 되돌리기: 이번에 올린 파일만 (덮어쓴 것은 백업으로 되돌리고 새로 올린 것은 지움) */
  onUndoUpload?: () => void;
  /** 「문제 자동 수정」 — 구조 계획으로 고칠 수 있는 점검만 모아 Claude 1회, 나아졌을 때만 바꿈 (코드 생성 방식) */
  onAutoFix?: () => void;
  /** 에디터 테스트 화면으로 넘어가 지금 결과를 불러온다 */
  onOpenTester?: () => void;
  /** 지난 자동 수정 결과 안내 */
  autoFix?: { ok: boolean; text: string } | null;
  /** 고도몰 등록 확인 상자 (서버에 아이티켓 고도몰 API 키가 있고 채널이 아이티켓일 때) */
  godo?: boolean;
  /** 이 작업에 저장된 등록 페이지 주소 (작업 기록 link) */
  regLink?: string;
  /** 등록 확인이 맞으면 그 상품 페이지 주소를 작업 기록에 저장 */
  onRegLink?: (url: string) => void;
  /** 「수정」에서 저장해 둔 복사 구간 HTML (이 결과에 맞을 때만, 없으면 null) — 「HTML 복사」가 이것을 쓴다 */
  savedEdit?: string | null;
  /** 수정 저장(html) · 원래대로(null) — 작업에 남긴다 */
  onSaveEdit?: (html: string | null) => void;
  /** 「다시 변환」: 구조 계획부터 새로 (Claude 1회). wish = 마음에 안 드는 점 (이번 요청에만 추가 지시로) */
  onReconvert?: (wish: string) => void;
  /** 다시 변환할 수 없는 이유 (설정 미비 등) */
  reconvertBlocked?: string;
  /** 되돌릴 수 있는 이전 결과가 밀려난 시각 (없으면 「이전 결과로 되돌리기」를 숨김) */
  prevAt?: number;
  /** 이전 결과로 되돌리기 — 남겨 둔 계획으로 다시 계산 (Claude 호출 없음), 지금 결과와 맞바꿈 */
  onRestorePrev?: () => void;
}

export interface UploadState {
  /** confirm = 서버에 내용이 다른 같은 이름 이미지가 있어 덮어쓰기 확인을 기다림 */
  phase: 'idle' | 'checking' | 'confirm' | 'uploading' | 'verifying' | 'done' | 'error' | 'removing' | 'removed';
  done: number;
  total: number;
  message?: string;
  /** 확인 실패한 파일 */
  bad?: { file: string; status: number }[];
  /** 덮어쓸 파일 (confirm) — from/to = 서버 그림·새 그림 크기, sizeChanged = 크기가 달라 이미 붙여 둔 옛 HTML 과 어긋남 */
  overwrite?: { file: string; from?: string; to: string; sizeChanged: boolean }[];
  /** 서버 제품 폴더 주소 (confirm 안내용) */
  folder?: string;
  /** 서버에 있지만 이 HTML 이 쓰지 않는 파일 수 (지우지 않음) */
  unused?: number;
  /** 이번에 올린 파일 (되돌리기용) — backup 이 있으면 덮어쓴 것 */
  record?: { file: string; backup?: string }[];
  /** 덮어쓴 파일 수 (done 안내용) */
  overwritten?: number;
  /** 다시 연 작업에서 서버에 이미 올라가 있는 것을 확인함 (이번 화면에서 올린 게 아님 — 복사할 때 한 번 더 내용 확인) */
  restored?: boolean;
}

type Tab = 'preview' | 'edit' | 'images' | 'report';

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

/** 자동으로 못 고치는 문제를 관리자에게 넘길 때 붙여넣을 진단 정보 (PSD·계획·점검·위치 어긋남) */
function diagnostics(result: Result, loaded: Loaded, run: RunState) {
  const s = loaded.summary;
  const plan = result.bundle.plan;
  const bad = (result.layout?.items ?? []).filter((i) => i.dy != null && !i.ok);
  return [
    `[Pagefy 진단] ${new Date().toLocaleString('ko-KR')}`,
    `PSD: ${loaded.file.name} · ${fmtBytes(loaded.file.size)} · ${s.width}×${s.height}px · 텍스트 레이어 ${s.texts.length}개`,
    `제품: ${result.meta.productName} (${result.meta.slug}) · 채널 ${result.meta.channel} · 이미지 ${result.baseUrl}/`,
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

export default function ResultPanel({ run, result, loaded, revisionCount, onRevise, onCancel, onResume, onRetry, resumeLabel, upload, onUpload, onUploadReset, onUndoUpload, onAutoFix, onOpenTester, autoFix, godo, regLink, onRegLink, savedEdit = null, onSaveEdit, onReconvert, reconvertBlocked, prevAt, onRestorePrev }: Props) {
  const [reconvOpen, setReconvOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('preview');
  // 「수정」 — 실수 방지로 「저장」해야만 복사에 들어간다 (2026-11-25 사용자).
  //  draft = 저장하지 않은 고침 (있으면 「HTML 복사」를 막는다) · savedEdit = 저장한 고침 (작업에 남음, 결과가 다시 만들어지면 App 이 버림)
  // 「이미지」 탭 — 그림마다 HTML 에서 <img> 로 쓰였는지(alt 포함) CSS 배경으로 쓰였는지
  const use = useMemo(() => imageUse(result?.parsed.html ?? ''), [result?.parsed.html]);
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => setDraft(null), [result?.parsed.html]);
  // 버리기·되돌리기 때 편집 화면을 새로 그리게 (SeEditBox resetKey)
  const [editKey, setEditKey] = useState(0);
  const dropDraft = () => (setDraft(null), setEditKey((k) => k + 1));
  const original = result ? copySection(result.parsed.html) : '';
  const edited = savedEdit;
  const dirty = draft !== null;
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
  /** 자동 업로드가 없을 때: 「이미지를 올렸습니다」를 체크해야 복사 버튼이 켜진다 (먼저 복사해 붙여넣으면 그림이 빈칸) */
  const [imgReady, setImgReady] = useState(false);
  useEffect(() => setImgReady(false), [result?.baseUrl, result?.parsed.html]);
  /** HTML 복사 (자동 업로드면 이미지를 먼저 올린다). confirmOverwrite = 덮어쓰기 안내에서 확인함 */
  const copyHtml = (confirmOverwrite = false) => {
    if (!result) return;
    if (dirty) return; // 저장하지 않은 고침이 있으면 복사하지 않는다 (단추도 막혀 있음)
    const html = edited ?? copySection(result.parsed.html);
    // HTML 이 가리키는 이미지가 결과에 다 있는지 (자르기에 실패한 이미지가 있으면 붙여넣은 페이지에 빈칸이 생긴다)
    const have = new Set(result.images.map((im) => im.file));
    // 이미지 주소 = baseUrl/파일명 — 주소 뒤 따옴표·괄호·공백 앞까지가 파일명
    const refs = html.split(`${result.baseUrl}/`).slice(1).map((s) => s.split(/['")\s]/)[0]);
    const lost = [...new Set(refs.filter((f) => !have.has(f)))];
    setMissing(lost);
    if (lost.length) return;
    if (autoUpload && (upload!.phase !== 'done' || upload!.restored)) copyLater('html', onUpload!(confirmOverwrite).then((ok) => (ok ? html : null)));
    else copy('html', html);
  };
  /** 수동 업로드 단계 카드: zip 을 받았는지 (1단계 완료 표시) */
  /** zip 을 어디로 받았는지: saved = 저장 창으로 (공유 폴더에서 열림) · download = 보통 내려받기 */
  const [zipDone, setZipDone] = useState<null | 'saved' | 'download'>(null);
  /** 1단계를 공유 폴더 저장으로 끝냈을 때 그 경로 */
  const [sharedPath, setSharedPath] = useState<string | null>(null);
  useEffect(() => {
    setZipDone(null);
    setSharedPath(null);
  }, [result?.baseUrl, result?.parsed.html]);
  const downloadZip = async () => {
    if (!result) return;
    setZipping(true);
    setZipError(null);
    try {
      const blob = await buildZip(result.meta.productName, result.parsed.html, result.images);
      const name = `${safeFolderName(result.meta.productName) || 'pagefy'}.zip`;
      // 크롬·엣지: 저장 창이 공유 폴더(채널 폴더)에서 열린다. 창을 닫으면 아무것도 안 바뀜
      const how = await saveZipToShared(blob, name, result.meta.channel);
      if (how === 'cancel') return;
      if (how === 'download') download(blob, name);
      setZipDone(how === 'saved' ? 'saved' : 'download');
    } catch (e) {
      setZipError(`zip을 만들지 못했습니다: ${(e as Error).message}`);
    } finally {
      setZipping(false);
    }
  };
  /** 직접 올릴 때 쓰는 것: zip 내려받기 + 이미지 주소 (자동 업로드일 때 「직접 올리기」 접기 안) */
  const manualTools = result && (
    <span className="getit__tools">
      <Button size="sm" disabled={!result.parsed.html || zipping} onClick={downloadZip}>
        {zipping ? 'zip 만드는 중…' : 'zip 내려받기 (HTML + 이미지)'}
      </Button>
      <span className="getit__url">
        <code className="getit__code">{result.baseUrl}/</code>
        <Button size="sm" onClick={() => copy('url', `${result.baseUrl}/`)}>{copied === 'url' ? '복사됨' : '이미지 주소 복사'}</Button>
      </span>
    </span>
  );

  return (
    <section className="panel">
      <div className="reconv__head">
        <h2 className="panel__title">결과 {revisionCount > 0 && <small>(수정 {revisionCount}회)</small>}</h2>
        {/* 결과가 마음에 안 들 때 — 설정 패널을 펼치지 않고 여기서 바로 (2026-11-27) */}
        {result && !running && (onReconvert || (prevAt && onRestorePrev)) && (
          <div className="reconv__acts">
            {prevAt && onRestorePrev && (
              <Tip content={`${ago(prevAt)}까지 보던 결과로 되돌립니다. 남겨 둔 구조 계획으로 다시 계산해 비용이 들지 않고, 지금 결과는 다시 「이전 결과」로 남습니다.`}>
                <Button type="button" size="sm" onClick={onRestorePrev}>
                  <Undo2 className="btn__ico" />
                  이전 결과로 되돌리기
                </Button>
              </Tip>
            )}
            {onReconvert && (
              <Button type="button" size="sm" onClick={() => setReconvOpen(true)}>
                <RefreshCw className="btn__ico" />
                다시 변환
              </Button>
            )}
          </div>
        )}
      </div>
      {onReconvert && <ReconvertDialog open={reconvOpen} onClose={() => setReconvOpen(false)} onConfirm={onReconvert} blocked={reconvertBlocked} revisions={revisionCount} />}

      {running && (
        <div className="progress">
          <p className="progress__now">
            <span className="spinner" />
            <span className="progress__label">{prog.label}</span>
            <span className="progress__pct">{pct}%</span>
            {run.startedAt && <Elapsed since={run.startedAt} className="progress__time" suffix=" 지남" />}
            <Button size="sm" onClick={onCancel}>취소</Button>
          </p>
          <div className="progress__bar" role="progressbar" aria-label="만드는 중" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <span style={{ width: `${pct}%` }} />
          </div>
          <ol className="runsteps" aria-label="진행 단계">
            {STEPS.map(([k, label], i) => (
              <li key={k} className={i < stepIdx ? 'is-done' : i === stepIdx ? 'is-on' : ''} aria-current={i === stepIdx ? 'step' : undefined}>
                {i > 0 && <ChevronRight className="runsteps__sep" aria-hidden="true" />}
                {i < stepIdx && <CheckMark className="runsteps__ico" aria-hidden="true" />}
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
          {/* 이어서 만들 수 있으면 그게 먼저 (끝난 섹션을 살림). 서버 연결 실패면 같은 설정으로 「다시 시도」 */}
          {onResume ? (
            <div className="actions">
              <Button variant="primary" onClick={onResume}>{resumeLabel}</Button>
            </div>
          ) : (
            run.noResponse &&
            onRetry && (
              <div className="actions">
                <Button variant="primary" onClick={onRetry}>
                  <RotateCw className="btn__ico" />
                  다시 시도
                </Button>
              </div>
            )
          )}
        </div>
      )}

      {(running || run.phase === 'error') && (
        <>
          {run.sections.length > 0 && (
            <ul className="secs">
              {run.sections.map((s) => (
                <Tip key={s.id} content={s.error}>
                <li className={`sec sec--${s.state}`}>
                  <b>{s.id}</b> {s.name} <small>{STATE_LABEL[s.state]}{s.state === 'run' && s.chars ? ` · ${s.chars.toLocaleString()}자` : ''}</small>
                </li>
                </Tip>
              ))}
            </ul>
          )}
          {(run.status.length > 0 || (running && run.thinking)) && (
            <Fold className="fold" summary="진행 기록 보기">
              <ul className="progress__log">
                {run.status.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
              {running && !run.sections.length && run.thinking && <pre className="progress__thinking">{run.thinking.slice(-600)}</pre>}
            </Fold>
          )}
        </>
      )}

      {result && !running && (
        <>
          <div className="getit">
            {/* 머리: 제목 왼쪽, 점검 배지·걸린 시간 오른쪽 한 줄 */}
            <div className="getit__head">
            <h3 className="getit__title">
              마크업이 준비됐습니다{nErr > 0 && <em> — 오류 {nErr}건 확인 필요</em>}
            </h3>
            <div className="getit__badges">
              {nErr > 0 && <span className="badge badge--error">오류 {nErr}</span>}
              {nWarn > 0 && <span className="badge badge--warn">확인 {nWarn}</span>}
              <span className="badge badge--ok">통과 {passed.length}</span>
              {/* 이번 변환(또는 수정 요청)에 걸린 시간 — 대부분은 Claude 구조 계획, 나머지는 이 PC 의 코드 생성·점검 */}
              {run.startedAt && run.endedAt && (
                <Tip content={run.planMs !== undefined ? `구조 계획(Claude) ${fmtDur(run.planMs)} · 마크업 생성·점검(이 PC) ${fmtDur(secMs(run.endedAt - run.startedAt) - secMs(run.planMs))}` : '저장된 구조 계획으로 만들어 Claude 호출 없음'}>
                <span className="getit__time" tabIndex={0}>
                  {fmtDur(run.endedAt - run.startedAt)} 걸림
                  {run.planMs !== undefined && <small> · 구조 계획 {fmtDur(run.planMs)}</small>}
                </span>
                </Tip>
              )}
            </div>
            </div>
            {/* 담당자가 할 일은 「복사 → 붙여넣기」 하나. 이미지 업로드는 복사 버튼이 알아서 먼저 한다 */}
            <div className="getit__main">
              <div className="getit__btns">
              <button
                className={`btn ${autoUpload || imgReady ? 'btn--primary' : ''} getit__copy`}
                disabled={!result.parsed.html || upBusy || (!autoUpload && !imgReady) || dirty}
                onClick={() => copyHtml()}
              >
                {upBusy ? (
                  <>
                    <span className="spinner" />
                    {upload!.phase === 'checking' ? '이미지 서버 확인 중…' : upload!.phase === 'uploading' ? `이미지 올리는 중 ${upload!.done}/${upload!.total}` : upload!.phase === 'removing' ? `이미지 지우는 중 ${upload!.done}/${upload!.total}` : '이미지 주소 확인 중…'}
                  </>
                ) : copied === 'html' ? (
                  <><CheckMark className="btn__ico" aria-hidden="true" /> 복사됨 · 이제 붙여넣으세요</>
                ) : (
                  autoUpload && upload!.phase !== 'done' ? '이미지 올리고 HTML 복사' : 'HTML 복사'
                )}
              </button>
              {/* 붙여넣기 전에 — 에디터 테스트(#tester)로 넘어가 지금 결과를 불러 둔다.
                  예전엔 안내 글 아래 글자 링크라 설명처럼 묻혀서(2026-11-25 의견) 복사 버튼 옆 보조 버튼으로. 복사가 막혀 있어도(이미지 올리기 전) 미리 볼 수 있다 */}
              {onOpenTester && (
                <TipWrap disabled={!result.parsed.html} content="붙여넣기 전에, 쇼핑몰 에디터가 저장하면서 이 HTML을 어떻게 바꾸는지 미리 봅니다">
                  <Button type="button" className="getit__tester" disabled={!result.parsed.html} onClick={onOpenTester}>
                    <Eye className="btn__ico" />
                    에디터 미리보기
                  </Button>
                </TipWrap>
              )}
              </div>
              <p className="getit__paste">
                <span className="getit__where">
                  <b>{openmarket ? '오픈마켓 상세 편집기의 HTML 입력' : '고도몰 상품 상세설명 (HTML 모드)'}</b>
                  {autoUpload ? '에 붙여넣으면 끝입니다.' : '에 붙여넣습니다 — 그 전에 아래 3단계로 이미지를 먼저 올려 주세요.'}
                </span>
                {dirty ? (
                  <span className="getit__note getit__unsaved" role="alert">
                    「수정」에 저장하지 않은 고침이 있어 복사를 막았습니다 — 저장하거나 되돌린 뒤 복사하세요.
                    <button type="button" className="link-btn" onClick={() => setTab('edit')}>
                      수정으로 가기
                    </button>
                  </span>
                ) : (
                  edited !== null && (
                    <span className="getit__note getit__edited">
                      「수정」에서 저장한 HTML을 복사합니다.
                      <button type="button" className="link-btn" onClick={() => setTab('edit')}>
                        손본 내용 보기
                      </button>
                    </span>
                  )
                )}
                {!autoUpload && !imgReady && <span className="getit__note">아래 3단계를 마치고 「올렸습니다」를 체크하면 「HTML 복사」가 눌립니다.</span>}
                {autoUpload && upload!.phase !== 'done' && <span className="getit__note">이미지 {result.images.length}장은 복사할 때 이미지 서버에 자동으로 올라갑니다.</span>}
                {autoUpload && upload!.phase === 'done' && (
                  <span className="getit__note">
                    이미지 {upload!.total}장은 이미지 서버에 올라가 있습니다{upload!.restored ? ' (전에 올린 것)' : ` (모두 열리는 것 확인${upload!.overwritten ? ` · ${upload!.overwritten}장 덮어씀` : ''})`}.
                    {onUndoUpload && !undoAsk && !!upload!.record?.length && (
                      <button className="link-btn" onClick={() => { setUndoAsk(true); setUndoSure(false); }}>잘못 올렸으면 되돌리기</button>
                    )}
                  </span>
                )}
              </p>
            </div>
            {missing.length > 0 && (
              <p className="msg msg--error" role="alert">
                복사하지 않았습니다 — 이 HTML 이 쓰는 이미지 {missing.length}장이 만들어지지 않았습니다 ({missing.slice(0, 3).join(', ')}{missing.length > 3 ? ' …' : ''}). 그대로 붙여넣으면 그림이 빈칸으로 나옵니다. 아래 점검의 「이미지 자르기 실패」를 확인하고 다시 만들어 주세요.
              </p>
            )}
            {copied?.startsWith('fail:') && copied !== 'fail:diag' && <p className="msg msg--error" role="alert">복사하지 못했습니다. 버튼을 한 번 더 누르고, 그래도 안 되면 아래 「HTML」 탭에서 직접 선택해 복사하세요.</p>}
            {autoUpload && upload!.phase === 'confirm' && !!upload!.overwrite?.length && (() => {
              const over = upload!.overwrite!;
              const changed = over.filter((o) => o.sizeChanged).length;
              return (
                <div className="getit__undo getit__over" role="group" aria-label="이미지 덮어쓰기 확인">
                  <b>
                    이미지 서버에 같은 이름 이미지 {over.length}장이 있어, 올리면 새 것으로 덮어씁니다.
                  </b>
                  <code className="getit__code">{upload!.folder}</code>
                  <ul className="getit__over-list">
                    {over.slice(0, 12).map((o) => (
                      <li key={o.file}>
                        {o.file} <small>{o.from ? `${o.from} → ${o.to}` : `새 그림 ${o.to}`}{o.sizeChanged ? ' · 크기 바뀜' : ''}</small>
                      </li>
                    ))}
                    {over.length > 12 && <li>… 외 {over.length - 12}장</li>}
                  </ul>
                  {changed > 0 ? (
                    <span className="getit__undo-warn">
                      그림 크기가 바뀐 이미지 {changed}장 — 이 이미지를 쓰는 예전 HTML 이 이미 쇼핑몰에 붙어 있다면, 그 상품 페이지도 이번 HTML 로 다시 붙여넣어야 화면이 틀어지지 않습니다.
                    </span>
                  ) : (
                    <span>그림 크기는 그대로라, 이미 붙여 둔 상품 페이지에도 새 그림이 그대로 보입니다 (안 바뀌어 보이면 Ctrl+F5).</span>
                  )}
                  <span>예전 이미지는 서버에 백업해 두고, 올린 뒤 「잘못 올렸으면 되돌리기」로 되돌릴 수 있습니다.</span>
                  {!!upload!.unused && <span>이 HTML 이 쓰지 않는 서버 파일 {upload!.unused}개는 지우지 않고 그대로 둡니다.</span>}
                  <span className="getit__undo-actions">
                    <Button size="sm" variant="primary" onClick={() => copyHtml(true)}>덮어쓰고 HTML 복사</Button>
                    <Button size="sm" onClick={onUploadReset}>취소</Button>
                  </span>
                </div>
              );
            })()}
            {autoUpload && onUndoUpload && undoAsk && upload!.phase === 'done' && !!upload!.record?.length && (() => {
              const rec = upload!.record!;
              const over = rec.filter((x) => x.backup).length;
              return (
              <div className="getit__undo" role="group" aria-label="올린 이미지 되돌리기">
                <b>
                  방금 올린 이미지 {rec.length}장을 되돌립니다{over ? ` — 덮어쓴 ${over}장은 예전 이미지로, 새로 올린 ${rec.length - over}장은 지웁니다` : ' — 서버에서 지웁니다'}.
                </b>
                <span>이 HTML 을 이미 쇼핑몰에 붙여넣었다면, 되돌리는 순간 그 상품 페이지 그림이 빈칸이 되거나 예전 그림으로 바뀝니다.</span>
                <CheckField className="getit__undo-check" checked={undoSure} onChange={setUndoSure}>
                  이 HTML 은 아직 쇼핑몰에 붙여넣지 않았습니다
                </CheckField>
                <span className="getit__undo-actions">
                  <Button size="sm" variant="danger" disabled={!undoSure} onClick={() => { setUndoAsk(false); onUndoUpload(); }}>되돌리기</Button>
                  <Button size="sm" onClick={() => setUndoAsk(false)}>취소</Button>
                </span>
              </div>
              );
            })()}
            {upload?.phase === 'removed' && (
              <p className="msg getit__removed">{upload.message} 다시 쓰려면 「이미지 올리고 HTML 복사」를 누르세요.</p>
            )}
            {upload?.phase === 'error' && <UploadStatus upload={upload} />}
            {!autoUpload && (
              <ManualSteps
                count={result.images.length}
                url={`${result.baseUrl}/`}
                zipping={zipping}
                zipDone={zipDone}
                onZip={downloadZip}
                folder={`${SHARED_ROOT}\\${CHANNEL_DIR[result.meta.channel]}`}
                saver={canSaveToFolder() ? <SharedSave result={result} loaded={loaded} onSaved={setSharedPath} primary={!sharedPath && !zipDone && !imgReady} label="공유 폴더에 바로 저장" /> : undefined}
                savedPath={sharedPath}
                folderCopied={copied === 'folder'}
                onCopyFolder={() => copy('folder', `${SHARED_ROOT}\\${CHANNEL_DIR[result.meta.channel]}`)}
                urlCopied={copied === 'url'}
                onCopyUrl={() => copy('url', `${result.baseUrl}/`)}
                ready={imgReady}
                onReady={setImgReady}
                htmlCopied={copied === 'html'}
                onCopyHtml={() => copyHtml()}
              />
            )}
            {/* 그 밖의 일(보관·직접 올리기)은 주 버튼과 선으로 나눠 아래에 모은다 */}
            {(autoUpload || zipError) && (
              <div className="getit__extra">
                {canSaveToFolder() && autoUpload && <SharedSave result={result} loaded={loaded} />}
                {autoUpload && (
                  <Fold className="fold getit__more" summary="직접 올리기 · zip 내려받기">
                    {manualTools}
                  </Fold>
                )}
                {zipError && <p className="msg msg--error" role="alert">{zipError}</p>}
              </div>
            )}
          </div>

          {/* 등록한 페이지 링크 — 복사·붙여넣기(받아 가기 상자)가 끝난 뒤의 일이라 상자 밖에 따로 둔다 */}
          {godo && <GodoCheckBox html={copySection(result.parsed.html)} folder={`/${result.meta.channel}/${result.meta.slug}/`} link={regLink} onLink={onRegLink} />}

          {issues.length > 0 && (
            <ul className="checks">
              {issues.map((c, i) => (
                <li key={i} className={`check check--${c.level}`}>
                  <CheckLine c={c} />
                </li>
              ))}
            </ul>
          )}
          {/* 문제 자동 수정: 고칠 수 있는 것(구조 계획)만 Claude 1회로, 나머지(코드 쪽)는 진단 정보 복사 */}
          {codeEngine && (fixable.length > 0 || codeSide.length > 0 || autoFix) && (
            <div className={`autofix ${autoFix ? (autoFix.ok ? 'is-ok' : 'is-kept') : ''}`}>
              {autoFix && <p className="autofix__result">{autoFix.text}</p>}
              {fixable.length > 0 && onAutoFix && (
                <div className="autofix__row">
                  <Button variant="primary" size="sm" disabled={running} onClick={onAutoFix}>
                    문제 자동 수정 ({fixable.length}건)
                  </Button>
                  <span className="autofix__note">
                    빠진 글자·제목 구조처럼 구조 계획으로 고칠 수 있는 문제만 고칩니다 · Claude 1회(1~2분, 새로 만들 때와 비슷한 비용) · <b>나아졌을 때만</b> 새 결과로 바꿉니다
                  </span>
                </div>
              )}
              {codeSide.length > 0 && (
                <div className="autofix__row">
                  <Button size="sm" onClick={() => copy('diag', diagnostics(result, loaded, run))}>
                    {copied === 'diag' ? '복사됨' : copied === 'fail:diag' ? '복사 실패' : '진단 정보 복사'}
                  </Button>
                  <span className="autofix__note">
                    나머지 {codeSide.length}건({layoutOff ? '위치 어긋남 등 ' : ''}마크업 코드 쪽 문제)은 Claude 에게 다시 시켜도 바뀌지 않아 자동으로 고치지 않습니다. 진단 정보를 복사해 관리자에게 보내 주세요.
                  </span>
                </div>
              )}
            </div>
          )}
          {passed.length > 0 && (
            <Fold className="fold" summary={<>통과한 점검 {passed.length}개</>}>
              <ul className="checks">
                {passed.map((c, i) => (
                  <li key={i} className="check check--ok">
                    <CheckLine c={c} />
                  </li>
                ))}
              </ul>
            </Fold>
          )}

          <Tabs.Root value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <Tabs.List className="tabs" aria-label="결과 보기">
            {(
              [
                ['preview', '미리보기'],
                ['edit', dirty ? '수정 · 저장 안 함' : edited !== null ? '수정 · 저장됨' : '수정'],
                ['images', `이미지 ${result.images.length}`],
                ['report', '로그'],
              ] as [Tab, string][]
            ).map(([k, label]) => (
              <Tabs.Trigger key={k} value={k} className="tabs__tab">{label}</Tabs.Trigger>
            ))}
          </Tabs.List>

          <Tabs.Content value="preview"><Preview result={result} loaded={loaded} /></Tabs.Content>
          <Tabs.Content value="edit">
            <div className="fixit">
              <p className="hint fixit__note">
                복사하기 전에 글자를 고치거나 글꼴·크기·정렬·링크를 손볼 수 있습니다. 「저장」해야 「HTML 복사」에 들어가고 작업에도 남습니다. 다시 만들기·수정 요청으로 결과가 새로 만들어지면 저장한 고침은 사라집니다.
              </p>
              {/* 저장 막대 — 지금 상태를 말로 보여 주고, 저장·되돌리기·원래대로 */}
              <div className={`fixit__bar${dirty ? ' is-dirty' : ''}`} role="status">
                <span className="fixit__state">{dirty ? '저장하지 않은 고침이 있습니다' : edited !== null ? '저장한 고침이 복사에 쓰입니다' : '고친 내용 없음 — 만든 결과 그대로 복사합니다'}</span>
                {dirty && (
                  <>
                    <Button type="button" size="sm" variant="primary" disabled={!onSaveEdit} onClick={() => (onSaveEdit?.(draft === original ? null : draft), setDraft(null))}>
                      저장
                    </Button>
                    <Button type="button" size="sm" onClick={dropDraft}>
                      변경점 되돌리기
                    </Button>
                  </>
                )}
                {!dirty && edited !== null && (
                  <Button type="button" size="sm" onClick={() => (onSaveEdit?.(null), dropDraft())}>
                    원래 결과로 되돌리기
                  </Button>
                )}
              </div>
              <SeEditBox
                title="복사 전에 수정"
                resetKey={editKey}
                note={openmarket ? '오픈마켓 HTML' : '고도몰 상세설명'}
                common={openmarket}
                html={draft ?? edited ?? original}
                onChange={(h) => setDraft(h === (edited ?? original) ? null : h)}
                p={editorOf(editorIdOf(result.meta))}
                images={result.images.map((im) => [`${result.baseUrl}/${im.file}`, im.url] as [string, string])}
                warn="고친 뒤 위의 「저장」을 눌러야 복사할 HTML에 들어갑니다. 그림·표는 바꿀 수 없습니다."
              />
            </div>
          </Tabs.Content>
          <Tabs.Content value="report">
              {run.usage && (
                <p className="usage">
                  {run.model} · 입력 {run.usage.input.toLocaleString()} / 캐시 {run.usage.cacheRead.toLocaleString()} / 출력 {run.usage.output.toLocaleString()} 토큰 · 약 ${run.usage.costUsd.toFixed(2)}
                </p>
              )}
              <p className="hint">규칙 9절 완료 보고 — 이미지로 구운 텍스트·오탈자·검색 최적화 제안은 디자이너·기획 담당에게 넘깁니다.</p>
              <pre className="pre">{result.parsed.report || '(보고 없음)'}</pre>
              <Fold className="raw" summary="Claude 응답 원문 (결과가 이상할 때 원인 확인용)">
                <pre className="pre">{[`===== 계획 =====\n${result.planRaw}`, ...result.sections.map((s) => `===== ${s.id} ${s.name} =====\n${s.raw}`)].join('\n\n')}</pre>
              </Fold>
          </Tabs.Content>
          <Tabs.Content value="images">
            <p className="hint images__legend">
              alt 는 그림이 HTML 에서 쓰이는 방식에 따라 정해집니다 (규칙 8-2): 사진은 설명, 구운 글자는 원문, 글자 뺀 배경은 CSS 배경이라 alt 가 없고 그 위 문구는 HTML 글자로 들어갑니다.
            </p>
            <div className="images">
              {result.images.map((im) => {
                const k = imageKind(im.file, use.get(im.file));
                const alt = use.get(im.file)?.alt ?? im.alt;
                return (
                  <figure key={im.file} className={`images__item${im.blob.size > 1024 * 1024 ? ' is-big' : ''}`}>
                    <img className="images__thumb" src={im.url} alt={alt || ''} />
                    <figcaption className="images__cap">
                      <em className={`images__kind images__kind--${k.tone}`}>{k.label}</em>
                      <b>{im.file}</b> {im.width}×{im.height} · {fmtBytes(im.blob.size)}
                      {alt ? <span>alt: {alt}</span> : <span className="images__noalt">{k.noAlt}</span>}
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          </Tabs.Content>
          </Tabs.Root>

          <h3 className="revise__title">고칠 곳이 있으면</h3>
          <div className="revise">
            {autoCount > 0 && (
              <Tip content="PSD 위치 대조에서 어긋난 텍스트가 있는 섹션만 골라 고치게 합니다">
              <Button size="sm" onClick={() => onRevise(auto)}>
                대조 결과로 고치기 (섹션 {autoCount}개)
              </Button>
              </Tip>
            )}
            <Select
              aria-label="고칠 섹션"
              value={target}
              onChange={setTarget}
              options={[{ value: 'all', label: '모든 섹션' }, ...result.sections.map((s) => ({ value: s.id, label: `${s.id} ${s.name}` }))]}
            />
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
  /** 이미지에 남긴 글자 위치를 PSD 이미지 위에 표시 */
  const [showKept, setShowKept] = useState(false);
  const { real, kept } = textSplit(result, loaded);
  const showHtml = view !== 'psd';
  const showPsd = view !== 'html';

  const height = useFrameHeight(frame, 1000, [result.previewHtml, width, showHtml]);

  return (
    <div className="preview">
      <div className="preview__bar">
        <Seg
          aria-label="미리보기 보기 방식"
          value={view}
          onChange={setView}
          items={[
            { value: 'compare', label: '나란히 비교' },
            { value: 'psd', label: 'PSD 이미지' },
            { value: 'html', label: 'HTML 마크업' },
          ]}
        />
        <div className="zoom">
          <span aria-hidden="true">배율</span>
          <Select size="sm" aria-label="배율" className="zoom__sel" value={zoom} onChange={setZoom} options={[0.25, 0.4, 0.5, 0.75, 1].map((z) => ({ value: z, label: `${Math.round(z * 100)}%` }))} />
        </div>
      </div>
      <div className="preview__bar preview__texts">
        <span>
          실제 글자 <b>{real.toLocaleString()}개</b> ·{' '}
          {kept.length > 0 ? (
            // 숫자를 누르면 PSD 위 위치 표시(주황 테두리)·목록을 켜고 끈다 (따로 버튼을 두지 않음)
            <Tip content={showKept ? '위치 표시 끄기' : 'PSD 이미지 위에 위치 표시'}>
            <button
              type="button"
              className={`preview__keptToggle${showKept ? ' is-on' : ''}`}
              aria-pressed={showKept}
              onClick={() => {
                setShowKept((v) => !v);
                if (view === 'html') setView('compare');
              }}
            >
              이미지에 남긴 글자 <b>{kept.length.toLocaleString()}개</b>
            </button>
            </Tip>
          ) : (
            <>이미지에 남긴 글자 <b>0개</b></>
          )}
        </span>
        <span className="hint">
          {kept.length > 0 ? '숫자를 누르면 PSD 위에 위치를 표시합니다. ' : ''}이미지에 남긴 글자는 문구를 고치려면 PSD 를 고쳐야 합니다 (완료 보고에 목록).
        </span>
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

/** 자동 업로드가 막혔을 때만 보이는 안내 — 실패 이유 (진행 상황은 복사 버튼에 표시) */
function UploadStatus({ upload: u }: { upload: UploadState }) {
  return (
    <span className="upbox">
      <span className="msg msg--error" role="alert">{u.message}{u.message?.startsWith('되돌리기') ? '' : ' — 「이미지 올리고 HTML 복사」를 다시 누르면 이어서 올립니다. (HTML 은 복사되지 않았습니다)'}</span>
      {u.bad?.length ? <span className="msg msg--error" role="alert">열리지 않는 이미지: {u.bad.map((b) => `${b.file}(${b.status || '응답 없음'})`).join(', ')}</span> : null}
      <small className="hint">같은 이름 이미지는 안내에서 확인한 뒤에만 덮어씁니다 (예전 이미지는 서버에 백업).</small>
    </span>
  );
}

/**
 * 공유 폴더에 저장 — A_상세페이지<채널><제품명> 에 HTML · img · (없으면) PSD.
 * 처음 한 번 A_상세페이지 폴더를 고르면 기억한다. 덮어쓰지 않고, HTML 이 다르면 물어본 뒤에만 바꾼다
 */
/** 점검 한 줄: 쉬운 말(무슨 뜻 + 할 일) + 원래 문구는 「자세히」 안에 (src/lib/plainCheck.ts) */
function CheckLine({ c }: { c: Check }) {
  const p = plainCheck(c);
  return (
    <>
      <b className="check__what">{p.what}</b>
      {p.todo && <span className="check__todo"> {p.todo}</span>}
      {p.what !== c.message && (
        <Fold className="check__more" summary="자세히">
          <span>{c.message}</span>
        </Fold>
      )}
    </>
  );
}

function SharedSave({ result, loaded, onSaved, primary, label = '공유 폴더에 저장' }: { result: Result; loaded: Loaded; onSaved?: (path: string) => void; primary?: boolean; label?: string }) {
  type St =
    | { s: 'idle' }
    | { s: 'busy'; msg: string }
    | { s: 'ask'; root: FileSystemDirectoryHandle; path: string }
    | { s: 'done'; r: SaveResult }
    | { s: 'error'; msg: string };
  const [st, setSt] = useState<St>({ s: 'idle' });
  const [rootName, setRootName] = useState<string | null>(null);
  const [pathCopied, setPathCopied] = useState(false);
  useEffect(() => {
    rememberedRootName().then(setRootName);
  }, []);
  // 결과가 바뀌면(수정·새 rev) 처음 상태로
  useEffect(() => setSt({ s: 'idle' }), [result.baseUrl, result.parsed.html]);
  const folder = safeFolderName(result.meta.productName);
  const changed = folder !== result.meta.productName.trim();
  const input = { channel: result.meta.channel, productName: result.meta.productName, html: result.parsed.html, images: result.images, psd: loaded.file };

  const write = async (root: FileSystemDirectoryHandle, replaceHtml: boolean) => {
    setSt({ s: 'busy', msg: '저장 중…' });
    try {
      const r = await saveToShared(root, input, replaceHtml, (msg) => setSt({ s: 'busy', msg }));
      setSt({ s: 'done', r });
      onSaved?.(r.path);
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
        <button className={`btn btn--sm${primary ? ' btn--primary' : ''}`} disabled={busy || !result.parsed.html} onClick={() => start(false)}>
          {busy ? (
            <>
              <span className="spinner" />
              {st.msg}
            </>
          ) : (
            label
          )}
        </button>
        {/* 버튼 오른쪽: 무엇을 · 어디에(경로) · 처음 안내를 한 덩어리로 */}
        <span className="shared__desc">
          <span>
            HTML · 이미지 · PSD 를 폴더째 보관합니다
            {rootName && !busy && (
              <button className="link-btn" onClick={() => start(true)}>
                다른 폴더 고르기
              </button>
            )}
          </span>
          <code className="shared__where" title={where}>{where}</code>
          {!rootName && st.s === 'idle' && (
            <small className="hint">
              처음 한 번 폴더 고르기 창이 열립니다 — {SHARED_ROOT} 폴더를 고르세요 (창 아래 「폴더」 칸에 이 경로를 붙여넣으면 바로 갑니다).
              <button className="link-btn" onClick={() => void copyText(SHARED_ROOT).then((ok) => ok && setPathCopied(true))}>
                {pathCopied ? '경로 복사됨' : '경로 복사'}
              </button>
            </small>
          )}
          {changed && st.s === 'idle' && <small className="hint">폴더 이름에 쓸 수 없는 글자를 빼고 「{folder}」로 저장합니다.</small>}
        </span>
      </div>
      {st.s === 'ask' && (
        <div className="shared__ask" role="group" aria-label="HTML 바꾸기 확인">
          <span>
            <b>{st.path}</b> 에 있는 <b>{folder}.html</b> 이 지금 결과와 다릅니다. 새 것으로 바꿀까요? (공유 폴더 HTML 은 보관용이라 쇼핑몰에는 영향이 없습니다)
          </span>
          <span className="shared__actions">
            <Button size="sm" variant="primary" onClick={() => write(st.root, true)}>새 HTML 로 바꾸기</Button>
            <Button size="sm" onClick={() => write(st.root, false)}>HTML 은 그대로 두고 나머지만 저장</Button>
            <Button size="sm" onClick={() => setSt({ s: 'idle' })}>취소</Button>
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
      {st.s === 'error' && <p className="msg msg--error" role="alert">{st.msg}</p>}
    </div>
  );
}

/**
 * 이미지 자동 업로드가 없을 때 — 붙여넣기 전에 이미지를 직접 올리는 3단계 (예전 노란 경고 상자를 단계 카드로).
 * ① zip 받기 → ② img 폴더 안 이미지를 FTP 로 주소 폴더에 → ③ 올렸다고 체크하면 그 자리에서 HTML 복사.
 * 지금 할 단계만 강조하고, 끝난 단계는 초록 체크로 바꾼다 (② 는 화면 밖 일이라 ③ 체크로 함께 끝난다)
 */
function ManualSteps(p: {
  count: number;
  url: string;
  zipping: boolean;
  zipDone: null | 'saved' | 'download';
  onZip: () => void;
  /** 공유 폴더에 바로 저장 (크롬·엣지 — 없으면 zip 만) */
  saver?: React.ReactNode;
  savedPath: string | null;
  /** 공유 폴더 채널 폴더 경로 (\\192.168.1.254\…\아이티켓) */
  folder: string;
  folderCopied: boolean;
  onCopyFolder: () => void;
  urlCopied: boolean;
  onCopyUrl: () => void;
  ready: boolean;
  onReady: (v: boolean) => void;
  htmlCopied: boolean;
  onCopyHtml: () => void;
}) {
  const got = !!p.zipDone || !!p.savedPath; // 1단계 끝 (공유 폴더에 저장했거나 zip 을 받음)
  const now = p.ready ? 4 : got ? 2 : 1; // 지금 할 단계 (4 = 다 끝남)
  const state = (n: number) => (n < now || (n === 2 && p.ready) ? 'done' : n === now || (n === 3 && now === 2) ? 'now' : 'todo');
  const Num = ({ n }: { n: number }) => (
    <span className="msteps__num" aria-hidden="true">
      {state(n) === 'done' ? (
        <CheckMark />
      ) : (
        n
      )}
    </span>
  );
  return (
    <section className={`msteps${p.ready ? ' is-ready' : ''}`} aria-label="이미지 직접 올리기">
      <header className="msteps__head">
        <span className={`badge ${p.ready ? 'badge--ok' : 'badge--warn'}`}>{p.ready ? '이미지 준비됨' : '붙여넣기 전에'}</span>
        {p.ready ? (
          <p>
            <b>이미지 {p.count}장을 올렸습니다.</b> 이제 HTML 을 복사해 붙여넣으세요.
          </p>
        ) : (
          <p>
            <b>이미지 {p.count}장을 먼저 서버에 올려 주세요.</b> 올리지 않고 붙여넣으면 상품 페이지에 그림이 빈칸으로 나옵니다.
          </p>
        )}
      </header>
      <ol className="msteps__list">
        <li className={`msteps__step is-${state(1)}`}>
          <Num n={1} />
          <div className="msteps__body">
            <b>{p.saver ? '공유 폴더에 HTML·이미지 저장' : 'HTML·이미지 zip 받기'}</b>
            {p.saver ? (
              <>
                <span className="msteps__desc">
                  zip·압축 풀기 없이 공유 폴더 <code>{p.folder.split('\\').slice(-1)[0]}</code> 안 제품 폴더에 HTML 과 <code>img</code> 폴더(이미지 {p.count}장)를 바로 만듭니다.
                </span>
                {p.saver}
                {/* 공유 폴더 주소 복사는 zip 방식(아래)에만 — 여기서는 앱이 그 폴더에 바로 쓰고, 처음 폴더 고를 때는 위 「경로 복사」를 쓴다 */}
                <div className="msteps__act msteps__alt">
                  <span>또는</span>
                  <Button type="button" size="sm" disabled={p.zipping} onClick={p.onZip}>
                    {p.zipping ? 'zip 만드는 중…' : p.zipDone ? 'zip 다시 받기' : 'zip 으로 받기'}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <span className="msteps__desc">
                  저장 창이 열리면 공유 폴더(<code>{p.folder.split('\\').slice(-2).join('\\')}</code>)에 저장하고 풉니다. <code>img</code> 폴더에 이미지 {p.count}장이 있습니다.
                </span>
                <div className="msteps__act">
                  <button type="button" className={`btn btn--sm${now === 1 ? ' btn--primary' : ''}`} disabled={p.zipping} onClick={p.onZip}>
                    {p.zipping ? 'zip 만드는 중…' : p.zipDone ? 'zip 다시 받기' : 'zip 저장하기'}
                  </button>
                  <Button type="button" size="sm" onClick={p.onCopyFolder}>
                    {p.folderCopied ? '복사됨 — 탐색기 주소창에 붙여넣으세요' : '공유 폴더 주소 복사'}
                  </Button>
                </div>
              </>
            )}
            {p.zipDone === 'download' && (
              <span className="msteps__note">
                이 브라우저는 저장 위치를 고를 수 없어 「다운로드」 폴더에 받았습니다. 위 「공유 폴더 주소 복사」 → 탐색기 주소창(또는 Win+R)에 붙여넣으면 공유 폴더가 열립니다.
              </span>
            )}
          </div>
        </li>
        <li className={`msteps__step is-${state(2)}`}>
          <Num n={2} />
          <div className="msteps__body">
            <b>이미지를 서버 폴더에 올리기</b>
            <span className="msteps__desc">
              FTP 프로그램으로 {p.savedPath ? <><code>{p.savedPath}\img</code> 폴더</> : <><code>img</code> 폴더</>} <em>안의</em> 이미지를 아래 주소 폴더에 올립니다. 같은 이름은 덮어씁니다.
            </span>
            <div className="msteps__act msteps__url">
              <code title={p.url}>{p.url}</code>
              <Button type="button" size="sm" onClick={p.onCopyUrl}>{p.urlCopied ? '복사됨' : '주소 복사'}</Button>
            </div>
          </div>
        </li>
        <li className={`msteps__step is-${state(3)}`}>
          <Num n={3} />
          <div className="msteps__body">
            <b>올렸다고 표시하고 HTML 복사</b>
            <div className="msteps__act">
              <CheckField className="msteps__check" checked={p.ready} onChange={p.onReady}>
                이미지 {p.count}장을 올렸습니다
              </CheckField>
              {p.ready && (
                <Button type="button" size="sm" variant="primary" onClick={p.onCopyHtml}>
                  {p.htmlCopied ? <><CheckMark className="btn__ico" aria-hidden="true" /> 복사됨 · 이제 붙여넣으세요</> : 'HTML 복사'}
                </Button>
              )}
            </div>
          </div>
        </li>
      </ol>
      <small className="msteps__later">이미지 자동 업로드가 켜지면 이 단계 없이 「HTML 복사」 한 번으로 끝납니다.</small>
    </section>
  );
}


