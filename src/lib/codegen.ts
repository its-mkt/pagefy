// 구조 계획 → 마크업 (코드 생성 방식, 2026-11-23~)
// 검증본 ~/.claude/tools/psd2html/build.js (ZGX Nano 102/102 통과) 의 글자 상자·행 묶기·배경 블록 방식을 일반화해 옮겼다.
// Claude 는 구조(섹션·사진 띠·이미지에 남길 글자·제목 단계)만 정하고, 위치·크기·줄바꿈·자간·색은 PSD 값으로 여기서 계산한다.
//  - 섹션 = [글자 뺀 배경 + 글자 상자 행] 블록과 [사진 <img alt>] 블록을 위에서부터 쌓는다
//  - 글자 상자: 규칙 4-1 (줄 상자 위쪽 = 기준선 − (행간/2 + 0.35×크기), 줄마다 다른 행간, 문단 간격, 끝 공백 보존)
//  - 세로가 겹치는 상자끼리 한 줄(고도몰 flex / 오픈마켓 table)로 묶는다
//  - 고도몰: 모든 크기 calc(N * var(--u)) (7-5), 스타일은 <style> 클래스 + 인라인 / 오픈마켓: 인라인·px 고정 (7-3)
import { type GenerateMeta, type Plan, type PlanBundle, type PlanImage, type PsdSummary, type TextInfo, type TextRun, imageBaseUrl } from '../../shared/types';
import { godoRootCss } from '../../shared/width';
import { MARKETS, marketWidth, normMarket, type MarketSpec } from '../../shared/markets';
import { FONT_MAP } from './psd/extract';
import type { SectionOut } from './assemble';
import type { Check } from './output';
import { esc, escAttr } from './html';
import { tabHtml, tabStopPx } from './tabs';

/** 점검 경고. fix 'plan' = 구조 계획을 바로잡으면 사라지는 것 (「문제 자동 수정」 대상) */
const warn = (message: string, fix?: Check['fix']): Check => ({ level: 'warn', message, fix });

/** 배경 한 장 최대 세로 (규칙 6절) */
const BG_MAX_H = 3000;
/** 이 효과가 켜진 글자는 효과 값(그림자 거리·획 굵기 등)을 몰라 CSS 로 같게 못 만든다 → 이미지에 남긴다 */
const KEEP_FX = ['stroke', 'colorOverlay', 'dropShadow'];
const PAPERLOGY_IMPORT = '@import url("https://cdn.jsdelivr.net/gh/fonts-archive/Paperlogy/Paperlogy.css");';
const FALLBACK_FAMILY = "-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Noto Sans KR','Malgun Gothic',sans-serif";

export interface KeptText {
  id: number;
  text: string;
  reason: string;
}

export interface CodegenResult {
  /** plan.images 를 채운 계획 + 공통 CSS — assembleHtml·cutImages 에 그대로 넘긴다 */
  bundle: PlanBundle;
  sections: SectionOut[];
  /** 이미지에 남긴 글자 (완료 보고용) */
  kept: KeptText[];
  /** 계획을 고쳐 쓴 것·주의할 것 (점검 경고로 보여 준다) */
  warnings: Check[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;
/** txt 이미지 파일명 뒤 내용 이름 (6-1: 영문 소문자·숫자·하이픈) — 글자에서 영문·숫자만, 없으면 text */
const txtSlug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/, '') || 'text';
const fillOf = (t: TextInfo) => {
  const m = (t.fx || []).map((f) => /^fill (\d+)%$/.exec(f)).find(Boolean);
  return m ? Number(m[1]) / 100 : 1;
};

function familyOf(font: string): string | null {
  return FONT_MAP.find((m) => m.test.test(font))?.family ?? null;
}

/** 이미지에 남길 이유 (없으면 HTML 글자로) */
function autoKeep(t: TextInfo): string | null {
  if (t.bakeHint) return t.bakeHint;
  // 드롭섀도는 값을 읽었으면 text-shadow 로 옮긴다 (소제목이 이미지가 되면 검색에서 빠짐)
  // 드롭섀도는 text-shadow 로, 보통 혼합 색상 오버레이는 글자색으로 옮긴다 (규칙 4절 표)
  const fx = (t.fx || []).filter((f) => KEEP_FX.includes(f) && !(f === 'dropShadow' && t.shadows?.length) && !(f === 'colorOverlay' && t.overlay));
  if (fx.length) return `CSS 로 같게 못 만드는 효과(${fx.join(', ')})`;
  if (fillOf(t) === 0) return '칠 0% (외곽선 글자)';
  const fonts = (t.runs?.length ? t.runs.filter((r) => r.text.trim()).map((r) => r.font) : [t.font]).filter(Boolean);
  const bad = fonts.filter((f) => !familyOf(f));
  if (bad.length) return `웹폰트 표에 없는 폰트(${[...new Set(bad)].join(', ')})`;
  return null;
}

interface Box {
  t: TextInfo;
  /** 블록 안 y (처음엔 문서 y) */
  top: number;
  left: number;
  width: number;
  height: number;
  size: number;
  html: string;
  /** CSS 속성 → 값 (u() 를 거친 문자열) */
  style: Record<string, string | null>;
  /** 이미지에 남긴 글자: 글자 대신 <img alt="원문"> (규칙 4절·8-2 3항) */
  img?: { src: string; alt: string };
}

interface Ctx {
  goodomall: boolean;
  prefix: string;
  /** PSD px → CSS 길이 */
  u: (n: number) => string;
  lsAdj: Record<number, number>;
  /** 상자 텍스트 자동 줄바꿈 위치 (텍스트 id → 새 줄이 시작하는 글자 위치들) */
  wraps: Record<number, number[]>;
  usesPaperlogy: boolean;
  warnings: Check[];
  /** 오픈마켓 플랫폼 출력 규칙 (shared/markets.ts — 고도몰은 없음) */
  rules?: MarketSpec['rules'];
  /** PSD px → 출력 px 배율 (오픈마켓 플랫폼 폭에 맞춰 줄일 때만 1 미만, 고도몰은 1 — 고도몰은 --u 로 줄인다) */
  scale: number;
  /** 탭 간격 (PSD px) */
  tabStop: number;
}

/** 색상 오버레이를 글자색에 섞는다 (불투명도 1 이면 오버레이 색 그대로) */
function overlayColor(base: string, ov: NonNullable<TextInfo['overlay']>) {
  if (ov.opacity >= 0.99) return ov.color;
  const a = parseInt(base, 16);
  const b = parseInt(ov.color, 16);
  const ch = (sh: number) => Math.round(((b >> sh) & 255) * ov.opacity + ((a >> sh) & 255) * (1 - ov.opacity));
  return [16, 8, 0].map((sh) => ch(sh).toString(16).padStart(2, '0')).join('');
}

function colorCss(hex: string, alpha: number) {
  if (alpha >= 1) return `#${hex}`;
  const n = parseInt(hex, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.round(alpha * 100) / 100})`;
}

function familyCss(font: string, ctx: Ctx) {
  if (familyOf(font) === 'Paperlogy') {
    ctx.usesPaperlogy = true;
    return `'Paperlogy','Pretendard',${FALLBACK_FAMILY}`;
  }
  return `'Pretendard',${FALLBACK_FAMILY}`;
}

/** 텍스트 레이어 하나 → 상자 (build.js textBox 를 TextInfo 에 맞게 옮기고, 섞인 크기·상자 텍스트 줄바꿈·빈 줄·불투명도를 더함) */
function textBox(t: TextInfo, ctx: Ctx): Box {
  const { u } = ctx;
  const runs: TextRun[] = t.runs?.length ? t.runs : [{ text: t.text, font: t.font, size: t.size, weight: t.weight, color: t.color, ls: t.ls }];
  const r0: TextRun = { text: '', font: t.font, size: t.size, weight: t.weight, color: t.color, ls: t.ls };
  const size = t.size;
  const L = t.lineHeight;
  const alpha = fillOf(t);
  const lsBase = t.ls + (ctx.lsAdj[t.id] ?? 0);
  const wrapAt = new Set(ctx.wraps[t.id] || []);

  // 줄 단위로 모은다. \r(문단 나눔) 앞엔 문단 간격, \u0003(소프트 줄바꿈)·자동 줄바꿈엔 넣지 않는다 (4-1)
  type Seg = { text: string; st: string[]; size: number };
  type Line = { segs: Seg[]; size: number; text: string; pgap: number; hard: number; wrapped: boolean };
  const lines: Line[] = [{ segs: [], size: 0, text: '', pgap: 0, hard: 0, wrapped: false }];
  let hard = 0;
  const pgapOf = (sep: string) => (sep === '\u0003' ? 0 : (t.spaceAfter ?? 0) + (t.spaceBefore ?? 0));
  const add = (text: string, st: string[], sz: number) => {
    if (!text) return;
    const ln = lines[lines.length - 1];
    ln.size = Math.max(ln.size, sz);
    ln.text += text;
    const last = ln.segs[ln.segs.length - 1];
    if (last && last.st === st) last.text += text;
    else ln.segs.push({ text, st, size: sz });
  };
  let idx = 0; // t.text 안 글자 위치 (자동 줄바꿈 위치와 맞추려고)
  for (const r of runs) {
    const st: string[] = [];
    if (familyOf(r.font) !== familyOf(r0.font)) st.push(`font-family:${familyCss(r.font, ctx)}`);
    if (r.weight !== r0.weight) st.push(`font-weight:${r.weight}`);
    if (r.color !== r0.color && !t.overlay) st.push(`color:${colorCss(r.color, alpha)}`); // 오버레이는 모든 글자를 한 색으로 덮는다
    if (Math.abs(r.ls - r0.ls) >= 0.0005) st.push(`letter-spacing:${Math.round((r.ls + (ctx.lsAdj[t.id] ?? 0)) * 10000) / 10000}em`);
    const parts = r.text.split(/(\r\n|[\r\n\u0003])/);
    parts.forEach((part, k) => {
      if (k % 2 === 1) {
        hard++;
        // 문단마다 간격이 다르면 extract 가 줄별로 계산해 둔 값(paraGaps)을 쓴다
        lines.push({ segs: [], size: 0, text: '', pgap: t.paraGaps ? (t.paraGaps[hard] ?? 0) : pgapOf(part), hard, wrapped: false });
        idx += part.length;
        return;
      }
      // 자동 줄바꿈 위치에서 줄을 나눈다 (줄 끝·줄 앞 공백은 포토샵처럼 버린다)
      let from = 0;
      for (let i = 0; i < part.length; i++) {
        if (!wrapAt.has(idx + i) || idx + i === 0) continue;
        add(part.slice(from, i), st, r.size);
        const ln = lines[lines.length - 1];
        const lastSeg = ln.segs[ln.segs.length - 1];
        if (lastSeg) lastSeg.text = lastSeg.text.replace(/\s+$/, '');
        ln.text = ln.text.replace(/\s+$/, '');
        lines.push({ segs: [], size: 0, text: '', pgap: 0, hard, wrapped: true });
        from = i;
        while (from < part.length && part[from] === ' ') from++;
      }
      add(part.slice(from), st, r.size);
      idx += part.length;
    });
  }
  while (lines.length > 1 && !lines[lines.length - 1].text.trim()) lines.pop();
  lines.forEach((ln) => {
    if (!ln.size) ln.size = size;
  });
  // 가운데·오른쪽 정렬은 포토샵이 끝 공백까지 넣어 정렬하므로 &nbsp; 로 남긴다 (4-1). 자동 줄바꿈 줄은 제외
  const keepTrail = t.align === 'center' || t.align === 'right';
  /** 줄 HTML. cs = 이 줄을 감싼 요소의 글자 크기 — 다른 크기 글자만 font-size 를 주고, 줄보다 작은 글자는 줄 높이를 늘리지 않게 line-height:0 */
  const htmlOf = (ln: Line, cs: number) => {
    const out = ln.segs.map((sg, i) => {
      const lastSeg = i === ln.segs.length - 1;
      let h = esc(lastSeg && !keepTrail ? sg.text.replace(/\s+$/, '') : sg.text);
      if (lastSeg && keepTrail) h = h.replace(/( +)$/, (sp) => '&nbsp;'.repeat(sp.length));
      // 줄 앞 공백·이어진 공백은 white-space:nowrap 에서 하나로 접힌다 → PSD 처럼 남게 &nbsp; 로 (자간 측정도 공백을 다 센다)
      if (i === 0) h = h.replace(/^ +/, (sp) => '&nbsp;'.repeat(sp.length));
      h = h.replace(/ {2,}/g, (sp) => `${'&nbsp;'.repeat(sp.length - 1)} `);
      if (h.includes('	')) h = tabHtml(h, sg.text, ln.segs.slice(0, i).map((x) => x.text).join(''), sg.size, ctx.tabStop, u);
      const st = [...sg.st];
      if (Math.abs(sg.size - cs) > 0.3) st.push(`font-size:${u(sg.size)}`);
      if (sg.size < ln.size - 0.3) st.push('line-height:0');
      return st.length ? `<span style="${st.join(';')}">${h}</span>` : h;
    });
    return out.join('');
  };
  const leadAt = (i: number) => t.lineHeights?.[lines[i].hard] ?? L;

  // 문단마다 정렬이 다르거나 양쪽 정렬인 상자 텍스트: 상자 폭 전체를 쓰고 줄마다 text-align (줄바꿈 위치를 잰 경우만 — 아니면 첫 문단 정렬로)
  const perLine = t.shape === 'box' && !!t.boxWidth && !!t.lineAligns && t.id in ctx.wraps;
  if (t.lineAligns && !perLine && new Set(t.lineAligns).size > 1)
    ctx.warnings.push(warn(`"${t.text.trim().slice(0, 15)}"는 문단마다 정렬이 달라 첫 문단 정렬로 맞췄습니다 — PSD 와 다를 수 있습니다.`));
  /** 줄 i 의 text-align (+ 양쪽 정렬이면 text-align-last). 문단 마지막 줄은 포토샵의 마지막 줄 정렬을 따른다 */
  const lineAlignCss = (i: number): string[] => {
    const raw = t.lineAligns?.[lines[i].hard] ?? 'left';
    const paraLast = i === lines.length - 1 || !lines[i + 1].wrapped;
    if (raw.startsWith('justify')) {
      if (!paraLast || raw === 'justify-all') return ['text-align:justify', 'text-align-last:justify'];
      const last = raw.slice('justify-'.length);
      return [`text-align:${last === 'center' || last === 'right' ? last : 'left'}`];
    }
    return [`text-align:${raw === 'center' || raw === 'right' ? raw : 'left'}`];
  };

  const uniform = !perLine && lines.every((ln, i) => Math.abs(leadAt(i) - L) < 0.3 && Math.abs(ln.size - size) < 0.3 && !ln.pgap);
  let html: string;
  let height: number;
  if (uniform) {
    html = lines.map((ln) => htmlOf(ln, size)).join('<br>');
    height = L * lines.length;
  } else {
    // 줄마다 행간·크기가 다르면 줄을 블록으로 나눠 포토샵 기준선 간격을 그대로 맞춘다 (build.js 와 같은 식)
    height = 0;
    html = lines
      .map((ln, i) => {
        const Li = leadAt(i);
        let mt = 0;
        if (i > 0) {
          const prev = lines[i - 1];
          mt = Li - leadAt(i - 1) / 2 - Li / 2 - 0.35 * (ln.size - prev.size) + (ln.pgap || 0);
        }
        height += Li + mt;
        const st = ['display:block', `line-height:${u(Li)}`, ...(perLine ? lineAlignCss(i) : [])];
        if (Math.abs(ln.size - size) > 0.3) st.push(`font-size:${u(ln.size)}`); // 줄 기준선은 그 줄 글자 크기 기준
        if (Math.abs(mt) > 0.05) st.push(`margin-top:${u(mt)}`);
        return `<span style="${st.join(';')}">${htmlOf(ln, ln.size) || '&nbsp;'}</span>`; // 빈 줄도 높이를 갖게
      })
      .join('');
  }

  const align = t.align === 'center' ? 'center' : t.align === 'right' ? 'right' : 'left';
  // 상자 텍스트인데 줄바꿈 위치를 못 쟀으면 브라우저가 상자 폭에서 줄을 바꾸게 둔다 (대체)
  const cssWrap = t.shape === 'box' && !!t.boxWidth && !(t.id in ctx.wraps) && (t.b[3] - t.b[1]) > (lines.length + 0.5) * L;
  if (cssWrap) {
    ctx.warnings.push(warn(`상자 텍스트 "${t.text.trim().slice(0, 15)}"의 줄바꿈 위치를 재지 못해 브라우저 줄바꿈에 맡겼습니다 — PSD 와 줄바꿈이 다를 수 있습니다.`));
    height = Math.max(height, Math.round((t.b[3] - t.b[1] - size * 0.7) / L + 1) * L);
  }
  // 줄별 정렬은 포토샵 상자 폭 그대로 (정렬 기준 = 상자 왼쪽·가운데·오른쪽)
  const width = perLine ? t.boxWidth! : cssWrap ? t.boxWidth! + 2 : Math.max(t.b[2] - t.b[0], 10) + Math.ceil(size * 0.6) + 8; // 글꼴 차이 여유
  const left = align === 'center' ? t.anchorX - width / 2 : align === 'right' ? t.anchorX - width : t.anchorX;
  // 첫 줄 상자 위쪽 = 기준선 − (첫 줄 행간/2 + 0.35 × 첫 줄 크기) (4-1). 첫 줄에 더 큰 글자가 섞이면 그 크기 기준
  const top = t.baseline - (leadAt(0) / 2 + 0.35 * lines[0].size);
  const style: Record<string, string | null> = {
    'font-family': familyOf(t.font) === 'Paperlogy' ? familyCss(t.font, ctx) : null,
    'font-size': u(size),
    'line-height': u(L),
    'font-weight': String(t.weight),
    // 색상 오버레이는 효과라 칠 불투명도와 상관없이 보인다
    color: t.overlay ? colorCss(overlayColor(t.color, t.overlay), 1) : colorCss(t.color, alpha),
    'letter-spacing': Math.abs(lsBase) >= 0.0005 ? `${Math.round(lsBase * 10000) / 10000}em` : null,
    'text-align': align !== 'left' && !perLine ? align : null,
    'text-transform': t.caps ? 'uppercase' : null,
    'text-shadow': t.shadows?.length ? t.shadows.map((s) => `${u(s.x)} ${u(s.y)} ${u(s.blur)} ${s.color}`).join(',') : null,
    // 레이어·그룹 불투명도 (글자 칠 불투명도는 색에, 이것은 그림자까지 함께)
    opacity: t.opacity != null && t.opacity < 1 ? String(t.opacity) : null,
  };
  // 키 자체를 넣지 않는다 — null 이면 오픈마켓 기본값(white-space:nowrap)을 덮어 지워 버림
  if (cssWrap) style['white-space'] = 'normal';
  return { t, top, left, width, height, size, html, style };
}

const styleStr = (o: Record<string, string | null>) =>
  Object.entries(o)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}:${v}`)
    .join(';');

/**
 * table 을 못 쓰는 플랫폼의 여러 칸 줄 감싸개 style. font-size:0 은 칸 사이 공백이 높이를 만들지 않게 하는 것이고
 * 안의 칸은 글자 크기를 따로 지정하므로 숨긴 글자가 아니다 (output.ts 점검이 이 값만 제외)
 */
export const INLINE_ROW_STYLE = 'margin:0;padding:0;font-size:0;line-height:0;white-space:nowrap';

/** 세로 범위가 겹치는 상자끼리 한 줄로 묶어 HTML 줄들로 (build.js emitRows) */
function emitRows(boxes0: Box[], ctx: Ctx, tagOf: (b: Box) => { tag: string; attrs: string }, ind: string) {
  const { u, goodomall, prefix } = ctx;
  const boxes = boxes0.slice().sort((a, b) => a.top - b.top || a.left - b.left);
  const rows: { items: Box[]; top: number; bottom: number }[] = [];
  for (const b of boxes) {
    const last = rows[rows.length - 1];
    if (last && b.top < last.bottom - 2) {
      last.items.push(b);
      last.bottom = Math.max(last.bottom, b.top + b.height);
      last.top = Math.min(last.top, b.top);
    } else rows.push({ items: [b], top: b.top, bottom: b.top + b.height });
  }
  const lines: string[] = [];
  const first = rows.length ? Math.max(0, rows[0].top) : 0; // 음수 padding 은 무효 CSS → 첫 줄 음수 margin-top 으로
  let prevBottom = first;
  // 오픈마켓은 class 에 스타일을 기댈 수 없어 기본 여백·굵기를 인라인으로 지운다
  const reset: Record<string, string | null> = goodomall ? {} : { margin: '0', padding: '0', 'white-space': 'nowrap' };
  /** 상자 하나 → 요소. 이미지에 남긴 글자는 <img alt> (폭·높이 고정, 스킨의 img 폭 100% 를 이기도록 인라인) */
  const render = (b: Box, pos: Record<string, string | null>) => {
    if (b.img) {
      // max-width 금지 플랫폼(ESM)은 빼고, 나머지는 스킨의 img max-width 를 이기게 none
      const st = { display: 'block', 'max-width': ctx.rules?.noMaxWidth ? null : 'none', height: 'auto', border: '0', ...(goodomall ? {} : { margin: '0' }), ...pos };
      const cls = goodomall ? ` class="${prefix}-tx"` : '';
      return `<img${cls} src="${b.img.src}" alt="${escAttr(b.img.alt)}" width="${Math.round(b.width * ctx.scale)}" height="${Math.round(b.height * ctx.scale)}" loading="lazy" decoding="async"${goodomall ? ' draggable="false"' : ''} style="${styleStr(st)}">`;
    }
    const { tag, attrs } = tagOf(b);
    return `<${tag}${attrs} style="${styleStr({ ...reset, ...b.style, ...pos })}">${b.html}</${tag}>`;
  };
  for (const row of rows) {
    row.items.sort((a, b) => a.left - b.left);
    const mt = row.top - prevBottom;
    const el = (b: Box, ml: number) => render(b, { width: u(b.width), 'margin-left': ml ? u(ml) : null, 'margin-top': b.top - row.top ? u(b.top - row.top) : null });
    if (goodomall) {
      lines.push(`${ind}<div class="${prefix}-row"${mt ? ` style="margin-top:${u(mt)}"` : ''}>`);
      let x = 0;
      for (const b of row.items) {
        lines.push(`${ind}  ${el(b, b.left - x)}`);
        x = b.left + b.width;
      }
      lines.push(`${ind}</div>`);
    } else if (row.items.length === 1) {
      const b = row.items[0];
      lines.push(`${ind}${render(b, { width: u(b.width), 'margin-left': b.left ? u(b.left) : null, 'margin-top': mt ? u(mt) : null })}`);
    } else if (ctx.rules?.noTable) {
      // table 을 못 쓰는 플랫폼(스마트스토어 — table 이 있으면 모바일 미리보기 안 됨): 칸을 inline-block 으로 나란히.
      // 줄은 nowrap 이라 넘쳐도 아래로 안 떨어지고, font-size·line-height 0 으로 칸 사이 공백이 높이를 만들지 않게 (칸마다 글자 크기·행간은 인라인으로 다시 준다)
      lines.push(`${ind}<div style="${INLINE_ROW_STYLE}${mt ? `;margin-top:${u(mt)}` : ''}">`);
      let x = 0;
      for (const b of row.items) {
        lines.push(`${ind}  ${render(b, { display: 'inline-block', 'vertical-align': 'top', width: u(b.width), 'margin-left': b.left - x ? u(b.left - x) : null, 'margin-top': b.top - row.top ? u(b.top - row.top) : null })}`);
        x = b.left + b.width;
      }
      lines.push(`${ind}</div>`);
    } else {
      // 오픈마켓: flex 대신 표 (7-3). 상자가 겹치면 margin-left 가 음수가 되는데, 자동 표 폭은 음수 여백을 무시해
      // 뒤 칸을 밀어낸다 → 칸 폭을 고정(table-layout:fixed)하고 음수 여백은 칸 밖으로 넘치게 둔다
      let x = 0;
      const cells = row.items.map((b) => {
        const ml = b.left - x;
        const w = Math.max(1, b.left + b.width - x);
        x = Math.max(x + w, b.left + b.width);
        return { b, ml, w };
      });
      const total = cells.reduce((s, c) => s + c.w, 0);
      lines.push(`${ind}<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:0;table-layout:fixed;width:${u(total)};${mt ? `margin-top:${u(mt)};` : ''}">`);
      lines.push(`${ind}  <tr>`);
      for (const c of cells) lines.push(`${ind}    <td style="padding:0;border:0;vertical-align:top;width:${u(c.w)};overflow:visible">${el(c.b, c.ml)}</td>`);
      lines.push(`${ind}  </tr>`);
      lines.push(`${ind}</table>`);
    }
    prevBottom = row.top + Math.max(...row.items.map((b) => b.top - row.top + b.height));
  }
  return { lines, first, prevBottom };
}

/** 배경 구간 [a,b) 를 세로 maxH(기본 3000px) 이하 조각으로. 자르는 위치는 글자 bounds 가 걸치지 않는 곳 */
function splitBg(a: number, b: number, texts: TextInfo[], maxH = BG_MAX_H): number[] {
  const cuts = [a];
  let y = a;
  const crosses = (cy: number) => texts.some((t) => t.b[1] < cy && t.b[3] > cy);
  while (b - y > maxH) {
    let cut = -1;
    for (let cy = y + maxH; cy >= y + Math.min(1000, Math.floor(maxH / 2)); cy--) {
      if (!crosses(cy)) {
        cut = cy;
        break;
      }
    }
    if (cut < 0) break; // 걸치지 않는 곳이 없으면 그대로 (경고)
    cuts.push(cut);
    y = cut;
  }
  cuts.push(b);
  return cuts;
}

function baseCss(p: string, W: number, usesPaperlogy: boolean) {
  return [
    usesPaperlogy ? PAPERLOGY_IMPORT : '',
    `/* 최상위 폭·배율 (7-2·7-5) */\n${godoRootCss(p, W)}`,
    `/* 스킨 CSS 방어 + 기본값 */
.${p}{font-family:'Pretendard',${FALLBACK_FAMILY};word-break:keep-all;overflow-wrap:anywhere;text-align:left;line-height:1.2;letter-spacing:normal;text-transform:none;text-indent:0;font-weight:400;font-style:normal;font-size:16px;padding:0;border:0;font-kerning:normal;font-variant-ligatures:normal;font-feature-settings:normal;font-optical-sizing:auto}
.${p}.${p} *{box-sizing:border-box;margin:0;padding:0;border:0;font:inherit;color:inherit;letter-spacing:inherit;text-transform:inherit;text-decoration:none;vertical-align:baseline}
.${p} .${p}-s{display:block}
.${p} .${p}-sec{background-repeat:no-repeat;background-size:100% auto;background-position:center top;overflow:hidden}
.${p} .${p}-row{display:flex;align-items:flex-start}
.${p} .${p}-row>*{flex:none;white-space:nowrap}
.${p} img.${p}-img{display:block;width:100%;max-width:none;height:auto;float:none}
.${p}.${p} img.${p}-tx{display:block;max-width:none;height:auto;float:none}
.${p}.${p} h2,.${p}.${p} p{font-weight:inherit;font-size:inherit;color:inherit}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * 바로 위에 클리핑 마스크 레이어(그라데이션·사진 등)가 얹힌 텍스트 id — 글자색이 PSD 텍스트 값과 다르게 보인다.
 * summary.layers 는 아래→위 순서라 텍스트 다음 레이어가 clip 이면 그 텍스트에 클리핑된 것이다
 */
export function clippedTexts(summary: PsdSummary): Set<number> {
  const out = new Set<number>();
  summary.layers.forEach((l, i) => {
    // 같은 그룹 안의 바로 다음 레이어만 (그룹 마지막 텍스트 다음 레이어는 그룹 밖일 수 있음)
    const next = summary.layers[i + 1];
    if (l.kind === 'text' && next?.clip && next.path === l.path) out.add(l.id);
  });
  return out;
}

/** 바깥 폭 고정 대신 편집 영역 폭을 따른다 (max-width 금지 플랫폼 G마켓: width:860px 는 휴대폰에서 500px 넘침) — 되돌리기: false */
export const OPENMARKET_FLUID_WRAPPER = true;

/**
 * 오픈마켓: 섹션마다 한 장 이미지로 (대응 방식 「섹션 이미지」, 2026-11-25 결정) — 되돌리기: false (글자 HTML 방식).
 * 「글자만 이미지로 굽기」도 시험했지만(2026-11-25) 넘침·비율 어긋남이 그대로라 뺐다
 */
export const OPENMARKET_SECTION_IMAGE = true;

/** 이미지에 남길 글자 id → 이유: 계획이 고른 것 + 자동(bakeHint·효과·칠 0%·표에 없는 폰트, 오픈마켓은 클리핑된 글자도) */
export function keepMap(summary: PsdSummary, plan: Plan, openmarket = false): Map<number, string> {
  const m = new Map<number, string>();
  for (const t of summary.texts) {
    const r = autoKeep(t);
    if (r) m.set(t.id, r);
  }
  // 고도몰은 클리핑된 글자를 background-clip:text 로 PSD 색 그대로 칠한다. 오픈마켓 에디터는 그 CSS 를 지울 수 있어 이미지로
  const clipped = clippedTexts(summary);
  if (openmarket) for (const id of clipped) if (!m.has(id)) m.set(id, '클리핑 마스크로 칠한 글자 (오픈마켓은 CSS 로 못 옮김)');
  // 섹션 이미지 모드: 글자가 전부 이미지에 들어가므로(글자는 alt 에 남음) HTML 글자 대조·겹침 경고에서 빠지도록 모두 '이미지에 남긴 글자'로 등록
  if (openmarket && OPENMARKET_SECTION_IMAGE) for (const t of summary.texts) if (!m.has(t.id) && t.text.trim()) m.set(t.id, '오픈마켓 섹션 이미지에 들어간 글자');
  // 고도몰은 클리핑된 글자를 계획이 이미지로 남기라고 해도 실제 글자로 둔다 (규칙 4절 표, 사용자 지시 2026-11-23: 제목·검색 유지)
  for (const k of plan.keepInImage || []) if (!m.has(k.id) && (openmarket || !clipped.has(k.id))) m.set(k.id, k.reason || '계획에서 이미지로');
  return m;
}

/** 가로선 y 가 글자(빈 글자 제외)를 가로지르는지 */
const crossesCut = (t: TextInfo, y: number) => !!t.text.trim() && t.b[1] < y && t.b[3] > y;

/** y 에서 가장 가까운, 글자를 가로지르지 않는 가로 자름 위치 (같은 거리면 위쪽, [min, max] 안, 600px 까지). 이미 괜찮으면 y, 없으면 null */
export function clearCut(texts: TextInfo[], y: number, min: number, max: number): number | null {
  // 빈 글자는 한 번만 걸러 낸다 — 후보 줄(최대 1,200개)마다 모든 글자를 trim 하지 않게 (다시 계산할 때마다 섹션 경계마다 돈다)
  const live = texts.filter((t) => t.text.trim());
  const blocked = (c: number) => live.some((t) => t.b[1] < c && t.b[3] > c);
  if (!blocked(y)) return y;
  for (let d = 1; d <= 600; d++) {
    for (const c of [y - d, y + d]) if (c >= min && c <= max && !blocked(c)) return c;
  }
  return null;
}

/**
 * 계획의 섹션을 문서에 맞게 정리한다: 위→아래 정렬, 0~문서 높이로 자르기, 빈틈·겹침 없이 잇기, id 를 s00… 로 다시 매기기.
 * Claude 가 섹션을 조금 틀리게 줘도 글자가 빠지거나 두 번 나오지 않게. 사진 띠의 section 도 새 id 로 바꾼다
 */
function normalizeSections(plan: Plan, summary: PsdSummary, warnings: Check[]): { sections: Plan['sections']; photos: NonNullable<Plan['photos']> } {
  const H = summary.height;
  const src = (plan.sections || [])
    .filter((s) => Number.isFinite(s.y0) && Number.isFinite(s.y1))
    .map((s) => ({ ...s, y0: Math.max(0, Math.min(H, Math.round(s.y0))), y1: Math.max(0, Math.min(H, Math.round(s.y1))) }))
    .filter((s) => s.y1 > s.y0)
    .sort((a, b) => a.y0 - b.y0);
  if (!src.length) {
    warnings.push(warn('계획에 쓸 수 있는 섹션이 없어 문서 전체를 섹션 하나로 만들었습니다.', 'plan'));
    src.push({ id: 's00', name: '본문', y0: 0, y1: H });
  }
  // 경계 = 각 섹션의 시작 y (첫 섹션은 0, 끝은 문서 높이). 빈틈은 앞 섹션이 메우고, 겹치면 뒤 섹션 시작에서 끊는다
  const starts: number[] = [];
  src.forEach((s, i) => starts.push(i === 0 ? 0 : Math.max(s.y0, starts[i - 1] + 1)));
  const idMap = new Map<string, string>();
  let fixed = false;
  const sections = src.map((s, i) => {
    const y0 = starts[i];
    const y1 = i === src.length - 1 ? H : starts[i + 1];
    if (y0 !== s.y0 || y1 !== s.y1) fixed = true;
    const id = `s${String(i).padStart(2, '0')}`;
    if (!idMap.has(s.id)) idMap.set(s.id, id);
    return { id, name: (s.name || '').trim() || `섹션 ${i + 1}`, y0, y1 };
  });
  if (fixed) warnings.push(warn('계획의 섹션 경계에 빈틈·겹침이 있어 이어지게 고쳤습니다.', 'plan'));
  // 섹션 배경 블록은 overflow:hidden 이라 경계가 글자를 가로지르면 글자가 반쯤 잘려 보인다 (위치 대조는 기준선만 봐서 못 잡음)
  // → 앞뒤 경계 사이에서 가장 가까운 빈 곳으로 경계를 옮긴다. 옮길 곳이 없을 때만 그대로 두고 알린다
  for (let i = 1; i < sections.length; i++) {
    const s = sections[i];
    const y = clearCut(summary.texts, s.y0, sections[i - 1].y0 + 1, s.y1 - 1);
    if (y == null) {
      const hit = summary.texts.find((t) => crossesCut(t, s.y0))!;
      warnings.push(warn(`${s.id} 시작 경계(y ${s.y0})가 글자 "${hit.text.trim().slice(0, 15)}"를 가로지릅니다 — 글자가 잘려 보일 수 있습니다.`, 'plan'));
    } else if (y !== s.y0) {
      sections[i - 1].y1 = y;
      s.y0 = y;
    }
  }
  const photos = (plan.photos || []).map((p) => {
    const sec = sections.find((s) => s.id === idMap.get(p.section)) ?? sections.find((s) => p.y0 >= s.y0 && p.y0 < s.y1) ?? sections[0];
    return { ...p, section: sec.id };
  });
  return { sections, photos };
}

/**
 * 구조 계획 + PSD 요약 → 섹션별 HTML·공통 CSS·자를 이미지 목록.
 * lsAdj: 텍스트 id → 자간 보정(em, lsAdjust.ts 가 PSD 폭과 실제 글자 폭을 재서 구함)
 */
export function generateMarkup(meta: GenerateMeta, summary: PsdSummary, plan0: Plan, lsAdj: Record<number, number> = {}, wraps: Record<number, number[]> = {}): CodegenResult {
  const W = summary.width;
  const goodomall = meta.channel !== 'openmarket';
  const warnings: Check[] = [];
  const norm = normalizeSections(plan0, summary, warnings);
  const plan: Plan = { ...plan0, sections: norm.sections, photos: norm.photos };
  // 접두사는 클래스·id·CSS 선택자에 그대로 들어가므로 형식을 지킨다 (6-1·7-2)
  const prefix = /^dp-[a-z0-9-]+$/.test(plan0.prefix || '') ? plan0.prefix : `dp-${(meta.slug || 'page').replace(/[^a-z0-9-]/g, '').slice(0, 24) || 'page'}`;
  if (prefix !== plan0.prefix) warnings.push(warn(`계획의 접두사 "${plan0.prefix}"가 형식(dp-영문소문자)에 맞지 않아 "${prefix}"로 바꿨습니다.`, 'plan'));
  plan.prefix = prefix;
  const base = imageBaseUrl(meta);
  // 오픈마켓은 px 고정이라 플랫폼 상세 폭보다 넓으면 잘린다 → 플랫폼 폭에 맞춰 모든 값을 비율대로 줄인다 (shared/markets.ts)
  const OW = goodomall ? W : marketWidth(meta.market, W);
  const omScale = OW / W;
  // 플랫폼 출력 규칙 (max-width 금지·table 금지·이미지 세로 비율 — 규칙 원본 7-4)
  const rules = goodomall ? undefined : MARKETS[normMarket(meta.market ?? 'other')].rules;
  // 이미지 한 장 최대 세로 (PSD px): 기본 3000, 비율 제한이 있으면 가로 × 비율 이하
  const maxH = rules?.maxImgRatio ? Math.min(BG_MAX_H, Math.floor(W * rules.maxImgRatio)) : BG_MAX_H;
  const ctx: Ctx = {
    rules,
    goodomall,
    prefix,
    lsAdj,
    wraps,
    warnings,
    usesPaperlogy: false,
    tabStop: tabStopPx(summary.dpi),
    scale: omScale,
    u: goodomall
      ? (n) => {
          const v = r1(n);
          return v === 0 ? '0' : `calc(${v} * var(--u))`;
        }
      : (n) => `${r1(n * omScale)}px`, // 오픈마켓: 플랫폼 폭(예: 쿠팡 780)에 맞춰 비율대로 줄인 px
  };

  const keepReason = keepMap(summary, plan, !goodomall);
  const clipped = goodomall ? clippedTexts(summary) : new Set<number>();
  const usable = summary.texts.filter((t) => t.text.trim() && t.b[2] > t.b[0]);
  const htmlTexts = usable.filter((t) => !keepReason.has(t.id));
  const keptTexts = usable.filter((t) => keepReason.has(t.id));
  const kept: KeptText[] = keptTexts.map((t) => ({ id: t.id, text: t.text.replace(/\s+/g, ' ').trim(), reason: keepReason.get(t.id)! }));

  const images: PlanImage[] = [];
  const sections: SectionOut[] = [];
  let firstImg = true;
  const headings = plan.headings || {};

  for (const sec of plan.sections) {
    const sid = sec.id;
    // 오픈마켓: 섹션을 배경·글자가 합쳐진 이미지 한 장(또는 세로 제한에 맞춘 여러 장)으로 — 모든 크기가 이미지 비율로 줄어 휴대폰에서 잘리지 않는다 (7-5)
    // 글자는 alt 에 남긴다. 검색 영향은 규칙 8-4 에서 확인되지 않았다고 본다
    if (!goodomall && OPENMARKET_SECTION_IMAGE) {
      const st = summary.texts.filter((t) => t.text.trim() && t.lineTop >= sec.y0 && t.lineTop < sec.y1);
      const altAll = [...st].sort((p, q) => p.lineTop - q.lineTop || p.b[0] - q.b[0]).map((t) => t.text.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' · ');
      const cuts = splitBg(sec.y0, sec.y1, usable, maxH);
      const parts: string[] = [];
      for (let i = 0; i < cuts.length - 1; i++) {
        const c0 = cuts[i], c1 = cuts[i + 1];
        const file = `${sid}_bg${i + 1}.jpg`;
        const alt = i === 0 ? (altAll || sec.name) : '';
        images.push({ file, kind: 'bg', source: 'composite', x0: 0, y0: c0, x1: W, y1: c1 });
        parts.push(`  <img src="${base}/${file}" alt="${escAttr(alt)}" width="${OW}" height="${Math.round((c1 - c0) * omScale)}" style="display:block;width:100%;height:auto;border:0">`);
      }
      sections.push({ id: sid, name: sec.name, html: [`<div class="${prefix}-${sid}"${altAll ? '' : ` aria-label="${escAttr(sec.name)}"`}>`, ...parts, '</div>'].join('\n'), css: '', notes: '', raw: '' });
      continue;
    }
    const inSec = (t: TextInfo) => t.baseline >= sec.y0 && t.baseline < sec.y1;
    const secTexts = htmlTexts.filter(inSec);
    const all = secTexts.map((t) => textBox(t, ctx));
    // 클리핑된 글자: 글자 상자 영역의 PSD 원본 합성을 배경으로 깔고 글자 모양으로만 보이게 (글자는 HTML 그대로 — 제목·검색 유지)
    let tn = 0;
    for (const bx of all) {
      if (!clipped.has(bx.t.id)) continue;
      tn++;
      const x0 = Math.max(0, Math.floor(bx.left));
      const y0 = Math.max(0, Math.floor(bx.top));
      const x1 = Math.min(W, Math.ceil(bx.left + bx.width));
      const y1 = Math.min(summary.height, Math.ceil(bx.top + bx.height));
      if (x1 <= x0 || y1 <= y0) continue;
      const file = `${sid}_txt${tn}-${txtSlug(bx.t.text)}.jpg`;
      images.push({ file, kind: 'txt', source: 'composite', x0, y0, x1, y1, alt: bx.t.text.replace(/\s+/g, ' ').trim() });
      Object.assign(bx.style, {
        color: 'transparent',
        '-webkit-text-fill-color': 'transparent',
        'background-image': `url('${base}/${file}')`,
        'background-repeat': 'no-repeat',
        'background-size': `${ctx.u(x1 - x0)} ${ctx.u(y1 - y0)}`,
        'background-position': `${ctx.u(x0 - bx.left)} ${ctx.u(y0 - bx.top)}`,
        '-webkit-background-clip': 'text',
        'background-clip': 'text',
        // text-shadow 는 글자 배경 위에 그려져 PSD 색을 덮는다 → 클리핑된 글자는 그림자 없이
        'text-shadow': null,
      });
    }

    // 제목: 계획의 단계, 섹션에 2단계가 없으면 가장 큰 글자를 h2 로 (8-2 1항)
    const levelOf = new Map<number, number>();
    for (const t of secTexts) {
      const lv = headings[String(t.id)];
      if (lv) levelOf.set(t.id, lv);
    }
    // 계획이 이미지로 남기려던 클리핑 글자(제품명 제목 등)를 실제 글자로 되돌렸고 섹션에서 가장 큰 글자면 대제목으로 (원래 h2 는 소제목으로)
    const biggest = secTexts.length ? secTexts.reduce((a, b) => (b.size > a.size ? b : a)) : null;
    if (biggest && goodomall && clipped.has(biggest.id) && (plan.keepInImage || []).some((k) => k.id === biggest.id) && levelOf.get(biggest.id) !== 2) {
      for (const [id, lv] of levelOf) if (lv === 2) levelOf.set(id, 3);
      levelOf.set(biggest.id, 2);
    }
    if (secTexts.length && ![...levelOf.values()].includes(2)) {
      const big = secTexts.reduce((a, b) => (b.size > a.size ? b : a));
      levelOf.set(big.id, 2);
      if (Object.keys(headings).length) warnings.push(warn(`${sid} ${sec.name}: 계획에 대제목(h2)이 없어 가장 큰 글자 "${big.text.trim().slice(0, 20)}"를 h2 로 했습니다.`, 'plan'));
    }
    const hid = `${prefix}-${sid}`;
    let idDone = false;
    const tagOf = (b: Box) => {
      const lv = levelOf.get(b.t.id);
      if (lv === 2) {
        const attrs = idDone ? '' : ` id="${hid}"`;
        idDone = true;
        return { tag: 'h2', attrs };
      }
      if (lv === 3 || lv === 4) return goodomall ? { tag: 'p', attrs: ` role="heading" aria-level="${lv}"` } : { tag: `h${lv}`, attrs: '' }; // 7-2-1: 고도몰은 h3 금지
      return { tag: 'p', attrs: '' };
    };

    // 사진 띠: 섹션 안으로 자르고, HTML 글자와 겹치면 빼서 배경으로 둔다 (겹치면 글자가 두 번 보임)
    const photos = (plan.photos || [])
      .filter((p) => p.section === sid)
      .map((p) => ({ ...p, y0: Math.max(sec.y0, Math.round(p.y0)), y1: Math.min(sec.y1, Math.round(p.y1)) }))
      .filter((p) => {
        if (p.y1 - p.y0 < 20) return false;
        const hit = secTexts.concat(htmlTexts.filter((t) => !inSec(t))).filter((t) => !(t.b[3] <= p.y0 || t.b[1] >= p.y1));
        if (hit.length) {
          warnings.push(warn(`${sid} 사진 "${p.role}"(y ${p.y0}~${p.y1})이 글자 "${hit[0].text.trim().slice(0, 15)}"와 겹쳐 배경으로 처리했습니다.`, 'plan'));
          return false;
        }
        return true;
      })
      .sort((a, b) => a.y0 - b.y0)
      // 사진 띠끼리 겹치면 뒤 띠를 앞 띠 끝에서 시작 (두 번 그려지고 아래가 밀리는 것 방지)
      .reduce<typeof norm.photos>((acc, p) => {
        const prev = acc[acc.length - 1];
        const y0 = prev ? Math.max(p.y0, prev.y1) : p.y0;
        if (p.y1 - y0 >= 20) acc.push({ ...p, y0 });
        else if (prev) warnings.push(warn(`${sid} 사진 "${p.role}"이 앞 사진과 겹쳐 뺐습니다.`, 'plan'));
        return acc;
      }, []);

    // 블록 나누기: 사진 띠 사이 구간 = 배경+글자 (3000px 넘으면 더 나눔)
    type Block = { type: 'bg'; y0: number; y1: number; boxes: Box[]; file: string } | { type: 'img'; y0: number; y1: number; file: string; alt: string };
    const blocks: Block[] = [];
    let y = sec.y0;
    let k = 0;
    let j = 0;
    const used = new Set<Box>();
    const pushBg = (a: number, b: number) => {
      const cuts = splitBg(a, b, usable, maxH);
      if (cuts.length === 2 && b - a > maxH) warnings.push(warn(`${sid}: 글자가 이어져 있어 배경을 ${maxH}px 이하로 나누지 못했습니다 (세로 ${b - a}px).`));
      for (let i = 0; i < cuts.length - 1; i++) {
        const c0 = cuts[i];
        const c1 = cuts[i + 1];
        const boxes = all.filter((bx) => !used.has(bx) && bx.t.baseline >= c0 && bx.t.baseline < c1);
        boxes.forEach((bx) => used.add(bx));
        k++;
        blocks.push({ type: 'bg', y0: c0, y1: c1, boxes, file: `${sid}_bg${k}.jpg` });
      }
    };
    for (const p of photos) {
      if (p.y0 > y) pushBg(y, p.y0);
      j++;
      const role = (p.role || 'photo').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'photo'; // 하이픈 여러 개는 하나로 (6-1 파일명 규칙)
      // 사진 띠 안에 이미지로 남긴 글자가 있으면 alt 에 원문을 덧붙인다 (구운 글자는 alt 에 빠짐없이, 8-2 3항)
      // 한 글자짜리 번호 라벨(1·2·3…)은 정보가 없어 빼고, alt 에 이미 있는 문구도 다시 넣지 않는다
      const baseAlt = p.alt || sec.name;
      const inPhoto = keptTexts
        .filter((t) => t.b[1] >= p.y0 && t.b[3] <= p.y1)
        .map((t) => t.text.replace(/\s+/g, ' ').trim())
        .filter((s) => s.replace(/\s/g, '').length >= 2 && !baseAlt.includes(s));
      const alt = inPhoto.length ? `${baseAlt} — ${[...new Set(inPhoto)].join(' · ')}` : baseAlt;
      // 세로 3000px 넘는 사진 띠는 같은 높이로 나눈다 (용량·업로드 한도, 규칙 6절). alt 는 첫 조각에, 이어지는 조각은 같은 사진이라 빈 alt
      const parts = Math.ceil((p.y1 - p.y0) / maxH);
      for (let q = 0; q < parts; q++) {
        const a = Math.round(p.y0 + ((p.y1 - p.y0) * q) / parts);
        const b = Math.round(p.y0 + ((p.y1 - p.y0) * (q + 1)) / parts);
        blocks.push({ type: 'img', y0: a, y1: b, file: `${sid}_img${j}-${role}${q ? `-${q + 1}` : ''}.jpg`, alt: q ? '' : alt });
      }
      y = p.y1;
    }
    if (sec.y1 > y) pushBg(y, sec.y1);
    // 사진 띠 안에 기준선이 있는 글자(위에서 걸러져 없어야 정상)는 바로 앞 배경 블록에 붙인다
    const orphans = all.filter((bx) => !used.has(bx));
    if (orphans.length) {
      const bgs = blocks.filter((b): b is Extract<Block, { type: 'bg' }> => b.type === 'bg');
      for (const bx of orphans) {
        const target = bgs.filter((b) => b.y0 <= bx.t.baseline).pop() ?? bgs[0];
        if (target) target.boxes.push(bx);
        else warnings.push(warn(`${sid}: 글자 "${bx.t.text.trim().slice(0, 15)}"를 놓을 배경 블록이 없어 빠졌습니다 (섹션 전체가 사진 띠).`, 'plan'));
      }
    }

    const out: string[] = [];
    out.push(`<!-- ${sid} ${sec.name.replace(/--+/g, '-').replace(/[<>]/g, '')} -->`);
    const labelAttr = all.length ? ` aria-labelledby="${hid}"` : ` aria-label="${escAttr(sec.name)}"`;
    out.push(goodomall ? `<section class="${prefix}-s"${labelAttr}>` : `<div class="${prefix}-${sid}"${all.length ? '' : ` aria-label="${escAttr(sec.name)}"`}>`);
    for (const blk of blocks) {
      const url = `${base}/${blk.file}`;
      const h = blk.y1 - blk.y0;
      if (blk.type === 'img') {
        images.push({ file: blk.file, kind: 'img', source: 'composite', x0: 0, y0: blk.y0, x1: W, y1: blk.y1, alt: blk.alt });
        const lazy = firstImg ? 'loading="eager" fetchpriority="high"' : 'loading="lazy" decoding="async"';
        firstImg = false;
        out.push(
          goodomall
            ? `  <img class="${prefix}-img" src="${url}" alt="${escAttr(blk.alt)}" width="${W}" height="${h}" ${lazy} draggable="false">`
            : `  <img src="${url}" alt="${escAttr(blk.alt)}" width="${OW}" height="${Math.round(h * omScale)}" style="display:block;width:100%;${rules?.noMaxWidth ? '' : `max-width:${OW}px;`}height:auto;border:0">`,
        );
        continue;
      }
      // 배경: 글자 뺀 합성. 이미지에 남길 글자는 그 영역을 PSD 원본 합성에서 잘라 <img alt="원문"> 으로 같은 자리에 둔다 (4절·8-2 3항:
      // 구운 글자는 alt 에 원문). HTML 글자와 겹치거나 블록 경계에 걸리면 이미지로 못 빼므로 예전처럼 배경에 덧그린다(alt 없음 — 경고)
      const patches: [number, number, number, number][] = [];
      for (const t of keptTexts) {
        // 효과(그림자·획·광선)는 bounds 밖으로 퍼진다 → 그만큼 넓게 덧그린다
        const fxPad = Math.max(0, ...(t.shadows || []).map((sh) => Math.max(Math.abs(sh.x), Math.abs(sh.y)) + sh.blur * 1.5), (t.fx || []).some((f) => ['stroke', 'outerGlow'].includes(f)) ? t.size * 0.5 : 0);
        const pad = Math.ceil(Math.max(6, t.size * 0.3, fxPad + 4));
        const px0 = Math.max(0, t.b[0] - pad);
        const py0 = Math.max(blk.y0, t.b[1] - pad);
        const px1 = Math.min(W, t.b[2] + pad);
        const py1 = Math.min(blk.y1, t.b[3] + pad);
        if (px1 <= px0 || py1 <= py0) continue;
        const clash = htmlTexts.find((o) => !(o.b[2] <= px0 || o.b[0] >= px1 || o.b[3] <= py0 || o.b[1] >= py1));
        // 글자는 이웃 블록에 있고 여백·효과만 이 블록에 걸친 경우: 효과가 있으면 그 부분만 조용히 덧그리고 넘어간다 (경고·<img> 는 글자가 있는 블록에서)
        if (t.b[3] <= blk.y0 || t.b[1] >= blk.y1) {
          if (fxPad && !clash) patches.push([px0, py0, px1, py1]);
          continue;
        }
        // 글자 본체가 블록 안이면 <img alt> 로 뺀다 — 여백은 위에서 블록 안으로 잘라 두었다 (섹션 경계가 글자에 가까워도 alt 를 잃지 않게)
        const inside = t.b[1] >= blk.y0 && t.b[3] <= blk.y1;
        if (!clash && inside) {
          tn++;
          const file = `${sid}_txt${tn}-${txtSlug(t.text)}.jpg`;
          const alt = t.text.replace(/\s+/g, ' ').trim();
          images.push({ file, kind: 'txt', source: 'composite', x0: px0, y0: py0, x1: px1, y1: py1, alt });
          blk.boxes.push({ t, top: py0, left: px0, width: px1 - px0, height: py1 - py0, size: t.size, html: '', style: {}, img: { src: `${base}/${file}`, alt } });
          continue;
        }
        patches.push([px0, py0, px1, py1]);
        if (clash) warnings.push(warn(`이미지에 남긴 "${t.text.trim().slice(0, 12)}" 영역이 HTML 글자 "${clash.text.trim().slice(0, 12)}"와 겹쳐 배경에 그렸습니다 — 이 글자는 alt 가 없고, 겹친 글자가 두 번 보일 수 있습니다.`, 'plan'));
        else warnings.push(warn(`이미지에 남긴 "${t.text.trim().slice(0, 12)}"가 배경 경계에 걸려 배경에 그렸습니다 — 이 글자는 HTML 에 alt 가 없습니다.`, 'plan'));
      }
      images.push({ file: blk.file, kind: 'bg', source: 'notext', x0: 0, y0: blk.y0, x1: W, y1: blk.y1, ...(patches.length ? { patches } : {}) });
      blk.boxes.forEach((bx) => (bx.top -= blk.y0));
      const r = emitRows(blk.boxes, ctx, tagOf, '    ');
      // 마지막 줄 상자가 블록 높이보다 내려오면 다음 블록이 밀린다 → 넘친 만큼 아래 여백을 당긴다
      const over = r.prevBottom - h;
      if (goodomall) {
        out.push(`  <div class="${prefix}-sec" style="${over > 0 ? `margin-bottom:${ctx.u(-over)};` : ''}background-image:url('${url}');min-height:${ctx.u(h)};padding-top:${ctx.u(r.first)}">`);
      } else {
        out.push(
          `  <div style="background-image:url('${url}');background-repeat:no-repeat;background-position:center top;background-size:100% auto;min-height:${ctx.u(h)};padding-top:${ctx.u(r.first)};${over > 0 ? `margin-bottom:${ctx.u(-over)};` : ''}overflow:hidden;box-sizing:border-box">`,
        );
      }
      out.push(...r.lines);
      out.push('  </div>');
    }
    out.push(goodomall ? '</section>' : '</div>');
    sections.push({ id: sid, name: sec.name, html: out.join('\n'), css: '', notes: '', raw: '' });
  }

  const style = goodomall ? baseCss(prefix, W, ctx.usesPaperlogy) : '';
  const wrapperStyle = goodomall
    ? undefined
    : `${rules?.noMaxWidth ? (OPENMARKET_FLUID_WRAPPER ? 'width:100%' : `width:${OW}px`) : `max-width:${OW}px`};margin:0 auto;font-family:'Pretendard',${FALLBACK_FAMILY};line-height:1.2;word-break:keep-all;text-align:left;font-weight:400;letter-spacing:normal`;
  // 오픈마켓: 만든 HTML 에 그 플랫폼이 지우거나 막는 요소가 없는지 마지막으로 확인 (규칙 원본 7-4 [공식] 근거).
  // 스마트스토어는 iframe·table·link 가 있으면 모바일 캡처 미리보기가 안 돼 HTML 이 모바일용 고정 글자 크기로 보이며 시안과 달라진다
  if (!goodomall) {
    const out = `${sections.map((s) => s.html).join('\n')}\n${wrapperStyle ?? ''}`;
    const mk = MARKETS[normMarket(meta.market ?? 'other')];
    const bad: string[] = [];
    if (/<style[\s>]/i.test(out)) bad.push('<style>');
    if (/<script[\s>]/i.test(out)) bad.push('<script>');
    if (/<iframe[\s>]/i.test(out)) bad.push('<iframe>');
    if (/<link[\s>]/i.test(out)) bad.push('<link>');
    if (/<a\s/i.test(out)) bad.push('링크 <a>');
    if (mk.rules?.noTable && /<table[\s>]/i.test(out)) bad.push('<table>');
    if (mk.rules?.noMaxWidth && /max-width/i.test(out)) bad.push('max-width');
    warnings.push(
      bad.length
        ? { level: 'error', message: `${mk.label} 규칙에 걸리는 요소가 있습니다: ${bad.join(', ')} — 붙여넣으면 지워지거나 모바일 화면이 시안과 달라질 수 있습니다.` }
        : { level: 'ok', message: `${mk.label} 규칙 확인: 막히는 요소(style·script·iframe·link·외부 링크${mk.rules?.noTable ? '·table' : ''}${mk.rules?.noMaxWidth ? '·max-width' : ''}) 없음` },
    );
  }
  const report = kept.length ? `이미지에 남긴 글자 ${kept.length}개 (문구를 고치려면 PSD 수정 필요):\n${kept.map((k) => `- #${k.id} "${k.text.slice(0, 40)}" — ${k.reason}`).join('\n')}` : '';
  return {
    bundle: { plan: { ...plan, engine: 'code', images, wrapperStyle }, style, notes: report },
    sections,
    kept,
    warnings,
  };
}
