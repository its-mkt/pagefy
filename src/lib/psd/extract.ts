// ag-psd 로 읽은 PSD → Claude 에게 넘길 레이어·텍스트 요약 (순수 함수: 브라우저 워커와 Node 점검 스크립트가 같이 씀)
// 규칙 원본: \\192.168.1.254\마케팅팀\A_상세페이지\pagefy.md (3절 사용 레이어 판정, 4절·4-1 텍스트 환산)
import type { Color, Layer, Psd, TextStyle } from 'ag-psd';
import type { LayerInfo, PsdSummary, TextInfo, TextRun } from '../../../shared/types';

/** 규칙 5절 폰트 매핑 표. 표에 없는 폰트는 임의로 대체하지 않고 경고로 알린다 */
export const FONT_MAP: { test: RegExp; family: string }[] = [
  { test: /^Pretendard-/i, family: 'Pretendard' },
  // 페이퍼로지: 1Thin~9Black. PSD 에 따라 앞부분이 빠진 "-3Light" 처럼 읽히기도 한다
  { test: /^(Paperlogy)?-?[1-9](Thin|ExtraLight|Light|Regular|Medium|SemiBold|Bold|ExtraBold|Black)$/i, family: 'Paperlogy' },
];

/** 규칙 5절 "이미지로 굽는 폰트" 표. 이 폰트가 쓰인 텍스트 레이어는 이미지로 굽는다 */
export const BAKE_FONTS: RegExp[] = [/^KoreanCNM/i, /^RixYeoljeongdo/i, /^NotoColorEmoji/i];

const WEIGHT_BY_STYLE: [RegExp, number][] = [
  [/thin|hairline/i, 100],
  [/extralight|ultralight/i, 200],
  [/light/i, 300],
  [/semibold|demibold/i, 600],
  [/extrabold|ultrabold/i, 800],
  [/black|heavy/i, 900],
  [/bold/i, 700],
  [/medium/i, 500],
  [/regular|normal|book|roman/i, 400],
];

export function weightOf(font: string): number {
  const style = font.includes('-') ? font.slice(font.lastIndexOf('-') + 1) : font;
  for (const [re, w] of WEIGHT_BY_STYLE) if (re.test(style)) return w;
  return 400;
}

export const isMappedFont = (font: string) => FONT_MAP.some((m) => m.test.test(font));
export const isBakeFont = (font: string) => BAKE_FONTS.some((re) => re.test(font));

const r2 = (n: number) => Math.round(n * 100) / 100;

/** ag-psd 색 → RGB 0~255 (CMYK·회색조·HSB·Lab 은 대략 환산) */
export function rgbOf(c?: Color): [number, number, number] {
  if (!c) return [0, 0, 0];
  if ('r' in c) return [c.r, c.g, c.b];
  if ('fr' in c) return [c.fr * 255, c.fg * 255, c.fb * 255];
  if ('c' in c) {
    const k = c.k / 255;
    return [255 * (1 - c.c / 255) * (1 - k), 255 * (1 - c.m / 255) * (1 - k), 255 * (1 - c.y / 255) * (1 - k)];
  }
  if ('k' in c) return [255 - c.k, 255 - c.k, 255 - c.k]; // 회색조 k = 검정 잉크 양 (255 = 검정)
  if ('h' in c) {
    // HSB: h 각도, s·b 0~1
    const h = (((c.h % 360) + 360) % 360) / 60, s = c.s, v = c.b * 255;
    const f = (n: number) => { const k = (n + h) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
    return [f(5), f(3), f(1)];
  }
  if ('l' in c) {
    // Lab(D50) → sRGB 대략: l 0~1, a·b -1~1 (ag-psd 정규화) → ±128
    const L = c.l * 100, A = c.a * 128, B = c.b * 128;
    const fy = (L + 16) / 116, fx = fy + A / 500, fz = fy - B / 200;
    const inv = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
    const X = 0.9642 * inv(fx), Y = inv(fy), Z = 0.8251 * inv(fz);
    const lin = [3.1339 * X - 1.6169 * Y - 0.4906 * Z, -0.9785 * X + 1.9160 * Y + 0.0333 * Z, 0.0720 * X - 0.2290 * Y + 1.4057 * Z];
    return lin.map((u) => 255 * (u <= 0.0031308 ? 12.92 * u : 1.055 * u ** (1 / 2.4) - 0.055)) as [number, number, number];
  }
  return [0, 0, 0];
}

function hex(c?: Color): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return rgbOf(c).map(h).join('');
}

function enabledEffects(layer: Layer): string[] | undefined {
  const fx = layer.effects;
  if (!fx || fx.disabled) return undefined;
  const out: string[] = [];
  const on = (v: unknown) => (Array.isArray(v) ? v.some((e) => e && e.enabled !== false) : !!v && (v as { enabled?: boolean }).enabled !== false);
  if (on(fx.dropShadow)) out.push('dropShadow');
  if (on(fx.innerShadow)) out.push('innerShadow');
  if (on(fx.outerGlow)) out.push('outerGlow');
  if (on(fx.innerGlow)) out.push('innerGlow');
  if (on(fx.bevel)) out.push('bevel');
  if (on(fx.solidFill)) out.push('colorOverlay');
  if (on(fx.satin)) out.push('satin');
  if (on(fx.stroke)) out.push('stroke');
  if (on(fx.gradientOverlay)) out.push('gradientOverlay');
  if (on(fx.patternOverlay)) out.push('patternOverlay');
  return out.length ? out : undefined;
}

function kindOf(layer: Layer): LayerInfo['kind'] {
  if (layer.children) return 'group';
  if (layer.text) return 'text';
  if (layer.adjustment) return 'adjustment';
  if (layer.placedLayer) return 'smartObject';
  if (layer.vectorFill && !layer.vectorOrigination) return 'fill';
  if (layer.vectorOrigination || layer.vectorMask) return 'shape';
  return 'pixel';
}

function fillDesc(layer: Layer): string | undefined {
  const f = layer.vectorFill;
  if (!f) return undefined;
  if (f.type === 'color') return `#${hex(f.color)}`;
  if (f.type === 'solid') return `gradient(${f.style ?? 'linear'}, ${f.angle ?? 0}deg, ${(f.colorStops || []).map((s) => `#${hex(s.color)} ${Math.round((s.location > 1 ? s.location / 4096 : s.location) * 100)}%`).join(', ')})`;
  return f.type;
}

/** 텍스트 레이어의 변형 배율 (세로). transform = [xx, xy, yx, yy, tx, ty] */
function scaleY(t: number[] | undefined) {
  if (!t) return 1;
  return Math.hypot(t[2], t[3]) || 1;
}

function alignOf(j?: string): TextInfo['align'] {
  if (!j) return 'left';
  if (j === 'center' || j === 'justify-center') return 'center';
  if (j === 'right' || j === 'justify-right') return 'right';
  if (j === 'justify-all' || j === 'justify-left') return j === 'justify-all' ? 'justify' : 'left';
  return 'left';
}

function styleOf(base: TextStyle | undefined, over: TextStyle | undefined): TextStyle {
  return { ...(base || {}), ...(over || {}) };
}

/**
 * 드롭섀도 → text-shadow (규칙 4절 표: 드롭섀도 → text-shadow). 포토샵 각도는 빛이 오는 방향이라 그림자는 반대쪽:
 * x = −거리·cos(각도), y = 거리·sin(각도). 크기(size) ≈ 흐림 반경. 스프레드(choke)·윤곽선은 옮기지 않는다.
 */
function shadowsOf(layer: Layer, globalAngle: number, scale: number): TextInfo['shadows'] {
  const fx = layer.effects;
  if (!fx || fx.disabled || !fx.dropShadow) return undefined;
  const list = (Array.isArray(fx.dropShadow) ? fx.dropShadow : [fx.dropShadow]).filter((e) => e && e.enabled !== false);
  const out = list.map((e) => {
    const a = (((e.useGlobalLight ?? true) ? globalAngle : (e.angle ?? globalAngle)) * Math.PI) / 180;
    const d = (e.distance?.value ?? 0) * scale;
    const [r, g, b] = rgbOf(e.color);
    return { x: r2(-d * Math.cos(a)), y: r2(d * Math.sin(a)), blur: r2((e.size?.value ?? 0) * scale), color: `rgba(${r},${g},${b},${r2(e.opacity ?? 0.75)})` };
  });
  return out.length ? out : undefined;
}

/**
 * 색상 오버레이(혼합 모드 보통) → 글자색 (규칙 4절 표: 색상 오버레이 → color).
 * 다른 혼합 모드는 CSS 로 같게 못 내므로 undefined (그 글자는 이미지로 남는다)
 */
function overlayOf(layer: Layer): TextInfo['overlay'] {
  const fx = layer.effects;
  if (!fx || fx.disabled || !fx.solidFill) return undefined;
  const list = (Array.isArray(fx.solidFill) ? fx.solidFill : [fx.solidFill]).filter((e) => e && e.enabled !== false);
  if (list.length !== 1) return undefined;
  const e = list[0];
  if (e.blendMode && e.blendMode !== 'normal') return undefined;
  return { color: hex(e.color), opacity: r2(e.opacity ?? 1) };
}

function textInfo(layer: Layer, path: string, globalAngle = 120): TextInfo | null {
  const t = layer.text;
  if (!t) return null;
  const tf = t.transform;
  const sy = scaleY(tf);
  const raw = t.text ?? '';
  const baseStyle = t.style || {};

  // 글자 범위별 스타일 (규칙 4-1: 범위가 겹치거나 반복될 수 있으므로 앞에서부터 안 쓴 글자만 쓴다)
  const runs: TextRun[] = [];
  /** 글자 위치의 문단 스타일 (paragraphStyleRuns 는 글자 수 단위, 문단마다 다를 수 있음) */
  const paraAt = (idx: number) => {
    let c = 0;
    for (const r of t.paragraphStyleRuns || []) {
      if (idx < c + r.length) return { ...(t.paragraphStyle || {}), ...(r.style || {}) };
      c += r.length;
    }
    return t.paragraphStyle || {};
  };
  /** 글자 범위별 행간 (자동 행간 = 그 글자 크기 × 문단의 자동 행간 배율, 기본 1.2) — 줄마다 가장 큰 값을 쓴다 (규칙 4-1) */
  const spans: { start: number; end: number; lh: number }[] = [];
  const leadingOf = (st: TextStyle, at = 0) => {
    if (st.autoLeading === false && st.leading) return st.leading * sy;
    const ratio = paraAt(at).autoLeading;
    return (st.fontSize ?? 12) * sy * (typeof ratio === 'number' && ratio > 0.5 && ratio < 5 ? ratio : 1.2);
  };
  let cursor = 0;
  for (const r of t.styleRuns || [{ length: raw.length, style: {} }]) {
    const start = cursor;
    const end = Math.min(raw.length, cursor + r.length);
    cursor = end;
    if (end <= start) continue;
    const st = styleOf(baseStyle, r.style);
    const font = st.font?.name || 'unknown';
    spans.push({ start, end, lh: leadingOf(st, start) });
    runs.push({
      text: raw.slice(start, end),
      font,
      size: r2((st.fontSize ?? 12) * sy),
      weight: weightOf(font),
      color: hex(st.fillColor),
      ls: Math.round(st.tracking ?? 0) / 1000,
    });
  }
  if (!runs.length) runs.push({ text: raw, font: baseStyle.font?.name || 'unknown', size: r2((baseStyle.fontSize ?? 12) * sy), weight: weightOf(baseStyle.font?.name || ''), color: hex(baseStyle.fillColor), ls: (baseStyle.tracking ?? 0) / 1000 });

  // 대표 스타일 = 공백이 아닌 첫 글자 범위
  const first = runs.find((r) => r.text.trim()) || runs[0];
  const firstStyle = styleOf(baseStyle, (t.styleRuns || [])[runs.indexOf(first)]?.style);
  const size = first.size;
  const lines = raw.replace(/\r\n?/g, '\n').replace(/\u0003/g, '\n').split('\n');
  while (lines.length > 1 && !lines[lines.length - 1].trim()) lines.pop();

  // 줄마다 그 줄 글자들의 가장 큰 행간 (\r\n 은 한 줄바꿈 — 원문 위치로 센다)
  if (!spans.length) spans.push({ start: 0, end: raw.length, lh: leadingOf(baseStyle) });
  const lineLh: number[] = [];
  /** 줄마다 그 줄 문단의 정렬 (포토샵 justification 원문) */
  const lineJust: string[] = [];
  const breaks = /\r\n|[\r\n\u0003]/g;
  let pos = 0;
  for (let li = 0; li < lines.length; li++) {
    breaks.lastIndex = pos;
    const m = breaks.exec(raw);
    const end = m ? m.index : raw.length;
    let best = 0;
    for (const sp of spans) if (sp.start < Math.max(end, pos + 1) && sp.end > pos) best = Math.max(best, sp.lh);
    lineLh.push(r2(best || size * 1.2));
    lineJust.push(String(paraAt(pos).justification ?? 'left'));
    pos = m ? m.index + m[0].length : raw.length;
  }
  const lineHeight = lineLh[0];
  const lineHeights = lineLh.some((v) => Math.abs(v - lineHeight) > 0.3) ? lineLh : undefined;
  // 문단마다 정렬이 다르거나 양쪽 정렬이면 줄별 정렬을 넘긴다 (codegen 이 줄마다 text-align 을 준다)
  const lineAligns = new Set(lineJust).size > 1 || lineJust.some((j) => j.startsWith('justify')) ? lineJust : undefined;

  // 줄마다 그 앞의 문단 간격 (규칙 4-1): 문단 나눔(\r·\n)이면 앞 문단 spaceAfter + 이 문단 spaceBefore, 소프트 줄바꿈(\u0003)은 0.
  // 문단 스타일은 paragraphStyleRuns(글자 수 단위)에 문단마다 다를 수 있다 → 줄 첫 글자 위치의 스타일을 쓴다 (paraAt 은 위에 정의)
  const gaps: number[] = [0];
  {
    let p = 0;
    let prevStart = 0;
    for (let li = 1; li < lines.length; li++) {
      breaks.lastIndex = p;
      const m = breaks.exec(raw);
      if (!m) break;
      const start = m.index + m[0].length;
      gaps.push(m[0] === '\u0003' ? 0 : r2(((paraAt(prevStart).spaceAfter ?? 0) + (paraAt(start).spaceBefore ?? 0)) * sy));
      prevStart = start;
      p = start;
    }
  }
  const paraGaps = gaps.some((g) => g) ? gaps : undefined;

  const shape: TextInfo['shape'] = t.shapeType === 'box' ? 'box' : 'point';
  const tx = tf ? tf[4] : layer.left ?? 0;
  const ty = tf ? tf[5] : layer.top ?? 0;
  const box = t.boxBounds; // [left, top, right, bottom] (원점 기준, 변형 전)
  // 기준선: 점 텍스트 = 원점 y, 상자 텍스트 = 상자 위쪽 + 0.76 × 크기 (규칙 4-1)
  const bs = (firstStyle.baselineShift ?? 0) * sy;
  const baseline = r2((shape === 'box' && box ? ty + box[1] * sy + 0.76 * size : ty) - bs);
  const lineTop = r2(baseline - (lineHeight / 2 + 0.35 * size));

  // 정렬·문단 간격은 문단별 스타일(paragraphStyleRuns)에 있을 수 있다 → 첫 문단 값을 우선, 없으면 기본값
  const para = { ...(t.paragraphStyle || {}), ...((t.paragraphStyleRuns || [])[0]?.style || {}) };
  const align = alignOf(para.justification);
  let anchorX = tx;
  let boxWidth: number | undefined;
  if (shape === 'box' && box) {
    const sx = tf ? Math.hypot(tf[0], tf[1]) : 1;
    boxWidth = r2((box[2] - box[0]) * sx);
    const L = tx + box[0] * sx;
    const R = tx + box[2] * sx;
    anchorX = align === 'center' ? (L + R) / 2 : align === 'right' ? R : L;
  }

  const mixed = runs.some((r) => r.text.trim() && (r.font !== first.font || Math.abs(r.size - first.size) > 0.3 || r.color !== first.color || Math.abs(r.ls - first.ls) > 0.0005));

  let bakeHint: string | undefined;
  if (t.warp && t.warp.style && t.warp.style !== 'none') bakeHint = `뒤틀기(warp: ${t.warp.style})`;
  else if (t.textOnPath?.type) bakeHint = '패스 위 글자';
  else if (t.orientation === 'vertical') bakeHint = '세로쓰기';
  else if (tf && (Math.abs(tf[1]) > 0.01 || Math.abs(tf[2]) > 0.01)) bakeHint = '회전·기울인 글자';
  // 장평(가로 비율)이 조금 다른 것은 자간 보정이 폭을 맞춘다 → 10% 넘게 다르거나 세로 비율이 5% 넘게 다를 때만 이미지로
  else if ((tf && Math.abs(Math.hypot(tf[0], tf[1]) / sy - 1) > 0.1) || runs.some((_, i) => Math.abs((styleOf(baseStyle, (t.styleRuns || [])[i]?.style).horizontalScale ?? 1) - 1) > 0.1 || Math.abs((styleOf(baseStyle, (t.styleRuns || [])[i]?.style).verticalScale ?? 1) - 1) > 0.05))
    bakeHint = '장평·세로 비율을 바꾼 글자';

  // 칠 불투명도 (칠 0% + 획 = 외곽선 글자) — fx 에 'fill N%' 로 알린다
  const fill = layer.fillOpacity ?? 1;
  const fx = fill < 1 ? [...(enabledEffects(layer) ?? []), `fill ${Math.round(fill * 100)}%`] : enabledEffects(layer);
  if (!bakeHint && fx?.some((f) => ['gradientOverlay', 'patternOverlay', 'bevel', 'satin', 'innerShadow', 'innerGlow', 'outerGlow'].includes(f))) {
    bakeHint = `CSS로 같게 안 나오는 효과(${fx.join(', ')})`;
  }

  const fonts = new Set(runs.filter((r) => r.text.trim()).map((r) => r.font));
  const bakeFonts = [...fonts].filter(isBakeFont);
  if (bakeFonts.length) bakeHint = `규칙 5절 이미지로 굽는 폰트(${bakeFonts.join(', ')}) → 반드시 이미지${bakeHint ? ` · ${bakeHint}` : ''}`;
  const unmapped = [...fonts].some((f) => !isMappedFont(f) && !isBakeFont(f));

  return {
    id: layer.id ?? -1,
    path,
    text: raw,
    lines,
    b: [layer.left ?? 0, layer.top ?? 0, layer.right ?? 0, layer.bottom ?? 0],
    font: first.font,
    size,
    lineHeight,
    lineHeights,
    lineAligns,
    paraGaps,
    weight: first.weight,
    color: first.color,
    ls: first.ls,
    align,
    caps: firstStyle.fontCaps === 2 || undefined,
    shape,
    baseline,
    lineTop,
    anchorX: r2(anchorX),
    boxWidth,
    runs: mixed ? runs : undefined,
    spaceBefore: para.spaceBefore ? r2(para.spaceBefore * sy) : undefined,
    spaceAfter: para.spaceAfter ? r2(para.spaceAfter * sy) : undefined,
    bakeHint,
    fx,
    shadows: shadowsOf(layer, globalAngle, 1),
    overlay: overlayOf(layer),
    unmappedFont: unmapped || undefined,
  };
}

/** 그룹 영역 = 쓰는 하위 레이어 영역의 합 (ag-psd 는 그룹 left/top/right/bottom 을 0 으로 준다) */
const clampBox = (b: [number, number, number, number], psd: Pick<Psd, 'width' | 'height'>): [number, number, number, number] => [Math.max(0, b[0]), Math.max(0, b[1]), Math.min(psd.width, b[2]), Math.min(psd.height, b[3])];

export function groupBounds(layer: Layer, psd: Pick<Psd, 'width' | 'height'>): [number, number, number, number] {
  if (!layer.children) return [layer.left ?? 0, layer.top ?? 0, layer.right ?? 0, layer.bottom ?? 0];
  let b: [number, number, number, number] | null = null;
  for (const c of layer.children) {
    if (!isUsable(c, psd) || c.adjustment) continue;
    const cb = groupBounds(c, psd);
    if (cb[2] <= cb[0] || cb[3] <= cb[1]) continue;
    b = b ? [Math.min(b[0], cb[0]), Math.min(b[1], cb[1]), Math.max(b[2], cb[2]), Math.max(b[3], cb[3])] : cb;
  }
  return b ?? [0, 0, 0, 0];
}

/** 규칙 3절 4항: 숨김·숨김 그룹 하위·불투명도 0·캔버스 밖 레이어는 제외 */
export function isUsable(layer: Layer, psd: Pick<Psd, 'width' | 'height'>): boolean {
  if (layer.hidden) return false;
  if (layer.opacity === 0) return false;
  if (!layer.children) {
    const l = layer.left ?? 0, t = layer.top ?? 0, r = layer.right ?? 0, b = layer.bottom ?? 0;
    if (r <= 0 || b <= 0 || l >= psd.width || t >= psd.height) return false;
    if (r - l <= 0 || b - t <= 0) return layer.adjustment != null; // 조정 레이어는 크기가 없을 수 있음
  }
  return true;
}

export function countLayers(children: Layer[] | undefined): number {
  return (children || []).reduce((n, l) => n + 1 + countLayers(l.children), 0);
}

/**
 * 레이어(또는 그룹)의 마스크가 글자 상자 b 의 일부를 가리는지.
 * - 픽셀 마스크: 마스크 사각형 밖이 가려지는 설정(기본색 검정)인데 글자가 사각형 밖으로 나가거나, 글자 영역 마스크 픽셀에 어두운 곳이 있으면
 * - 벡터 마스크: 반전이거나, 글자가 패스 범위 밖으로 나가면
 * 픽셀을 못 읽은 경우는 사각형 범위로만 본다 (레이아웃용 사각 마스크 때문에 멀쩡한 글자가 이미지가 되지 않게)
 */
function maskHides(l: Layer, b: [number, number, number, number]): boolean {
  const m = l.mask;
  if (m && !m.disabled) {
    const L = m.left ?? 0, T = m.top ?? 0, R = m.right ?? 0, B = m.bottom ?? 0;
    const inside = b[0] >= L && b[1] >= T && b[2] <= R && b[3] <= B;
    if ((m.defaultColor ?? 0) < 128 && !inside) return true;
    const px = m.imageData;
    const w = R - L;
    if (px && w > 0 && B > T && px.data.length >= w * (B - T)) {
      const ch = px.data.length / (w * (B - T)) >= 4 ? 4 : 1; // RGBA 로 풀었으면 4, 회색 한 채널이면 1
      const max = px.data instanceof Float32Array ? 1 : px.data instanceof Uint16Array ? 65535 : 255;
      const x0 = Math.max(b[0], L), x1 = Math.min(b[2], R), y0 = Math.max(b[1], T), y1 = Math.min(b[3], B);
      const step = Math.max(2, Math.round(Math.min(x1 - x0, y1 - y0) / 12));
      for (let y = y0; y < y1; y += step)
        for (let x = x0; x < x1; x += step) if (px.data[((y - T) * w + (x - L)) * ch] / max < 0.95) return true;
    }
  }
  const v = l.vectorMask;
  if (v && !v.disable) {
    if (v.invert) return true;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of v.paths || [])
      for (const k of p.knots || []) {
        const [x, y] = [k.points[2], k.points[3]]; // 기준점 (앞뒤는 제어점)
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    if (Number.isFinite(x0) && (b[0] < x0 - 1 || b[1] < y0 - 1 || b[2] > x1 + 1 || b[3] > y1 + 1)) return true;
  }
  return false;
}

export function extractSummary(psd: Psd, fileName: string): PsdSummary {
  const layers: LayerInfo[] = [];
  const texts: TextInfo[] = [];
  const warnings: string[] = [];
  let hiddenCount = 0;
  const adjustmentNames: string[] = [];
  const blendNames = new Set<string>();

  // groupOpacity: 바깥 그룹들의 불투명도 곱 (텍스트 글자색 투명도에 반영)
  // groupWhy: 바깥 그룹의 효과·혼합 모드 — 안의 글자는 PSD 에서 그 영향을 받아 보이므로 CSS 글자로 같게 못 낸다 → 이미지로
  // maskOwners: 마스크가 있는 바깥 그룹들 — 마스크가 그 글자를 실제로 가릴 때만 이미지로 (레이아웃용 사각 마스크는 글자를 안 가림)
  const walk = (children: Layer[] | undefined, path: string, groupOpacity = 1, groupWhy: string | null = null, maskOwners: Layer[] = []) => {
    let baseOk = true; // 클리핑 기준(아래쪽 클리핑 아닌 레이어)이 보이는지 — 숨긴 기준에 클리핑된 레이어는 화면에 안 나온다
    for (const layer of children || []) {
      const name = layer.name ?? '';
      if (!layer.clipping) baseOk = isUsable(layer, psd);
      else if (!baseOk) {
        hiddenCount += 1 + countLayers(layer.children);
        continue;
      }
      if (!isUsable(layer, psd)) {
        hiddenCount += 1 + countLayers(layer.children);
        continue;
      }
      const kind = kindOf(layer);
      const info: LayerInfo = {
        id: layer.id ?? -1,
        name,
        path,
        kind,
        // Claude 에게 주는 범위는 캔버스 안으로 자른다 (캔버스 밖으로 넓은 그룹이 섹션·사진 띠 판단을 흐리지 않게 — 합성용 groupBounds 는 그대로)
        b: clampBox(groupBounds(layer, psd), psd),
      };
      if (layer.opacity != null && layer.opacity < 1) info.opacity = r2(layer.opacity);
      if (layer.blendMode && !['normal', 'pass through'].includes(layer.blendMode)) {
        info.blend = layer.blendMode;
        blendNames.add(layer.blendMode);
      }
      if (layer.clipping) info.clip = true;
      if (layer.mask && !layer.mask.disabled) info.mask = true;
      const fx = enabledEffects(layer);
      if (fx) info.fx = fx;
      const fill = fillDesc(layer);
      if (fill) info.fill = fill;
      if (kind === 'adjustment') adjustmentNames.push(name);
      layers.push(info);

      if (kind === 'text') {
        const ti = textInfo(layer, path, psd.imageResources?.globalAngle ?? 120);
        if (ti) {
          const op = r2(groupOpacity * (layer.opacity ?? 1));
          if (op < 1) ti.opacity = op;
          if (layer.blendMode && !['normal', 'pass through'].includes(layer.blendMode) && !ti.bakeHint) ti.bakeHint = `혼합 모드(${layer.blendMode}) 글자`;
          // 글자 자신의 마스크(일부를 가림)·바깥 그룹 효과는 HTML 글자에 옮길 수 없다
          if (!ti.bakeHint && maskHides(layer, ti.b)) ti.bakeHint = '마스크로 일부를 가린 글자';
          if (!ti.bakeHint && groupWhy) ti.bakeHint = groupWhy;
          const hider = ti.bakeHint ? undefined : maskOwners.find((g) => maskHides(g, ti.b));
          if (hider) ti.bakeHint = `그룹 "${hider.name ?? ''}"의 마스크로 일부를 가린 글자`;
          texts.push(ti);
        }
      }
      if (layer.children) {
        const gfx = (enabledEffects(layer) || []).filter((f) => !f.startsWith('fill '));
        const why =
          groupWhy ??
          (gfx.length
            ? `그룹 "${name}"의 효과(${gfx.join(', ')})가 걸린 글자`
            : layer.blendMode && !['normal', 'pass through'].includes(layer.blendMode)
              ? `그룹 "${name}"의 혼합 모드(${layer.blendMode}) 안 글자`
              : null);
        const hasMask = (layer.mask && !layer.mask.disabled) || (layer.vectorMask && !layer.vectorMask.disable);
        walk(layer.children, path ? `${path}/${name}` : name, groupOpacity * (layer.opacity ?? 1), why, hasMask ? [...maskOwners, layer] : maskOwners);
      }
    }
  };
  walk(psd.children, '');

  // 위→아래, 왼→오 순서 (Claude 가 읽기 쉽게)
  texts.sort((a, b) => a.lineTop - b.lineTop || a.b[0] - b.b[0]);

  const fontCount = new Map<string, number>();
  for (const t of texts) for (const f of new Set((t.runs || [{ font: t.font, text: t.text }]).filter((r) => r.text.trim()).map((r) => r.font))) fontCount.set(f, (fontCount.get(f) || 0) + 1);
  const fonts = [...fontCount.entries()].map(([name, count]) => ({ name, count, mapped: isMappedFont(name), bake: isBakeFont(name) || undefined })).sort((a, b) => b.count - a.count);

  const res = psd.imageResources?.resolutionInfo;
  // PSD 는 해상도를 단위와 상관없이 항상 inch 기준으로 저장한다 (PPI/PPCM 은 표시 단위일 뿐)
  const dpi = res?.horizontalResolution || 72;

  const unmapped = fonts.filter((f) => !f.mapped && !f.bake);
  if (unmapped.length) warnings.push(`웹폰트 표(규칙 5절)에 없는 폰트: ${unmapped.map((f) => f.name).join(', ')} → 임의로 대체하지 않습니다. 쓸 웹폰트를 정해 규칙 표에 추가하거나, 해당 글자를 이미지로 굽도록 지시해 주세요.`);
  if (Math.round(dpi) !== 72) warnings.push(`문서 해상도가 ${Math.round(dpi)}ppi 입니다 (72ppi 가 아님). 글자 크기 환산을 결과에서 꼭 확인하세요.`);
  if (adjustmentNames.length) warnings.push(`조정 레이어 ${adjustmentNames.length}개(${adjustmentNames.slice(0, 5).join(', ')}${adjustmentNames.length > 5 ? ' …' : ''})는 "글자 뺀 배경"에 반영되지 않습니다. 그 영역은 배경 색감이 PSD 와 다를 수 있으니 미리보기에서 확인하세요.`);
  if (blendNames.size) warnings.push(`표준 외 혼합모드(${[...blendNames].join(', ')})가 있습니다. 글자 뺀 배경은 브라우저 합성으로 근사합니다.`);
  // 글자 뺀 배경 합성이 그리는 효과: 드롭 섀도·외부 광선·색상/그라데이션 오버레이·획 (effects.ts). 나머지는 빠진다
  const unsupportedFx = layers.filter((l) => l.kind !== 'text' && l.fx?.some((f) => !['dropShadow', 'outerGlow', 'colorOverlay', 'gradientOverlay', 'stroke'].includes(f)));
  if (unsupportedFx.length) warnings.push(`"글자 뺀 배경"에 못 그리는 효과(내부 그림자·경사·새틴·패턴 등)가 걸린 레이어 ${unsupportedFx.length}개: ${unsupportedFx.slice(0, 4).map((l) => `${l.name}(y${l.b[1]})`).join(', ')}${unsupportedFx.length > 4 ? ' …' : ''}. 그 영역 색감이 PSD 와 다를 수 있으니 미리보기에서 확인하세요.`);
  if (texts.some((t) => t.bakeHint)) warnings.push(`이미지로 구워야 할 수 있는 글자 ${texts.filter((t) => t.bakeHint).length}개 (이미지로 굽는 폰트·뒤틀기·특수 효과).`);

  return { fileName, width: psd.width, height: psd.height, dpi: Math.round(dpi), layers, texts, hiddenCount, fonts, warnings };
}
