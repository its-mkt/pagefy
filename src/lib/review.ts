// 변환 뒤 「마크업 재검증」 3단계 (2026-11-27 사용자 지시) — 만든 마크업만 보고 규칙대로 됐는지 따로 다시 본다.
//   1단계 규칙·플랫폼: 7-1 공통 · 7-2 고도몰 · 7-3/7-3-1/7-4 오픈마켓 플랫폼별 (+ 브라우저에서는 그 플랫폼 에디터 흉내 결과)
//   2단계 SEO·GEO·AEO·alt·마크업: 8-2·8-3·8-4 (제목 구조·alt·핵심 사실·속도 속성·숨긴 글자) + 태그 짝·중복 id 등 마크업 짜임
//   3단계 PSD 레이어 대응: 텍스트 레이어마다 HTML 글자/alt/이미지에 남김/빠짐을 가르고, 텍스트가 이미지가 된 곳과 사유를 본다 (4절·9절 4항)
// 자동 점검(output.ts checkOutput)과 겹치는 항목도 있지만, 여기서는 생성 코드와 상관없이 결과 HTML 을 처음부터 다시 읽는다.
// DOM 없이 문자열로만 읽는다 (Node 테스트에서도 돈다). 에디터 흉내(simulate)는 브라우저에서 넘겨줄 때만 쓴다
import type { GenerateMeta, Plan, PsdSummary, ReviewRequest, TextInfo } from '../../shared/types';
import { godoCap, godoMaxWidth } from '../../shared/width';
import { MARKETS, normMarket } from '../../shared/markets';
import type { LayoutResult } from './layoutCheck';
import type { SimResult } from './editorSim';
import { COPY_END, COPY_START, copySection } from './output';

export type ReviewLevel = 'error' | 'warn' | 'info' | 'ok';

export interface ReviewFinding {
  level: ReviewLevel;
  message: string;
  /** 해당 글자·태그 예시 (최대 몇 개) */
  samples?: string[];
}

export type ReviewKey = 'rules' | 'seo' | 'layers';

export interface ReviewPass {
  key: ReviewKey;
  title: string;
  /** 이 단계에서 본 것 (한 줄) */
  scope: string;
  findings: ReviewFinding[];
  /** 요약 수치 (예: 「h2 13 · h3 6 · 이미지 52」) */
  stats: string;
}

export interface ReviewInput {
  /** 완성 HTML (복사 구간 주석 포함) — 손으로 고친 복사 구간만 있어도 된다 */
  html: string;
  summary: PsdSummary;
  plan: Plan;
  meta: GenerateMeta;
  baseUrl: string;
  /** 이미지에 남긴 텍스트 레이어 id → 사유 (codegen keepMap) */
  kept: Map<number, string>;
  layout?: LayoutResult;
  /** 그 플랫폼 에디터에 저장했을 때의 흉내 (브라우저에서만) */
  sim?: SimResult;
}

export const REVIEW_STEPS: { key: ReviewKey; title: string; scope: string }[] = [
  { key: 'rules', title: '규칙·플랫폼', scope: '공통 금지 태그·이미지 주소, 고도몰(접두사·폭·h3 금지·선택 막기) / 오픈마켓 플랫폼별 제약, 에디터 저장 흉내' },
  { key: 'seo', title: 'SEO·GEO·AEO·alt·마크업', scope: '제목 단계·섹션별 h2, alt 품질, 핵심 수치 글자 여부, 속도 속성, 숨긴 글자, 태그 짝·중복 id' },
  { key: 'layers', title: 'PSD 레이어 대응', scope: '텍스트 레이어마다 HTML 글자·alt·이미지에 남김·빠짐, 이미지가 된 글자의 사유, 위치 대조, 레이어 종류별 처리' },
];

// ───── 문자열 도우미 ─────

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#160': ' ' };
const decode = (s: string) => s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => ENT[e.toLowerCase()] ?? (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : m));
const squash = (s: string) => s.replace(/\s+/g, '');
const short = (s: string, n = 24) => (s.length > n ? `${s.slice(0, n)}…` : s);
const firstLine = (t: TextInfo) => t.lines.find((l) => l.trim())?.trim() ?? t.text.trim();
const stripStyle = (s: string) => s.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
/** 태그를 빼고 화면에 보이는 글자만 (alt 제외) */
const visibleText = (s: string) => decode(stripStyle(s).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '));
const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? decode(m[2] ?? m[3] ?? '') : null;
};

interface ImgTag {
  tag: string;
  src: string;
  alt: string | null;
  /** <h2>~<h4> 또는 role=heading 안에 있음 */
  inHeading: boolean;
}

function imgTags(copy: string): ImgTag[] {
  // 제목 위치는 <style>·주석을 뺀 글에서 재므로 이미지도 같은 글에서 찾는다
  const heads = headingSpans(copy);
  return [...stripStyle(copy).matchAll(/<img\b[^>]*>/gi)].map((m) => ({
    tag: m[0],
    src: attr(m[0], 'src') ?? '',
    alt: attr(m[0], 'alt'),
    inHeading: heads.some((h) => m.index! >= h.start && m.index! < h.end),
  }));
}

interface Heading {
  level: number;
  /** 글자 + 안에 든 이미지 alt */
  text: string;
  start: number;
  end: number;
  role: boolean;
}

/** 문서 순서대로 제목 (<h1>~<h6> 와 role="heading" aria-level) */
function headingSpans(copy: string): Heading[] {
  const out: Heading[] = [];
  const body = stripStyle(copy);
  for (const m of body.matchAll(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)) out.push({ level: +m[1][1], text: headingText(m[2]), start: m.index!, end: m.index! + m[0].length, role: false });
  for (const m of body.matchAll(/<([a-z]+)\b([^>]*\brole\s*=\s*"heading"[^>]*)>([\s\S]*?)<\/\1\s*>/gi)) {
    const lv = Number(/aria-level\s*=\s*"(\d)"/i.exec(m[2])?.[1] ?? 2);
    out.push({ level: lv, text: headingText(m[3]), start: m.index!, end: m.index! + m[0].length, role: true });
  }
  return out.sort((a, b) => a.start - b.start);
}
const headingText = (inner: string) => [visibleText(inner), ...[...inner.matchAll(/<img\b[^>]*>/gi)].map((m) => attr(m[0], 'alt') ?? '')].join(' ').replace(/\s+/g, ' ').trim();

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const BLOCK = new Set(['div', 'section', 'article', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'dl', 'table', 'figure', 'header', 'footer', 'aside', 'nav', 'blockquote', 'pre']);

/** 태그 짝 맞춤 — 닫히지 않은 태그·엇갈린 닫힘·<p> 안의 블록 태그 */
function tagBalance(copy: string) {
  const body = stripStyle(copy);
  const stack: string[] = [];
  const mismatched: string[] = [];
  const blockInP: string[] = [];
  for (const m of body.matchAll(/<(\/?)([a-zA-Z][\w-]*)\b[^>]*?(\/?)>/g)) {
    const [, close, raw, self] = m;
    const name = raw.toLowerCase();
    if (VOID.has(name) || self) continue;
    if (!close) {
      if (BLOCK.has(name) && stack[stack.length - 1] === 'p') blockInP.push(`<p> 안의 <${name}>`);
      stack.push(name);
      continue;
    }
    const at = stack.lastIndexOf(name);
    if (at < 0) {
      mismatched.push(`짝 없는 </${name}>`);
      continue;
    }
    if (at !== stack.length - 1) mismatched.push(`<${stack[stack.length - 1]}> 가 닫히기 전에 </${name}>`);
    stack.length = at;
  }
  return { unclosed: stack, mismatched, blockInP };
}

/** 사진 속 수치처럼 「핵심 사실」로 볼 숫자+단위 (8-2 4항) */
const FACT_RE = /\d+(?:[.,]\d+)?\s?(?:TB|GB|MB|PB|GHz|MHz|Hz|Gbps|Mbps|TOPS|TFLOPS|PFLOPS|mAh|Wh|kg|mm|cm|nm|inch|인치|nits|fps|W|V|g|코어|core|형)(?![a-zA-Z가-힣])/gi;
const facts = (s: string) => [...new Set([...s.matchAll(FACT_RE)].map((m) => m[0].replace(/\s+/g, '')))];

const GENERIC_ALT = /^(이미지|사진|그림|배경|image|img|photo|picture|banner|배너|상세|상세이미지|상세 이미지)\s*\d*$/i;
const FILE_ALT = /\.(jpe?g|png|gif|webp|svg)\b|^s\d{2}_/i;

/** alt 안에서 같은 낱말을 4번 넘게 되풀이 (키워드 나열 의심, 8-2 6항·9항) */
function stuffed(alt: string) {
  const words = alt.split(/[\s,·/|]+/).filter((w) => w.length >= 2);
  if (words.length < 8) return null;
  const n = new Map<string, number>();
  for (const w of words) n.set(w, (n.get(w) ?? 0) + 1);
  const [w, c] = [...n].sort((a, b) => b[1] - a[1])[0];
  return c >= 4 && c / words.length > 0.25 ? w : null;
}

// ───── 1단계: 규칙·플랫폼 ─────

function reviewRules(x: ReviewInput, copy: string): ReviewPass {
  const f: ReviewFinding[] = [];
  const add = (level: ReviewLevel, message: string, samples?: string[]) => f.push({ level, message, samples: samples?.slice(0, 5) });
  const openmarket = x.meta.channel === 'openmarket';
  const market = normMarket(x.meta.market);
  const spec = MARKETS[market];
  const body = stripStyle(copy);
  const imgs = imgTags(copy);

  // 7-1 공통
  if (!x.html.includes(COPY_START) || !x.html.includes(COPY_END)) add('info', '복사 구간 표시(▼▼▼/▲▲▲)가 없어 전체를 복사 구간으로 보고 검토했습니다');
  const banned: [RegExp, string][] = [
    [/<h1[\s>]/i, '<h1> (8-2: 쇼핑몰 상품명 h1 과 겹침)'],
    [/<script[\s>]/i, '<script> (7-1 금지)'],
    [/<iframe[\s>]/i, '<iframe> (7-1 금지)'],
    [/<form[\s>]|<input[\s>]|<button[\s>]/i, '<form>·입력칸 (7-1 금지)'],
    [/\son[a-z]+\s*=/i, 'onclick 같은 이벤트 속성 (쇼핑몰 에디터가 지움)'],
    [/position\s*:\s*(absolute|fixed)/i, 'position:absolute/fixed (5절·7-1 금지)'],
    [/naver\.me|bit\.ly|han\.gl|goo\.gl/i, '외부 단축 URL (7-1 금지)'],
  ];
  for (const [re, what] of banned) if (re.test(body)) add('error', `금지 항목: ${what}`);

  // 이미지 주소 (6절·7-3-1 4항)
  const data = imgs.filter((i) => /^data:/i.test(i.src));
  const rel = imgs.filter((i) => i.src && !/^(https?:)?\/\//i.test(i.src) && !/^data:/i.test(i.src));
  const http = imgs.filter((i) => /^http:\/\//i.test(i.src));
  const other = imgs.filter((i) => /^https:\/\//i.test(i.src) && !i.src.startsWith(`${x.baseUrl}/`));
  const bgUrls = [...body.matchAll(/url\(\s*['"]?([^'")]+)/gi)].map((m) => m[1]);
  if (data.length) add('error', `base64(data:) 이미지 ${data.length}개 — 스마트스토어 등이 지움. https 절대주소만 (7-3-1 4항)`);
  if (rel.length) add('error', `상대 경로 이미지 ${rel.length}개 — 붙여넣으면 깨짐`, rel.map((i) => i.src));
  if (http.length) add('error', `http:// 이미지 ${http.length}개 — https 만 (쇼핑몰이 막음)`, http.map((i) => i.src));
  if (other.length) add('warn', `이 작업의 이미지 폴더(${x.baseUrl}/) 밖 이미지 ${other.length}개`, other.map((i) => i.src));
  if (bgUrls.some((u) => !/^https:\/\//i.test(u))) add('error', 'CSS 배경 이미지에 https 가 아닌 주소가 있음', bgUrls.filter((u) => !/^https:\/\//i.test(u)));

  if (!openmarket) {
    // 7-2 고도몰
    const prefix = x.plan.prefix;
    if (!/<style[\s>]/i.test(copy)) add('error', '고도몰인데 <style> 이 없음 — 7-2: <style> + 고유 접두사 class');
    const classes = [...body.matchAll(/\sclass\s*=\s*"([^"]*)"/gi)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean);
    const foreign = [...new Set(classes.filter((c) => prefix && !c.startsWith(prefix)))];
    if (foreign.length) add('warn', `접두사(${prefix})로 시작하지 않는 class ${foreign.length}종 — 스킨 class 와 겹칠 수 있음 (7-2)`, foreign);
    const ids = [...body.matchAll(/\sid\s*=\s*"([^"]*)"/gi)].map((m) => m[1]);
    const foreignId = ids.filter((i) => prefix && !i.startsWith(prefix));
    if (foreignId.length) add('warn', `접두사로 시작하지 않는 id ${foreignId.length}개 (8-2 2항)`, foreignId);
    const css = [...copy.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
    const selectors = [...css.replace(/@(import|charset)[^;]*;/gi, '').replace(/@font-face\s*\{[^}]*\}/gi, '').replace(/@keyframes[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/gi, '')
      // @supports·@media 같은 감싸는 규칙은 머리(조건)만 지우고 안쪽 규칙은 그대로 본다 — 남는 } 는 아래 정규식이 무시
      .replace(/@[a-z-]+[^{;]*\{/gi, '')
      .matchAll(/([^{}@]+)\{[^}]*\}/g)]
      .flatMap((m) => m[1].split(','))
      .map((s) => s.trim())
      .filter((s) => s && !/^(from|to|\d+%)$/.test(s));
    const unscoped = selectors.filter((s) => prefix && !s.includes(`.${prefix}`) && !s.includes(`#${prefix}`));
    if (unscoped.length) add('error', `상세 영역 밖까지 걸리는 CSS 선택자 ${unscoped.length}개 — 접두사 class 안으로만 (7-2)`, unscoped);
    const hn = (body.match(/<h[3-6][\s>]/gi) || []).length;
    if (hn) add('error', `<h3>~<h6> ${hn}개 — 아이티켓 스킨이 상세 영역 h3 를 숨김. 소제목은 <p role="heading" aria-level="3"> (7-2-1)`);
    const cap = godoCap(x.meta.target);
    const maxW = godoMaxWidth(x.summary.width, x.meta.target);
    const widths = [...copy.matchAll(/max-width\s*:\s*(\d+(?:\.\d+)?)px/gi)].map((m) => +m[1]);
    if (!widths.includes(maxW)) add('warn', `최상위 max-width:${maxW}px 가 없음 (7-2, ${x.meta.target === 'board' ? '게시판 본문' : '상세 영역'} 최대 ${cap}px)`);
    if (widths.some((w) => w > cap)) add('error', `max-width ${Math.max(...widths)}px — 고도몰 ${x.meta.target === 'board' ? '게시판 본문' : '상세 영역'} ${cap}px 넘음 (7-2)`);
    if (!/user-select\s*:\s*none\s*!important/i.test(copy)) add('warn', '글자 선택 막기(user-select:none!important) 없음 (7-6)');
    if (/@media\b[^{]*\b(max|min)-width/i.test(copy)) add('warn', '@media 폭 조건 — 7-5: 휴대폰도 비율 축소만');
    // 섹션 묶음 (8-2 2항): aria-labelledby 가 가리키는 id 가 있어야 한다
    const labelled = [...body.matchAll(/aria-labelledby\s*=\s*"([^"]+)"/gi)].map((m) => m[1]);
    const lost = labelled.filter((l) => !ids.includes(l));
    if (lost.length) add('error', `aria-labelledby 가 가리키는 제목 id 가 없음 ${lost.length}곳 (8-2 2항)`, lost);
    if (!/<section\b/i.test(body)) add('warn', '<section> 묶음이 없음 — 고도몰은 섹션마다 <section aria-labelledby> (8-2 2항)');
  } else {
    // 7-3·7-3-1·7-4 오픈마켓
    if (/<style[\s>]/i.test(copy)) add('error', `${spec.label}: <style> — 오픈마켓은 인라인 style 만 (7-3)`);
    if (/<link[\s>]|@import/i.test(copy)) add('error', `${spec.label}: <link>·@import — 지워짐 (7-3)`);
    if (/var\(--/i.test(body)) add('error', `${spec.label}: CSS 변수(var) — 지워지면 크기·색이 사라짐 (7-3-1 3항)`);
    if (/\b(calc|min|max|clamp)\(/i.test(body)) add('warn', `${spec.label}: calc()/min()/max() — 에디터가 지울 수 있음 (7-3-1 3항)`);
    if (/@media|@container/i.test(body)) add('error', `${spec.label}: @media — 인라인에서는 쓸 수 없음 (7-3)`);
    if (/background-clip\s*:\s*text/i.test(body)) add('warn', `${spec.label}: background-clip:text — 지워지면 글자가 사라짐 (7-3-1 3항)`);
    if (/margin(-top|-left|-right|-bottom)?\s*:\s*[^;"]*-\d/i.test(body)) add('warn', `${spec.label}: 음수 여백 — 지워지면 겹침이 풀려 어긋남 (7-3-1 3항)`);
    const links = (body.match(/<a\b/gi) || []).length;
    if (links) add('warn', `${spec.label}: 링크 <a> ${links}개 — 스마트스토어·11번가·롯데온이 외부 링크를 지움 (7-3-1 5항)`);
    if (/<details[\s>]/i.test(body)) add('error', `${spec.label}: <details> — 오픈마켓에서 지워지고 내용이 숨겨짐 (8-3 3항)`);
    if (spec.rules?.noTable && /<table[\s>]/i.test(body)) add('error', `${spec.label}: <table> — 모바일 미리보기가 안 됨 (7-3-1 6항)`);
    if (spec.rules?.noMaxWidth && /max-width/i.test(body)) add('error', `${spec.label}: max-width — ESM 은 사용 불가 [공식] (7-3)`);
    if (spec.rules?.maxImgRatio) {
      const long = x.plan.images.filter((im) => im.x1 > im.x0 && (im.y1 - im.y0) / (im.x1 - im.x0) > spec.rules!.maxImgRatio!);
      if (long.length) add('error', `${spec.label}: 세로가 가로의 ${spec.rules.maxImgRatio}배 넘는 이미지 ${long.length}장 (7-3)`, long.map((i) => i.file));
      if (imgs.length > 100) add('warn', `${spec.label}: 이미지 ${imgs.length}장 — ESM 최대 100장`);
    }
    if (spec.width) {
      const wide = [...body.matchAll(/(?:^|[;"\s])(?:max-)?width\s*:\s*(\d+(?:\.\d+)?)px/gi)].map((m) => +m[1]).filter((w) => w > spec.width! + 0.5);
      if (wide.length) add('error', `${spec.label}: 폭 ${Math.max(...wide)}px — 플랫폼 폭 ${spec.width}px 넘음 (7-4)`);
    }
    const gifs = imgs.filter((i) => /\.gif(\?|#|$)/i.test(i.src));
    if (gifs.length) add('warn', `${spec.label}: GIF ${gifs.length}개 — 쿠팡은 jpg 로 바꿔 첫 장면만 남음 (7-3-1 4항)`);
    if (/\sclass\s*=/i.test(body) && !/style\s*=/i.test(body)) add('warn', `${spec.label}: class 만 있고 인라인 style 이 없음 — class 에 기대면 안 됨 (7-3)`);
  }

  // 에디터 저장 흉내 (에디터 테스트와 같은 표) — 지워지거나 바뀌는 것
  if (x.sim) {
    for (const c of x.sim.changes.filter((c) => !c.strict && (c.level === 'removed' || c.level === 'error'))) {
      add(c.level === 'error' ? 'error' : 'warn', `${openmarket ? spec.label : '고도몰'} 에디터에 저장하면 ${c.level === 'removed' ? '지워짐' : '규칙 위반'}: ${c.what} (${c.count}곳 · 근거 ${c.ev})`, c.samples);
    }
    const changed = x.sim.changes.filter((c) => !c.strict && c.level === 'changed');
    if (changed.length) add('info', `에디터가 바꾸는 것 ${changed.length}종: ${changed.map((c) => c.what).slice(0, 4).join(' · ')} — 화면은 「쇼핑몰 미리보기」에서 확인`);
  }
  if (!f.some((i) => i.level === 'error' || i.level === 'warn')) add('ok', `${openmarket ? `${spec.label} 오픈마켓` : '고도몰'} 규칙 위반 없음`);
  return { ...REVIEW_STEPS[0], findings: f, stats: `${openmarket ? spec.label : '고도몰'} · 이미지 ${imgs.length}개${x.sim ? ' · 에디터 흉내 포함' : ''}` };
}

// ───── 2단계: SEO·GEO·AEO·alt·마크업 ─────

function reviewSeo(x: ReviewInput, copy: string): ReviewPass {
  const f: ReviewFinding[] = [];
  const add = (level: ReviewLevel, message: string, samples?: string[]) => f.push({ level, message, samples: samples?.slice(0, 5) });
  const openmarket = x.meta.channel === 'openmarket';
  const body = stripStyle(copy);
  const heads = headingSpans(copy);
  const imgs = imgTags(copy);

  // 제목 구조 (8-2 1항·8-4)
  const h2 = heads.filter((h) => h.level === 2);
  const h1 = heads.filter((h) => h.level === 1);
  if (h1.length) add('error', `<h1> ${h1.length}개 — 쇼핑몰 상품명 h1 과 겹침 (8-2 1항)`);
  if (!h2.length) add('error', '<h2> 가 하나도 없음 — 검색·AI 가 섹션 주제를 못 읽음 (8-2 1항)');
  if (heads.length && heads[0].level > 2) add('warn', `첫 제목이 h${heads[0].level} — 섹션 대제목 h2 부터 (8-2 1항)`, [heads[0].text]);
  const skips: string[] = [];
  for (let i = 1; i < heads.length; i++) if (heads[i].level > heads[i - 1].level + 1) skips.push(`h${heads[i - 1].level} → h${heads[i].level} 「${short(heads[i].text)}」`);
  if (skips.length) add('warn', `제목 단계를 건너뜀 ${skips.length}곳 (h2 다음 h4 금지, 8-2 1항)`, skips);
  const empty = heads.filter((h) => !h.text.trim());
  if (empty.length) add('error', `글자도 alt 도 없는 빈 제목 ${empty.length}개 (8-4)`);
  // 섹션 하나 = 주제 하나 (8-3 1항): 섹션 수와 h2 수
  const secCount = x.plan.sections.length;
  if (h2.length && h2.length < secCount) add('warn', `섹션 ${secCount}개 중 h2 가 ${h2.length}개 — 대제목 없는 섹션이 있음 (8-3 1항: 섹션마다 h2 하나)`);
  const longH = heads.filter((h) => h.text.length > 80);
  if (longH.length) add('warn', `80자 넘는 제목 ${longH.length}개 — 본문이 제목 태그에 들어갔을 수 있음`, longH.map((h) => short(h.text, 40)));

  // alt (8-2 6항)
  const noAlt = imgs.filter((i) => i.alt == null);
  if (noAlt.length) add('error', `alt 속성 없는 <img> ${noAlt.length}개 (8-4)`, noAlt.map((i) => i.src.split('/').pop() ?? ''));
  const emptyIn = imgs.filter((i) => i.alt === '' && i.inHeading);
  if (emptyIn.length) add('error', `제목 안 이미지인데 alt 가 비어 있음 ${emptyIn.length}개 — 제목이 빈칸이 됨`);
  const emptyAlt = imgs.filter((i) => i.alt === '' && !i.inHeading);
  // 오픈마켓은 모든 이미지에 alt 를 요구하는 플랫폼이 있다 (7-3-1 1-1항)
  if (openmarket && emptyAlt.length) add('warn', `alt 가 빈 이미지 ${emptyAlt.length}개 — 11번가·G마켓·롯데온은 모든 이미지에 alt 를 요구 (7-3-1 1-1항)`);
  const generic = imgs.filter((i) => i.alt && GENERIC_ALT.test(i.alt.trim()));
  if (generic.length) add('warn', `뜻 없는 alt(「이미지」「사진」 등) ${generic.length}개 — 보이는 것을 구체적으로 (8-2 6항)`, generic.map((i) => i.alt!));
  const fileAlt = imgs.filter((i) => i.alt && FILE_ALT.test(i.alt));
  if (fileAlt.length) add('error', `파일 이름이 alt 로 들어감 ${fileAlt.length}개 (8-2 6항)`, fileAlt.map((i) => i.alt!));
  const stuff = imgs.map((i) => i.alt && stuffed(i.alt)).filter(Boolean) as string[];
  if (stuff.length) add('warn', `alt 에 같은 낱말 되풀이(키워드 나열 의심) ${stuff.length}개 (8-2 6항·9항)`, stuff);
  if (!openmarket) {
    // 고도몰은 사진 alt 가 사진마다 달라야 (같은 alt 여러 장 = 키워드 반복)
    const alts = imgs.map((i) => i.alt?.trim()).filter((a): a is string => !!a);
    const dup = [...new Set(alts.filter((a, i) => alts.indexOf(a) !== i))];
    if (dup.length) add('warn', `같은 alt 를 여러 이미지에 씀 ${dup.length}종 — 같은 문구 반복 금지 (8-2 6항)`, dup.map((a) => short(a, 30)));
  }

  // 제품 정식 이름 (8-2 8항) — 글자나 alt 어디엔가 있어야 AI 가 무엇의 정보인지 안다
  const text = visibleText(copy);
  const altAll = imgs.map((i) => i.alt ?? '').join(' ');
  const name = x.meta.productName.trim();
  if (name && !squash(text + altAll).toLowerCase().includes(squash(name).toLowerCase())) add('info', `제품명 「${name}」이 글자·alt 어디에도 그대로 없음 — PSD 표기가 다르면 괜찮음 (8-2 8항: 같은 이름으로 통일)`);

  // 핵심 수치는 글자로 (8-2 4항) — 고도몰만 (오픈마켓은 섹션 이미지 방식이라 alt 로만 전달, 7-3-1 1항)
  const kept = x.summary.texts.filter((t) => x.kept.has(t.id));
  const keptFacts = [...new Set(kept.flatMap((t) => facts(t.text)))];
  const textFacts = new Set(facts(text).map((s) => s.toLowerCase()));
  if (!openmarket) {
    const onlyImg = keptFacts.filter((s) => !textFacts.has(s.toLowerCase()));
    if (onlyImg.length) add('warn', `이미지(alt)에만 있는 핵심 수치 ${onlyImg.length}개 — 모델·용량·크기 같은 수치는 HTML 글자로 (8-2 4항)`, onlyImg);
  } else if (keptFacts.length) add('info', `핵심 수치 ${keptFacts.length}개는 섹션 이미지 alt 로만 전달됩니다 (오픈마켓 방식, 7-3-1 1항)`);

  // 글자 노출 비율 — 검색·AI 가 읽는 실제 글자
  const psdChars = squash(x.summary.texts.map((t) => t.text).join('')).length;
  const htmlChars = squash(text).length;
  const ratio = psdChars ? Math.min(1, htmlChars / psdChars) : 1;
  if (!openmarket && psdChars && ratio < 0.7) add('warn', `PSD 글자의 ${Math.round(ratio * 100)}% 만 HTML 글자로 나옴 — 나머지는 이미지·alt (8-2 3항)`);

  // 속도 (8-2 11항)
  const noSize = imgs.filter((i) => !/\swidth\s*=/.test(i.tag));
  if (noSize.length) add('warn', `width 속성 없는 <img> ${noSize.length}개 (화면 밀림, 8-2 11항)`);
  if (imgs.length) {
    if (/loading\s*=\s*"lazy"/i.test(imgs[0].tag)) add('warn', '첫 이미지가 loading="lazy" — 첫 화면은 eager (8-2 11항)');
    const lazyMiss = imgs.slice(1).filter((i) => !/loading\s*=\s*"lazy"/i.test(i.tag));
    if (lazyMiss.length > 1) add('info', `첫 이미지 뒤 loading="lazy" 없는 <img> ${lazyMiss.length}개 (8-2 11항)`);
  }

  // 숨긴 글자 (8-2 9항) — 감싸개 줄(font-size:0 + 바로 태그)은 뺀다
  const hiddenRe = /<[a-z]+\b[^>]*style\s*=\s*"[^"]*(display\s*:\s*none|visibility\s*:\s*hidden|text-indent\s*:\s*-\d{3,})[^"]*"[^>]*>\s*[^<\s]/gi;
  const hidden = [...body.matchAll(hiddenRe)].map((m) => short(m[0].replace(/\s+/g, ' '), 60));
  const zeroText = [...body.matchAll(/<[a-z]+\b[^>]*font-size\s*:\s*0(?:px)?\s*[;"][^>]*>([^<]*\S[^<]*)</gi)].map((m) => short(m[1].trim()));
  if (hidden.length || zeroText.length) add('error', `숨긴 글자 ${hidden.length + zeroText.length}곳 — 검색 스팸 정책 위반 (8-2 9항)`, [...hidden, ...zeroText]);
  const ariaLabels = [...body.matchAll(/aria-label\s*=\s*"([^"]+)"/gi)].map((m) => m[1]).filter((a) => stuffed(a));
  if (ariaLabels.length) add('warn', `aria-label 에 키워드 나열 의심 ${ariaLabels.length}곳 (8-2 9항)`, ariaLabels);

  // 마크업 짜임
  const bal = tagBalance(copy);
  if (bal.unclosed.length) add('error', `닫히지 않은 태그 ${bal.unclosed.length}개`, bal.unclosed.map((t) => `<${t}>`));
  if (bal.mismatched.length) add('error', `엇갈려 닫힌 태그 ${bal.mismatched.length}곳`, bal.mismatched);
  if (bal.blockInP.length) add('error', `<p> 안에 블록 태그 ${bal.blockInP.length}곳 — 브라우저가 <p> 를 끊어 구조가 바뀜`, bal.blockInP);
  const ids = [...body.matchAll(/\sid\s*=\s*"([^"]+)"/gi)].map((m) => m[1]);
  const dupIds = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))];
  if (dupIds.length) add('error', `같은 id 가 두 번 이상 ${dupIds.length}종`, dupIds);
  const emptyP = (body.match(/<p\b[^>]*>\s*<\/p>/gi) || []).length;
  if (emptyP > 2) add('info', `빈 <p> ${emptyP}개`);

  if (!f.some((i) => i.level === 'error' || i.level === 'warn')) add('ok', '제목 구조·alt·숨긴 글자·마크업 짜임 문제 없음');
  const h3 = heads.filter((h) => h.level === 3).length;
  return {
    ...REVIEW_STEPS[1],
    findings: f,
    stats: `h2 ${h2.length} · h3 ${h3}${heads.some((h) => h.role) ? '(role)' : ''} · alt ${imgs.filter((i) => i.alt).length}/${imgs.length} · 글자 노출 ${openmarket ? 'alt 로만' : `${Math.round(ratio * 100)}%`}`,
  };
}

// ───── 3단계: PSD 레이어 대응 ─────

function reviewLayers(x: ReviewInput, copy: string): ReviewPass {
  const f: ReviewFinding[] = [];
  const add = (level: ReviewLevel, message: string, samples?: string[]) => f.push({ level, message, samples: samples?.slice(0, 8) });
  const openmarket = x.meta.channel === 'openmarket';
  const imgs = imgTags(copy);
  const textHay = squash(visibleText(copy));
  const altHay = squash(imgs.map((i) => i.alt ?? '').join(' '));
  const texts = x.summary.texts.filter((t) => t.text.trim());
  const has = (hay: string, t: TextInfo) => t.lines.every((l) => !l.trim() || hay.includes(squash(decode(l))));
  const tag = (t: TextInfo) => `#${t.id} 「${short(firstLine(t))}」`;

  const asText: TextInfo[] = [];
  const asAlt: TextInfo[] = [];
  const asImgOk: TextInfo[] = [];
  const keptNoAlt: TextInfo[] = [];
  const lost: TextInfo[] = [];
  for (const t of texts) {
    const inText = has(textHay, t);
    const inAlt = has(altHay, t);
    if (x.kept.has(t.id)) (inAlt || inText ? asImgOk : keptNoAlt).push(t);
    else if (inText) asText.push(t);
    else if (inAlt) asAlt.push(t);
    else lost.push(t);
  }

  // 빠진 글자 (9절 4항)
  if (lost.length) add('error', `HTML 글자에도 alt 에도 없는 텍스트 레이어 ${lost.length}개 (9절 4항)`, lost.map(tag));
  if (keptNoAlt.length) add('error', `이미지에 남겼는데 alt 에 원문이 없는 글자 ${keptNoAlt.length}개 — 검색·AI 가 못 읽음 (4절·8-2 3항)`, keptNoAlt.map(tag));

  // 텍스트 레이어가 이미지가 된 곳 — 사유별로
  const keptAll = texts.filter((t) => x.kept.has(t.id));
  if (openmarket) {
    const byDesign = keptAll.filter((t) => /섹션 이미지/.test(x.kept.get(t.id)!));
    if (byDesign.length) add('info', `오픈마켓 방식: 텍스트 레이어 ${byDesign.length}개가 섹션 이미지에 들어가고 원문은 alt·제목 띠로 전달됩니다 (7-3-1 1항)`);
    const extra = keptAll.filter((t) => !/섹션 이미지/.test(x.kept.get(t.id)!));
    if (extra.length) add('info', `그 밖에 이미지로 남긴 이유가 따로 있는 글자 ${extra.length}개`, extra.map((t) => `${tag(t)} — ${x.kept.get(t.id)}`));
  } else {
    // 구조 계획(Claude)이 정한 것 = keepInImage 에서 왔고 프로그램 자동 사유(bakeHint·효과·폰트 등, codegen autoKeep)가 먼저 붙지 않은 것
    const planWhy = new Map((x.plan.keepInImage ?? []).map((k) => [k.id, k.reason || "계획에서 이미지로"]));
    const fromPlan = (t: TextInfo) => !t.bakeHint && planWhy.has(t.id) && x.kept.get(t.id) === planWhy.get(t.id);
    const auto = keptAll.filter((t) => !fromPlan(t));
    const byPlan = keptAll.filter(fromPlan);
    if (auto.length) add('info', `규칙 4절 예외로 이미지에 남긴 글자 ${auto.length}개 (뒤틀기·CSS 로 못 옮기는 효과·웹폰트 없음 등)`, auto.map((t) => `${tag(t)} — ${x.kept.get(t.id)}`));
    // 구조 계획이 이미지로 남기라고 한 글자 중 크거나 제목·긴 문장이면 다시 본다 (텍스트는 텍스트로가 원칙)
    const heading = new Set(Object.keys(x.plan.headings ?? {}).map(Number));
    const doubt = byPlan.filter((t) => heading.has(t.id) || t.size >= 20 || t.text.replace(/\s+/g, '').length >= 20);
    if (doubt.length) add('warn', `구조 계획이 이미지로 남긴 글자 중 제목·큰 글자·긴 문장 ${doubt.length}개 — 텍스트 레이어는 글자로가 원칙, 사유 확인 (4절·8-2 3항)`, doubt.map((t) => `${tag(t)} — ${x.kept.get(t.id)}`));
    const small = byPlan.filter((t) => !doubt.includes(t));
    if (small.length) add('info', `구조 계획이 이미지로 남긴 작은 글자 ${small.length}개 (사진 속 라벨·로고 등)`, small.map((t) => `${tag(t)} — ${x.kept.get(t.id)}`));
    // 이미지가 안 됐어야 할 글자인데 alt 로만 들어간 것 (keep 목록에 없는데 HTML 글자가 아님)
    if (asAlt.length) add('warn', `이미지로 남긴다는 결정 없이 alt 에만 있는 글자 ${asAlt.length}개 — 사진 띠에 구워졌을 수 있음`, asAlt.map(tag));
    // 제목으로 정한 레이어가 이미지가 됨
    const lostHead = keptAll.filter((t) => heading.has(t.id));
    if (lostHead.length) add('warn', `제목으로 정한 레이어 ${lostHead.length}개가 이미지가 됨 — 제목 글자가 검색에 덜 읽힘`, lostHead.map(tag));
  }

  // 위치 대조 (4-1, 9절 3항) — 자동 점검이 잰 값을 다시 요약
  if (x.layout && !openmarket) {
    const off = x.layout.items.filter((i) => i.dy != null && !i.ok);
    const nf = x.layout.items.filter((i) => i.dy == null);
    if (off.length) add('warn', `PSD 와 자리가 어긋난 글자 ${off.length}개 (세로 ±3·가로 ±6px 밖)`, off.map((i) => `#${i.id} 「${short(i.text)}」 ${i.dy}/${i.dx ?? '줄바꿈'}px`));
    if (nf.length) add('info', `렌더에서 위치를 못 잰 글자 ${nf.length}개`);
    if (x.layout.overflow360 > 0) add('error', `휴대폰 360px 에서 가로 넘침 ${x.layout.overflow360}px (7-5)`);
  }

  // 숨긴 레이어 내용이 들어갔는지 — 요약에는 보이는 레이어만 있으므로 개수만 알린다
  if (x.summary.hiddenCount) add('info', `숨긴 레이어 ${x.summary.hiddenCount}개는 변환에서 뺐습니다 (10절)`);

  // 레이어 종류별 처리
  const kinds = new Map<string, number>();
  for (const l of x.summary.layers) if (l.kind !== 'group') kinds.set(l.kind, (kinds.get(l.kind) ?? 0) + 1);
  const imgFiles = x.plan.images.length;
  const photos = x.plan.photos?.length ?? 0;
  const adj = kinds.get('adjustment') ?? 0;
  if (adj) add('info', `조정 레이어 ${adj}개는 CSS 로 옮기지 않고 아래 이미지와 합쳐 구웠습니다 (4절)`);
  const unmapped = texts.filter((t) => t.unmappedFont);
  if (unmapped.length && !openmarket) add('info', `웹폰트 표에 없는 폰트 글자 ${unmapped.length}개는 이미지로 (5절)`, [...new Set(unmapped.map((t) => t.font))]);

  if (!f.some((i) => i.level === 'error' || i.level === 'warn')) add('ok', openmarket ? '모든 텍스트 레이어 원문이 이미지 alt·제목 띠에 들어 있음' : '텍스트 레이어가 모두 HTML 글자이거나, 사유가 있는 이미지 + alt 원문');
  return {
    ...REVIEW_STEPS[2],
    findings: f,
    stats: `텍스트 레이어 ${texts.length} → 글자 ${asText.length} · 이미지 ${asImgOk.length + keptNoAlt.length} · alt만 ${asAlt.length} · 빠짐 ${lost.length} / 이미지 ${imgFiles}장${photos ? `(사진 띠 ${photos})` : ''} · 레이어 ${[...kinds].map(([k, n]) => `${KIND[k] ?? k} ${n}`).join(' ')}`,
  };
}
const KIND: Record<string, string> = { text: '글자', pixel: '픽셀', smartObject: '고급 개체', shape: '셰이프', fill: '채우기', adjustment: '조정' };

/** 한 단계만 (화면이 단계마다 안내 문구를 바꾸며 차례로 부른다) */
export function reviewStep(key: ReviewKey, x: ReviewInput): ReviewPass {
  const copy = x.html.includes(COPY_START) ? copySection(x.html) : x.html;
  return key === 'rules' ? reviewRules(x, copy) : key === 'seo' ? reviewSeo(x, copy) : reviewLayers(x, copy);
}

/** 세 단계 모두 */
export const reviewMarkup = (x: ReviewInput) => REVIEW_STEPS.map((s) => reviewStep(s.key, x));

export const passCounts = (p: ReviewPass) => ({
  err: p.findings.filter((i) => i.level === 'error').length,
  warn: p.findings.filter((i) => i.level === 'warn').length,
});

/** 진단 정보·보고에 붙일 글 */
export function reviewText(passes: ReviewPass[], claude?: { summary: string; passes: Record<ReviewKey, (ReviewFinding & { where?: string })[]> }) {
  return [
    '마크업 재검증 (코드 3단계' + (claude ? ' + Claude 정밀 검토):' : '):'),
    ...passes.flatMap((p, i) => [
      `${i + 1}. ${p.title} — ${p.stats}`,
      ...p.findings.filter((x) => x.level !== 'ok').map((x) => `   - [${x.level === 'error' ? '오류' : x.level === 'warn' ? '확인' : '참고'}] ${x.message}${x.samples?.length ? ` (${x.samples.slice(0, 3).join(' / ')})` : ''}`),
      ...(claude?.passes[p.key] ?? []).map((x) => `   - [Claude·${x.level === 'error' ? '오류' : x.level === 'warn' ? '확인' : '참고'}] ${x.message}${x.where ? ` (${x.where})` : ''}`),
    ]),
    ...(claude?.summary ? [`Claude 결론: ${claude.summary}`] : []),
  ].join('\n');
}

// ───── Claude 정밀 검토 (2026-11-27 사용자: 재검증도 Claude 가 해야 더 정확) ─────
// 코드 3단계는 셀 수 있는 것(태그·속성·포함 여부)을 정확히 본다. Claude 는 판단이 필요한 것(제목 의미·이미지로 남긴 글자가 맞는지·alt 문구·
// 핵심 사실·읽기 순서·구조화)을 본다. 서버 /review — core/prompt.ts buildReviewMessages. 결과는 같은 세 단계 아래에 「Claude」로 붙인다

/** 뼈대 HTML 상한 — core/validate.ts MAX_REVIEW_MARKUP 과 같게 */
export const MAX_MARKUP = 400_000;

/** 복사 구간 → Claude 에게 보낼 뼈대: <style>·주석·style·class·크기·로딩 속성을 빼고 이미지 src 는 파일 이름만 */
export function skeleton(html: string) {
  const copy = html.includes(COPY_START) ? copySection(html) : html;
  return stripStyle(copy)
    .replace(/\s(style|class|loading|decoding|fetchpriority|width|height|data-[\w-]+)\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/(\ssrc\s*=\s*")[^"]*\/([^"/]+)"/gi, '$1$2"')
    // 태그 사이 공백은 지우지 않고 하나로 — 줄마다 나눈 글자 사이 줄바꿈까지 지우면 Claude 가 「글자가 붙었다」고 잘못 본다
    .replace(/>\s+</g, '> <')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildReviewRequest(x: ReviewInput, passes: ReviewPass[]): ReviewRequest {
  const markup = skeleton(x.html);
  const heads = x.plan.headings ?? {};
  return {
    meta: x.meta,
    doc: { fileName: x.summary.fileName, width: x.summary.width, height: x.summary.height },
    markup: markup.length > MAX_MARKUP ? `${markup.slice(0, MAX_MARKUP - 40)} …(뒤는 길어서 뺐음)` : markup,
    texts: x.summary.texts
      .filter((t) => t.text.trim())
      .map((t) => ({
        id: t.id,
        text: t.text,
        size: Math.round(t.size),
        weight: t.weight,
        ...(heads[String(t.id)] ? { heading: heads[String(t.id)] } : {}),
        ...(x.kept.has(t.id) ? { kept: x.kept.get(t.id) } : {}),
      })),
    images: x.plan.images.map((im) => ({ file: im.file, kind: im.kind, ...(im.alt ? { alt: im.alt } : {}) })),
    codeFindings: passes.flatMap((p) => p.findings.filter((f) => f.level !== 'ok').map((f) => `[${p.key}·${f.level}] ${f.message}${f.samples?.length ? ` (${f.samples.slice(0, 3).join(' / ')})` : ''}`)),
  };
}

export interface ClaudeFinding extends ReviewFinding {
  where?: string;
  fix?: string;
}

export interface ClaudeReview {
  summary: string;
  passes: Record<ReviewKey, ClaudeFinding[]>;
  /** Claude 가 오탐이라고 본 코드 점검 */
  falsePositives: { finding: string; why: string }[];
}

const LEVELS: ReviewLevel[] = ['error', 'warn', 'info'];

type RawReview = {
  summary?: unknown;
  passes?: { key?: string; findings?: { level?: string; message?: string; where?: string; fix?: string }[] }[];
  falsePositives?: { finding?: string; why?: string }[];
};

/** <review>{…}</review> 응답 읽기 — 형식이 틀리면 오류 문구를 던진다 */
export function parseReviewOutput(text: string): ClaudeReview {
  const body = /<review>([\s\S]*?)(<\/review>|$)/.exec(text)?.[1]?.trim().replace(/^```[a-z]*\s*|\s*```$/g, '');
  if (!body) throw new Error('정밀 검토 응답에 <review> 블록이 없습니다.');
  let raw: RawReview;
  try {
    raw = JSON.parse(body) as RawReview;
  } catch {
    throw new Error('정밀 검토 응답(JSON)을 읽지 못했습니다.');
  }
  const passes: ClaudeReview['passes'] = { rules: [], seo: [], layers: [] };
  for (const p of raw.passes ?? []) {
    if (!p?.key || !(p.key in passes)) continue;
    for (const f of p.findings ?? []) {
      if (!f?.message) continue;
      const level = (LEVELS as string[]).includes(f.level ?? '') ? (f.level as ReviewLevel) : 'info';
      passes[p.key as ReviewKey].push({ level, message: String(f.message), where: f.where ? String(f.where) : undefined, fix: f.fix ? String(f.fix) : undefined });
    }
  }
  return {
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    passes,
    falsePositives: (raw.falsePositives ?? []).filter((x) => x?.finding).map((x) => ({ finding: String(x.finding), why: String(x.why ?? '') })),
  };
}

/** 같은 마크업을 다시 열 때 비용 없이 보이도록 기억하는 열쇠 (채널·마크업·텍스트 레이어로 만든 짧은 해시) */
export function reviewKey(req: ReviewRequest) {
  // 올릴 곳(상품 상세·게시판)이 다르면 같은 뼈대라도 기준이 달라 따로 기억한다
  const src = [req.meta.channel, req.meta.market ?? '', req.meta.target ?? '', req.meta.board ?? '', req.markup, JSON.stringify(req.texts)].join('|');
  let h1 = 0x811c9dc5;
  let h2 = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = (Math.imul(h2, 31) + c) | 0;
  }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}${src.length.toString(36)}`;
}
