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

export default function ResultPanel({ run, result, loaded, revisionCount, onRevise, onCancel, onResume, resumeLabel }: Props) {
  const [tab, setTab] = useState<Tab>('preview');
  const [feedback, setFeedback] = useState('');
  const [target, setTarget] = useState('all');
  const running = run.phase === 'running';
  const auto = result ? layoutFeedback(result, loaded) : {};
  const autoCount = Object.keys(auto).length;
  const done = run.sections.filter((s) => s.state === 'done').length;

  return (
    <section className="panel">
      <h2 className="panel__title">4. 결과 {revisionCount > 0 && <small>(수정 {revisionCount}회)</small>}</h2>

      {(running || run.phase === 'error') && (
        <div className="progress">
          <ul className="progress__log">
            {run.status.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
          {running && (
            <p className="progress__now">
              <span className="spinner" />
              {run.sections.length ? `섹션 ${done}/${run.sections.length} 완료` : `계획 받는 중 (${run.planChars.toLocaleString()}자)`}
              <button className="btn btn--ghost btn--sm" onClick={onCancel}>취소</button>
            </p>
          )}
          {run.sections.length > 0 && (
            <ul className="secs">
              {run.sections.map((s) => (
                <li key={s.id} className={`sec sec--${s.state}`} title={s.error}>
                  <b>{s.id}</b> {s.name} <small>{STATE_LABEL[s.state]}{s.state === 'run' && s.chars ? ` · ${s.chars.toLocaleString()}자` : ''}</small>
                </li>
              ))}
            </ul>
          )}
          {running && !run.sections.length && run.thinking && <pre className="progress__thinking">{run.thinking.slice(-600)}</pre>}
          {run.phase === 'error' && <p className="msg msg--error">{run.error}</p>}
          {run.phase === 'error' && onResume && (
            <div className="actions">
              <button className="btn btn--primary" onClick={onResume}>{resumeLabel}</button>
            </div>
          )}
        </div>
      )}

      {result && !running && (
        <>
          <div className="result-head">
            <ul className="checks">
              {result.checks.map((c, i) => (
                <li key={i} className={`check check--${c.level}`}>{c.message}</li>
              ))}
            </ul>
            <div className="result-head__side">
              {run.usage && (
                <p className="usage">
                  {run.model} · 입력 {run.usage.input.toLocaleString()} / 캐시 {run.usage.cacheRead.toLocaleString()} / 출력 {run.usage.output.toLocaleString()} 토큰 · 약 ${run.usage.costUsd.toFixed(2)}
                </p>
              )}
              <button
                className="btn btn--primary"
                disabled={!result.parsed.html}
                onClick={async () => download(await buildZip(result.meta.productName, result.meta.rev, result.parsed.html, result.images), `${result.meta.productName}.zip`)}
              >
                zip 내려받기 (HTML + img/{result.meta.rev})
              </button>
            </div>
          </div>

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
            <textarea rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="고칠 내용을 적고 섹션을 고르면 그 섹션만 다시 만듭니다. 예) 제목 줄바꿈이 PSD와 달라요 / 스펙 영역을 <table>로 바꿔 줘" />
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
  compare: '왼쪽 PSD 합성 / 오른쪽 생성 HTML (이미지는 아직 업로드 전이라 로컬 파일로 표시)',
  psd: 'PSD 합성 렌더 (원본 이미지)',
  html: '생성 HTML — 마우스로 끌어 글자가 긁히는지 보세요. 긁히지 않는 글자는 이미지로 구운 것입니다.',
};

const countChars = (t: string) => t.replace(/\s/g, '').length;

/** 미리보기 문서에만 선택 색을 넣는다 (포커스가 밖에 있어도 회색이 아닌 파란색으로). 내려받는 HTML 에는 들어가지 않는다 */
function ensureSelStyle(doc: Document) {
  if (doc.getElementById('pf-sel') || !doc.head) return;
  const st = doc.createElement('style');
  st.id = 'pf-sel';
  st.textContent = '::selection{background:rgba(45,95,209,.45)!important;color:inherit}';
  doc.head.appendChild(st);
}

function Preview({ result, loaded }: { result: Result; loaded: Loaded }) {
  const W = loaded.summary.width;
  const [view, setView] = useState<View>('compare');
  const [width, setWidth] = useState<number>(W);
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
      const h = f.contentDocument?.documentElement.scrollHeight;
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
        {showHtml && (
          <div className="seg" aria-label="HTML 폭">
            <button className={width === W ? 'is-on' : ''} onClick={() => setWidth(W)}>PSD 폭 {W}px</button>
            <button className={width === 360 ? 'is-on' : ''} onClick={() => setWidth(360)}>모바일 360px</button>
          </div>
        )}
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
      <div className="preview__cols" style={{ zoom }}>
        {(view === 'psd' || (view === 'compare' && width === W)) && (
          <div className="preview__col">
            <img src={loaded.compositeUrl} width={W} alt="PSD 합성 렌더" />
          </div>
        )}
        {showHtml && (
          <div className="preview__col">
            <iframe ref={frame} title="생성 HTML 미리보기" sandbox="allow-same-origin" srcDoc={result.previewHtml} style={{ width, height }} />
          </div>
        )}
      </div>
    </div>
  );
}

function Code({ html }: { html: string }) {
  const [which, setWhich] = useState<'copy' | 'full'>('copy');
  const [copied, setCopied] = useState(false);
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
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? '복사됨' : '복사'}
        </button>
        <span className="hint">{text.length.toLocaleString()}자 · 이미지 주소는 업로드 후 실제로 열리는지 확인하세요 (9절 6항)</span>
      </div>
      <pre className="pre pre--code">{text}</pre>
    </div>
  );
}
