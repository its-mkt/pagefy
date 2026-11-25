// 에디터 테스트 (주소 #tester) — 붙여넣을 HTML 이 쇼핑몰 상세 에디터에 저장되면 어떻게 바뀌는지 흉내 낸다.
// 근거는 규칙 원본 7-2-1·7-3·7-4 표와 2026-11-25 조사(공식 문서·에디터/사이트 코드·실물·커뮤니티). 각 처리에 근거 수준을 붙여, 확인된 것과 안전 기준(추정)을 구분해 보여 준다.
// 표를 고치면 여기도 맞춘다 (폭은 shared/markets.ts · shared/width.ts 를 그대로 쓴다). 실제 에디터 코드가 아니므로 첫 등록은 사람이 확인한다 (규칙 9절).
import { MARKETS, normMarket, type Market } from '../../shared/markets';
import { GODO_MAX_W } from '../../shared/width';
import type { Channel } from '../../shared/types';

export type EditorId = 'godo' | 'smartstore' | 'coupang' | 'st11' | 'gmarket' | 'auction' | 'lotteon' | 'himart' | 'compuzone';

/**
 * 오픈마켓 플랫폼 → 흉내 낼 에디터. 마켓을 shared/markets.ts 에 추가하면 여기서 타입 오류가 나서 빠뜨리지 않는다
 * (기타 오픈마켓은 정해진 에디터가 없어 가장 엄격한 스마트스토어로 본다)
 */
const MARKET_EDITOR: Record<Market, EditorId> = {
  smartstore: 'smartstore',
  coupang: 'coupang',
  st11: 'st11',
  gmarket: 'gmarket',
  lotteon: 'lotteon',
  himart: 'himart',
  compuzone: 'compuzone',
  other: 'smartstore',
};
/** 판매처 → 흉내 낼 에디터 (고도몰은 채널과 상관없이 같은 SE2 에디터) */
export const editorFor = (p: { channel: Channel; market?: Market }): EditorId => (p.channel === 'openmarket' ? MARKET_EDITOR[normMarket(p.market)] : 'godo');

/** 근거 수준 — 규칙 7-4 표의 표시와 같다. 시험 = Pagefy 가 실제 에디터·필터 코드를 받아 직접 돌려 본 결과 (2026-11-25). 소스 = 에디터·사이트가 실제로 쓰는 코드·CSS 원문 (2026-11-25 조사). 추정 = 공개 자료가 없어 Pagefy 가 안전하게 가정한 것 */
export type Evidence = '공식' | '시험' | '소스' | '등록 확인' | '관찰' | '커뮤니티' | '추정';

export interface EditorOptions {
  /** 공개 근거가 없는 것도 지워진다고 보기 (오픈마켓 — 규칙 7-3 「기대지 않는다」 목록) */
  strict: boolean;
  /** 고도몰: HTML 모드에서 Editor(디자인) 모드로 바꾼 뒤 저장 (스마트에디터2 — <style> 이 빠질 수 있음) */
  designMode: boolean;
}

type Op =
  /** 태그를 통째로 지운다 (keep 이 참이면 남김) */
  // lucy: 네이버 Lucy XSS 필터 방식 — 태그 자리에 <!-- Not Allowed Tag Filtered --> 주석을 남기고 원래 태그는 글자(&lt;…&gt;)로 바꾼다
  | { kind: 'tag'; tags: string[]; keep?: (el: Element) => boolean; what: string; ev: Evidence; strict?: boolean; design?: boolean; lucy?: boolean }
  /** 속성을 지운다 (lucy: 요소 앞에 <!-- Not Allowed Attribute Filtered ( 이름="값") --> 주석) */
  | { kind: 'attr'; test: (name: string, el: Element) => boolean; what: string; ev: Evidence; strict?: boolean; lucy?: boolean }
  /** 허용 태그 목록 밖은 태그만 벗기고 글자는 남긴다 (drop 은 내용까지 버림) — sanitize-html 기본 동작 */
  | { kind: 'allowlist'; tags: string[]; drop: string[]; what: string; ev: Evidence }
  /** 그 밖의 처리 — run 이 바꾼 곳 목록을 돌려준다 */
  | { kind: 'fn'; run: (root: HTMLElement, doc: Document) => string[]; level: 'removed' | 'changed'; what: string; ev: Evidence; strict?: boolean; design?: boolean }
  /** 허용 주소 밖 링크를 글자만 남기고 지운다 */
  | { kind: 'unlink'; allow: RegExp; deny?: RegExp; what: string; ev: Evidence }
  /** 인라인 style 선언을 지운다 */
  | { kind: 'css'; test: (prop: string, value: string) => boolean; what: string; ev: Evidence; strict?: boolean }
  /** base64(data:) 이미지를 지운다 */
  | { kind: 'base64'; what: string; ev: Evidence }
  /** 움직이는 GIF 가 정지 이미지(jpg)로 바뀐다 — HTML 은 그대로, 미리보기에서 첫 장면으로 멈춘다 */
  | { kind: 'gif'; what: string; ev: Evidence }
  /** 바꾸지 않고 알리기만 */
  | { kind: 'check'; find: (root: HTMLElement) => Element[]; what: string; ev: Evidence; level?: 'warn' | 'error' };

export interface EditorProfile {
  id: EditorId;
  label: string;
  group: '고도몰' | '오픈마켓';
  /** 화면에 보이는 에디터 이름 */
  editor: string;
  /** PC 상세 영역 폭 px */
  pcWidth: number;
  pcWidthEv: Evidence;
  pcWidthNote?: string;
  /** 360px 휴대폰에서 상세 영역 폭 px */
  mobileWidth: number;
  mobileWidthEv: Evidence;
  /**
   * 모바일 보이기: same = 같은 HTML 을 좁은 상세 영역에
   * · smartstore = 스마트스토어 공식 3가지 (FAQ 13768): iframe 있음 → 모바일 미리보기 없음 / link·table·외부 이미지 있음 → PC 캡처 / 그 외 원본
   * · capture = 늘 PC 화면을 이미지로 저장해 보여 줌 (11번가 옛 매뉴얼)
   */
  mobile: 'same' | 'smartstore' | 'capture';
  /** 긴 상세 접힘 — over px 를 넘으면 PC pc px · 모바일 mobile px 까지만 보이고 펼쳐보기 */
  fold?: { over: number; pc?: number; mobile?: number; /** 모바일만 접히는 기준이 다를 때 */ mobileOver?: number; ev: Evidence };
  /** 상세 높이 상한 px (넘으면 등록 불가) */
  maxHeight?: { px: number; ev: Evidence };
  /** 상세 HTML 글자 수(바이트) 상한 */
  maxBytes?: { bytes: number; ev: Evidence; what: string };
  /** 모바일에서 HTML 글자 크기를 무시하고 고정 (스마트스토어 [공식]) — 고정 크기는 공개되지 않아 미리보기는 기본 크기로 */
  mobileFixedFont?: boolean;
  /** 모바일 화면을 만들 때 쇼핑몰 서버가 HTML 글자를 바꾸는 규칙 (컴퓨존: width·height 글자 삭제) */
  mobileTransform?: (html: string) => string;
  mobileTransformNote?: string;
  /** 상세 영역을 감싸는 쇼핑몰 마크업 (스킨 CSS 가 이 선택자로 걸린다) */
  wrap: [string, string];
  /** 상세 영역에 걸리는 스킨 CSS — PC · 모바일 */
  skinCss?: string;
  skinMobileCss?: string;
  /** PC 화면에만 걸리는 CSS (11번가: PC 상세 iframe 의 prdc_detail.css — 모바일 페이지는 불러오지 않음) */
  skinPcCss?: string;
  ops: Op[];
  /** 담당자에게 보여 줄 주의 (규칙 7-4 표) */
  notes: string[];
}

// ───── 공용 처리 ─────
const isJsHref = (n: string, el: Element) => n === 'href' && /^\s*javascript:/i.test(el.getAttribute('href') ?? '');
/** 이벤트 속성·javascript: 링크 — 공식 문구가 있는 곳은 11번가뿐(onerror·onload 불가). 다른 곳은 script 차단에서 미루어 본 것 */
const ON_ATTR: Op = { kind: 'attr', test: (n, el) => /^on/i.test(n) || isJsHref(n, el), what: 'onclick 같은 이벤트 속성·javascript: 링크', ev: '추정' };
const SCRIPT: Op = { kind: 'tag', tags: ['script', 'noscript'], what: '<script>', ev: '공식' };
const STYLE_TAG = (ev: Evidence): Op => ({ kind: 'tag', tags: ['style'], what: '<style> 블록 (class 로 건 모양이 모두 사라짐)', ev });
// 스마트스토어 공식 문구는 "script, style(CSS), title 등" — title 만 공식, meta·link·base 는 「등」에 들어 있을 수 있다는 추정
const TITLE_TAG: Op = { kind: 'tag', tags: ['title'], what: '<title>', ev: '공식' };
const FORM_TAGS: Op = { kind: 'tag', tags: ['form', 'input', 'button', 'select', 'textarea'], what: '<form>·입력칸', ev: '추정', strict: true };
const OBJECT_TAGS = (ev: Evidence): Op => ({ kind: 'tag', tags: ['object', 'embed', 'applet'], what: '<object>·<embed>(플래시 등)', ev });

/** class·id 를 지울 수도 있다는 가정 — 저장된 상세에 class 가 남는 것을 확인한 플랫폼(스마트스토어·11번가·ESM·롯데온·컴퓨존)에는 넣지 않는다 (2026-11-25) */
const STRICT_CLASS: Op = { kind: 'attr', test: (n) => n === 'class' || n === 'id', what: 'class·id 속성', ev: '추정', strict: true };

/** 규칙 7-3: 오픈마켓 에디터가 지우거나 무시하는 경우가 많아 기대지 않는 것 — 공개 목록이 없어 「지워질 수도 있는 것까지 미리 지워 보기」에서만 지운다 */
const STRICT_73: Op[] = [
  { kind: 'css', test: (_p, v) => /\b(var|calc|min|max|clamp)\s*\(/i.test(v), what: 'var()·calc()·min() 이 든 인라인 CSS', ev: '추정', strict: true },
  { kind: 'css', test: (p) => p.startsWith('--'), what: 'CSS 변수(--이름) 선언', ev: '추정', strict: true },
  { kind: 'css', test: (p, v) => p === 'position' && /absolute|fixed|sticky/i.test(v), what: 'position:absolute·fixed', ev: '추정', strict: true },
  { kind: 'css', test: (p) => p === 'container-type' || p === 'container', what: 'container-type', ev: '추정', strict: true },
  FORM_TAGS,
];

/** 규칙 7-1 공통 금지 — 고도몰은 지워지는지 확인 안 됨 → 알리기만 */
const COMMON_71: Op[] = [
  { kind: 'check', find: (r) => [...r.querySelectorAll('script,iframe,form')], what: '<script>·<iframe>·<form> — 규칙 7-1 공통 금지', ev: '추정', level: 'error' },
  { kind: 'check', find: (r) => [...r.querySelectorAll('[style]')].filter((e) => /position\s*:\s*absolute/i.test(e.getAttribute('style') ?? '')), what: 'position:absolute — 규칙 5절·7-1 금지 (글자가 길어지면 겹침)', ev: '추정', level: 'error' },
  { kind: 'check', find: (r) => [...r.querySelectorAll('a[href]')].filter((e) => /naver\.me|bit\.ly|han\.gl/i.test(e.getAttribute('href') ?? '')), what: '외부 단축 URL — 규칙 7-1 금지', ev: '추정', level: 'error' },
  { kind: 'check', find: (r) => [...r.querySelectorAll('*')].filter((e) => [...e.attributes].some((a) => /^on/i.test(a.name) || isJsHref(a.name, e))), what: 'onclick 같은 이벤트 속성·javascript: 링크 — 규칙 7-1 (<script> 금지와 같음)', ev: '추정', level: 'error' },
];

/** 규칙 7-2-1 5항: 음수 padding 은 무효 CSS 라 무시된다 (ZGX 등록 때 담당자가 손으로 0 으로 고침) */
const NEG_PADDING = /padding(-(top|right|bottom|left))?\s*:[^;}"]*-\d/i;
const NEG_PAD_CHECK: Op = {
  kind: 'check',
  find: (r) => [...r.querySelectorAll('style,[style]')].filter((e) => NEG_PADDING.test(e.tagName === 'STYLE' ? (e.textContent ?? '') : (e.getAttribute('style') ?? ''))),
  what: '음수 padding — 무효 CSS 라 무시되어 위치가 어긋남 (위로 당기려면 margin-top 음수, 규칙 7-2-1)',
  ev: '등록 확인',
  level: 'error',
};

const hostOf = (href: string) => {
  try {
    return new URL(href, 'https://x.invalid/').hostname;
  } catch {
    return '';
  }
};

const imgs = (r: HTMLElement) => [...r.querySelectorAll('img')];
/** 인라인 style 의 url(…) 주소들 (background-image 등) */
const cssUrls = (el: Element) => [...(el.getAttribute('style') ?? '').matchAll(/url\(\s*['"]?([^'")]+)/gi)].map((m) => m[1]);
/** 이미지 주소가 조건에 맞는 요소 — <img src> 와 인라인 background url() 둘 다 본다 */
const imageEls = (r: HTMLElement, test: (url: string) => boolean) =>
  [...r.querySelectorAll('img,[style]')].filter((e) => (e.tagName === 'IMG' && test(e.getAttribute('src') ?? '')) || cssUrls(e).some(test));
export const isGif = (src: string) => /\.gif(\?|#|$)/i.test(src) || /^data:image\/gif/i.test(src);

// ───── 플랫폼 ─────
// 근거: 2026-11-25 조사 — 공식 문서 대조 + 에디터·사이트 코드(소스)·실물 관찰·커뮤니티. 원문·주소는 각 항목 주석
const W = (m: keyof typeof MARKETS, fallback: number) => MARKETS[m].width ?? fallback;
const PF_WRAP: [string, string] = ['<div class="pf-area">', '</div>'];

/** <img> 대체 글(alt) — 11번가 매뉴얼("대체텍스트를 제공해야 합니다")·롯데온 API("alt 입력 필요")·ESM 가이드(권장) */
/**
 * style 값 안 따옴표가 깨져 CSS 조각이 속성 이름이 된 경우 (예: style="font-family:"Noto Sans"" → sans""="")
 * 커머스API discussions #3585 (2026-07-02): 이런 속성들이 "Not Allowed Attribute Filtered" 로 걸러지고 HTML 태그가 화면에 그대로 보였다는 문의
 */
const BROKEN_ATTR: Op = {
  kind: 'check',
  find: (r) => [...r.querySelectorAll('*')].filter((e) => [...e.attributes].some((a) => /[:;"'(){}]/.test(a.name))),
  what: '깨진 속성 — style 값 안 따옴표가 깨져 CSS 가 속성 이름으로 쪼개짐 (필터가 지우고 주석·글자가 화면에 보일 수 있음)',
  ev: '공식',
  level: 'error',
};

const ALT_CHECK = (ev: Evidence, what: string): Op => ({ kind: 'check', find: (r) => imgs(r).filter((i) => !(i.getAttribute('alt') ?? '').trim()), what, ev, level: 'warn' });

// 스마트스토어 링크 — FAQ 4025 허용 목록 / 불가 목록 (naver.me 단축 URL·m.site.naver.com·sell.smartstore.naver.com)
// (2026-11-25 원문 재확인: youtu.be 단축 주소는 목록에 없음, blog.me 는 blog.naver.com 으로 바꾸라고 안내)
const SS_LINK_ALLOW = /(^|\.)(naver\.com|naver\.net|pstatic\.net|youtube\.com|grafolio\.com|modoo\.at|band\.us|clova\.ai|facebook\.com|tumblr\.com|twitter\.com|x\.com|instagram\.com)$/i;
const SS_LINK_DENY = /(^|\.)(naver\.me|m\.site\.naver\.com|sell\.smartstore\.naver\.com|sell\.storefarm\.naver\.com|sell\.shop\.naver\.com)$/i;
// 스마트스토어 iframe — 공지 「iframe태그, 단축URL 제한 사전안내」(2025-05-08): "등록이 허용되는 아래의 링크를 연결하기 위한 iframe 태그는 삭제되지 않습니다" → 링크와 같은 허용·불가 목록 (youtube-nocookie.com 은 목록에 없음)
const YOUTUBE = /(^|\.)(youtube\.com|youtube-nocookie\.com)$/i;

/** 고도몰 저장(IR_TO_DB): 내용이 빈 <p></p> 를 지운다 — SmartEditor2 hp_SE_WYSIWYGEnterKey.js rxEmptyP (고도몰 빌드에도 있음) */
const EMPTY_P: Op = {
  kind: 'fn',
  level: 'removed',
  what: '내용이 빈 <p></p>·공백만 든 <p> — 저장할 때 지워짐 (여백은 margin·padding 으로)',
  ev: '시험',
  run: (r) => {
    const hit = [...r.querySelectorAll('p')].filter((e) => !e.childNodes.length || (e.children.length === 0 && !(e.textContent ?? '').trim() && !/ /.test(e.textContent ?? '')));
    hit.forEach((e) => e.remove());
    return hit.map(sample);
  },
};

/** 고도몰 Editor 탭에서 저장: www.·http(s):// 글자를 자동으로 <a> 로 감싼다 — SE2M_Hyperlink bAutolink:true (HTML 탭에서는 꺼짐) */
const AUTOLINK: Op = {
  kind: 'fn',
  level: 'changed',
  design: true,
  what: 'www.·http:// 로 시작하는 글자 — Editor 탭에서 저장하면 자동으로 링크가 됨',
  ev: '시험',
  run: (r, doc) => {
    const out: string[] = [];
    const walker = doc.createTreeWalker(r, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (!(n.parentElement?.closest('a,style,script'))) texts.push(n as Text);
    for (const t of texts) {
      const v = t.nodeValue ?? '';
      const re = /(https?:\/\/|www\.)[^\s<>"']+/gi;
      if (!re.test(v)) continue;
      re.lastIndex = 0;
      const frag = doc.createDocumentFragment();
      let last = 0;
      for (const m of v.matchAll(re)) {
        frag.append(v.slice(last, m.index));
        const a = doc.createElement('a');
        // 실제 SmartEditor: 대문자 WWW. 도 http:// 를 붙인다 (2026-11-25 로컬 실행 대조)
        a.setAttribute('href', /^www\./i.test(m[0]) ? `http://${m[0]}` : m[0]);
        a.setAttribute(MARK, '자동 링크');
        a.textContent = m[0];
        frag.append(a);
        out.push(m[0]);
        last = (m.index ?? 0) + m[0].length;
      }
      frag.append(v.slice(last));
      t.replaceWith(frag);
    }
    return out;
  },
};

/** 롯데온 상세 화면(llis-goodsdetail): img 의 인라인 style 을 모두 버리고 width:100%;height:auto 로 덮어씀 — 원본 60개·렌더 8개 대조 */
const LOTTE_IMG: Op = {
  kind: 'fn',
  level: 'changed',
  what: '<img> 의 인라인 style — 화면에 보여 줄 때 모두 버리고 width:100%·height:auto 로 바꿈 (이미지는 눌리지 않음)',
  ev: '관찰',
  run: (r) => {
    const hit = imgs(r).filter((i) => (i.getAttribute('style') ?? '').trim() && !/^\s*width:\s*100%;\s*height:\s*auto\s*!important;?\s*(pointer-events:\s*none;?)?\s*$/i.test(i.getAttribute('style') ?? ''));
    const out = hit.map((i) => `<img style="${(i.getAttribute('style') ?? '').slice(0, 80)}">`);
    for (const i of imgs(r)) {
      i.setAttribute('style', 'width: 100%; height: auto !important; pointer-events: none;');
      if (hit.includes(i)) i.setAttribute(MARK, 'img style 덮어씀');
    }
    return out;
  },
};

/**
 * 롯데온: a 태그 속성 제거 — 원본(contents.lotteon.com)의 롯데온 기획전 링크도 화면(llis-goodsdetail)에서는 <a> 만 남음 (2026-11-25 다시 확인).
 * 조사 때 근거로 든 「공지 6681」은 롯데온 API 센터에 없는 글이라 공식 근거로 쓰지 않는다
 */
const LOTTE_LINK: Op = {
  kind: 'fn',
  level: 'removed',
  what: '링크(<a> 의 href·target) — 롯데온 안 링크까지 모든 속성이 지워져 눌러도 이동 안 함',
  ev: '관찰',
  run: (r) => {
    const hit = [...r.querySelectorAll('a')].filter((a) => a.attributes.length);
    const out = hit.map(sample);
    for (const a of hit) {
      for (const at of [...a.attributes]) a.removeAttribute(at.name);
      a.setAttribute(MARK, '링크 속성 지워짐');
    }
    return out;
  },
};

// 쿠팡 상품 페이지가 상세 HTML 을 그릴 때 쓰는 sanitize-html 설정 (assets.coupangcdn.com front-web-next 번들 모듈 56990, 2026-11-25)
const COUPANG_TAGS = ['address', 'article', 'aside', 'footer', 'header', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hgroup', 'main', 'nav', 'section', 'blockquote', 'dd', 'div', 'dl', 'dt', 'figcaption', 'figure', 'hr', 'li', 'ol', 'p', 'pre', 'ul', 'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data', 'dfn', 'em', 'i', 'kbd', 'mark', 'q', 'rb', 'rp', 'rt', 'rtc', 'ruby', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr', 'caption', 'col', 'colgroup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'button', 'img', 'audio', 'video', 'iframe', 'strike', 'center', 'link'];

export const EDITORS: EditorProfile[] = [
  {
    id: 'godo',
    label: '고도몰',
    group: '고도몰',
    editor: '고도몰 상품 상세설명 (SmartEditor 2.10 · HTML 탭)',
    // 공식 상세 폭 없음 (도움말 전체 검색, 2026-11-25) — 스킨 실측
    // 실측(2026-11-25, 화면 1440): 아이티켓 .txt-manual 1200px 안에 Pagefy 결과(ZGX)가 860px 로 가운데 · 온코어 .oc-gv-desc 1280px → 좁은 아이티켓 기준
    pcWidth: 1200,
    pcWidthEv: '관찰',
    pcWidthNote: '실제 상세 영역 (아이티켓 1200px·온코어 1280px) — Pagefy 결과는 그 안에서 최대 ' + GODO_MAX_W + 'px 로 가운데 (규칙 7-2)',
    // 360px 폰에서 아이티켓 323px · 온코어 332px → 좁은 쪽
    mobileWidth: 323,
    mobileWidthEv: '관찰',
    mobile: 'same',
    // 같은 HTML 을 아이티켓·온코어 두 쇼핑몰에 쓰므로 두 스킨의 상세 영역 마크업·CSS 를 함께 건다 (더 나쁜 쪽으로 보이게)
    wrap: ['<div class="oc-gv-desc"><div class="item_goods_sec"><div class="detail_explain_box"><div class="txt-manual">', '</div></div></div></div>'],
    // 7-2-1 표: 아이티켓(designbook_air_RES) h3 숨김 · 모바일 img 폭 100% / 온코어 가운데 정렬 · p 진회색 · img 폭 100%·가운데
    // 2026-11-25 실제 상품 페이지 CSSOM 재확인 — 아이티켓(goodsNo=11012) · 온코어 리뉴얼 스킨(oc-renewal, goodsNo=1000000710)
    skinCss: '.item_goods_sec h3{display:none}.item_goods_sec .detail_explain_box h3{display:none}.oc-gv-desc{text-align:center;overflow-wrap:break-word}.oc-gv-desc p{color:#6b6f78}.oc-gv-desc img{display:block;max-width:100%;height:auto;margin:0 auto}.oc-gv-desc iframe,.oc-gv-desc video{max-width:100%;height:auto}.oc-gv-desc table{max-width:100%}',
    skinMobileCss: '.detail_explain_box .txt-manual img{width:100%;display:block}.item_goods_sec table td{font-size:12px}',
    ops: [
      // 고도몰 SE2BasicCreator.js 에는 원본 SE2 의 태그 제거 필터(_rxFilter: style·script·iframe…)가 없음 → <style>·<script> 는 탭을 바꿔도 지워지지 않음
      // 상품 저장 서버(GoodsAdmin::saveInfoGoods)도 xss 필터 없음 (공개 사본 기준 — 서버 전역 필터는 미확인)
      EMPTY_P,
      AUTOLINK,
      ...COMMON_71,
      { kind: 'check', find: (r) => [...r.querySelectorAll('h3')], what: '<h3> — 아이티켓 스킨이 상세 영역 h3 를 숨김 (소제목은 <p role="heading" aria-level="3">)', ev: '관찰', level: 'error' },
      { kind: 'check', find: (r) => [...r.querySelectorAll('h1')], what: '<h1> — 스킨의 상품명이 h1 (규칙 7-2-1)', ev: '관찰', level: 'error' },
      NEG_PAD_CHECK,
    ],
    notes: [
      '에디터는 SmartEditor 2.10 이지만 고도몰은 원본의 태그 제거 필터를 빼고 씁니다 [소스]. 아이티켓 관리자 에디터 파일을 받아 직접 돌려 보니 HTML 탭·Editor 탭 어느 쪽에서 저장해도 <style>·class·role·aria·calc()·var()·iframe·script 가 남았습니다 [시험·등록 확인]. 서버 쪽 필터는 공개 사본상 없지만 전역 필터는 미확인입니다.',
      '저장할 때 HTML 이 한 번 다시 정리됩니다 — 닫지 않은 태그 닫기, 표에 tbody 넣기, 빈 <p>·공백만 든 <p> 삭제 [시험]. Editor 탭에서 저장하면 URL 글자가 자동 링크가 됩니다 [시험].',
      '다시 수정할 때 에디터가 Editor 탭으로 열리고 <font> 를 <span> 으로 바꿉니다 [소스] — 고칠 때는 Pagefy 결과를 HTML 탭에 통째로 다시 붙여넣으세요. 에디터로 올리는 이미지는 webp 를 받지 않습니다 (외부 주소 이미지는 상관없음) [소스].',
      '미리보기에는 아이티켓·온코어 스킨 CSS 를 함께 걸었습니다 [관찰, 2026-11-25 실측] — h3 숨김·모바일 표 글자 12px(아이티켓), 가운데 정렬·p 회색(#6b6f78)·iframe·video 높이 auto(온코어 리뉴얼), 상세 img 폭 100%. 온코어는 유튜브 iframe 높이가 auto 로 바뀌어 낮아질 수 있으니 height 를 꼭 지정하세요. 휴대폰(360px) 상세 영역 323~332px.',
    ],
  },
  {
    id: 'smartstore',
    label: MARKETS.smartstore.label,
    group: '오픈마켓',
    editor: '스마트스토어 상세설명 · HTML 작성',
    // FAQ 3923 "상세설명 권장 크기는 가로 848px입니다." (FAQ 5307 은 스마트에디터 최대 860px)
    pcWidth: W('smartstore', 860),
    pcWidthEv: '공식',
    pcWidthNote: '권장 (FAQ 3923)',
    mobileWidth: 360,
    mobileWidthEv: '추정',
    mobile: 'smartstore',
    // FAQ 4414 "모바일 상품 상세 페이지에서는 모바일에 맞게 최적화되어 고정 노출됩니다"
    mobileFixedFont: true,
    // FAQ 14079 "4000px 초과 할 경우 … 3000px 까지만 노출 … PC 3000px, Mobile 1200px"
    fold: { over: 4000, pc: 3000, mobile: 1200, ev: '공식' },
    // FAQ 13986 "5MB를 초과한 경우 등록/수정 불가"
    maxBytes: { bytes: 5 * 1024 * 1024, ev: '공식', what: '상세설명 글자 수 5MB 초과 — 등록·수정 불가' },
    wrap: PF_WRAP,
    ops: [
      // 걸러진 자리의 문구가 네이버 오픈소스 lucy-xss-filter XssFilter.java 상수와 같음 → Lucy 방식 (주석 + 원래 태그를 글자로)
      // FAQ 4414 "차단되는 태그 : script, style(CSS), title 등" · 커머스API #3442 "HTML, META, SCRIPT, STYLE, BODY, HEAD 와 같이 … 전역에 영향"
      { ...SCRIPT, lucy: true } as Op,
      { ...STYLE_TAG('공식'), lucy: true, what: '<style> 블록 — 지워지고 그 자리에 CSS 가 글자로 보일 수 있음 (Lucy 필터)' } as Op,
      { ...TITLE_TAG, lucy: true } as Op,
      { kind: 'tag', tags: ['meta', 'link', 'base'], what: '<meta>·<link>·<base> (전역에 영향 주는 태그)', ev: '공식', lucy: true },
      BROKEN_ATTR,
      // Lucy 상위 설정 lucy-xss-superset.xml: body·embed·iframe·meta·object·script·style·link·base 를 disable (iframe 은 네이버가 SNS 예외를 둠)
      { kind: 'tag', tags: ['object', 'embed'], what: '<object>·<embed> — 걸러지고 원래 태그가 글자로 남음', ev: '소스', lucy: true },
      { ...ON_ATTR, lucy: true } as Op,
      { kind: 'tag', tags: ['iframe'], keep: (el) => { const h = hostOf(el.getAttribute('src') ?? ''); return SS_LINK_ALLOW.test(h) && !SS_LINK_DENY.test(h); }, what: '<iframe> (허용 링크 목록의 SNS·유튜브·네이버 서비스만 남음, 2025-05-08 공지)', ev: '공식', lucy: true },
      // Lucy 기본 설정(lucy-xss-default.xml) iframe 허용 속성에 allow·allowfullscreen·referrerpolicy 없음 — 11번가 실물에서도 지워짐
      { kind: 'attr', test: (n, el) => el.tagName === 'IFRAME' && /^(allow|allowfullscreen|referrerpolicy)$/.test(n), what: '남은 <iframe> 의 allow·allowfullscreen·referrerpolicy (전체 화면 버튼이 안 될 수 있음)', ev: '소스', lucy: true },
      // FAQ 4025·4414 허용 목록 밖 링크, a 태그 비허용·단축 URL 은 "대체문구없이 삭제"
      { kind: 'unlink', allow: SS_LINK_ALLOW, deny: SS_LINK_DENY, what: '외부 링크 (네이버·일부 SNS 만 허용, naver.me 단축 URL 불가) — 글자만 남김', ev: '공식' },
      // FAQ 5305 "<Not Allowed Attribute Filtered> : 새창 열기 태그는 사용하실 수 없습니다." · Lucy 기본 설정 a 에 style·target 없음
      { kind: 'attr', test: (n, el) => el.tagName === 'A' && (n === 'target' || n === 'style'), what: '<a> 의 target(새 창)·style', ev: '공식', lucy: true },
      // Lucy 기본 설정 img 허용 속성에 border·align·hspace·vspace 없음 · 롯데온에 복사된 스마트스토어 HTML 에 "( border="0")" 주석 실물
      { kind: 'attr', test: (n, el) => el.tagName === 'IMG' && /^(border|align|hspace|vspace)$/.test(n), what: '<img> 의 border·align·hspace 속성', ev: '소스', lucy: true },
      // FAQ 4414 "src="data:image/~" … 소스가 반영되지 않으며"
      // 네이버 공지(가비아CNS 재게시, 2023-03-09) 출력 예시: <div><!-- Not Allowed Attribute Filtered ( src=올바르지 않아 소스가 제거됩니다. …) --><img /></div> → src 만 지워지고 빈 <img> 가 남음
      { kind: 'attr', test: (n, el) => el.tagName === 'IMG' && n === 'src' && /^\s*data:/i.test(el.getAttribute('src') ?? ''), what: 'base64(data:) 이미지 주소 — src 가 지워지고 빈 <img> 가 남음', ev: '공식', lucy: true },
      // Lucy 기본 설정은 CSS 속성을 이름별로 거르지 않음. 그러나 네이버 답변(커머스API discussions #3337, 2026-03-31):
      // "상품 상세 페이지의 UI를 변동시킬 수 있는 태그와 속성은 필터링" — 같은 글에서 판매자가 인라인 max-width:860 이 안 먹는다고 보고. 목록은 비공개
      { kind: 'css', test: (p) => /^border(-(top|bottom)-(left|right))?-radius$/.test(p), what: 'border-radius (둥근 모서리)', ev: '커뮤니티' },
      { kind: 'css', test: (p) => p === 'max-width', what: 'max-width — 네이버가 "UI 를 바꾸는 속성"을 거른다고 답했고, 인라인 max-width 가 안 먹는다는 판매자 보고 있음', ev: '커뮤니티', strict: true },
      // FAQ 13768 table → 모바일은 캡처
      { kind: 'check', find: (r) => [...r.querySelectorAll('table')], what: '<table> — 모바일이 PC 캡처 미리보기로 바뀜 (FAQ 13768) — inline-block 칸으로', ev: '공식' },
      // FAQ 4159 "GIF이미지가 움직이지 않아"
      { kind: 'check', find: (r) => imgs(r).filter((i) => isGif(i.getAttribute('src') ?? '')), what: 'GIF — 모바일에서는 움직이지 않음 (원본보기를 눌러야 움직임)', ev: '공식' },
      ...STRICT_73,
    ],
    notes: [
      '권장 폭 848px [공식]. HTML 작성과 직접 작성(스마트에디터ONE)은 섞어 쓸 수 없습니다 [공식]. 지원 태그 목록은 공개되지 않습니다 [공식 답변].',
      '저장 필터는 네이버 오픈소스 Lucy XSS 필터 방식입니다 [소스] — 걸러진 태그 자리에 <!-- Not Allowed Tag Filtered --> 주석이 남고 원래 태그가 글자로 보일 수 있습니다. 꺾쇠 글자(<양준일>)도 태그로 처리되니 &lt; 로 쓰세요 [공식]. 네이버는 "상품 상세 페이지의 UI를 변동시킬 수 있는 태그와 속성"도 거른다고 답했지만(커머스API, 2026-03) 목록은 비공개입니다 — 인라인 max-width 가 안 먹는다는 판매자 보고가 있습니다. 다른 답변(#3585, 2026-07)에서는 "style, line-height, letter-spacing, text-align 등의 스타일 속성"을 필터링 대상이 될 수 있다고 했습니다 — 인라인 스타일이 많은 HTML 은 실제 등록 화면으로 꼭 확인하세요.',
      '모바일 [공식, FAQ 13768]: iframe 이 있으면 모바일 미리보기 없음 · link·table 태그나 외부 이미지가 있으면 PC 화면을 캡처한 미리보기 · 그 외는 원본 그대로. 원본일 때도 HTML 글자 크기는 무시되고 고정됩니다.',
      '외부 이미지를 같은 파일명으로 덮어쓰면 모바일 미리보기에 반영되지 않습니다 [공식]. 이미지 장당 20MB, GIF 300프레임 [공식]. 다른 쇼핑몰 구매 링크는 판매금지 처리될 수 있습니다 [공식].',
    ],
  },
  {
    id: 'coupang',
    label: MARKETS.coupang.label,
    group: '오픈마켓',
    editor: '쿠팡 Wing 상세설명 · HTML 작성',
    // 로켓그로스 입고 가이드 V2 "상세설명 | 780px * 5,000px 이상의 해상도, 10MB 이하" (Wing HTML 작성 화면 안내는 아님)
    // 상품 페이지 실측(2026-11-25, 화면 1649px): 상세 블록(.vendor-item > div) 1460px — 780px(with-width-780)은 이미지 블록에만 붙음
    pcWidth: 1460,
    pcWidthEv: '관찰',
    pcWidthNote: 'HTML 블록이 퍼지는 실제 칸 (가이드 상세 폭은 780px [공식] — 바깥을 max-width:780px 로)',
    mobileWidth: 360,
    mobileWidthEv: '추정',
    mobile: 'same',
    // 상품 페이지 CSS: .hide-overflow .product-detail-content-inside{max-height:1200px;overflow:hidden} + 「더보기」 [소스]
    // PC 상품 페이지에서만 확인 — 모바일(m.coupang.com)은 조사하지 못해 넣지 않음
    fold: { over: 1200, pc: 1200, ev: '소스' },
    // 상세 블록 클래스는 type-IMAGE·TEXT·…·UNDEFINED 뿐 (type-HTML 없음) — HTML 상세는 API 예시처럼 TEXT 로 본다
    wrap: ['<div class="product-detail-content"><div class="vendor-item"><div class="type-TEXT">', '</div></div></div>'],
    // 상품 페이지가 상세 블록에 거는 CSS — 상품 6945442901 CSSOM 에서 값 그대로 (2026-11-25 다시 확인). 우리 마크업 위에 덮어씌워짐
    skinCss:
      '.vendor-item .type-TEXT{color:#333;font-size:16px;margin-bottom:40px}.vendor-item .type-TEXT::after{content:"";display:block;clear:both;height:1px}.vendor-item .type-TEXT img{max-width:100%;width:auto}.vendor-item .type-TEXT hr{height:15px;border:0;border-bottom:1px dotted #d2d2d2;font-size:0;line-height:0}.vendor-item .type-TEXT>div{clear:both;line-height:1.5;font-size:1em}.vendor-item .type-TEXT table{border-collapse:collapse;border-top:2px solid #464646;border-bottom:2px solid #c2c2c2;table-layout:auto;text-align:justify;width:100%!important}.vendor-item .type-TEXT table li{padding-left:13px;background-position:6px 10px}.vendor-item .type-TEXT table td{border-left:0;padding:5px 5px 5px 8px;line-height:18px;letter-spacing:-1px;font-size:1em}.vendor-item .type-TEXT table td:first-child{width:20%;padding:5px;border-right:0}.vendor-item .type-TEXT table td:last-child{white-space:normal}.vendor-item .type-TEXT li{line-height:1.5;padding:1px 0 1px 9px;font-size:1em;background:url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAEAQMAAACTPww9AAAABlBMVEX///8AAABVwtN+AAAAAXRSTlMAQObYZgAAAA5JREFUeF5jSGD4AIQJAAqIAqEi1nJaAAAAAElFTkSuQmCC") 1px 9px/3px auto no-repeat}.vendor-item .type-TEXT li span{line-height:1.5!important}.vendor-item .type-TEXT ol{padding-left:35px}.vendor-item .type-TEXT ol li{padding-left:0;background:none;list-style:outside decimal;text-indent:-3px}.vendor-item .type-TEXT h5{font-weight:400}.vendor-item .type-TEXT h3{background:none}.vendor-item .type-TEXT h1{font-size:30px;line-height:1.3}.product-detail-content{margin-bottom:70px}.product-detail-content em{font-style:italic}.product-detail-content img{display:inline}',
    ops: [
      // 상품 페이지 렌더 필터 sanitize-html: 허용 목록 밖 태그는 벗기고, script·style·textarea·option 은 내용까지 버림 [소스]
      { kind: 'allowlist', tags: COUPANG_TAGS, drop: ['script', 'style', 'textarea', 'option'] /* sanitize-html nonTextTags 그대로 — noscript 는 태그만 벗기고 내용은 남음 (실행 확인) */, what: '허용 목록 밖 태그 — <style>·<script>·<textarea> 는 내용째 버리고, <font>·<svg>·<picture>·<input> 등은 태그만 벗김 (상품 페이지 화면 필터)', ev: '시험' },
      // sanitize-html 기본값: HTML 주석은 지운다 (같은 설정으로 실행해 확인, 2026-11-25)
      {
        kind: 'fn',
        level: 'removed',
        what: 'HTML 주석 <!-- … --> — 화면 필터가 지움',
        ev: '시험',
        run: (r, doc) => {
          const out: string[] = [];
          const w = doc.createTreeWalker(r, NodeFilter.SHOW_COMMENT);
          const list: Comment[] = [];
          for (let n = w.nextNode(); n; n = w.nextNode()) list.push(n as Comment);
          for (const c of list) {
            out.push(`<!--${c.data.slice(0, 40)}-->`);
            c.remove();
          }
          return out;
        },
      },
      // allowedSchemes ["http","https","ftp","mailto","tel"] [소스]
      { kind: 'attr', test: (n, el) => /^(href|src|cite)$/.test(n) && /^\s*[a-z][\w+.-]*:/i.test(el.getAttribute(n) ?? '') && !/^\s*(https?|ftp|mailto|tel):/i.test(el.getAttribute(n) ?? ''), what: 'http·https·mailto·tel 밖 주소 (javascript: 등)', ev: '시험' },
      // FAQ "유튜브(youtube), 일반 이미지를제외한 <iframe> 태그는사용이불가능합니다" (2019-05-15)
      { kind: 'tag', tags: ['iframe'], keep: (el) => YOUTUBE.test(hostOf(el.getAttribute('src') ?? '')), what: '유튜브가 아닌 <iframe> — 사용 불가', ev: '공식' },
      // 저장 단계(Wing)는 로그인 영역이라 미확인 — 커뮤니티 1곳씩
      { kind: 'attr', test: (n, el) => el.tagName === 'A' && (n === 'href' || n === 'target'), what: '링크의 href·target — 저장할 때 지워진다는 자료 (1곳)', ev: '커뮤니티', strict: true },
      // 화면 필터는 onclick 같은 속성도 남긴다 (allowedAttributes:false, 시험) — 저장 단계는 미확인이라 「가능성」으로만
      { ...ON_ATTR, strict: true } as Op,
      { kind: 'gif', what: 'GIF — 업로드가 막히거나 jpg 로 바뀐다는 자료 (자료끼리 엇갈림)', ev: '커뮤니티' },
      { kind: 'check', find: (r) => imageEls(r, (u) => /^https?:/i.test(u)), what: '외부 이미지 — 저장할 때 쿠팡 서버로 복사됨 (나중에 이미지를 바꿔도 반영 안 됨, 3곳)', ev: '커뮤니티', level: 'warn' },
      { kind: 'check', find: (r) => [...r.querySelectorAll('table')], what: '<table> — 쿠팡 CSS 가 굵은 위아래 테두리·width:100% !important·칸 여백·첫 칸 width:20% 를 덮어씀', ev: '소스', level: 'warn' },
      {
        kind: 'check',
        // 바깥 요소 중 하나라도 폭(px)을 800 이하로 정했으면 통과
        find: (r) => {
          const top = [...r.children].filter((e) => e.tagName !== 'STYLE' && e.tagName !== 'SCRIPT');
          const capped = top.some((e) => { const m = (e.getAttribute('style') ?? '').match(/(?:^|;)\s*(?:max-)?width\s*:\s*(\d+(?:\.\d+)?)px/i); return !!m && Number(m[1]) <= 800; });
          return capped || !top.length ? [] : top.slice(0, 1);
        },
        what: '바깥 폭 제한 없음 — HTML 블록에는 780px 제한이 안 붙어 상세 칸(PC 약 1460px) 전체로 퍼짐 → 바깥을 max-width:780px 로',
        ev: '관찰',
        level: 'warn',
      },
      { kind: 'check', find: (r) => [...r.querySelectorAll('li')], what: '<li> — 쿠팡 CSS 가 점 모양 배경·왼쪽 여백·줄 간격 1.5 를 덮어씀', ev: '소스', level: 'warn' },
      STRICT_CLASS,
      ...STRICT_73,
    ],
    notes: [
      '「HTML 작성: HTML 소스를 입력해 등록할 수 있습니다」 [공식]. 저장 단계 규칙은 Wing 로그인 영역이라 확인하지 못했습니다. 상품 페이지가 그릴 때 쓰는 필터 설정(sanitize-html 허용 태그·모든 속성 허용)을 쿠팡 코드에서 원문으로 확인하고, 같은 설정으로 라이브러리를 직접 돌려 봤습니다 [시험] — 최소한 이만큼은 걸러집니다.',
      '화면 필터는 class·id·인라인 style 을 모두 남기고 CSS 속성도 거르지 않습니다 [소스]. 대신 쿠팡 CSS 가 상세 글자(16px·#333)·이미지(max-width:100%)·표(굵은 테두리)를 덮어씌우니 인라인으로 직접 정하세요.',
      '상세 폭 780px 은 로켓그로스 입고 가이드 규격(780×5,000px 이상, 10MB 이하) [공식]. PC 상세는 처음 1,200px 만 보이고 「더보기」로 펼칩니다 [소스] (모바일은 미확인). Open API 로 보낼 때는 HTML 을 한 줄로 [공식].',
    ],
  },
  {
    id: 'st11',
    label: MARKETS.st11.label,
    group: '오픈마켓',
    editor: '11번가 셀러오피스 상세설명 · HTML 입력',
    // 상세 iframe 실측 880px · product_view.css .ifrm_prdc_detail{max-width:880px} · 11Editor WIDTH_DESKTOP=850
    pcWidth: 880,
    pcWidthEv: '소스',
    pcWidthNote: '상세 영역 CSS max-width 880px (11Editor 기준 850px)',
    // 모바일: div.c-content-reset 실측 — 휴대폰 UA·360px 화면 328px (2026-11-25 재측정, 이전 358 은 390px 화면 값)
    mobileWidth: 328,
    mobileWidthEv: '관찰',
    // 옛 매뉴얼의 "모바일은 이미지로 변환"은 지금은 아님 — 모바일 API 가 HTML 그대로 내려줌 (9개 확인)
    mobile: 'same',
    // 모바일 「더보기」 전 max-height:400px [관찰]
    fold: { over: 400, mobile: 400, ev: '관찰' },
    wrap: ['<div class="ifrm_prdc_detail"><div class="c-content-reset">', '</div></div>'],
    // prdc_detail.css + product_view.css (PC) / detail_general.min.css (모바일)
    // prdc_detail.css + product_view.css 값 그대로 (2026-11-25 다시 확인). * 초기화는 상세 iframe 전체에 걸린다
    skinPcCss: '.ifrm_prdc_detail,.ifrm_prdc_detail *{margin:0;padding:0}.ifrm_prdc_detail{width:100%;min-width:860px;max-width:880px;text-align:center;margin:0 auto;font-size:12px;color:#808080;padding-top:4px}.ifrm_prdc_detail img{max-width:100%;font-size:0;line-height:0;vertical-align:top}.ifrm_prdc_detail table{margin:0 auto}.ifrm_prdc_detail table img{max-width:880px}',
    skinMobileCss: '.c-content-reset div,.c-content-reset span,.c-content-reset img,.c-content-reset table,.c-content-reset p,.c-content-reset ul,.c-content-reset li,.c-content-reset center{width:auto!important;max-width:100%!important;min-width:0!important}.c-content-reset img{width:100%!important;height:auto!important}.c-content-reset iframe{width:100%}',
    ops: [
      // 저장 필터: 상세 HTML 에 <!-- Not Allowed Attribute Filtered ( … ) --> 주석이 남아 있음 (17개 상품 571곳) → Lucy 계열
      // prod.pdf "자바 스크립트 사용이 제한됩니다." "onerror/onload 소스를 입력하면 블록 처리"
      { ...SCRIPT, lucy: true, what: '<script> — 자바스크립트 제한' } as Op,
      { kind: 'tag', tags: ['object', 'embed', 'applet'], what: '<object>·<embed> — 걸러지고 원래 태그가 글자로 남음', ev: '관찰', lucy: true },
      BROKEN_ATTR,
      { ...ON_ATTR, ev: '공식', lucy: true, what: 'onerror·onload 같은 이벤트 속성·javascript: 링크 — 블록 처리' } as Op,
      // 실물 주석: data-gjs-type 549·data-highlightable 382·contenteditable 25
      { kind: 'attr', test: (n) => n.startsWith('data-') || n === 'contenteditable', what: 'data-* 속성·contenteditable', ev: '관찰', lucy: true },
      // 실물: 유튜브 iframe 은 남지만 allow·allowfullscreen·referrerpolicy 는 지워짐
      { kind: 'attr', test: (n, el) => el.tagName === 'IFRAME' && /^(allow|allowfullscreen|referrerpolicy)$/.test(n), what: '<iframe> 의 allow·allowfullscreen·referrerpolicy', ev: '관찰', lucy: true },
      // prod.pdf "11번가 이외의 URL로 링크를 입력하실 수 없습니다. 입력 시, 자동으로 링크가 지워집니다." · 실물 href="http://" 로 비워진 흔적
      { kind: 'unlink', allow: /(^|\.)11st\.co\.kr$/i, what: '11번가 밖 링크 — 자동 삭제 (휴대폰 가입신청서 링크만 예외)', ev: '공식' },
      ALT_CHECK('공식', 'alt 없는 이미지 — "대체텍스트를 제공해야 합니다" (접근성 지침)'),
      ...STRICT_73,
    ],
    notes: [
      '저장 필터는 Lucy 계열입니다 — 저장된 상세에 <!-- Not Allowed Attribute Filtered --> 주석이 남아 있습니다 [관찰, 상품 220개]. data-*·on*·contenteditable·<object>·iframe 의 allow 속성이 지워집니다.',
      '<style> 블록·class·id·flex·grid·border-radius·background-image 는 PC·모바일 모두 남습니다 [관찰]. 모바일은 HTML 을 그대로 보여 주지만 div·p·table·img 의 폭을 width:auto!important·max-width:100%!important 로, img 를 폭 100% 로 덮어씁니다 [소스] — 고정 px 폭에 기대지 마세요.',
      'PC 상세 영역은 880px (11Editor 850px) [소스]. http 이미지는 11번가 프록시를 거쳐 보입니다 [관찰]. 11번가 밖 링크는 자동 삭제, alt 필수 [공식·옛 매뉴얼].',
    ],
  },
  {
    id: 'gmarket',
    label: MARKETS.gmarket.label,
    group: '오픈마켓',
    editor: 'ESM PLUS 상세설명 · HTML로 작성',
    // ESM PLUS FAQ "최대 가로 사이즈는 옥션은 980픽셀이며 G마켓은 860픽셀 입니다." · vip.css .vip-detailarea_seller{width:860px;overflow:hidden}
    pcWidth: W('gmarket', 860),
    pcWidthEv: '공식',
    // 휴대폰 UA·360px 실측(2026-11-25): .box__detail-view 360px, 「더보기」 전 max-height 910px
    mobileWidth: 360,
    mobileWidthEv: '관찰',
    mobile: 'same',
    // ESM 2.0 가이드 "세로 길이는 90,000px 이상 등록 불가"
    maxHeight: { px: 90000, ev: '공식' },
    fold: { over: 910, mobileOver: 910, mobile: 910, ev: '관찰' },
    wrap: ['<div class="vip-detailarea_seller">', '</div>'],
    // vip.css 상세 칸 규칙 전부 (2026-11-25 재확인) — 글꼴 Tahoma·Noto Sans Korean·맑은 고딕, article 16px·가운데
    skinCss: ".vip-detailarea_seller{font-family:Tahoma,'Noto Sans Korean','Malgun Gothic','맑은 고딕',AppleSDGothicNeo,Helvetica,dotum,돋움,sans-serif;width:860px;max-width:100%;overflow:hidden}.vip-detailarea_seller img{max-width:860px;vertical-align:top}.vip-detailarea_seller article{margin-bottom:8px;font-size:16px;line-height:22px;text-align:center;color:#222;font-weight:normal;overflow-wrap:break-word}.vip-detailarea_seller article p{margin:0 auto}.vip-detailarea_seller td{text-align:center}",
    ops: esmOps(),
    notes: esmNotes('G마켓 860px'),
  },
  {
    id: 'auction',
    label: '옥션',
    group: '오픈마켓',
    editor: 'ESM PLUS 상세설명 · HTML로 작성',
    // 상품 페이지 실측(2026-11-25, 2개): 상세 iframe ExplainViewV1·#hdivDescription 모두 860px. ESM FAQ 의 「옥션 980」은 지금 화면과 다름
    pcWidth: 860,
    pcWidthEv: '관찰',
    pcWidthNote: '실측 860px — ESM FAQ 의 980px 은 옛 안내로 보임',
    mobileWidth: 360,
    mobileWidthEv: '관찰', // 휴대폰 UA·360px 실측: .box__detail-view 360px, 「더보기」 전 max-height 960px (2026-11-25)
    mobile: 'same',
    maxHeight: { px: 90000, ev: '공식' },
    fold: { over: 960, mobileOver: 960, mobile: 960, ev: '관찰' },
    wrap: PF_WRAP,
    ops: esmOps(),
    notes: esmNotes('옥션 980px (지금 상품 페이지 실측은 860px)'),
  },
  {
    id: 'lotteon',
    label: MARKETS.lotteon.label,
    group: '오픈마켓',
    editor: '롯데온 상세설명 · HTML 소스입력',
    // 상세 컨텐츠 가이드(패션편) "가로 750px, 세로 1장당 최대 2580px (전체 최대 40,000 px)" · PC 상세 iframe 실측 750
    pcWidth: W('lotteon', 750),
    pcWidthEv: '공식',
    pcWidthNote: '상세 컨텐츠 가이드 (패션편) · 실측 750px',
    // 휴대폰 UA·360px 실측(2026-11-25): 상세 iframe 328px, .imgWrap max-height 1400px
    mobileWidth: 328,
    mobileWidthEv: '관찰',
    mobile: 'same',
    // commonActions.js isMoreButtonShow = detail.height >= 2000 → 「상세정보 더보기」 [소스]
    // PC 실측: .imgWrap{max-height:2000px;overflow:hidden} + 「상세정보 더보기」 (2026-11-25). 모바일은 재지 않아 넣지 않음
    fold: { over: 2000, pc: 2000, mobileOver: 1400, mobile: 1400, ev: '관찰' },
    wrap: ['<div id="llis-root" class="pf-area">', '</div>'],
    // llis-goodsdetail 이 상세 문서에 넣는 <style> [소스]
    skinCss: '.pf-area table{width:100%!important}.pf-area h1,.pf-area h2,.pf-area h3,.pf-area h4,.pf-area h5{width:100%!important}.pf-area div{width:100%!important;height:auto!important}.pf-area video,.pf-area table,.pf-area h1,.pf-area h2,.pf-area h3,.pf-area h4,.pf-area h5{max-width:100%;vertical-align:top}.pf-area img,.pf-area div{vertical-align:top;max-width:100%}',
    ops: [
      // 상품등록 매뉴얼 "롯데ON 이외의 외부링크, 일부 스크립트 및 태그는 자동 삭제 될 수 있습니다."
      { ...SCRIPT, what: '<script> — 일부 스크립트는 자동 삭제될 수 있음' } as Op,
      ON_ATTR,
      LOTTE_LINK,
      LOTTE_IMG,
      // API 공지 135249: 2026-08-07~ 이 경로가 있으면 등록 불가, 2026-08-31~ 일괄 삭제
      { kind: 'check', find: (r) => imageEls(r, (u) => /doc-pub\.lotteon\.com\/ec\/public/i.test(u)), what: '롯데온 임시 이미지 경로 — 2026-08-07 부터 등록 불가, 08-31 부터 이미지 삭제', ev: '공식', level: 'error' },
      { kind: 'check', find: (r) => imgs(r).filter((i) => isGif(i.getAttribute('src') ?? '')), what: 'GIF — 가이드 형식은 jpg·png (패션편). 실제 상품에는 GIF 가 그대로 쓰임 [관찰]', ev: '공식', level: 'warn' },
      // 상품 등록 API cnts "상세정보를 이미지로 등록 시 시각 약자 고객을 위해 이미지 대체 텍스트 (alt) 입력 필요"
      ALT_CHECK('공식', 'alt 없는 이미지 — "이미지 대체 텍스트 (alt) 입력 필요"'),
      { kind: 'check', find: (r) => [...r.querySelectorAll('div[style]')].filter((d) => /(^|;)\s*(width|max-width|height)\s*:/i.test(d.getAttribute('style') ?? '')), what: '폭·높이를 정한 <div> — 롯데온 CSS 가 모든 div 를 width:100%!important·height:auto!important 로 덮어씀', ev: '소스', level: 'warn' },
      { ...STYLE_TAG('추정'), strict: true } as Op,
      ...STRICT_73,
    ],
    notes: [
      '롯데온은 저장 때보다 화면에 보여 줄 때 HTML 을 고칩니다 [관찰·소스, 2026-11-25 다시 확인]: img 의 인라인 style 은 모두 width:100%·height:auto·pointer-events:none 으로 바뀌고(안 뜨는 이미지는 숨김), 모든 div·표·h1~h5 는 width:100%!important. 크기·가운데 정렬은 div 폭 대신 바깥 여백(%)이나 이미지 자체 크기로 만드세요.',
      '링크는 롯데온 안 링크까지 a 태그 속성이 지워져 동작하지 않습니다 [관찰]. http 이미지는 롯데온 프록시를 거칩니다 [관찰]. 상세가 2,000px 를 넘으면 「상세정보 더보기」로 접힙니다 [소스].',
      '상세 이미지 규격 가로 750px·1장 세로 2,580px 이하·전체 40,000px 이하·jpg/png [공식 — 패션편]. "롯데ON 이외의 외부링크, 일부 스크립트 및 태그는 자동 삭제 될 수 있습니다" [공식].',
    ],
  },
  {
    id: 'himart',
    label: MARKETS.himart.label,
    group: '오픈마켓',
    editor: '하이마트 파트너사지원시스템 상세설명 (AXEditor)',
    // PC 상세 iframe 본문 약 542px (감싸개 558px), 390px 화면에서 331px [관찰]
    pcWidth: 542,
    pcWidthEv: '관찰',
    pcWidthNote: '공개 규격 없음 · 실측 (PC 상세 칸이 좁음)',
    // 휴대폰 UA·360px 실측(2026-11-25, m.e-himart.co.kr): 상세 iframe 316px, 안쪽 body margin 8px → 본문 300px
    mobileWidth: 300,
    mobileWidthEv: '관찰',
    mobile: 'same',
    // detail.css .hm-goods__info-detail-view{max-height:1000px;overflow-y:hidden} + 「상품정보 더보기」 (높이 1000 이상) [관찰]
    fold: { over: 1000, pc: 1000, mobile: 1000, ev: '관찰' },
    wrap: PF_WRAP,
    // 상세 iframe 안에 하이마트가 넣는 CSS + 바깥 detail.css [관찰]
    skinCss: '.pf-area img{width:100%!important;height:auto!important;max-width:100%!important}.pf-area iframe,.pf-area div,.pf-area table{max-width:100%!important}',
    ops: [
      // AXEditor getContent 는 innerHTML 그대로 — 화면 쪽 태그 필터 없음 [소스]. 서버 필터는 미확인
      { ...SCRIPT, ev: '추정' } as Op,
      ON_ATTR,
      { kind: 'check', find: (r) => imgs(r).filter((i) => { const w = Number(i.getAttribute('width')) || parseFloat((i.getAttribute('style') ?? '').match(/(?:^|;)\s*width\s*:\s*(\d+)px/i)?.[1] ?? ''); return w > 0 && w < 300; }), what: '작은 이미지(아이콘 등) — 하이마트가 모든 img 를 width:100%!important 로 늘림', ev: '관찰', level: 'warn' },
      { ...STYLE_TAG('추정'), strict: true } as Op,
      STRICT_CLASS,
      ...STRICT_73,
    ],
    notes: [
      '공개된 상세 규격 문서는 없습니다. 파트너사지원시스템 편집기(AXEditor)는 화면에서 태그를 거르지 않습니다 [소스] (서버 필터는 미확인). 인라인 style·align·table 이 남은 상품이 있습니다 [관찰].',
      '상세가 iframe 안에 들어가고 하이마트가 img 를 모두 폭 100% 로 늘립니다 [관찰]. PC 상세 칸이 약 540px, 휴대폰(360px)은 약 300px 로 좁고, 처음 1,000px 만 보입니다 [관찰].',
      '하이마트 서버에 올린 이미지는 1200px 로 줄이고 세로 1200px 단위로 잘라(avif·webp) 보여 줍니다 — 외부 주소 이미지는 그대로 [관찰].',
    ],
  },
  {
    id: 'compuzone',
    label: MARKETS.compuzone.label,
    group: '오픈마켓',
    editor: '컴퓨존 협력사툴 상세설명',
    // #contents{width:1300px}, 상세 img 폭 제한 없음 [관찰]
    pcWidth: 1300,
    pcWidthEv: '관찰',
    pcWidthNote: '상세 영역 1300px · 이미지 폭 제한 없음 — 바깥을 max-width 로 직접 정하세요',
    mobileWidth: 360,
    mobileWidthEv: '관찰', // 휴대폰 UA·360px 실측: #contents2 360px·여백 0 (2026-11-25)
    mobile: 'same',
    // 모바일 상세는 max-height:1200px 로 접힌 채 시작 [관찰]
    fold: { over: 1200, mobile: 1200, ev: '관찰' },
    // 서버가 상세 앞에 <p align='center'>, 뒤에 빈 680px 표를 붙임 (44/44) [관찰]
    wrap: ["<div class=\"pf-area\"><p align='center'>", "<table width='680' border='0' cellpadding='0' cellspacing='0'><tr><td align='center'></td></tr></table></p></div>"],
    // m.compuzone.co.kr/css/product_detail.css (2026-11-18 판): .pr_detail_info_div img{display:block;width:100%;max-width:750px;height:auto;margin:0 auto}
    // PC: product_detail_new.css #contents .pdtl_dtlcont_wrap .pdtl_detail_img table{margin:0 auto} — img 폭 제한은 없음 (2026-11-25 재확인)
    skinPcCss: '.pf-area table{margin:0 auto}',
    // + .pr_detail_info_div{margin:0 auto;text-align:center} (2026-11-25 다시 확인 — 모바일 상세는 가운데 정렬이 기본)
    skinMobileCss: '.pf-area{margin:0 auto;text-align:center}.pf-area img{display:block;width:100%;max-width:750px;height:auto;margin:0 auto}',
    // 모바일 서버가 width:·width=·height: 글자를 지움 (15개 중 12개 재현, PC 44개는 멀쩡) [관찰]
    mobileTransform: (h) => h.replace(/width\s*:/gi, '').replace(/\bwidth\s*=/gi, '').replace(/height\s*:/gi, ''),
    mobileTransformNote: '모바일 서버가 width:·width=·height: 글자를 지웁니다 (style="max-width:768px" → "max-768px") [관찰]. line-height: 도 같이 망가지는지는 표본이 없어 미확인 — 미리보기는 같이 망가지는 쪽(최악)으로 보여 줍니다',
    ops: [
      { ...SCRIPT, ev: '추정' } as Op,
      ON_ATTR,
      {
        kind: 'check',
        find: (r) => [...r.querySelectorAll('[style],[width],[height]')].filter((e) => e.hasAttribute('width') || /(^|;)\s*(max-|min-)?(width|height)\s*:/i.test(e.getAttribute('style') ?? '')),
        what: '폭·높이 지정 — 컴퓨존 모바일 서버가 width·height 글자를 지워 모바일에서 무너짐 (나란히 놓은 칸이 위아래로 쌓임 등)',
        ev: '관찰',
        level: 'warn',
      },
      { ...STYLE_TAG('추정'), strict: true } as Op,
      ...STRICT_73,
    ],
    notes: [
      '공개된 상세 규격 문서는 없습니다 (협력사 영역 로그인 필요). 아래는 실제 상품 44개(모바일 15개)를 대조한 결과입니다 [관찰].',
      '모바일 서버가 width:·width=·height: 글자를 지웁니다 — PC 원본은 그대로인데 모바일에서 style="max-768px; 100%;" 처럼 바뀝니다. 폭·높이 지정 없이도 무너지지 않게 만드세요. 아래 모바일 미리보기에 같은 처리를 적용했습니다.',
      'PC 상세 영역은 1300px 이고 이미지 폭 제한이 없습니다. 서버가 상세를 <p align=center> 로 감싸고 뒤에 빈 680px 표를 붙입니다 — 상세가 <div> 로 시작하면 브라우저가 <p> 를 바로 닫아 가운데 정렬이 안 걸리니, 정렬은 직접 지정하세요 [관찰]. 모바일은 img 를 폭 100%(최대 750px)로 늘리고 lazyload 로 바꾸며 1,200px 로 접힙니다.',
    ],
  },
];

function esmOps(): Op[] {
  return [
    // ESM API 20·24·114 "iframe, Script, 및 max-width 등은 사용 불가" · 1.0 가이드 "Flash 와 Script, object 태그는 보안에 취약하여 사용하실 수 없습니다."
    { ...SCRIPT, what: '<script> — 사용 불가' } as Op,
    // 2.0 가이드 "iFrame, 다른상품링크, 팝업링크 모두 입력불가" (1.0 가이드는 ESM 호스팅·유튜브 iframe 예외 — 새 가이드 기준)
    { kind: 'tag', tags: ['iframe'], what: '<iframe> — 사용 불가', ev: '공식' },
    OBJECT_TAGS('공식'),
    ON_ATTR,
    // 공식은 "사용 불가"지만 실제로 지워지지는 않는다 — 판매자 HTML 의 img style "max-width: 100%" 가 그대로 남은 상품 확인 (G마켓 20개 중 1개, 2026-11-25) → 지우지 않고 경고만
    {
      kind: 'check',
      find: (r) => [...r.querySelectorAll('[style]')].filter((e) => /(^|;)\s*max-width\s*:/i.test(e.getAttribute('style') ?? '')),
      what: 'max-width — 공식 안내상 사용 불가 (실제로는 지워지지 않고 남은 상품도 있음 — 바깥 폭은 width 로)',
      ev: '공식',
      level: 'error',
    },
    // API 130 공지 "상품상세 내 이미지 url 변경 (http → https)"
    { kind: 'check', find: (r) => imageEls(r, (u) => /^http:\/\//i.test(u)), what: 'http 이미지 주소 — 상세 안 이미지는 https', ev: '공식', level: 'error' },
    { kind: 'check', find: (r) => [...r.querySelectorAll('a[href]')].filter((a) => /gmarket\.co\.kr|auction\.co\.kr/i.test(a.getAttribute('href') ?? '')), what: 'G마켓·옥션 상품 링크 — 다른 상품 링크는 입력 불가 (이 상품 링크인지 확인)', ev: '공식', level: 'warn' },
    // 모바일 가이드 "CSS 초기화 코드를 삭제해주세요. <style type="text/css"> * {margin: 0; padding: 0;} </style>" (2026-11-25 원문 재확인)
    { kind: 'check', find: (r) => [...r.querySelectorAll('style')].filter((e) => /(^|[},\s])\*\s*\{/.test(e.textContent ?? '')), what: '* { … } 전체 초기화 CSS — 모바일 가이드: CSS 초기화 코드를 삭제하라고 안내 (페이지 전체가 바뀜)', ev: '공식', level: 'warn' },
    // 모바일 가이드 "링크 사용시 A태그만 이용해주세요" (@import·window.open 불가)
    { kind: 'check', find: (r) => [...r.querySelectorAll('style')].filter((e) => /@import/i.test(e.textContent ?? '')), what: '@import — 모바일 가이드: 링크는 A 태그만', ev: '공식', level: 'warn' },
    // 모바일 가이드 "넓이 값에 영향을 주는 style(width, margin, padding)은 … %값(100% 미만)으로" "높이(height) 값은 삭제"
    {
      kind: 'check',
      find: (r) => [...r.querySelectorAll('[style]')].filter((e) => /(^|;)\s*(width|margin[\w-]*|padding[\w-]*)\s*:[^;]*\d+px|(^|;)\s*height\s*:/i.test(e.getAttribute('style') ?? '')),
      what: 'px 폭·여백·height — 모바일 가이드는 width·margin·padding 을 %(100% 미만)로, height 는 지우라고 권장',
      ev: '공식',
      level: 'warn',
    },
    ALT_CHECK('공식', 'alt 없는 이미지 — 가이드: "이미지 태그에 대체텍스트(alt값)을 넣어줍니다"'),
    { ...STYLE_TAG('추정'), strict: true } as Op,
    ...STRICT_73,
  ];
}

function esmNotes(width: string): string[] {
  return [
    `최대 가로 ${width} [공식 FAQ] — G마켓 상세 칸은 CSS 로 860px 고정·넘치면 잘림 [소스]. 세로 90,000px 이상 등록 불가 [공식]. 모바일은 "스크린샷(캡쳐이미지) 노출 없음… 항시 원본 그대로 노출" [공식].`,
    '"iframe, Script, 및 max-width 등은 사용 불가" [공식 API] — 다만 max-width 는 실제로 지워지지 않고 남은 상품이 있습니다 [관찰]. class 는 남습니다 (API 예시·ESM 에디터 출력) [소스]. G마켓 상품 20개 상세에서 <style> 블록은 하나도 보지 못했습니다 [관찰: 못 봄] — 인라인 style 로 만드세요.',
    '1:3 보다 긴 이미지·장당 10MB·최대 100장은 ESM 「이미지 업로드」 규칙입니다 — HTML 안 외부 이미지에도 적용되는지는 공식 문장이 없습니다. 이미지 용량은 화면에서 잴 수 없어 확인하지 않습니다.',
    'HTML 태그는 꼭 닫아야 합니다 — 안 닫으면 장바구니·구매 버튼이 안 보일 수 있음 [공식]. HTML 로 등록한 상세는 ESM Editor 로 바꿀 수 있지만 되돌릴 수 없습니다 [공식].',
  ];
}

export const editorOf = (id: string): EditorProfile => EDITORS.find((e) => e.id === id) ?? EDITORS[0];

// ───── 인라인 CSS 선언 다루기 (DOM 없이 — 단위 테스트) ─────

/** style 속성 값을 선언으로 나눈다. 괄호·따옴표 안의 ; 는 나누지 않는다 (url(data:…;base64,…) 등) */
export function splitDecls(style: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let cur = '';
  for (const c of style) {
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === ';' && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** test 가 참인 선언을 뺀 style 과 뺀 선언 목록 */
export function filterDecls(style: string, test: (prop: string, value: string) => boolean): { style: string; removed: string[] } {
  const keep: string[] = [];
  const removed: string[] = [];
  for (const d of splitDecls(style)) {
    const i = d.indexOf(':');
    const prop = (i < 0 ? d : d.slice(0, i)).trim();
    const value = i < 0 ? '' : d.slice(i + 1).trim();
    (test(prop.startsWith('--') ? prop : prop.toLowerCase(), value) ? removed : keep).push(d);
  }
  return { style: keep.join(';'), removed };
}

// ───── 저장 흉내 ─────

export interface SimChange {
  /** removed = 지워짐 · changed = 바뀜 · warn = 그대로지만 문제 · error = 그대로지만 규칙 위반 */
  level: 'removed' | 'changed' | 'warn' | 'error';
  what: string;
  ev: Evidence;
  /** 「지워질 수도 있는 것까지 미리 지워 보기」(공개 근거 없음)에서만 */
  strict?: boolean;
  count: number;
  samples: string[];
}

export interface SimResult {
  /** 저장 후 HTML (상품 페이지에 남는 것) */
  html: string;
  /** 미리보기용 — 바뀐 곳에 표시(data-pf-sim)가 붙은 HTML */
  annotated: string;
  changes: SimChange[];
  /** 모바일 보이기 — same = 같은 HTML · capture = PC 화면 캡처를 줄여 보임 · none = 모바일 미리보기 없음 (스마트스토어 iframe) */
  mobile: { mode: 'same' | 'capture' | 'none'; why: string };
}

const MARK = 'data-pf-sim';
const sample = (el: Element) => {
  const s = el.outerHTML.replace(/\s+/g, ' ');
  return s.length > 140 ? `${s.slice(0, 140)}…` : s;
};

/**
 * 붙여넣은 HTML 을 이 플랫폼 에디터에 저장했을 때의 모양 (브라우저 전용).
 * DOMParser 문서 안에서만 다룬다 — 화면 문서(document)의 요소로 옮기면 <img onerror> 같은 속성이 Pagefy 화면 권한으로 실행된다
 * (화면에 붙이지 않은 요소라도 이미지를 불러오고 이벤트 속성이 돈다, 2026-11-25 확인). DOMParser 문서는 스크립트·이미지 로딩이 없다
 */
export function simulate(input: string, p: EditorProfile, o: EditorOptions): SimResult {
  const doc = new DOMParser().parseFromString('<!doctype html><body><div id="pf-root"></div></body>', 'text/html');
  const root = doc.getElementById('pf-root') as HTMLElement;
  root.innerHTML = input;
  // 스마트스토어 모바일 판단(FAQ 13768)의 link 태그는 걸러지기 전 원문 기준
  const hadLink = !!root.querySelector('link');
  const changes: SimChange[] = [];
  const push = (c: Omit<SimChange, 'count' | 'samples'>, items: string[]) => {
    if (items.length) changes.push({ ...c, count: items.length, samples: items.slice(0, 3) });
  };
  const all = () => [root, ...root.querySelectorAll('*')] as Element[];

  for (const op of p.ops) {
    if ('strict' in op && op.strict && !o.strict) continue;
    if ((op.kind === 'tag' || op.kind === 'fn') && op.design && !o.designMode) continue;
    const base = { what: op.what, ev: op.ev, strict: 'strict' in op ? op.strict : undefined };
    if (op.kind === 'tag') {
      const hit = [...root.querySelectorAll(op.tags.join(','))].filter((el) => !op.keep?.(el));
      push({ ...base, level: 'removed' }, hit.map(sample));
      for (const el of hit) {
        if (!op.lucy) {
          el.remove();
          continue;
        }
        // Lucy: <!-- Not Allowed Tag Filtered --> + 원래 태그를 글자로 (화면에 코드가 글자로 보일 수 있음 — 11번가 실물에서 확인)
        const ph = doc.createElement('span');
        ph.setAttribute(MARK, `${el.tagName.toLowerCase()} 걸러짐 (글자로 보임)`);
        ph.setAttribute('data-pf-wrap', '');
        ph.append(doc.createComment(' Not Allowed Tag Filtered '), doc.createTextNode(el.outerHTML));
        el.replaceWith(ph);
      }
    } else if (op.kind === 'attr') {
      const items: string[] = [];
      for (const el of all()) {
        if (el === root) continue;
        for (const a of [...el.attributes]) {
          // data-pf-* 는 미리보기 표시용으로 Pagefy 가 붙인 것 — 플랫폼 규칙 대상이 아니다
          if (a.name.startsWith('data-pf-') || !op.test(a.name.toLowerCase(), el)) continue;
          items.push(`<${el.tagName.toLowerCase()} ${a.name}="${a.value.slice(0, 60)}">`);
          if (op.lucy) {
            // Lucy 는 요소 하나의 지운 속성을 주석 하나에 모아 적는다 (XssFilter.java BAD_ATT_INFO_START)
            const prev = el.previousSibling;
            const att = `${a.name}="${a.value.replace(/--/g, '- -')}"`;
            if (prev?.nodeType === 8 && (prev as Comment).data.startsWith(' Not Allowed Attribute Filtered (')) (prev as Comment).data = (prev as Comment).data.replace(/\) $/, ` ${att}) `);
            else el.before(doc.createComment(` Not Allowed Attribute Filtered ( ${att}) `));
          }
          el.removeAttribute(a.name);
          el.setAttribute(MARK, (el.getAttribute(MARK) ? `${el.getAttribute(MARK)} · ` : '') + `${a.name} 지워짐`);
        }
      }
      push({ ...base, level: 'removed' }, items);
    } else if (op.kind === 'unlink') {
      const hit = [...root.querySelectorAll('a[href]')].filter((a) => {
        const href = a.getAttribute('href') ?? '';
        if (/^(#|mailto:|tel:)/i.test(href)) return false;
        const h = hostOf(href);
        return !!h && h !== 'x.invalid' && (!!op.deny?.test(h) || !op.allow.test(h));
      });
      push({ ...base, level: 'removed' }, hit.map(sample));
      for (const a of hit) {
        const span = doc.createElement('span');
        span.setAttribute(MARK, `링크 지워짐: ${a.getAttribute('href')}`);
        span.setAttribute('data-pf-unlink', '');
        span.append(...a.childNodes);
        a.replaceWith(span);
      }
    } else if (op.kind === 'css') {
      const items: string[] = [];
      for (const el of root.querySelectorAll('[style]')) {
        const r = filterDecls(el.getAttribute('style') ?? '', op.test);
        if (!r.removed.length) continue;
        items.push(...r.removed.map((d) => `<${el.tagName.toLowerCase()}> ${d}`));
        if (r.style) el.setAttribute('style', r.style);
        else el.removeAttribute('style');
        el.setAttribute(MARK, (el.getAttribute(MARK) ? `${el.getAttribute(MARK)} · ` : '') + `CSS 지워짐: ${r.removed.join('; ').slice(0, 120)}`);
      }
      push({ ...base, level: 'removed' }, items);
    } else if (op.kind === 'base64') {
      const hit = imgs(root).filter((i) => /^data:/i.test(i.getAttribute('src') ?? ''));
      push({ ...base, level: 'removed' }, hit.map((i) => `<img src="${(i.getAttribute('src') ?? '').slice(0, 40)}…">`));
      for (const i of hit) {
        const ph = doc.createElement('span');
        ph.setAttribute(MARK, 'base64 이미지 지워짐');
        ph.setAttribute('data-pf-ph', '');
        ph.textContent = '[이미지 지워짐]';
        i.replaceWith(ph);
      }
    } else if (op.kind === 'allowlist') {
      const ok = new Set(op.tags);
      const hit = [...root.querySelectorAll('*')].filter((el) => !ok.has(el.tagName.toLowerCase()));
      push({ ...base, level: 'removed' }, hit.map(sample));
      for (const el of hit) {
        if (!el.isConnected) continue;
        if (op.drop.includes(el.tagName.toLowerCase())) el.remove();
        else {
          // 태그만 벗기고 안의 글자·요소는 남긴다
          const ph = doc.createElement('span');
          ph.setAttribute(MARK, `<${el.tagName.toLowerCase()}> 태그 벗겨짐`);
          ph.setAttribute('data-pf-wrap', '');
          ph.append(...el.childNodes);
          el.replaceWith(ph);
        }
      }
    } else if (op.kind === 'fn') {
      push({ ...base, level: op.level }, op.run(root, doc));
    } else if (op.kind === 'gif') {
      const hit = imgs(root).filter((i) => isGif(i.getAttribute('src') ?? ''));
      push({ ...base, level: 'changed' }, hit.map(sample));
      hit.forEach((i) => i.setAttribute(MARK, 'GIF → 정지 이미지'));
      hit.forEach((i) => i.setAttribute('data-pf-gif', ''));
    } else {
      const hit = op.find(root);
      push({ ...base, level: op.level ?? 'warn' }, hit.map(sample));
      hit.forEach((el) => el.setAttribute(MARK, (el.getAttribute(MARK) ? `${el.getAttribute(MARK)} · ` : '') + op.what.split(' — ')[0]));
    }
  }

  if (p.maxBytes) {
    const bytes = new TextEncoder().encode(input).length;
    if (bytes > p.maxBytes.bytes) push({ what: p.maxBytes.what, ev: p.maxBytes.ev, level: 'error' }, [`${(bytes / 1024 / 1024).toFixed(1)}MB`]);
  }

  const annotated = root.innerHTML;
  // 저장 후 HTML = 표시를 뗀 것 (자리 표시 글자는 빼고, GIF 표시도 뗀다)
  root.querySelectorAll('[data-pf-ph]').forEach((el) => el.remove());
  // 표시용으로 감싼 span 은 벗긴다 (안의 주석·글자·요소는 남김)
  root.querySelectorAll('[data-pf-wrap]').forEach((el) => el.replaceWith(...el.childNodes));
  // 링크를 푼 자리의 span 은 글자만 남긴다
  root.querySelectorAll('[data-pf-unlink]').forEach((el) => el.replaceWith(...el.childNodes));
  root.querySelectorAll(`[${MARK}]`).forEach((el) => {
    el.removeAttribute(MARK);
    el.removeAttribute('data-pf-gif');
  });
  return { html: root.innerHTML.trim(), annotated, changes, mobile: mobileMode(p, root, hadLink) };
}

/** 모바일에서 어떻게 보이는지 — 스마트스토어 FAQ 13768 · 11번가 옛 매뉴얼 */
function mobileMode(p: EditorProfile, root: HTMLElement, hadLink: boolean): SimResult['mobile'] {
  if (p.mobile === 'capture') return { mode: 'capture', why: '11번가 옛 매뉴얼: 모바일 상세설명 이미지를 따로 올리지 않으면 상세 페이지를 이미지로 저장해 보여 줌 [공식·오래됨]' };
  if (p.mobile !== 'smartstore') return { mode: 'same', why: '' };
  if (root.querySelector('iframe')) return { mode: 'none', why: 'iframe 이 있어 모바일 미리보기가 만들어지지 않습니다 [공식, FAQ 13768] — 모바일에서 어떻게 보이는지는 공식 설명이 없어 원본으로 보여 줍니다' };
  const why = [hadLink && 'link 태그', root.querySelector('table') && 'table 태그', imageEls(root, (u) => /^https?:/i.test(u)).length && '외부 이미지'].filter(Boolean).join('·');
  if (why) return { mode: 'capture', why: `${why}가 있어 PC 화면을 캡처한 모바일 미리보기로 보입니다 [공식, FAQ 13768] — 글자가 작아지고 GIF 는 움직이지 않습니다` };
  return { mode: 'same', why: '원본 그대로 노출됩니다 [공식, FAQ 13768]. HTML 글자 크기는 무시되고 모바일용으로 고정됩니다 [공식] — 고정 크기는 공개되지 않아 기본 크기로 보여 줍니다 (추정)' };
}

/** 미리보기 문서 — 쇼핑몰 상세 영역 감싸개 + 스킨 CSS 안에 저장 후 HTML 을 넣는다 */
export function previewDoc(html: string, p: EditorProfile, opt: { mobile: boolean; marks: boolean; fixedFont?: boolean }) {
  const area = opt.mobile ? p.mobileWidth : p.pcWidth;
  const pad = opt.mobile ? Math.max(0, (360 - area) / 2) : 0;
  const marks = opt.marks
    ? `[${MARK}]{outline:2px dashed #e5484d!important;outline-offset:-1px}[data-pf-ph]{display:inline-block;padding:2px 6px;background:#fff0f0;color:#ce2c31;font:12px/1.4 sans-serif}`
    : '[data-pf-ph]{display:none}';
  // 모바일 글자 크기 고정(스마트스토어): 고정 크기가 공개되지 않아 인라인 font-size 를 무시한 기본 크기로 보여 준다
  const fixed = opt.fixedFont ? '.pf-area *{font-size:revert!important}' : '';
  // 미리보기는 스크롤 상자 안 iframe 이라 lazy 이미지가 빈칸으로 남는다 → 미리보기에서만 바로 불러온다
  const raw = opt.mobile && p.mobileTransform ? p.mobileTransform(html) : html;
  // 쇼핑몰이 붙이는 감싸개도 같은 서버를 거친다 (컴퓨존 모바일: 빈 680px 표가 <table "680"> 으로 나옴)
  const wrap = opt.mobile && p.mobileTransform ? p.wrap.map(p.mobileTransform) : p.wrap;
  const body = raw.replace(/loading="lazy"/g, 'loading="eager"');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<style>html,body{margin:0;background:#fff}body{padding:0 ${pad}px;font:14px/1.5 'Malgun Gothic','Apple SD Gothic Neo',sans-serif;color:#333;word-break:keep-all}
.pf-shell{width:${area}px;max-width:100%;margin:0 auto}${p.skinCss ?? ''}${opt.mobile ? (p.skinMobileCss ?? '') : (p.skinPcCss ?? '')}${marks}${fixed}</style></head>
<body><div class="pf-shell">${wrap[0]}${body}${wrap[1]}</div></body></html>`;
}
