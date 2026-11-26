// 에디터 테스트 — 고도몰 SmartEditor 2 흉내의 「Editor 탭」을 실제로 고칠 수 있게 (2026-11-25 사용자)
// 도구 막대(글꼴·크기·굵게·기울임·밑줄·취소선·정렬·링크)로 글자를 꾸며 보고, 그 결과가 저장하면 어떻게 바뀌는지 오른쪽 목록·미리보기로 본다.
// 테스트 뷰어라 쇼핑몰에 저장하지 않는다. 고친 내용은 입력 칸(임시 저장)에만 들어간다
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { previewDoc, type EditorProfile } from '../lib/editorSim';
import Select from './Select';
import { Tip } from './ui';
import { Info } from 'lucide-react';

/** Editor 탭 안내 (도구 막대의 ⓘ 에 뜬다) */
const EDITOR_NOTE = 'Editor 탭에서는 글자를 바로 고치고 위 도구로 꾸며 볼 수 있습니다 (테스트라 쇼핑몰에는 저장되지 않음). 고도몰은 <style> 을 지우지 않지만, 여기서 저장하면 www.·http:// 글자가 자동 링크가 됩니다.';

/** SmartEditor 2 기본 글꼴 목록 (고도몰 관리자 상세설명 에디터) */
const FONTS = ['나눔고딕', '돋움', '돋움체', '굴림', '굴림체', '바탕', '바탕체', '궁서', 'Arial', 'Tahoma', 'Times New Roman', 'Verdana', 'Courier New'];
/** SmartEditor 2 기본 글자 크기 (pt) */
const SIZES = [7, 8, 9, 10, 11, 12, 14, 18, 24, 36];

export type SeCmd =
  | { k: 'toggle'; cmd: 'bold' | 'italic' | 'underline' | 'strikeThrough' }
  | { k: 'align'; cmd: 'justifyLeft' | 'justifyCenter' | 'justifyRight' | 'justifyFull' }
  | { k: 'font'; name: string }
  | { k: 'size'; pt: number }
  | { k: 'link'; url: string };

export interface SeApi {
  exec: (c: SeCmd) => void;
}

type Active = Partial<Record<'bold' | 'italic' | 'underline' | 'strikeThrough', boolean>>;

const BLOCK = 'p,div,li,h1,h2,h3,h4,h5,h6,td,th,blockquote';
const ALIGN = { justifyLeft: 'left', justifyCenter: 'center', justifyRight: 'right', justifyFull: 'justify' } as const;

/**
 * 정렬 — 고른 글자가 걸친 문단(가장 안쪽 블록)마다 style="text-align: …" (SmartEditor 2 가 쓰는 모양).
 * execCommand('justify…') 는 이 미리보기 iframe 에서 성공을 돌려주고도 아무것도 바꾸지 않아 직접 칠한다
 */
function alignBlocks(d: Document, box: HTMLElement, cmd: keyof typeof ALIGN) {
  const sel = d.getSelection();
  if (!sel?.rangeCount) return;
  const range = sel.getRangeAt(0);
  const blockOf = (n: Node | null) => (n instanceof d.defaultView!.Element ? n : n?.parentElement)?.closest<HTMLElement>(BLOCK) ?? null;
  const inBox = (e: HTMLElement | null) => !!e && e !== box && box.contains(e);
  const hit = [...box.querySelectorAll<HTMLElement>(BLOCK)].filter((e) => range.intersectsNode(e));
  // 가장 안쪽 블록만 (감싸개 div 까지 칠하면 다른 문단도 같이 정렬된다)
  let targets = hit.filter((e) => !hit.some((o) => o !== e && e.contains(o)));
  if (!targets.length) {
    const one = blockOf(range.startContainer);
    targets = inBox(one) ? [one!] : [];
  }
  // 문단 없이 글자만 있으면 그 줄을 <p> 로 감싸 정렬
  if (!targets.length) {
    const p = d.createElement('p');
    p.append(...box.childNodes);
    box.append(p);
    targets = [p];
  }
  for (const t of targets) t.style.textAlign = ALIGN[cmd];
}

/**
 * 고칠 수 있는 칸에서만 쓰는 CSS (2026-11-25) — 결과 HTML 은 그대로 두고 편집 화면에서만 덮어쓴다.
 *  - 글자 선택: 고도몰 결과는 규칙 7-6 으로 상세 영역 안 선택을 막는다(selectable.ts, ID 두 개 수준 !important) → 끌어서 여러 글자를 고를 수 있게 다시 허용.
 *    :not(#…) 세 번 = ID 세 개 수준이라 그 규칙을 이긴다. 선택 색도 막아 두었으므로(투명) 보이게
 *  - 커서: 클리핑 글자는 color·-webkit-text-fill-color 가 transparent 라(codegen 클리핑 글자) 커서도 투명 → 커서 색을 따로
 *  - 맞춤법 물결(spellcheck)은 칸에서 끈다 — 영문 제품명마다 빨간 밑줄이 그어져 디자인을 가린다
 *  (바깥 체크무늬 배경은 previewDoc 이 칠한다 — 에디터 테스트 미리보기와 같음)
 */
const EDIT_SCOPE = '[data-pf-edit]:not(#pf-e1):not(#pf-e2):not(#pf-e3)';
const EDIT_CSS = `<style>${EDIT_SCOPE},${EDIT_SCOPE} *{-webkit-user-select:text!important;-moz-user-select:text!important;user-select:text!important;caret-color:#3e63dd!important}${EDIT_SCOPE}::selection,${EDIT_SCOPE} *::selection{background:rgba(62,99,221,.35)!important}</style>`;

/**
 * Editor 탭의 디자인 화면 — 고칠 수 있는 칸 (contenteditable). 고치면 onEdit 로 HTML 을 알린다.
 * 바깥에서 html 이 바뀌면(HTML 탭에서 고침 등) 다시 그리고, 여기서 고쳐 돌아온 html 이면 다시 그리지 않는다 (커서가 튀지 않게)
 */
export const SeEditorView = forwardRef<SeApi, { html: string; p: EditorProfile; onEdit: (html: string) => void; onActive: (a: Active) => void; warn?: React.ReactNode }>(function SeEditorView(
  { html, p, onEdit, onActive, warn },
  ref,
) {
  const frame = useRef<HTMLIFrameElement>(null);
  const emitted = useRef<string | null>(null);
  const [seed, setSeed] = useState(html);
  useEffect(() => {
    if (html !== emitted.current) setSeed(html);
  }, [html]);
  const doc = useMemo(() => {
    const t = document.createElement('template');
    t.innerHTML = seed;
    t.content.querySelectorAll('script').forEach((e) => e.remove());
    // 쇼핑몰 감싸개 안에 고칠 칸 하나 — 이 칸의 내용만 HTML 로 돌려준다 (EDIT_CSS 는 칸 밖이라 결과 HTML 에 들어가지 않음)
    return previewDoc(`${EDIT_CSS}<div data-pf-edit contenteditable="true" spellcheck="false" style="outline:none;min-height:4rem">${t.innerHTML}</div>`, p, { mobile: false, marks: false });
  }, [seed, p]);

  const box = () => frame.current?.contentDocument?.querySelector<HTMLElement>('[data-pf-edit]') ?? null;
  const timer = useRef(0);
  const emit = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const b = box();
      if (!b) return;
      emitted.current = b.innerHTML;
      onEdit(b.innerHTML);
    }, 250);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // 고칠 때마다 알리고, 커서 위치의 굵게·기울임 등을 도구 막대에 표시
  const onLoad = () => {
    const d = frame.current?.contentDocument;
    const b = box();
    if (!d || !b) return;
    b.addEventListener('input', emit);
    d.addEventListener('selectionchange', () => {
      const a: Active = {};
      for (const c of ['bold', 'italic', 'underline', 'strikeThrough'] as const) {
        try {
          a[c] = d.queryCommandState(c);
        } catch {
          /* 지원 안 함 */
        }
      }
      onActive(a);
    });
  };

  useImperativeHandle(ref, () => ({
    exec: (c) => {
      const d = frame.current?.contentDocument;
      const w = frame.current?.contentWindow;
      const b = box();
      if (!d || !w || !b) return;
      w.focus();
      // 선택이 고칠 칸 밖이면 칸 끝에 커서를 둔다 (도구를 먼저 누른 경우)
      const sel = d.getSelection();
      if (!sel || !sel.rangeCount || !b.contains(sel.anchorNode)) {
        const r = d.createRange();
        r.selectNodeContents(b);
        r.collapse(false);
        sel?.removeAllRanges();
        sel?.addRange(r);
      }
      // SmartEditor 2 처럼 글꼴·크기는 <span style="…"> 로 (예전 <font> 태그 대신)
      d.execCommand('styleWithCSS', false, 'true');
      if (c.k === 'toggle') d.execCommand(c.cmd);
      else if (c.k === 'align') alignBlocks(d, b, c.cmd);
      else if (c.k === 'font') d.execCommand('fontName', false, c.name);
      else if (c.k === 'link') d.execCommand('createLink', false, c.url);
      else if (c.k === 'size') {
        // execCommand 의 크기는 1~7 단계뿐 → 7 로 칠한 뒤 그 자리를 pt 값으로 바꾼다
        d.execCommand('fontSize', false, '7');
        b.querySelectorAll<HTMLElement>('[style*="xxx-large"], [style*="-webkit-xxx-large"]').forEach((e) => (e.style.fontSize = `${c.pt}pt`));
        b.querySelectorAll('font[size="7"]').forEach((f) => {
          const s = d.createElement('span');
          s.style.fontSize = `${c.pt}pt`;
          s.append(...f.childNodes);
          f.replaceWith(s);
        });
      }
      emit();
    },
  }));

  return (
    <div className="edsim__design">
      {/* 호출자가 준 경고(저장 전 주의 등)만 띠로 보인다. 기본 안내(Editor 탭 설명)는 도구 막대의 ⓘ 에 있다 */}
      {warn && <p className="edsim__warn">{warn}</p>}
      <iframe ref={frame} title="에디터 디자인 모드" sandbox="allow-same-origin" srcDoc={doc} onLoad={onLoad} />
    </div>
  );
});

/** SmartEditor 2 도구 막대 — Editor 탭에서만 누를 수 있다 (HTML·TEXT 탭에서는 회색, 설명 툴팁) */
/**
 * common = 오픈마켓용 공통 도구만 (굵게·기울임·밑줄·취소선·정렬·링크). 글꼴·크기는 플랫폼 에디터마다 달라 뺀다.
 * 실제 플랫폼 에디터와 결과가 다를 수 있으므로 화면에 그 안내를 같이 둔다.
 */
export function SeToolbar({ api, enabled, active, onGoEditor, common = false }: { api: React.RefObject<SeApi | null>; enabled: boolean; active: Active; onGoEditor?: () => void; common?: boolean }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState('https://');
  const off = enabled ? undefined : 'Editor 탭에서 쓸 수 있습니다';
  const run = (c: SeCmd) => api.current?.exec(c);
  // 단추를 눌러도 에디터의 글자 선택이 풀리지 않게 (마우스 누름의 기본 동작 = 초점 옮기기 막음)
  const keep = (e: React.MouseEvent) => e.preventDefault();
  const btn = (label: React.ReactNode, title: string, c: SeCmd, on?: boolean) => (
    <Tip content={off ?? title}>
      <button type="button" className={`edsim__tool${on ? ' is-on' : ''}`} disabled={!enabled} aria-pressed={on} aria-label={title} onMouseDown={keep} onClick={() => run(c)}>
        {label}
      </button>
    </Tip>
  );
  return (
    <div className="edsim__tools" role="toolbar" aria-label="SmartEditor 도구">
      {!common && (
        <>
          <Select<string>
            size="sm"
            className="edsim__pick"
            aria-label="글꼴"
            disabled={!enabled}
            value=""
            onChange={(v) => v && run({ k: 'font', name: v })}
            options={[{ value: '', label: '글꼴' }, ...FONTS.map((f) => ({ value: f, label: <span style={{ fontFamily: f }}>{f}</span>, text: f }))]}
          />
          <Select<string>
            size="sm"
            className="edsim__pick"
            aria-label="글자 크기"
            disabled={!enabled}
            value=""
            onChange={(v) => v && run({ k: 'size', pt: Number(v) })}
            options={[{ value: '', label: '크기' }, ...SIZES.map((s) => ({ value: String(s), label: `${s}pt` }))]}
          />
          <i />
        </>
      )}
      {btn(<b>B</b>, '굵게', { k: 'toggle', cmd: 'bold' }, active.bold)}
      {btn(<em>I</em>, '기울임', { k: 'toggle', cmd: 'italic' }, active.italic)}
      {btn(<u>U</u>, '밑줄', { k: 'toggle', cmd: 'underline' }, active.underline)}
      {btn(<s>S</s>, '취소선', { k: 'toggle', cmd: 'strikeThrough' }, active.strikeThrough)}
      <i />
      {btn('왼쪽', '왼쪽 정렬', { k: 'align', cmd: 'justifyLeft' })}
      {btn('가운데', '가운데 정렬', { k: 'align', cmd: 'justifyCenter' })}
      {btn('오른쪽', '오른쪽 정렬', { k: 'align', cmd: 'justifyRight' })}
      <i />
      <Tip content={off ?? '고른 글자에 링크 걸기'}>
        <button type="button" className={`edsim__tool${linkOpen ? ' is-on' : ''}`} disabled={!enabled} aria-expanded={linkOpen} onMouseDown={keep} onClick={() => setLinkOpen((o) => !o)}>
          링크
        </button>
      </Tip>
      <Tip content="테스트 뷰어에서는 지원하지 않습니다 — 그림·표는 HTML 탭에서 넣어 주세요">
        <span className="edsim__tool is-na" tabIndex={0}>
          사진
        </span>
      </Tip>
      {/* Editor 탭 안내 (예전엔 편집 화면 위 띠) — 마우스를 올리거나 눌러 본다 */}
      <Tip content={EDITOR_NOTE}>
        <span className="edsim__tool is-info" tabIndex={0} aria-label="Editor 탭 안내">
          <Info className="btn__ico" aria-hidden="true" />
        </span>
      </Tip>
      <Tip content="테스트 뷰어에서는 지원하지 않습니다 — 그림·표는 HTML 탭에서 넣어 주세요">
        <span className="edsim__tool is-na" tabIndex={0}>
          표
        </span>
      </Tip>
      {/* HTML·TEXT 탭: 막힌 단추는 툴팁이 안 떠서 이유가 안 보인다 → 막대 안에 바로 안내 + Editor 탭으로 가는 단추 (2026-11-25 사용자: 왜 선택이 안 되는지) */}
      {!enabled && (
        <span className="edsim__off">
          꾸미기 도구는 Editor 탭에서 쓸 수 있습니다
          {onGoEditor && (
            <button type="button" className="link-btn" onClick={onGoEditor}>
              Editor 탭으로
            </button>
          )}
        </span>
      )}
      {enabled && linkOpen && (
        <span className="edsim__link">
          <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="링크 주소" onMouseDown={(e) => e.stopPropagation()} />
          <button
            type="button"
            className="edsim__tool"
            onMouseDown={keep}
            onClick={() => {
              if (/^https?:\/\/\S+\.\S+/.test(url)) run({ k: 'link', url });
              setLinkOpen(false);
            }}
          >
            적용
          </button>
        </span>
      )}
    </div>
  );
}

/**
 * 손보기 상자 — 에디터 테스트와 같은 편집기(도구 막대 + Editor·HTML 탭)를 다른 화면에서 쓸 때 (결과 화면 「손보기」 탭, 2026-11-25 사용자).
 * html 은 원래 서버 주소 그대로 받고 돌려준다. localize = [서버 주소, 미리보기 주소] — 아직 안 올린 그림도 편집 화면에 보이게
 */
/** resetKey 가 바뀌면 편집 화면을 새로 그린다 — 「고친 것 버리기」처럼 같은 html 로 되돌릴 때 (같은 값이면 다시 그리지 않아 고친 모양이 남는다) */
export function SeEditBox({ html, onChange, p, images = [], title, note, warn, resetKey, common = false }: { html: string; onChange: (html: string) => void; p: EditorProfile; images?: [string, string][]; title: string; note?: React.ReactNode; warn?: React.ReactNode; resetKey?: number; /** 오픈마켓: 공통 도구만 */ common?: boolean }) {
  const [tab, setTab] = useState<'editor' | 'html'>('editor');
  const api = useRef<SeApi>(null);
  // 편집 칸 높이 — 아래 손잡이로 조절 (에디터 테스트와 같음)
  const bodyRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<Active>({});
  const localize = (h: string) => images.reduce((acc, [from, to]) => acc.split(from).join(to), h);
  const unlocalize = (h: string) => images.reduce((acc, [from, to]) => acc.split(to).join(from), h);
  return (
    <div className="edsim">
      <div className="edsim__bar">
        <b>{title}</b>
        {note && <span>{note}</span>}
      </div>
      <SeToolbar api={api} enabled={tab === 'editor'} active={active} common={common} onGoEditor={() => setTab('editor')} />
      <div className="edsim__body" ref={bodyRef}>
        {tab === 'editor' ? (
          <SeEditorView key={resetKey} ref={api} html={localize(html)} p={p} onEdit={(h) => onChange(unlocalize(h))} onActive={setActive} warn={warn} />
        ) : (
          <textarea className="edsim__src" value={html} spellCheck={false} onChange={(e) => onChange(e.target.value)} aria-label="HTML 고치기" />
        )}
      </div>
      <div className="edsim__modes" role="tablist" aria-label="편집 모드">
        {(
          [
            ['editor', 'Editor'],
            ['html', 'HTML'],
          ] as const
        ).map(([v, label]) => (
          <button key={v} type="button" role="tab" aria-selected={tab === v} className={tab === v ? 'is-on' : ''} onClick={() => setTab(v)}>
            {label}
          </button>
        ))}
      </div>
      <EdsimGrip target={bodyRef} />
    </div>
  );
}

/** 편집 칸 아래 가장자리 손잡이 — 마우스·터치로 끌거나 화살표 키로 높이를 바꾼다 (최소 16rem = 256px) */
export function EdsimGrip({ target }: { target: React.RefObject<HTMLDivElement | null> }) {
  const MIN = 416; // 26rem — CSS 최소 높이와 같게 (너무 작아져 스크롤 영역이 사라지지 않게)
  const setH = (px: number) => {
    const el = target.current;
    if (el) el.style.height = `${Math.max(MIN, Math.round(px))}px`;
  };
  return (
    <Tip content="끌어서 높이 조절 (위·아래 화살표 키도 됩니다)" side="top">
    <div
      className="edsim__grip"
      role="separator"
      aria-orientation="horizontal"
      aria-label="편집 칸 높이 조절"
      tabIndex={0}
      onPointerDown={(e) => {
        const el = target.current;
        if (!el) return;
        e.preventDefault();
        const startY = e.clientY;
        const startH = el.getBoundingClientRect().height;
        const move = (ev: PointerEvent) => setH(startH + ev.clientY - startY);
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const h = target.current?.getBoundingClientRect().height ?? MIN;
        setH(h + (e.key === 'ArrowDown' ? 32 : -32));
      }}
    >
      <span className="edsim__grip-mark" aria-hidden="true" />
    </div>
    </Tip>
  );
}
