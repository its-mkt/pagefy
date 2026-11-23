// 구조 계획 → 마크업 (코드 생성 방식, 2026-11-23~)
// 검증본 ~/.claude/tools/psd2html/build.js (ZGX Nano 102/102 통과) 의 글자 상자·행 묶기·배경 블록 방식을 일반화해 옮겼다.
// Claude 는 구조(섹션·사진 띠·이미지에 남길 글자·제목 단계)만 정하고, 위치·크기·줄바꿈·자간·색은 PSD 값으로 여기서 계산한다.
//  - 섹션 = [글자 뺀 배경 + 글자 상자 행] 블록과 [사진 <img alt>] 블록을 위에서부터 쌓는다
//  - 글자 상자: 규칙 4-1 (줄 상자 위쪽 = 기준선 − (행간/2 + 0.35×크기), 줄마다 다른 행간, 문단 간격, 끝 공백 보존)
//  - 세로가 겹치는 상자끼리 한 줄(고도몰 flex / 오픈마켓 table)로 묶는다
//  - 고도몰: 모든 크기 calc(N * var(--u)) (7-5), 스타일은 <style> 클래스 + 인라인 / 오픈마켓: 인라인·px 고정 (7-3)
import type { GenerateMeta, Plan, PlanBundle, PlanImage, PsdSummary, TextInfo, TextRun } from '../../shared/types';
import { godoRootCss } from '../../shared/width';
import { FONT_MAP } from './psd/extract';
import type { SectionOut } from './assemble';

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
  warnings: string[];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => esc(s).replace(/"/g, '&quot;');
const r1 = (n: number) => Math.round(n * 10) / 10;
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
  const fx = (t.fx || []).filter((f) => KEEP_FX.includes(f) && !(f === 'dropShadow' && t.shadows?.length));
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
  warnings: string[];
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
    if (r.color !== r0.color) st.push(`color:${colorCss(r.color, alpha)}`);
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
      const st = [...sg.st];
      if (Math.abs(sg.size - cs) > 0.3) st.push(`font-size:${u(sg.size)}`);
      if (sg.size < ln.size - 0.3) st.push('line-height:0');
      return st.length ? `<span style="${st.join(';')}">${h}</span>` : h;
    });
    return out.join('');
  };
  const leadAt = (i: number) => t.lineHeights?.[lines[i].hard] ?? L;

  const uniform = lines.every((ln, i) => Math.abs(leadAt(i) - L) < 0.3 && Math.abs(ln.size - size) < 0.3 && !ln.pgap);
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
        const st = ['display:block', `line-height:${u(Li)}`];
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
    ctx.warnings.push(`상자 텍스트 "${t.text.trim().slice(0, 15)}"의 줄바꿈 위치를 재지 못해 브라우저 줄바꿈에 맡겼습니다 — PSD 와 줄바꿈이 다를 수 있습니다.`);
    height = Math.max(height, Math.round((t.b[3] - t.b[1] - size * 0.7) / L + 1) * L);
  }
  const width = cssWrap ? t.boxWidth! + 2 : Math.max(t.b[2] - t.b[0], 10) + Math.ceil(size * 0.6) + 8; // 글꼴 차이 여유
  const left = align === 'center' ? t.anchorX - width / 2 : align === 'right' ? t.anchorX - width : t.anchorX;
  // 첫 줄 상자 위쪽 = 기준선 − (첫 줄 행간/2 + 0.35 × 첫 줄 크기) (4-1). 첫 줄에 더 큰 글자가 섞이면 그 크기 기준
  const top = t.baseline - (leadAt(0) / 2 + 0.35 * lines[0].size);
  const style: Record<string, string | null> = {
    'font-family': familyOf(t.font) === 'Paperlogy' ? familyCss(t.font, ctx) : null,
    'font-size': u(size),
    'line-height': u(L),
    'font-weight': String(t.weight),
    color: colorCss(t.color, alpha),
    'letter-spacing': Math.abs(lsBase) >= 0.0005 ? `${Math.round(lsBase * 10000) / 10000}em` : null,
    'text-align': align !== 'left' ? align : null,
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
  for (const row of rows) {
    row.items.sort((a, b) => a.left - b.left);
    const mt = row.top - prevBottom;
    const el = (b: Box, ml: number) => {
      const { tag, attrs } = tagOf(b);
      const st = { ...reset, ...b.style, width: u(b.width), 'margin-left': ml ? u(ml) : null, 'margin-top': b.top - row.top ? u(b.top - row.top) : null };
      return `<${tag}${attrs} style="${styleStr(st)}">${b.html}</${tag}>`;
    };
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
      const { tag, attrs } = tagOf(b);
      const st = { ...reset, ...b.style, width: u(b.width), 'margin-left': b.left ? u(b.left) : null, 'margin-top': mt ? u(mt) : null };
      lines.push(`${ind}<${tag}${attrs} style="${styleStr(st)}">${b.html}</${tag}>`);
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

/** 배경 구간 [a,b) 를 세로 3000px 이하 조각으로. 자르는 위치는 글자 bounds 가 걸치지 않는 곳 */
function splitBg(a: number, b: number, texts: TextInfo[]): number[] {
  const cuts = [a];
  let y = a;
  const crosses = (cy: number) => texts.some((t) => t.b[1] < cy && t.b[3] > cy);
  while (b - y > BG_MAX_H) {
    let cut = -1;
    for (let cy = y + BG_MAX_H; cy >= y + 1000; cy--) {
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

/** 이미지에 남길 글자 id → 이유: 계획이 고른 것 + 자동(bakeHint·효과·칠 0%·표에 없는 폰트, 오픈마켓은 클리핑된 글자도) */
export function keepMap(summary: PsdSummary, plan: Plan, openmarket = false): Map<number, string> {
  const m = new Map<number, string>();
  for (const t of summary.texts) {
    const r = autoKeep(t);
    if (r) m.set(t.id, r);
  }
  // 고도몰은 클리핑된 글자를 background-clip:text 로 PSD 색 그대로 칠한다. 오픈마켓 에디터는 그 CSS 를 지울 수 있어 이미지로
  if (openmarket) for (const id of clippedTexts(summary)) if (!m.has(id)) m.set(id, '클리핑 마스크로 칠한 글자 (오픈마켓은 CSS 로 못 옮김)');
  for (const k of plan.keepInImage || []) if (!m.has(k.id)) m.set(k.id, k.reason || '계획에서 이미지로');
  return m;
}

/**
 * 구조 계획 + PSD 요약 → 섹션별 HTML·공통 CSS·자를 이미지 목록.
 * lsAdj: 텍스트 id → 자간 보정(em, lsAdjust.ts 가 PSD 폭과 실제 글자 폭을 재서 구함)
 */
/**
 * 계획의 섹션을 문서에 맞게 정리한다: 위→아래 정렬, 0~문서 높이로 자르기, 빈틈·겹침 없이 잇기, id 를 s00… 로 다시 매기기.
 * Claude 가 섹션을 조금 틀리게 줘도 글자가 빠지거나 두 번 나오지 않게. 사진 띠의 section 도 새 id 로 바꾼다
 */
function normalizeSections(plan: Plan, summary: PsdSummary, warnings: string[]): { sections: Plan['sections']; photos: NonNullable<Plan['photos']> } {
  const H = summary.height;
  const src = (plan.sections || [])
    .filter((s) => Number.isFinite(s.y0) && Number.isFinite(s.y1))
    .map((s) => ({ ...s, y0: Math.max(0, Math.min(H, Math.round(s.y0))), y1: Math.max(0, Math.min(H, Math.round(s.y1))) }))
    .filter((s) => s.y1 > s.y0)
    .sort((a, b) => a.y0 - b.y0);
  if (!src.length) {
    warnings.push('계획에 쓸 수 있는 섹션이 없어 문서 전체를 섹션 하나로 만들었습니다.');
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
  if (fixed) warnings.push('계획의 섹션 경계에 빈틈·겹침이 있어 이어지게 고쳤습니다.');
  // 섹션 경계가 글자를 가로지르면 그 글자가 잘릴 수 있다
  for (const s of sections.slice(1)) {
    const hit = summary.texts.find((t) => t.text.trim() && t.b[1] < s.y0 - 1 && t.b[3] > s.y0 + 1);
    if (hit) warnings.push(`${s.id} 시작 경계(y ${s.y0})가 글자 "${hit.text.trim().slice(0, 15)}"를 가로지릅니다 — 글자가 잘려 보일 수 있습니다.`);
  }
  const photos = (plan.photos || []).map((p) => {
    const sec = sections.find((s) => s.id === idMap.get(p.section)) ?? sections.find((s) => p.y0 >= s.y0 && p.y0 < s.y1) ?? sections[0];
    return { ...p, section: sec.id };
  });
  return { sections, photos };
}

export function generateMarkup(meta: GenerateMeta, summary: PsdSummary, plan0: Plan, lsAdj: Record<number, number> = {}, wraps: Record<number, number[]> = {}): CodegenResult {
  const W = summary.width;
  const goodomall = meta.channel !== 'openmarket';
  const warnings: string[] = [];
  const norm = normalizeSections(plan0, summary, warnings);
  const plan: Plan = { ...plan0, sections: norm.sections, photos: norm.photos };
  // 접두사는 클래스·id·CSS 선택자에 그대로 들어가므로 형식을 지킨다 (6-1·7-2)
  const prefix = /^dp-[a-z0-9-]+$/.test(plan0.prefix || '') ? plan0.prefix : `dp-${(meta.slug || 'page').replace(/[^a-z0-9-]/g, '').slice(0, 24) || 'page'}`;
  if (prefix !== plan0.prefix) warnings.push(`계획의 접두사 "${plan0.prefix}"가 형식(dp-영문소문자)에 맞지 않아 "${prefix}"로 바꿨습니다.`);
  plan.prefix = prefix;
  const base = `${meta.publicRoot.replace(/\/+$/, '')}/${meta.channel}/${meta.slug}/${meta.rev}`;
  const ctx: Ctx = {
    goodomall,
    prefix,
    lsAdj,
    wraps,
    warnings,
    usesPaperlogy: false,
    u: goodomall
      ? (n) => {
          const v = r1(n);
          return v === 0 ? '0' : `calc(${v} * var(--u))`;
        }
      : (n) => `${r1(n)}px`,
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
      const file = `${sid}_txt${tn}.jpg`;
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
    if (secTexts.length && ![...levelOf.values()].includes(2)) {
      const big = secTexts.reduce((a, b) => (b.size > a.size ? b : a));
      levelOf.set(big.id, 2);
      if (Object.keys(headings).length) warnings.push(`${sid} ${sec.name}: 계획에 대제목(h2)이 없어 가장 큰 글자 "${big.text.trim().slice(0, 20)}"를 h2 로 했습니다.`);
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
          warnings.push(`${sid} 사진 "${p.role}"(y ${p.y0}~${p.y1})이 글자 "${hit[0].text.trim().slice(0, 15)}"와 겹쳐 배경으로 처리했습니다.`);
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
        else if (prev) warnings.push(`${sid} 사진 "${p.role}"이 앞 사진과 겹쳐 뺐습니다.`);
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
      const cuts = splitBg(a, b, usable);
      if (cuts.length === 2 && b - a > BG_MAX_H) warnings.push(`${sid}: 글자가 이어져 있어 배경을 ${BG_MAX_H}px 이하로 나누지 못했습니다 (세로 ${b - a}px).`);
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
      const role = (p.role || 'photo').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'photo';
      blocks.push({ type: 'img', y0: p.y0, y1: p.y1, file: `${sid}_img${j}-${role}.jpg`, alt: p.alt || sec.name });
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
        else warnings.push(`${sid}: 글자 "${bx.t.text.trim().slice(0, 15)}"를 놓을 배경 블록이 없어 빠졌습니다 (섹션 전체가 사진 띠).`);
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
            : `  <img src="${url}" alt="${escAttr(blk.alt)}" width="${W}" height="${h}" style="display:block;width:100%;max-width:${W}px;height:auto;border:0">`,
        );
        continue;
      }
      // 배경: 글자 뺀 합성 + 이미지에 남길 글자는 PSD 원본 합성을 덧그린다
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
        patches.push([px0, py0, px1, py1]);
        const clash = htmlTexts.find((o) => !(o.b[2] <= px0 || o.b[0] >= px1 || o.b[3] <= py0 || o.b[1] >= py1));
        if (clash) warnings.push(`이미지에 남긴 "${t.text.trim().slice(0, 12)}" 영역이 HTML 글자 "${clash.text.trim().slice(0, 12)}"와 겹쳐 그 글자가 두 번 보일 수 있습니다.`);
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
    : `max-width:${W}px;margin:0 auto;font-family:'Pretendard',${FALLBACK_FAMILY};line-height:1.2;word-break:keep-all;text-align:left;font-weight:400;letter-spacing:normal`;
  const report = kept.length ? `이미지에 남긴 글자 ${kept.length}개 (문구를 고치려면 PSD 수정 필요):\n${kept.map((k) => `- #${k.id} "${k.text.slice(0, 40)}" — ${k.reason}`).join('\n')}` : '';
  return {
    bundle: { plan: { ...plan, engine: 'code', images, wrapperStyle }, style, notes: report },
    sections,
    kept,
    warnings,
  };
}
