// 글자 폭 측정 — 자간 보정 + 상자(단락) 텍스트 자동 줄바꿈 위치
// 규칙 4-1 "글자 폭": 웹 렌더가 포토샵보다 약 1% 넓다 → 줄 폭을 재서 텍스트별 letter-spacing 을 고친다.
// psd2html widthadj.js 를 브라우저용으로 옮김. 그쪽은 PSD 렌더와 HTML 렌더의 잉크 폭을 픽셀로 비교했고, 여기서는 캔버스로:
//  - PSD 쪽 폭 = 텍스트 레이어 bounds 폭 (= 가장 긴 줄의 잉크 폭; 왼쪽·가운데·오른쪽 정렬 모두 줄들이 그 안에 들어간다)
//  - HTML 쪽 폭 = 출력과 같은 Pretendard v1.3.9 조각(fontLock 의 @font-face)으로 캔버스 measureText 한 잉크 폭
//  - 보정 em = (PSD 폭 − HTML 폭) ÷ (글자 수 − 1) ÷ 글자 크기
// 상자 텍스트는 포토샵이 상자 폭에서 자동으로 줄을 바꾼다(텍스트 값에는 강제 줄바꿈만 있음) → 같은 폰트로 재서 줄바꿈 위치를 정한다.
import type { PsdSummary, TextInfo, TextRun } from '../../shared/types';
import { fontFaces, pretendardChars } from './fontLock';
import { tabbedWidth, tabStopPx } from './tabs';

const MEASURE_FAMILY = 'pf-measure';
/** 이보다 작은 차이는 고치지 않는다 (px) */
const MIN_DIFF = 1.5;
/** 이보다 큰 보정이 나오면 bounds 를 믿을 수 없는 경우(변형·효과 등)로 보고 건드리지 않는다 (em) */
const MAX_ADJ = 0.05;
/** 폰트 받기를 이만큼만 기다린다 (ms) — 넘으면 보정 없이 진행 */
const LOAD_TIMEOUT = 8000;

let styleEl: HTMLStyleElement | null = null;

/** 출력과 같은 폰트 조각을 화면 문서에 이름만 바꿔 올린다 */
async function loadMeasureFonts(summary: PsdSummary) {
  const chars = pretendardChars(summary);
  const css = fontFaces(chars).rules.map((r) => r.replace(/font-family:'[^']+'/, `font-family:'${MEASURE_FAMILY}'`).replace('font-display:block', 'font-display:auto'));
  styleEl?.remove();
  styleEl = document.createElement('style');
  styleEl.textContent = css.join('\n');
  document.head.appendChild(styleEl);
  const jobs = [...chars].map(([w, set]) => {
    const sample = [...set].map((c) => String.fromCodePoint(c)).join('');
    return { font: `${w} 40px '${MEASURE_FAMILY}'`, sample };
  });
  let timer = 0;
  await Promise.race([
    Promise.all(jobs.map((j) => document.fonts.load(j.font, j.sample))),
    new Promise((_, reject) => (timer = window.setTimeout(() => reject(new Error(`${LOAD_TIMEOUT / 1000}초 안에 받지 못함`)), LOAD_TIMEOUT))),
  ]).finally(() => clearTimeout(timer));
  // 정말 그 폰트로 재는지 확인 (조용히 시스템 폰트로 재면 보정이 틀린다)
  const bad = jobs.filter((j) => !document.fonts.check(j.font, j.sample));
  if (bad.length) throw new Error(`일부 굵기 폰트가 준비되지 않음 (${bad.map((b) => b.font.split(' ')[0]).join(', ')})`);
}

const isPretendard = (f: string) => /^Pretendard-/i.test(f);
const runsOf = (t: TextInfo): TextRun[] => (t.runs?.length ? t.runs : [{ text: t.text, font: t.font, size: t.size, weight: t.weight, color: t.color, ls: t.ls }]);

type Ctx2D = OffscreenCanvasRenderingContext2D;

/** 글자 하나하나의 스타일 (상자 텍스트 줄바꿈용) */
function charStyles(t: TextInfo) {
  const out: { ch: string; weight: number; size: number; ls: number }[] = [];
  // UTF-16 단위로 센다 (codegen 이 같은 위치에서 줄을 나눈다)
  for (const r of runsOf(t)) for (let k = 0; k < r.text.length; k++) out.push({ ch: r.text[k], weight: r.weight, size: r.size, ls: r.ls });
  return out;
}

/** 글자 범위 [a,b) 의 진행 폭 (스타일이 같은 덩어리끼리 measureText + 자간) */
function advance(ctx: Ctx2D, cs: ReturnType<typeof charStyles>, a: number, b: number, caps: boolean) {
  let w = 0;
  let i = a;
  while (i < b) {
    let j = i + 1;
    while (j < b && cs[j].weight === cs[i].weight && cs[j].size === cs[i].size) j++;
    ctx.font = `${cs[i].weight} ${cs[i].size}px '${MEASURE_FAMILY}'`;
    const s = cs.slice(i, j).map((c) => c.ch).join('');
    w += ctx.measureText(caps ? s.toUpperCase() : s).width;
    for (let k = i; k < j; k++) w += cs[k].ls * cs[k].size;
    i = j;
  }
  return w;
}

/**
 * 상자 텍스트의 자동 줄바꿈 위치 (새 줄이 시작하는 글자 위치, t.text 기준). 띄어쓰기에서만 바꾸고(word-break:keep-all 과 같게),
 * 한 낱말이 상자보다 길면 글자 단위로 바꾼다
 */
function wrapPoints(ctx: Ctx2D, t: TextInfo): number[] {
  const cs = charStyles(t);
  const maxW = t.boxWidth! + 0.5;
  const out: number[] = [];
  let lineStart = 0;
  const isBreak = (c: string) => c === '\r' || c === '\n' || c === '\u0003';
  for (let i = 0; i <= cs.length; i++) {
    if (i < cs.length && !isBreak(cs[i].ch)) continue;
    // [lineStart, i) 는 강제 줄바꿈 사이 한 문단 → 넘치면 나눈다
    let s = lineStart;
    while (s < i) {
      let lastSpace = -1;
      let k = s;
      for (; k < i; k++) {
        if (cs[k].ch === ' ') lastSpace = k;
        // 줄 끝 공백은 폭에 넣지 않는다
        let e = k + 1;
        while (e > s && cs[e - 1].ch === ' ') e--;
        if (e > s && advance(ctx, cs, s, e, !!t.caps) > maxW) break;
      }
      if (k >= i) break; // 남은 글자가 다 들어감
      let next = lastSpace > s ? lastSpace + 1 : Math.max(k, s + 1);
      while (next < i && cs[next].ch === ' ') next++;
      if (next >= i) break;
      out.push(next);
      s = next;
    }
    lineStart = i + 1;
  }
  return out;
}

/** 줄들의 글자 (강제 줄바꿈 + 자동 줄바꿈 반영, 끝 공백 제외) */
function linesWith(t: TextInfo, wraps: number[]) {
  const cuts = new Set(wraps);
  const lines: string[] = [];
  let cur = '';
  t.text.split('').forEach((ch, i) => {
    if (cuts.has(i)) {
      lines.push(cur);
      cur = '';
    }
    if (ch === '\r' || ch === '\n' || ch === '\u0003') {
      lines.push(cur);
      cur = '';
    } else cur += ch;
  });
  lines.push(cur);
  return lines.map((l) => (t.caps ? l.toUpperCase() : l).replace(/\s+$/, '')).filter((l) => l.trim());
}

export interface Measured {
  /** 텍스트 id → 자간 보정 em */
  adj: Record<number, number>;
  /** 상자 텍스트 id → 자동 줄바꿈 위치 */
  wraps: Record<number, number[]>;
  error?: string;
}

/**
 * 자간 보정 + 상자 텍스트 줄바꿈. 폰트를 못 불러오면 빈 값 (보정 없이, 상자 텍스트는 브라우저 줄바꿈으로 진행).
 * skip: 이미지에 남길 텍스트 id
 */
export async function measureTexts(summary: PsdSummary, skip: Set<number>): Promise<Measured> {
  const live = summary.texts.filter((t) => !skip.has(t.id) && t.text.trim() && runsOf(t).filter((r) => r.text.trim()).every((r) => isPretendard(r.font)));
  if (!live.length) return { adj: {}, wraps: {} };
  try {
    await loadMeasureFonts(summary);
  } catch (e) {
    return { adj: {}, wraps: {}, error: `글자 폭 측정용 폰트를 불러오지 못했습니다: ${(e as Error).message}` };
  }
  const ctx = new OffscreenCanvas(8, 8).getContext('2d')!;
  const adj: Record<number, number> = {};
  const wraps: Record<number, number[]> = {};
  for (const t of live) {
    const w = t.shape === 'box' && t.boxWidth ? wrapPoints(ctx, t) : [];
    if (t.shape === 'box' && t.boxWidth) wraps[t.id] = w;
    // 자간 보정은 한 가지 스타일 텍스트만 (섞이면 줄 폭을 한 값으로 못 맞춤)
    if (t.runs?.length || t.b[2] - t.b[0] < 10) continue;
    ctx.font = `${t.weight} ${t.size}px '${MEASURE_FAMILY}'`;
    let best = { w: -1, n: 0 };
    for (const line of linesWith(t, w)) {
      // 탭이 있으면 탭 위치만큼 건너뛴 폭 — 자간은 마지막 탭 뒤 글자만 폭을 바꾼다
      const tail = line.slice(line.lastIndexOf('	') + 1);
      const n = [...tail].length;
      let ink: number;
      if (line.includes('	')) ink = tabbedWidth(line, tabStopPx(summary.dpi), (s) => ctx.measureText(s).width) + t.ls * t.size * Math.max(0, n - 1);
      else {
        const m = ctx.measureText(line);
        ink = m.actualBoundingBoxLeft + m.actualBoundingBoxRight + t.ls * t.size * (n - 1);
      }
      if (ink > best.w) best = { w: ink, n };
    }
    if (best.n < 3) continue;
    const d = t.b[2] - t.b[0] - best.w;
    if (Math.abs(d) < MIN_DIFF) continue;
    const em = d / (best.n - 1) / t.size;
    if (Math.abs(em) > MAX_ADJ) continue;
    adj[t.id] = Math.round(em * 10000) / 10000;
  }
  return { adj, wraps };
}
