// ag-psd 로 읽은 PSD → Claude 에게 넘길 레이어·텍스트 요약 (순수 함수: 브라우저 워커와 Node 점검 스크립트가 같이 씀)
// 규칙 원본: \\192.168.1.254\마케팅팀\A_상세페이지\detail_to_markup.md (3절 사용 레이어 판정, 4절·4-1 텍스트 환산)
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

function hex(c?: Color): string {
  if (!c) return '000000';
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  if ('r' in c) return h(c.r) + h(c.g) + h(c.b);
  if ('fr' in c) return h(c.fr * 255) + h(c.fg * 255) + h(c.fb * 255);
  if ('k' in c && 'c' in c) {
    // CMYK 대략 환산 (0~255 기준)
    const k = c.k / 255;
    return h(255 * (1 - c.c / 255) * (1 - k)) + h(255 * (1 - c.m / 255) * (1 - k)) + h(255 * (1 - c.y / 255) * (1 - k));
  }
  if ('k' in c) return h(c.k) + h(c.k) + h(c.k);
  return '000000';
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

function textInfo(layer: Layer, path: string): TextInfo | null {
  const t = layer.text;
  if (!t) return null;
  const tf = t.transform;
  const sy = scaleY(tf);
  const raw = t.text ?? '';
  const baseStyle = t.style || {};

  // 글자 범위별 스타일 (규칙 4-1: 범위가 겹치거나 반복될 수 있으므로 앞에서부터 안 쓴 글자만 쓴다)
  const runs: TextRun[] = [];
  let cursor = 0;
  for (const r of t.styleRuns || [{ length: raw.length, style: {} }]) {
    const start = cursor;
    const end = Math.min(raw.length, cursor + r.length);
    cursor = end;
    if (end <= start) continue;
    const st = styleOf(baseStyle, r.style);
    const font = st.font?.name || 'unknown';
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
  const lineHeight = firstStyle.autoLeading === false && firstStyle.leading ? r2(firstStyle.leading * sy) : r2(size * 1.2);

  const lines = raw.replace(/\r\n?/g, '\n').replace(/\u0003/g, '\n').split('\n');
  while (lines.length > 1 && !lines[lines.length - 1].trim()) lines.pop();

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
  if (shape === 'box' && box) {
    const sx = tf ? Math.hypot(tf[0], tf[1]) : 1;
    const L = tx + box[0] * sx;
    const R = tx + box[2] * sx;
    anchorX = align === 'center' ? (L + R) / 2 : align === 'right' ? R : L;
  }

  const mixed = runs.some((r) => r.text.trim() && (r.font !== first.font || Math.abs(r.size - first.size) > 0.3 || r.color !== first.color || Math.abs(r.ls - first.ls) > 0.0005));

  let bakeHint: string | undefined;
  if (t.warp && t.warp.style && t.warp.style !== 'none') bakeHint = `뒤틀기(warp: ${t.warp.style})`;
  else if (t.textOnPath?.type) bakeHint = '패스 위 글자';
  else if (t.orientation === 'vertical') bakeHint = '세로쓰기';

  const fx = enabledEffects(layer);
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
    weight: first.weight,
    color: first.color,
    ls: first.ls,
    align,
    caps: firstStyle.fontCaps === 2 || undefined,
    shape,
    baseline,
    lineTop,
    anchorX: r2(anchorX),
    runs: mixed ? runs : undefined,
    spaceBefore: para.spaceBefore ? r2(para.spaceBefore * sy) : undefined,
    spaceAfter: para.spaceAfter ? r2(para.spaceAfter * sy) : undefined,
    bakeHint,
    fx,
    unmappedFont: unmapped || undefined,
  };
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

export function extractSummary(psd: Psd, fileName: string): PsdSummary {
  const layers: LayerInfo[] = [];
  const texts: TextInfo[] = [];
  const warnings: string[] = [];
  let hiddenCount = 0;
  const adjustmentNames: string[] = [];
  const blendNames = new Set<string>();

  const walk = (children: Layer[] | undefined, path: string) => {
    for (const layer of children || []) {
      const name = layer.name ?? '';
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
        b: [layer.left ?? 0, layer.top ?? 0, layer.right ?? 0, layer.bottom ?? 0],
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
        const ti = textInfo(layer, path);
        if (ti) texts.push(ti);
      }
      if (layer.children) walk(layer.children, path ? `${path}/${name}` : name);
    }
  };
  walk(psd.children, '');

  // 위→아래, 왼→오 순서 (Claude 가 읽기 쉽게)
  texts.sort((a, b) => a.lineTop - b.lineTop || a.b[0] - b.b[0]);

  const fontCount = new Map<string, number>();
  for (const t of texts) for (const f of new Set((t.runs || [{ font: t.font, text: t.text }]).filter((r) => r.text.trim()).map((r) => r.font))) fontCount.set(f, (fontCount.get(f) || 0) + 1);
  const fonts = [...fontCount.entries()].map(([name, count]) => ({ name, count, mapped: isMappedFont(name), bake: isBakeFont(name) || undefined })).sort((a, b) => b.count - a.count);

  const res = psd.imageResources?.resolutionInfo;
  const dpi = res ? (res.horizontalResolutionUnit === 'PPCM' ? res.horizontalResolution * 2.54 : res.horizontalResolution) : 72;

  const unmapped = fonts.filter((f) => !f.mapped && !f.bake);
  if (unmapped.length) warnings.push(`웹폰트 표(규칙 5절)에 없는 폰트: ${unmapped.map((f) => f.name).join(', ')} → 임의로 대체하지 않습니다. 쓸 웹폰트를 정해 규칙 표에 추가하거나, 해당 글자를 이미지로 굽도록 지시해 주세요.`);
  if (Math.round(dpi) !== 72) warnings.push(`문서 해상도가 ${Math.round(dpi)}ppi 입니다 (72ppi 가 아님). 글자 크기 환산을 결과에서 꼭 확인하세요.`);
  if (adjustmentNames.length) warnings.push(`조정 레이어 ${adjustmentNames.length}개(${adjustmentNames.slice(0, 5).join(', ')}${adjustmentNames.length > 5 ? ' …' : ''})는 "글자 뺀 배경"에 반영되지 않습니다. 배경 색감이 PSD와 다르면 해당 영역을 원본 합성(composite)으로 쓰게 지시하세요.`);
  if (blendNames.size) warnings.push(`표준 외 혼합모드(${[...blendNames].join(', ')})가 있습니다. 글자 뺀 배경은 브라우저 합성으로 근사합니다.`);
  // 글자 뺀 배경 합성이 그리는 효과: 드롭 섀도·외부 광선·색상/그라데이션 오버레이·획 (effects.ts). 나머지는 빠진다
  const unsupportedFx = layers.filter((l) => l.kind !== 'text' && l.fx?.some((f) => !['dropShadow', 'outerGlow', 'colorOverlay', 'gradientOverlay', 'stroke'].includes(f)));
  if (unsupportedFx.length) warnings.push(`"글자 뺀 배경"에 못 그리는 효과(내부 그림자·경사·새틴·패턴 등)가 걸린 레이어 ${unsupportedFx.length}개: ${unsupportedFx.slice(0, 4).map((l) => `${l.name}(y${l.b[1]})`).join(', ')}${unsupportedFx.length > 4 ? ' …' : ''}. 그 영역 색감이 다르면 원본 합성으로 쓰게 지시하세요.`);
  if (texts.some((t) => t.bakeHint)) warnings.push(`이미지로 구워야 할 수 있는 글자 ${texts.filter((t) => t.bakeHint).length}개 (이미지로 굽는 폰트·뒤틀기·특수 효과).`);

  return { fileName, width: psd.width, height: psd.height, dpi: Math.round(dpi), layers, texts, hiddenCount, fonts, warnings };
}
