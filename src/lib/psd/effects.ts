// 레이어 효과 근사 렌더링 (워커 안, OffscreenCanvas)
// 지원: 색상 오버레이, 그라데이션 오버레이(선형·방사), 획(안·가운데·밖), 드롭 섀도, 외부 광선
// 미지원(무시): 내부 그림자·내부 광선·경사와 엠보스·새틴·패턴 오버레이 → 경고로 안내
import type { Color, Layer, LayerEffectGradientOverlay, UnitsValue } from 'ag-psd';
import { rgbOf } from './extract';

const BLEND: Record<string, GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  'color dodge': 'color-dodge',
  'color burn': 'color-burn',
  'hard light': 'hard-light',
  'soft light': 'soft-light',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
  'linear dodge': 'lighter',
};
export const blendOp = (m?: string): GlobalCompositeOperation => BLEND[m || 'normal'] || 'source-over';

export const SUPPORTED_EFFECTS = ['dropShadow', 'outerGlow', 'colorOverlay', 'gradientOverlay', 'stroke'];

function rgba(c: Color | undefined, a = 1) {
  // CMYK·회색조 등도 RGB 로 환산 (예전엔 검정으로 그려짐)
  const [r, g, b] = rgbOf(c).map((v) => Math.max(0, Math.min(255, Math.round(v))));
  return `rgba(${r},${g},${b},${a})`;
}

const px = (u?: UnitsValue) => (u ? u.value : 0);
const on = <T extends { enabled?: boolean }>(v: T | T[] | undefined): T[] => (Array.isArray(v) ? v : v ? [v] : []).filter((e) => e && e.enabled !== false);

function canvas(w: number, h: number) {
  return new OffscreenCanvas(Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)));
}

/** 내용의 알파만 남긴 단색 실루엣 */
function silhouette(src: OffscreenCanvas, color: string) {
  const c = canvas(src.width, src.height);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

function diskOffsets(r: number): [number, number][] {
  const out: [number, number][] = [];
  for (const rr of r > 2 ? [r, r / 2] : [r]) {
    const n = Math.max(8, Math.ceil(2 * Math.PI * rr));
    for (let i = 0; i < n; i++) out.push([Math.cos((2 * Math.PI * i) / n) * rr, Math.sin((2 * Math.PI * i) / n) * rr]);
  }
  return out;
}

/** 팽창 (src 와 같은 크기, 가장자리 여백은 호출 쪽이 확보) */
function dilate(src: OffscreenCanvas, r: number) {
  const c = canvas(src.width, src.height);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(src, 0, 0);
  if (r <= 0) return c;
  for (const [dx, dy] of diskOffsets(r)) ctx.drawImage(src, dx, dy);
  return c;
}

/** 침식 */
function erode(src: OffscreenCanvas, r: number) {
  const c = canvas(src.width, src.height);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(src, 0, 0);
  if (r <= 0) return c;
  ctx.globalCompositeOperation = 'destination-in';
  for (const [dx, dy] of diskOffsets(r)) ctx.drawImage(src, dx, dy);
  return c;
}

function gradientFill(ctx: OffscreenCanvasRenderingContext2D, g: LayerEffectGradientOverlay, box: { x: number; y: number; w: number; h: number }) {
  const grad = g.gradient;
  if (!grad || grad.type !== 'solid') return null;
  const scale = g.scale ?? 1;
  const a = ((g.angle ?? 90) * Math.PI) / 180;
  const cx = box.x + box.w / 2 + (g.offset?.x ?? 0) * box.w;
  const cy = box.y + box.h / 2 + (g.offset?.y ?? 0) * box.h;
  let cg: CanvasGradient;
  if (g.type === 'radial') {
    cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, (Math.hypot(box.w, box.h) / 2) * scale);
  } else {
    const dx = Math.cos(a);
    const dy = -Math.sin(a); // 포토샵 각도는 위쪽이 +
    const half = ((Math.abs(box.w * dx) + Math.abs(box.h * dy)) / 2) * scale;
    cg = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
  }
  // 색 정지점 + 불투명도 정지점을 합친다
  const locs = [...new Set([...grad.colorStops.map((s) => s.location), ...grad.opacityStops.map((s) => s.location)])].sort((x, y) => x - y);
  const lerp = <T extends { location: number }>(stops: T[], t: number, get: (s: T) => number[]) => {
    const sorted = [...stops].sort((x, y) => x.location - y.location);
    if (t <= sorted[0].location) return get(sorted[0]);
    for (let i = 1; i < sorted.length; i++) {
      if (t <= sorted[i].location) {
        const p = (t - sorted[i - 1].location) / (sorted[i].location - sorted[i - 1].location || 1);
        const A = get(sorted[i - 1]);
        const B = get(sorted[i]);
        return A.map((v, k) => v + (B[k] - v) * p);
      }
    }
    return get(sorted[sorted.length - 1]);
  };
  for (const t of locs) {
    const [r, gg, b] = lerp(grad.colorStops, t, (s) => rgbOf(s.color));
    const [op] = grad.opacityStops.length ? lerp(grad.opacityStops, t, (s) => [s.opacity]) : [1];
    const pos = g.reverse ? 1 - t : t;
    cg.addColorStop(Math.min(1, Math.max(0, pos)), `rgba(${Math.round(r)},${Math.round(gg)},${Math.round(b)},${op})`);
  }
  return cg;
}

export function hasRenderableEffects(layer: Layer) {
  const fx = layer.effects;
  if (!fx || fx.disabled) return false;
  return !!(on(fx.dropShadow).length || on(fx.outerGlow).length || on(fx.solidFill).length || on(fx.gradientOverlay).length || on(fx.stroke).length);
}

/**
 * 효과까지 그린 레이어 캔버스. content = 레이어 픽셀(마스크 적용 후), (x0,y0) = 문서 좌표.
 * body = 오버레이까지 입힌 본체(칠 불투명도 전) — 클리핑 기준 알파로 쓴다
 * 반환 캔버스는 여백(pad)만큼 커지므로 (x0 - pad, y0 - pad) 에 그린다
 */
export function renderEffects(content: OffscreenCanvas, x0: number, y0: number, layer: Layer, globalAngle: number, fillOpacity: number) {
  const fx = layer.effects!;
  const shadows = on(fx.dropShadow);
  const glows = on(fx.outerGlow);
  const strokes = on(fx.stroke);
  const pad = Math.ceil(Math.max(2, ...shadows.map((s) => px(s.distance) + px(s.size) * 1.5), ...glows.map((g) => px(g.size) * (1.5 + px(g.choke) / 100)), ...strokes.map((s) => px(s.size))) + 2);
  const W = content.width + pad * 2;
  const H = content.height + pad * 2;

  // 1) 본체 + 오버레이 (그라데이션 아래, 색상 위 — 포토샵 순서)
  const body = canvas(W, H);
  const bctx = body.getContext('2d')!;
  bctx.drawImage(content, pad, pad);
  const box = { x: pad, y: pad, w: content.width, h: content.height };
  const overlay = (paint: (c: OffscreenCanvasRenderingContext2D) => void, opacity: number, blend?: string) => {
    const t = canvas(W, H);
    const tctx = t.getContext('2d')!;
    paint(tctx);
    tctx.globalCompositeOperation = 'destination-in';
    tctx.drawImage(body, 0, 0);
    bctx.save();
    bctx.globalAlpha = opacity;
    bctx.globalCompositeOperation = blendOp(blend);
    bctx.drawImage(t, 0, 0);
    bctx.restore();
  };
  for (const g of on(fx.gradientOverlay)) {
    overlay((c) => {
      const fill = gradientFill(c, g, box);
      if (fill) {
        c.fillStyle = fill;
        c.fillRect(0, 0, W, H);
      }
    }, g.opacity ?? 1, g.blendMode);
  }
  for (const s of on(fx.solidFill)) {
    overlay((c) => {
      c.fillStyle = rgba(s.color);
      c.fillRect(0, 0, W, H);
    }, s.opacity ?? 1, s.blendMode);
  }

  const out = canvas(W, H);
  const octx = out.getContext('2d')!;
  const alpha = silhouette(body, '#000');

  // 2) 아래쪽 효과: 외부 광선, 드롭 섀도
  for (const g of glows) {
    const s = silhouette(alpha, rgba(g.color));
    const size = px(g.size);
    octx.save();
    octx.filter = size > 0 ? `blur(${size / 2}px)` : 'none';
    octx.globalAlpha = g.opacity ?? 1;
    octx.globalCompositeOperation = blendOp(g.blendMode);
    octx.drawImage(px(g.choke) > 0 ? dilate(s, (size * px(g.choke)) / 100) : s, 0, 0);
    octx.restore();
  }
  for (const sh of shadows) {
    const angle = (((sh.useGlobalLight ? globalAngle : sh.angle) ?? 90) * Math.PI) / 180;
    const d = px(sh.distance);
    const size = px(sh.size);
    const s = silhouette(alpha, rgba(sh.color));
    octx.save();
    octx.filter = size > 0 ? `blur(${size / 2}px)` : 'none';
    octx.globalAlpha = sh.opacity ?? 1;
    octx.globalCompositeOperation = blendOp(sh.blendMode);
    octx.drawImage(s, -Math.cos(angle) * d, Math.sin(angle) * d);
    octx.restore();
  }

  // 레이어 안쪽은 그림자·광선을 가린다 (포토샵 "레이어가 그림자를 가림" 기본값) → 칠 불투명도가 낮아도 안쪽에 비치지 않게
  if (glows.length || shadows.some((s) => s.layerConceals !== false)) {
    octx.save();
    octx.globalCompositeOperation = "destination-out";
    octx.drawImage(alpha, 0, 0);
    octx.restore();
  }

  // 3) 본체 (칠 불투명도는 본체·오버레이에만)
  octx.save();
  octx.globalAlpha = fillOpacity;
  octx.drawImage(body, 0, 0);
  octx.restore();

  // 4) 획
  for (const st of strokes) {
    const r = px(st.size);
    if (r <= 0) continue;
    let ring: OffscreenCanvas;
    if (st.position === 'inside') {
      ring = canvas(W, H);
      const rc = ring.getContext('2d')!;
      rc.drawImage(alpha, 0, 0);
      rc.globalCompositeOperation = 'destination-out';
      rc.drawImage(erode(alpha, r), 0, 0);
    } else {
      const outer = st.position === 'center' ? r / 2 : r;
      ring = dilate(alpha, outer);
      const rc = ring.getContext('2d')!;
      rc.globalCompositeOperation = 'destination-out';
      rc.drawImage(st.position === 'center' ? erode(alpha, r / 2) : alpha, 0, 0);
    }
    const color = st.fillType === 'gradient' && st.gradient && st.gradient.type === 'solid' ? st.gradient.colorStops[0]?.color : st.color;
    const colored = silhouette(ring, rgba(color));
    octx.save();
    octx.globalAlpha = st.opacity ?? 1;
    octx.globalCompositeOperation = blendOp(st.blendMode);
    octx.drawImage(colored, 0, 0);
    octx.restore();
  }

  return { canvas: out, body, x: x0 - pad, y: y0 - pad };
}
