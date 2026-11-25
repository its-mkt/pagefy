// 에디터 테스트 (주소 #tester) — HTML 을 고도몰·오픈마켓 상세 에디터에 붙여넣고 저장했을 때의 모양을 미리 본다.
// 저장 흉내·플랫폼 기준은 src/lib/editorSim.ts (규칙 7-2-1·7-3·7-4 근거). 실제 에디터가 아니므로 첫 등록은 사람이 확인한다
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from './Button';
import { EDITORS, editorOf, isGif, previewDoc, simulate, type EditorId, type EditorProfile, type Evidence, type SimChange } from '../lib/editorSim';
import { copySection } from '../lib/output';
import { readLocal, writeLocal } from '../lib/util';
import { useCopy } from '../lib/clipboard';
import { useFrameHeight } from '../lib/useFrameHeight';
import { CheckField, Fold, Seg, Tip } from './ui';
import { SeEditorView, SeToolbar, type SeApi } from './SeEditor';
import Select from './Select';
import TesterJobPicker from './TesterJobPicker';
import type { Job } from '../lib/jobs';

/** 지금 결과를 바로 불러올 때 — 업로드 전 이미지는 미리보기에서만 브라우저 안 그림으로 바꿔 보여 준다 */
export interface TesterSource {
  html: string;
  label: string;
  editor: EditorId;
  /** 이미지 주소 → 미리보기용 주소 */
  images: [string, string][];
}

const STORE_KEY = 'pagefy.tester.editor';
const DRAFT_KEY = 'pagefy.tester.draft';

const LEVEL: Record<SimChange['level'], [string, string]> = {
  removed: ['지워짐', 'badge--error'],
  changed: ['바뀜', 'badge--warn'],
  error: ['규칙 위반', 'badge--error'],
  warn: ['주의', 'badge--warn'],
};

const EV_TIP: Record<Evidence, string> = {
  공식: '플랫폼이 낸 도움말·가이드·API 문서',
  시험: 'Pagefy 가 실제 에디터·필터 코드를 받아 직접 돌려 본 결과 (2026-11-25)',
  소스: '에디터·쇼핑몰이 실제로 쓰는 코드·CSS 원문에서 확인 (2026-11-25)',
  '등록 확인': '담당자가 실제로 등록해 본 결과',
  관찰: '실제 상품 페이지 소스·스킨 CSS 에서 확인',
  커뮤니티: '판매자·제작 업체 자료 (공식 아님)',
  추정: '공개 자료가 없어 안전하게 가정한 것 (「지워질 수도 있는 것까지 미리 지워 보기」)',
};

/** 근거 배지 — 바뀌는 것 목록·옵션 설명이 같은 표기를 쓴다 */
function Ev({ ev, tip }: { ev: Evidence; tip?: string }) {
  const tone = ev === '추정' ? 'guess' : ev === '공식' || ev === '시험' || ev === '소스' || ev === '등록 확인' ? 'sure' : 'mid';
  return (
    <Tip content={tip ?? EV_TIP[ev]}>
      <span className={`tester__ev tester__ev--${tone}`} tabIndex={0}>
        {ev}
      </span>
    </Tip>
  );
}

const SAMPLE = `<style>.dp-x .t{color:#2b59ff;font-size:28px}</style>
<div class="dp-x" style="max-width:860px;margin:0 auto;--u:1px">
  <h3 class="t">소제목 (h3)</h3>
  <p style="font-size:calc(18 * var(--u));border-radius:8px;padding:12px;background:#f4f6ff">인라인 calc·변수·둥근 모서리</p>
  <p><a href="https://example.com" target="_blank">외부 링크</a></p>
  <img src="data:image/gif;base64,R0lGODlhAQABAIABAP8AAP///ywAAAAAAQABAAACAkQBADs=" alt="GIF 예시" width="400" height="80" style="width:400px;height:80px">
  <div style="width:1000px;height:40px;background:#ffe3e3">폭 1000px 상자</div>
  <script>alert(1)</script>
</div>`;

/**
 * current = 「지금 결과 불러오기」로 불러올 지금 결과.
 * start = 결과 화면·저장된 결과의 「에디터 미리보기」로 들어옴 → 임시 저장본 대신 이것으로 시작한다.
 * 받으면 onStarted 로 알려 비우게 한다 (메뉴로 다시 들어올 때는 임시 저장본으로)
 */
/**
 * findJobs · onPick = 「변환 내역에서 불러오기」 — 저장된 HTML 이 있는 작업을 검색·더 보기로 골라 불러온다 (2026-11-25 사용자, 20개 넘어도). 테스트 뷰어라 저장하지 않는다
 */
export default function TesterPanel({
  current,
  start,
  onStarted,
  findJobs,
  onPick,
}: {
  current?: TesterSource | null;
  start?: TesterSource | null;
  onStarted?: () => void;
  findJobs?: (q: string, offset: number, limit: number) => Promise<{ jobs: Job[]; more: boolean }>;
  onPick?: (job: Job) => Promise<TesterSource | null>;
}) {
  const [editorId, setEditorId] = useState<EditorId>(() => (start ? start.editor : editorOf(readLocal(STORE_KEY, '')).id));
  const p = editorOf(editorId);
  const godo = p.group === '고도몰';
  // 오픈마켓은 마지막으로 고른 플랫폼을 기억 (고도몰↔오픈마켓 전환 때 되살린다)
  const [marketId, setMarketId] = useState<EditorId>(p.group === '오픈마켓' ? editorId : 'smartstore');
  const [input, setInput] = useState(() => (start ? start.html : (sessionStorage.getItem(DRAFT_KEY) ?? '')));
  const [source, setSource] = useState<TesterSource | null>(start ?? null);
  useEffect(() => {
    if (start) onStarted?.(); // 처음 열 때 한 번만
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [tab, setTab] = useState<'html' | 'editor' | 'text'>('html');
  const [strict, setStrict] = useState(true);
  const [designMode, setDesignMode] = useState(false);
  const [marks, setMarks] = useState(true);
  const [screen, setScreen] = useState<'pc' | 'mobile'>('pc');
  const [copied, copy] = useCopy();
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => writeLocal(STORE_KEY, editorId), [editorId]);
  // 다른 플랫폼으로 바꾸면 에디터 탭·디자인 모드는 처음 상태로
  useEffect(() => {
    setTab('html');
    setDesignMode(false);
  }, [editorId]);

  // 타이핑마다 다시 계산하지 않게 잠깐 기다린다
  const [text, setText] = useState(input);
  useEffect(() => {
    const t = window.setTimeout(() => setText(input), 250);
    return () => window.clearTimeout(t);
  }, [input]);
  // 임시 저장도 입력이 멈춘 뒤에 (글자마다 쓰면 base64 그림이 든 수 MB 글을 매번 동기로 쓴다)
  useEffect(() => {
    // 글이 크면 저장이 막힐 수 있다 — 못 남겨도 화면은 그대로
    try {
      sessionStorage.setItem(DRAFT_KEY, text);
    } catch {
      /* 저장 공간 부족 */
    }
  }, [text]);

  const sim = useMemo(() => (text.trim() ? simulate(text, p, { strict: !godo && strict, designMode: godo && designMode }) : null), [text, p, godo, strict, designMode]);
  // 불러온 결과의 이미지가 아직 서버에 없으면 미리보기에서만 브라우저 안 그림으로
  const localize = (h: string) => (source ? source.images.reduce((acc, [from, to]) => acc.split(from).join(to), h) : h);
  // Editor 탭에서 고친 HTML 은 미리보기용 그림 주소를 원래 서버 주소로 되돌려 입력 칸에 넣는다 (불러온 결과는 그대로 이어서 씀)
  const unlocalize = (h: string) => (source ? source.images.reduce((acc, [from, to]) => acc.split(to).join(from), h) : h);
  const seApi = useRef<SeApi>(null);
  const [seActive, setSeActive] = useState<Record<string, boolean>>({});
  const capture = sim?.mobile.mode === 'capture';
  // 그림 수만큼 전체 HTML 을 나눴다 붙이므로 결과가 바뀔 때만 (입력·마우스 올림으로 다시 그릴 때마다 하지 않게)
  const shown = useMemo(() => (sim ? localize(marks ? sim.annotated : sim.html) : ''), [sim, marks, source]); // eslint-disable-line react-hooks/exhaustive-deps
  const pcDoc = useMemo(() => previewDoc(shown, p, { mobile: false, marks }), [shown, p, marks]);
  const mobileDoc = useMemo(() => (capture ? pcDoc : previewDoc(shown, p, { mobile: true, marks, fixedFont: p.mobileFixedFont && sim?.mobile.mode === 'same' })), [capture, pcDoc, shown, p, marks, sim?.mobile.mode]);

  const loadCurrent = () => {
    if (!current) return;
    setInput(current.html);
    setSource(current);
    setEditorId(current.editor);
  };
  // 변환 내역의 다른 작업 불러오기 — 지금 결과 불러오기와 같게 그 작업의 채널·플랫폼 에디터로 맞춘다
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState('');
  const loadPick = async (job: Job) => {
    if (!onPick) return;
    setPicking(true);
    setPickError('');
    try {
      const src = await onPick(job);
      if (!src) throw new Error('저장된 HTML이 없는 작업입니다.');
      setInput(src.html);
      setSource(src);
      setEditorId(src.editor);
    } catch (e) {
      setPickError(`불러오지 못했습니다: ${(e as Error).message}`);
    } finally {
      setPicking(false);
    }
  };
  const openFile = async (f: File) => {
    const t = await f.text();
    // Pagefy 결과 HTML 파일이면 복사 구간만
    setInput(copySection(t));
    setSource(null);
  };

  const counts = useMemo(() => {
    const c = sim?.changes ?? [];
    return { sure: c.filter((x) => !x.strict).length, strict: c.filter((x) => x.strict).length, bad: c.filter((x) => x.level === 'error' || x.level === 'removed').length };
  }, [sim]);

  return (
    <section className="panel tester" aria-labelledby="tester-title">
      <div className="tester__head">
        <h2 id="tester-title" className="panel__title">
          에디터 테스트
          <small>붙여넣을 HTML 이 쇼핑몰 상세 에디터에 저장되면 어떻게 바뀌는지 미리 봅니다</small>
        </h2>
      </div>

      {/* 플랫폼 고르기 (2026-11-25 개편): 고도몰 · 오픈마켓 세그먼트 → 고도몰은 사이트 체크박스(여러 곳), 오픈마켓은 드롭다운. 높이 2rem 맞춤 */}
      <div className="tester__pickers">
        {/* 변환 내역의 다른 작업 불러오기 — 플랫폼 고르기 왼쪽 (한 줄, 좁으면 두 줄) (고르면 그 작업의 판매처로 플랫폼도 바뀜, 2026-11-25) */}
        {findJobs && onPick && (
          <div className="tester__from">
            <span className="tester__glabel">변환 내역</span>
            <TesterJobPicker search={findJobs} onPick={loadPick} busy={picking} value={source?.label} />
            {pickError && <p className="msg msg--error" role="alert">{pickError}</p>}
          </div>
        )}
        <div className="tester__platforms">
          <span className="tester__glabel">플랫폼</span>
          <Seg
            aria-label="판매처 종류"
            value={godo ? 'godo' : 'openmarket'}
            onChange={(v) => setEditorId(v === 'godo' ? 'godo' : marketId)}
            items={[
              { value: 'godo', label: '고도몰' },
              { value: 'openmarket', label: '오픈마켓' },
            ]}
          />
          {!godo && (
            <Select
              size="sm"
              aria-label="오픈마켓 플랫폼"
              value={editorId}
              onChange={(id) => {
                setMarketId(id);
                setEditorId(id);
              }}
              options={EDITORS.filter((e) => e.group === '오픈마켓').map((e) => ({ value: e.id, label: e.label }))}
            />
          )}
        </div>
      </div>

      <Spec p={p} />

      <div className="tester__grid">
        {/* ── 에디터 ── */}
        <div className="tester__col">
          <div className="edsim">
            <div className="edsim__bar">
              <b>상세설명</b>
              <span>{p.editor}</span>
            </div>
            {/* 고도몰: SmartEditor 2 도구 막대 — Editor 탭에서 실제로 꾸며 볼 수 있다 (저장 없음, SeEditor.tsx). 오픈마켓은 HTML 직접 입력만 */}
            {godo ? (
              <SeToolbar
                api={seApi}
                enabled={tab === 'editor'}
                active={seActive}
                onGoEditor={() => {
                  setTab('editor');
                  if (input.trim()) setDesignMode(true); // 아래 Editor 탭 단추와 같게 (저장 때 URL 자동 링크 표시)
                }}
              />
            ) : (
              <div className="edsim__tools" aria-hidden="true">
                <span>HTML 직접 입력 — 에디터 꾸미기 기능과 섞어 쓰지 않음</span>
              </div>
            )}
            <div className="edsim__body">
              {tab === 'html' && (
                <textarea
                  className="edsim__src"
                  value={input}
                  spellCheck={false}
                  placeholder="여기에 상세 HTML 을 붙여넣으세요 (Pagefy 결과의 「HTML 복사」 내용, 또는 결과 HTML 파일 열기)"
                  onChange={(e) => {
                    setInput(e.target.value);
                    setSource(null);
                  }}
                  aria-label="붙여넣을 HTML"
                />
              )}
              {tab === 'editor' && <SeEditorView ref={seApi} html={localize(input)} p={p} onEdit={(h) => setInput(unlocalize(h))} onActive={setSeActive} />}
              {tab === 'text' && <pre className="edsim__text">{textOnly(input) || '(글자 없음)'}</pre>}
            </div>
            {godo && (
              <div className="edsim__modes" role="tablist" aria-label="에디터 모드">
                {(
                  [
                    ['editor', 'Editor'],
                    ['html', 'HTML'],
                    ['text', 'TEXT'],
                  ] as const
                ).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    role="tab"
                    aria-selected={tab === v}
                    className={tab === v ? 'is-on' : ''}
                    onClick={() => {
                      setTab(v);
                      // 고도몰 SmartEditor 2: Editor 탭에서 저장하면 URL 글자가 자동 링크가 된다 [소스] — 실제처럼 표시
                      if (v === 'editor' && input.trim()) setDesignMode(true);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 넣기(왼쪽: 주 행동 옅은 파랑 · 나머지 회색 면) | 글자 수 · 비우기(오른쪽 끝) */}
          <div className="tester__actions">
            {current && (
              <Tip content={`지금 결과(${current.label})의 복사 구간을 넣고 그 채널로 맞춥니다`}>
                <Button type="button" size="sm" variant="soft" onClick={loadCurrent}>
                  지금 결과 불러오기
                </Button>
              </Tip>
            )}
            <Button type="button" size="sm" onClick={() => fileRef.current?.click()}>
              HTML 파일 열기
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".html,.htm,text/html"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) openFile(f);
              }}
            />
            <Button type="button" size="sm" onClick={() => (setInput(SAMPLE), setSource(null))}>
              예시 넣기
            </Button>
            <span className="tester__len">{input.length.toLocaleString()}자</span>
            {input && (
              <Button type="button" size="sm" onClick={() => (setInput(''), setSource(null))}>
                비우기
              </Button>
            )}
          </div>

          <div className="tester__opts">
            {godo ? (
              <CheckField checked={designMode} onChange={setDesignMode}>
                Editor 탭에서 저장했다면
                <span className="hint"> — www.·http:// 글자가 자동으로 링크가 됩니다 (고도몰은 &lt;style&gt; 을 지우지 않음)</span>
                <Ev ev="시험" />
              </CheckField>
            ) : (
              <CheckField checked={strict} onChange={setStrict}>
                지워질 수도 있는 것까지 미리 지워 보기
                <span className="hint"> — &lt;style&gt;·class·calc() 등, 공개된 근거는 없지만 지워질 가능성이 있는 것</span>
                <Ev ev="추정" tip="오픈마켓 에디터가 지우거나 무시하는 경우가 많아 기대지 않는 것 — 공개 목록이 없어 안전하게 가정 (규칙 7-3)" />
              </CheckField>
            )}
            <CheckField checked={marks} onChange={setMarks}>
              미리보기에서 바뀐 곳을 빨간 점선으로 표시
            </CheckField>
          </div>
        </div>

        {/* ── 저장하면 바뀌는 것 (에디터 옆) ── */}
        <div className="tester__col">
          <div className="tester__report" aria-live="polite">
            <h3>저장하면 바뀌는 것</h3>
            {!sim && <p className="hint">HTML 을 붙여넣으면 여기에 나옵니다.</p>}
            {sim && !sim.changes.length && <p className="tester__clean">이 플랫폼 기준으로 지워지거나 문제 되는 곳이 없습니다. 첫 등록 때는 실제 상품 화면도 확인하세요.</p>}
            {sim && !!sim.changes.length && (
              <>
                <p className="hint">
                  {counts.sure}건{counts.strict ? ` + 가능성 ${counts.strict}건` : ''} · 근거 표시: 공식 &gt; 시험 &gt; 소스 &gt; 등록 확인 &gt; 관찰 &gt; 커뮤니티 &gt; 추정
                </p>
                <ul className="tester__changes">
                  {sim.changes.map((c, i) => (
                    <li key={i} className={c.strict ? 'is-strict' : ''}>
                      <span className={`badge ${LEVEL[c.level][1]}`}>{LEVEL[c.level][0]}</span>
                      <div>
                        <b>{c.what}</b> <span className="tester__n">{c.count}곳</span>
                        <Ev ev={c.ev} />
                        <Fold summary="해당 코드 보기" className="tester__samples">
                          {c.samples.map((s, j) => (
                            <code key={j}>{s}</code>
                          ))}
                        </Fold>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── 상품 페이지 미리보기 — 플랫폼 PC 폭(최대 980px)이 잘리지 않게 전체 폭 ── */}
      <div className="tester__preview">
        <div className="tester__phead">
          <h3>상품 페이지에서 (저장 후)</h3>
          <Seg
            aria-label="화면"
            value={screen}
            onChange={setScreen}
            items={[
              { value: 'pc', label: `PC ${p.pcWidth}px` },
              { value: 'mobile', label: capture ? '모바일 (PC 캡처 축소)' : sim?.mobile.mode === 'none' ? '모바일 (미리보기 없음)' : `모바일 360px` },
            ]}
          />
        </div>
        {/* 불러온 결과의 판매처 묶음과 고른 에디터가 다르면 알린다 — 고도몰 결과(<style>·글꼴 블록)를 오픈마켓 에디터로 보면 CSS 가 글자로 쏟아지는 게 정상 흉내라 헷갈린다 */}
        {source && editorOf(source.editor).group !== p.group && (
          <p className="tester__mismatch" role="note">
            불러온 결과는 <b>{editorOf(source.editor).group}</b>용인데 <b>{p.group}</b> 에디터({p.label})로 보고 있습니다. {p.group}에 올리려면 변환 내역의 「⋯ → 다른 판매처용으로 복제」로 {p.group}용 결과를 만들어 불러오세요.
          </p>
        )}
        {sim ? (
          screen === 'pc' ? (
            <Frame key={`pc-${p.id}`} doc={pcDoc} width={p.pcWidth} p={p} mobile={false} />
          ) : (
            <Frame key={`m-${p.id}-${capture}`} doc={mobileDoc} width={capture ? p.pcWidth : 360} scaleTo={capture ? 360 : undefined} p={p} mobile freezeGif={capture} />
          )
        ) : (
          <div className="tester__empty">HTML 을 붙여넣으면 이 플랫폼 상세 영역 폭으로 보여 줍니다.</div>
        )}
        {screen === 'mobile' && sim && (
          <p className="hint">
            {sim.mobile.why || `휴대폰 360px 에서 상세 영역 ${p.mobileWidth}px [${p.mobileWidthEv}]${p.skinMobileCss ? ' · 쇼핑몰 모바일 CSS 적용' : ''}`}
            {p.mobileTransformNote && <> · {p.mobileTransformNote}</>}
          </p>
        )}
        {sim && (
          <Fold summary="저장 후 HTML (상품 페이지에 남는 코드)" className="tester__out">
            <div className="tester__outbar">
              <Button type="button" size="sm" onClick={() => copy('out', sim.html)}>
                {copied === 'out' ? '복사됨' : copied === 'fail:out' ? '복사 실패' : '복사'}
              </Button>
              <span className="hint">
                {text.length.toLocaleString()}자 → {sim.html.length.toLocaleString()}자
              </span>
            </div>
            <pre>{sim.html}</pre>
          </Fold>
        )}
      </div>
      <p className="hint tester__foot">
        규칙 원본 7-2-1·7-3·7-4 표와 플랫폼 공식 문서(2026-11-25 대조)를 근거로 흉내 낸 것입니다 — 실제 에디터 코드가 아니므로, 처음 쓰는 플랫폼은 실제로 등록해 확인하고 결과를 규칙 표에 [등록 확인]으로 남겨 주세요.
      </p>
    </section>
  );
}

/** 폭·근거·주의 사항 한 줄 */
function Spec({ p }: { p: EditorProfile }) {
  return (
    <div className="tester__spec">
      <span>
        상세 폭 <b>{p.pcWidth}px</b> <em>[{p.pcWidthEv}]</em>
        {p.pcWidthNote && <small> {p.pcWidthNote}</small>}
      </span>
      <span>
        휴대폰 <b>{p.mobile === 'capture' ? 'PC 화면을 이미지로' : p.mobile === 'smartstore' ? '내용에 따라 원본 / PC 캡처 / 미리보기 없음' : `상세 영역 ${p.mobileWidth}px`}</b> <em>[{p.mobile === 'capture' ? '공식·오래됨' : p.mobile === 'smartstore' ? '공식' : p.mobileWidthEv}]</em>
      </span>
      <ul>
        {p.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  );
}

interface Measure {
  overflow: number;
  broken: string[];
  tall: string[];
  wide: string[];
  /** 상세 영역 높이 px */
  height: number;
}

/** 상품 페이지 미리보기 + 화면에서 잰 문제 (가로 넘침 · 안 뜬 이미지 · 너무 긴 이미지) */
/**
 * 상세 영역(.pf-shell) 안에서 실제로 그려지는 것의 가로 범위 — 그림·캔버스·영상, 바탕색·바탕 그림이 있는 상자, 글자.
 * 바탕 없는 감싸개(폭 100% div 등)는 넓어도 빈칸이라 빼고 잰다. 아무것도 없으면 null (자르지 않음)
 */
function paintedSpan(d: Document, shell: HTMLElement): { x: number; w: number } | null {
  const box = shell.getBoundingClientRect();
  let l = Infinity;
  let r = -Infinity;
  const add = (rc: DOMRect) => {
    if (rc.width < 1 || rc.height < 1) return;
    l = Math.min(l, rc.left);
    r = Math.max(r, rc.right);
  };
  const win = d.defaultView;
  for (const e of shell.querySelectorAll<HTMLElement>('*')) {
    if (/^(IMG|CANVAS|VIDEO|SVG|IFRAME|TABLE|HR|INPUT|BUTTON)$/i.test(e.tagName)) {
      add(e.getBoundingClientRect());
      continue;
    }
    const cs = win?.getComputedStyle(e);
    if (!cs) continue;
    const bg = cs.backgroundColor;
    // 투명 바탕(rgba(…, 0))은 빈칸 — 「흰색」 바탕을 칠한 칸은 상세페이지의 일부라 남긴다
    const clear = !bg || bg === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(bg);
    const painted = !clear || cs.backgroundImage !== 'none' || parseFloat(cs.borderLeftWidth) > 0 || parseFloat(cs.borderRightWidth) > 0;
    if (painted) add(e.getBoundingClientRect());
  }
  // 글자 (바탕 없는 칸 위의 글자도 보이는 것)
  const walk = d.createTreeWalker(shell, NodeFilter.SHOW_TEXT);
  const range = d.createRange();
  for (let n = walk.nextNode(), i = 0; n && i < 4000; n = walk.nextNode(), i++) {
    if (!n.textContent?.trim()) continue;
    range.selectNodeContents(n);
    add(range.getBoundingClientRect());
  }
  if (!Number.isFinite(l) || r <= l) return null;
  const x = Math.max(0, Math.floor(l - box.left));
  return { x, w: Math.ceil(r - box.left) - x };
}

function Frame({ doc, width, scaleTo, p, mobile, freezeGif }: { doc: string; width: number; scaleTo?: number; p: EditorProfile; mobile: boolean; freezeGif?: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const height = useFrameHeight(ref, 400, [doc, width]);
  const [m, setM] = useState<Measure | null>(null);
  // PC 미리보기에서 상세페이지 양옆의 빈 쇼핑몰 바탕(흰 여백)을 잘라 보이지 않게 — 배치는 그대로 상세 영역 폭으로 하고 보이는 칸만 줄인다 (2026-11-25 사용자: 보기 쉽게)
  const [crop, setCrop] = useState<{ x: number; w: number } | null>(null);
  const esm = p.id === 'gmarket' || p.id === 'auction';

  useEffect(() => {
    const f = ref.current;
    if (!f) return;
    setM(null);
    setCrop(null);
    const run = () => {
      const d = f.contentDocument;
      if (!d?.body) return;
      // 쿠팡: 움직이는 GIF 는 jpg 로 바뀐다 → 지금 장면을 캔버스에 그려 멈춘다 (다른 주소 그림이라도 화면에 그리기는 된다)
      // 캡처 미리보기(스마트스토어 모바일 등)도 그림이라 GIF 가 멈춘다
      [...d.querySelectorAll<HTMLImageElement>(freezeGif ? 'img' : 'img[data-pf-gif]')].filter((img) => !freezeGif || isGif(img.getAttribute('src') ?? '')).forEach((img) => {
        if (!img.complete || !img.naturalWidth) return;
        const c = d.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext('2d')?.drawImage(img, 0, 0);
        c.setAttribute('style', img.getAttribute('style') ?? '');
        c.style.width ||= `${img.getBoundingClientRect().width}px`;
        c.style.height = 'auto';
        c.setAttribute('data-pf-sim', img.getAttribute('data-pf-sim') ?? '');
        c.title = 'GIF → 정지 이미지';
        img.replaceWith(c);
      });
      const ims = [...d.images];
      const name = (i: HTMLImageElement) => /^data:/i.test(i.getAttribute('src') ?? '') ? '(base64 이미지)' : decodeURIComponent((i.getAttribute('src') ?? '').split('/').pop() ?? '').slice(0, 60) || '(이름 없음)';
      // 넘침은 휴대폰 화면 폭이 아니라 상세 영역(.pf-shell) 폭 기준 — 고도몰 모바일은 360px 화면 안 323px
      const shell = d.querySelector<HTMLElement>('.pf-shell') ?? d.documentElement;
      const box = shell.getBoundingClientRect();
      const right = Math.max(...[...shell.querySelectorAll('*')].map((e) => e.getBoundingClientRect().right), box.right);
      if (!mobile) setCrop(paintedSpan(d, shell));
      setM({
        overflow: Math.max(0, Math.round(right - box.right)),
        broken: ims.filter((i) => i.complete && !i.naturalWidth && !/^blob:/.test(i.src)).map(name),
        tall: esm ? ims.filter((i) => i.naturalWidth && i.naturalHeight / i.naturalWidth > 3).map((i) => `${name(i)} (${i.naturalWidth}×${i.naturalHeight})`) : [],
        wide: ims.filter((i) => i.naturalWidth && i.getBoundingClientRect().width > box.width + 1).map(name),
        height: Math.round(box.height),
      });
    };
    const timers = [400, 1500, 4000].map((ms) => window.setTimeout(run, ms));
    f.addEventListener('load', run);
    return () => {
      timers.forEach(window.clearTimeout);
      f.removeEventListener('load', run);
    };
  }, [doc, esm, mobile]);

  const scale = scaleTo ? scaleTo / width : 1;
  const cut = !mobile && crop && crop.w < width - 1 ? crop : null;
  const tooTall = !!m && !!p.maxHeight && m.height >= p.maxHeight.px;
  // 접힘: PC 기준 길이로 정한 플랫폼(스마트스토어)은 PC 값, 모바일만 접히는 곳(컴퓨존)은 모바일 화면에서만
  const folded = !!m && !!p.fold && m.height > ((mobile && p.fold.mobileOver) || p.fold.over) && (mobile ? p.fold.mobile != null : p.fold.pc != null);
  return (
    <>
      <div className="tester__stage">
        <div className="tester__device" style={{ width: (cut ? cut.w : width) * scale, height: height * scale }}>
          <iframe
            ref={ref}
            title="상품 페이지 미리보기"
            sandbox="allow-same-origin"
            scrolling="no"
            srcDoc={doc}
            style={{ width, height, marginLeft: cut ? -cut.x : undefined, transform: scale !== 1 ? `scale(${scale})` : undefined, transformOrigin: '0 0' }}
          />
        </div>
      </div>
      {cut && (
        <p className="hint tester__cut">
          쇼핑몰 상세 영역 {width}px 중 상세페이지 바깥의 흰 여백 {Math.round(width - cut.w)}px 는 보기 쉽게 숨겼습니다 (실제 쇼핑몰에서는 양옆이 흰 바탕으로 보입니다).
        </p>
      )}
      {m && (m.overflow > 0 || m.broken.length > 0 || m.tall.length > 0 || m.wide.length > 0 || tooTall || folded) && (
        <ul className="tester__measure">
          {m.overflow > 0 && <li><span className="badge badge--error">가로 넘침</span> 상세 영역보다 {m.overflow}px 넓어 가로 스크롤이 생기거나 잘립니다 — 고정 폭(width:…px)이 상세 폭보다 큰 곳을 줄이세요.</li>}
          {m.wide.length > 0 && <li><span className="badge badge--warn">넓은 이미지</span> 상세 영역보다 넓게 보이는 이미지 {m.wide.length}개: {m.wide.slice(0, 3).join(', ')}</li>}
          {m.broken.length > 0 && <li><span className="badge badge--warn">안 뜬 이미지</span> {m.broken.length}개: {m.broken.slice(0, 3).join(', ')} — 아직 이미지 서버에 올리지 않았거나 주소가 틀렸습니다.</li>}
          {m.tall.length > 0 && <li><span className="badge badge--warn">긴 이미지</span> 세로가 가로의 3배를 넘는 이미지 {m.tall.length}개: {m.tall.slice(0, 3).join(', ')} — ESM 「이미지 업로드」 규칙(1:3 이상 등록 불가) [공식]. HTML 안 외부 이미지에도 적용되는지는 공식 문장이 없습니다.</li>}
          {tooTall && <li><span className="badge badge--error">너무 김</span> 상세 높이 {m.height.toLocaleString()}px — 세로 {p.maxHeight!.px.toLocaleString()}px 이상은 등록 불가 [{p.maxHeight!.ev}]</li>}
          {folded && <li><span className="badge badge--warn">접힘</span> 상세 높이 {m.height.toLocaleString()}px — {((mobile && p.fold!.mobileOver) || p.fold!.over).toLocaleString()}px 를 넘어 처음에는 {mobile ? `${(p.fold!.mobile ?? p.fold!.pc)!.toLocaleString()}px` : `${(p.fold!.pc ?? p.fold!.mobile)!.toLocaleString()}px`}까지만 보이고 「펼쳐보기」를 눌러야 나머지가 보입니다 [{p.fold!.ev}] — 첫 화면 안에 핵심을 두세요.</li>}
        </ul>
      )}
    </>
  );
}

/** TEXT 탭 — 태그를 뺀 글자만 */
function textOnly(html: string) {
  const t = document.createElement('template');
  t.innerHTML = html;
  t.content.querySelectorAll('style,script').forEach((e) => e.remove());
  return (t.content.textContent ?? '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}
