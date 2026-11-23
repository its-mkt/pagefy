import { useEffect, useRef, useState } from 'react';
import type { Loaded, Result, RunState } from '../App';
import { copySection } from '../lib/output';
import { buildZip, download, fmtBytes } from '../lib/util';

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
  onUpload?: () => void;
  /** 같은 rev 폴더에 다른 이미지가 있을 때: 다음 번호 rev 로 다시 만들기 (계획 재사용, 비용 없음) */
  onNewRev?: () => void;
}

export interface UploadState {
  phase: 'idle' | 'checking' | 'uploading' | 'verifying' | 'done' | 'error' | 'conflict';
  done: number;
  total: number;
  message?: string;
  /** 확인 실패한 파일 */
  bad?: { file: string; status: number }[];
  nextRev?: string;
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

/** copied: 복사한 버튼 key, 실패하면 'fail:key' */
function useCopy(): [string | null, (key: string, text: string) => Promise<void>] {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async (key: string, text: string) => {
    setCopied((await copyText(text)) ? key : `fail:${key}`);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(null), 1500);
  };
  return [copied, copy];
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

export default function ResultPanel({ run, result, loaded, revisionCount, onRevise, onCancel, onResume, resumeLabel, upload, onUpload, onNewRev }: Props) {
  const [tab, setTab] = useState<Tab>('preview');
  const [feedback, setFeedback] = useState('');
  const [target, setTarget] = useState('all');
  const [copied, copy] = useCopy();
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

  const checks = result ? [...result.checks].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]) : [];
  const issues = checks.filter((c) => c.level !== 'ok');
  const passed = checks.filter((c) => c.level === 'ok');
  const nErr = checks.filter((c) => c.level === 'error').length;
  const nWarn = checks.filter((c) => c.level === 'warn').length;
  const openmarket = result?.meta.channel === 'openmarket';

  return (
    <section className="panel">
      <h2 className="panel__title">결과 {revisionCount > 0 && <small>(수정 {revisionCount}회)</small>}</h2>

      {running && (
        <div className="progress">
          <p className="progress__now">
            <span className="spinner" />
            <span className="progress__label">{prog.label}</span>
            <span className="progress__pct">{pct}%</span>
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
            </div>
            <div className="actions getit__actions">
              <button
                className="btn btn--primary"
                disabled={!result.parsed.html || zipping}
                onClick={async () => {
                  setZipping(true);
                  setZipError(null);
                  try {
                    download(await buildZip(result.meta.productName, result.meta.rev, result.parsed.html, result.images), `${result.meta.productName}.zip`);
                  } catch (e) {
                    setZipError(`zip을 만들지 못했습니다: ${(e as Error).message}`);
                  } finally {
                    setZipping(false);
                  }
                }}
              >
                {zipping ? 'zip 만드는 중…' : 'zip 내려받기'}
              </button>
              <button className="btn" disabled={!result.parsed.html} onClick={() => copy('html', copySection(result.parsed.html))}>
                {copied === 'html' ? '복사됨' : 'HTML 복사 (쇼핑몰 등록용)'}
              </button>
            </div>
            {zipError && <p className="msg msg--error">{zipError}</p>}
            {copied?.startsWith('fail:') && <p className="msg msg--error">복사하지 못했습니다. 아래 「HTML」 탭에서 직접 선택해 복사하세요.</p>}
            <h4 className="getit__sub">등록 순서</h4>
            <ol className="getit__steps">
              <li>
                {upload && onUpload ? (
                  <UploadBox upload={upload} total={result.images.length} onUpload={onUpload} onNewRev={onNewRev} />
                ) : (
                  <>
                    zip을 풀고 <code className="getit__code">img/{result.meta.rev}</code> 폴더 안 이미지를 아래 주소에 올리기
                  </>
                )}
                <span className="getit__url">
                  <code className="getit__code">{result.baseUrl}/</code>
                  <button className="btn btn--sm" onClick={() => copy('url', `${result.baseUrl}/`)}>{copied === 'url' ? '복사됨' : '주소 복사'}</button>
                </span>
              </li>
              <li>
                <b>HTML 복사</b> 후 {openmarket ? '오픈마켓 상세 편집기의 HTML 입력에 붙여넣기' : '고도몰 상품 상세설명(HTML 모드)에 붙여넣기'}
              </li>
              <li>상품 페이지에서 이미지가 모두 뜨는지 확인</li>
            </ol>
          </div>
          {run.usage && (
            <p className="usage">
              {run.model} · 입력 {run.usage.input.toLocaleString()} / 캐시 {run.usage.cacheRead.toLocaleString()} / 출력 {run.usage.output.toLocaleString()} 토큰 · 약 ${run.usage.costUsd.toFixed(2)}
            </p>
          )}

          {issues.length > 0 && (
            <ul className="checks">
              {issues.map((c, i) => (
                <li key={i} className={`check check--${c.level}`}>{c.message}</li>
              ))}
            </ul>
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
              className="btn"
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
  html: '만들어진 HTML 마크업만 봅니다 — 마우스로 끌어 글자가 긁히는지 보세요. 긁히지 않는 글자는 이미지로 구운 것입니다.',
};

const countChars = (t: string) => t.replace(/\s/g, '').length;

/** 미리보기 문서에만 선택 색을 넣는다 (포커스가 밖에 있어도 회색이 아닌 파란색으로). 내려받는 HTML 에는 들어가지 않는다 */
function ensureSelStyle(doc: Document) {
  if (doc.getElementById('pf-sel') || !doc.head) return;
  const st = doc.createElement('style');
  st.id = 'pf-sel';
  // 규칙 7-6 글자 선택 막기(.prefix * {user-select:none!important}, ::selection 투명)를 미리보기에서만 푼다 → "글자 전체 선택"으로 실제 글자인지 확인.
  // 상세 CSS 도 !important 라 특이도가 더 높아야 이긴다: 규칙 7-6 은 .prefix:not(#a):not(#b) * = (2,1,0) →
  // html:root body:not(#pf-s1):not(#pf-s2):not(#pf-s3) * = (3,1,2) 로 이긴다
  st.textContent =
    'html:root body:not(#pf-s1):not(#pf-s2):not(#pf-s3) *,html:root body:not(#pf-s1):not(#pf-s2):not(#pf-s3) *::before,html:root body:not(#pf-s1):not(#pf-s2):not(#pf-s3) *::after{-webkit-user-select:text!important;user-select:text!important}' +
    'html:root body:not(#pf-s1):not(#pf-s2):not(#pf-s3) ::selection,html:root body:not(#pf-s1):not(#pf-s2):not(#pf-s3) *::selection{background:rgba(45,95,209,.45)!important;color:inherit}';
  doc.head.appendChild(st);
}

function Preview({ result, loaded }: { result: Result; loaded: Loaded }) {
  const W = loaded.summary.width;
  const [view, setView] = useState<View>('compare');
  // 모바일은 비율 축소뿐이라(7-5) 따로 보지 않는다 — 모바일 확인(가로 스크롤·비율·가장 작은 글자)은 자동 점검이 한다
  const width = W;
  const [zoom, setZoom] = useState(0.5);
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(1000);
  /** 마우스로 긁은(또는 전체 선택한) 글자 수 (공백 제외) */
  const [picked, setPicked] = useState<number | null>(null);
  // 비교 기준: PSD 텍스트 레이어 글자 수. 이미지로 구울 후보(bakeHint)는 따로 센다
  const psdChars = loaded.summary.texts.reduce((n, t) => n + (t.bakeHint ? 0 : countChars(t.text)), 0);
  const bakeChars = loaded.summary.texts.reduce((n, t) => n + (t.bakeHint ? countChars(t.text) : 0), 0);
  const showHtml = view !== 'psd';

  useEffect(() => {
    setPicked(null);
    const f = frame.current;
    if (!f) return;
    // srcdoc 은 load 가 effect 보다 먼저 끝날 수 있고, 이미지가 늦게 뜨면 높이가 바뀐다 → 잠시 동안 주기적으로 잰다
    const measure = () => {
      // documentElement.scrollHeight 는 iframe 높이보다 작아지지 않아(폭을 360→PSD 폭으로 넓혀도 줄지 않음) 내용 높이인 body 로 잰다
      const d = f.contentDocument;
      const h = d?.body ? Math.max(Math.ceil(d.documentElement.getBoundingClientRect().height), d.body.scrollHeight) : undefined;
      if (h) setHeight(h);
    };
    let n = 0;
    const timer = window.setInterval(() => {
      measure();
      if (++n > 30) window.clearInterval(timer);
    }, 300);
    const onSel = () => {
      const t = f.contentWindow?.getSelection()?.toString() ?? '';
      setPicked(t ? countChars(t) : null);
    };
    // srcdoc 문서가 새로 뜰 때마다 선택 색과 선택 감지를 붙인다
    const bound = new WeakSet<Document>();
    const prep = () => {
      const doc = f.contentDocument;
      if (!doc) return;
      ensureSelStyle(doc);
      if (bound.has(doc)) return;
      bound.add(doc);
      doc.addEventListener('selectionchange', onSel);
    };
    const onLoad = () => {
      measure();
      prep();
    };
    prep();
    f.addEventListener('load', onLoad);
    return () => {
      f.removeEventListener('load', onLoad);
      f.contentDocument?.removeEventListener('selectionchange', onSel);
      window.clearInterval(timer);
    };
  }, [result.previewHtml, width, showHtml]);

  /** 마크업 전체 선택 (Ctrl+A 와 같음) — 글자로 된 부분만 파랗게 칠해지고, 이미지로 구운 글자는 그대로 남는다 */
  function selectAll() {
    const f = frame.current;
    const body = f?.contentDocument?.body;
    if (!body) return;
    ensureSelStyle(body.ownerDocument);
    f!.contentWindow!.getSelection()?.selectAllChildren(body);
  }
  const clearSel = () => frame.current?.contentWindow?.getSelection()?.removeAllRanges();

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
      {showHtml && (
        <div className="preview__bar preview__select">
          <button className="btn btn--sm" onClick={selectAll}>글자 전체 선택</button>
          <button className="btn btn--sm btn--ghost" onClick={clearSel} disabled={picked == null}>선택 해제</button>
          <span className="hint">
            {picked != null && <>선택된 글자 <b>{picked.toLocaleString()}자</b> · </>}
            PSD 텍스트 레이어 {psdChars.toLocaleString()}자{bakeChars ? ` (+ 이미지로 구울 후보 ${bakeChars.toLocaleString()}자)` : ''} · 공백 제외
          </span>
        </div>
      )}
      <p className="hint preview__hint">{VIEW_HINT[view]}</p>
      <div className="preview__cols">
        {(view === 'psd' || view === 'compare') && (
          <figure className="preview__col preview__col--psd">
            <figcaption className="preview__tag">
              <b>PSD 원본 이미지</b>
              <span>디자인 그대로의 그림 · 글자를 긁을 수 없음</span>
            </figcaption>
            <div style={{ zoom }}>
              <img src={loaded.compositeUrl} width={W} alt="PSD 합성 렌더" />
            </div>
          </figure>
        )}
        {showHtml && (
          <figure className="preview__col preview__col--html">
            <figcaption className="preview__tag">
              <b>HTML 마크업 (결과물)</b>
              <span>쇼핑몰에 들어갈 웹페이지 · PSD 폭 {W}px (모바일은 비율대로 줄어듦)</span>
            </figcaption>
            <div style={{ zoom }}>
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

/** 등록 순서 1번: 이미지 서버에 올리기 — 진행·결과·같은 날짜 폴더 충돌 안내 */
function UploadBox({ upload: u, total, onUpload, onNewRev }: { upload: UploadState; total: number; onUpload: () => void; onNewRev?: () => void }) {
  const busy = u.phase === 'checking' || u.phase === 'uploading' || u.phase === 'verifying';
  return (
    <span className="upbox">
      {u.phase === 'done' ? (
        <span className="upbox__ok">이미지 {u.total}장을 아래 주소에 올렸고, 모두 열리는 것을 확인했습니다.</span>
      ) : (
        <>
          <span>이미지 {total}장을 아래 주소에 올리기</span>
          <button className="btn btn--sm btn--primary" disabled={busy} onClick={onUpload}>
            {busy ? (
              <>
                <span className="spinner" />
                {u.phase === 'checking' ? '서버 확인 중…' : u.phase === 'uploading' ? `올리는 중 ${u.done}/${u.total}` : `주소 확인 중…`}
              </>
            ) : u.phase === 'error' ? (
              '다시 올리기'
            ) : (
              '이미지 서버에 올리기'
            )}
          </button>
        </>
      )}
      {u.phase === 'error' && <span className="msg msg--error">{u.message}</span>}
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
