// 보이는 레이어를 OffscreenCanvas 로 다시 합성한다 (워커 안에서 실행)
// 용도: '글자 뺀 배경'(텍스트 레이어 제외) 만들기. 규칙 7-2: 섹션 배경 = 글자를 뺀 PSD 합성 이미지
// 효과: 드롭 섀도·외부 광선·색상/그라데이션 오버레이·획은 effects.ts 로 근사. 조정 레이어·그 밖의 효과는 빠지고, 표준 외 혼합모드는 캔버스 합성으로 근사한다
import type { Layer, PixelData, Psd } from 'ag-psd';
import { groupBounds, isUsable } from './extract';
import { hasRenderableEffects, renderEffects } from './effects';

type Ctx = OffscreenCanvasRenderingContext2D;

const BLEND: Record<string, GlobalCompositeOperation> = {
  normal: 'source-over',
  'pass through': 'source-over',
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

export function pixelsToCanvas(pd: PixelData): OffscreenCanvas | null {
  if (!pd.width || !pd.height) return null;
  let data: Uint8ClampedArray;
  if (pd.data instanceof Uint8ClampedArray) data = pd.data;
  else if (pd.data instanceof Uint8Array) data = new Uint8ClampedArray(pd.data.buffer, pd.data.byteOffset, pd.data.length);
  else if (pd.data instanceof Uint16Array) data = Uint8ClampedArray.from(pd.data, (v) => v >> 8);
  else data = Uint8ClampedArray.from(pd.data, (v) => v * 255);
  const c = new OffscreenCanvas(pd.width, pd.height);
  c.getContext('2d')!.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, pd.width, pd.height), 0, 0);
  return c;
}

/** 레이어 마스크를 알파 캔버스로 (x0,y0 = 결과 캔버스의 문서 좌표 원점) */
function maskCanvas(layer: Layer, x0: number, y0: number, w: number, h: number): OffscreenCanvas | null {
  const m = layer.mask;
  if (!m || m.disabled || !m.imageData) return null;
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d')!;
  // 마스크 밖 영역 = defaultColor (0 이면 가림, 255 면 보임)
  if ((m.defaultColor ?? 0) > 127) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
  }
  const src = m.imageData;
  const alpha = new Uint8ClampedArray(src.width * src.height * 4);
  const s = src.data;
  // 비트 깊이에 맞게 0~255 로 (16비트 = 0~65535, 32비트 = 0~1 실수) — 값 크기로 짐작하면 어두운 16비트 마스크·32비트 마스크가 틀어짐
  const to8 = s instanceof Uint16Array ? (v: number) => v >> 8 : s instanceof Float32Array ? (v: number) => v * 255 : (v: number) => v;
  for (let i = 0; i < src.width * src.height; i++) alpha[i * 4 + 3] = to8(s[i * 4]);
  const mc = new OffscreenCanvas(src.width, src.height);
  mc.getContext('2d')!.putImageData(new ImageData(alpha, src.width, src.height), 0, 0);
  const mx = (m.left ?? 0) - x0;
  const my = (m.top ?? 0) - y0;
  // 마스크 영역은 마스크 값으로 덮어쓴다
  ctx.clearRect(mx, my, src.width, src.height);
  ctx.drawImage(mc, mx, my);
  return c;
}

function applyMask(target: OffscreenCanvas, layer: Layer, x0: number, y0: number) {
  const mc = maskCanvas(layer, x0, y0, target.width, target.height);
  if (!mc) return;
  const ctx = target.getContext('2d')!;
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mc, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
}

export interface RenderOptions {
  skipText: boolean;
}

/** 문서 크기 캔버스에 children 을 아래→위 순서로 그린다 (ag-psd children[0] = 맨 아래) */
export function renderChildren(psd: Psd, children: Layer[] | undefined, ctx: Ctx, opt: RenderOptions) {
  const list = children || [];
  for (let i = 0; i < list.length; i++) {
    const layer = list[i];
    if (layer.clipping) continue; // 아래 기준 레이어에서 같이 그린다
    const clipped: Layer[] = [];
    for (let j = i + 1; j < list.length && list[j].clipping; j++) clipped.push(list[j]);
    if (!isUsable(layer, psd)) continue;
    drawLayer(psd, layer, clipped, ctx, opt);
  }
}

interface Rendered {
  /** 효과까지 그린 레이어 이미지 */
  img: OffscreenCanvas;
  x: number;
  y: number;
  /** 클리핑 기준이 되는 알파 (효과 제외 본체) */
  alpha: OffscreenCanvas;
  ax: number;
  ay: number;
  opacity: number;
  /** 레이어 불투명도만 (칠 불투명도 제외) — 클리핑된 레이어에 곱한다 (포토샵은 기준 레이어의 칠 불투명도를 클리핑에 적용하지 않음) */
  baseOpacity: number;
  blend: GlobalCompositeOperation;
}

const globalAngleOf = (psd: Psd) => psd.imageResources?.globalAngle ?? 120;

/** 레이어 하나(그룹 포함)를 캔버스로. 그릴 것이 없으면 null */
function renderLayer(psd: Psd, layer: Layer, opt: RenderOptions): Rendered | null {
  const blend = layer.blendMode === 'pass through' ? 'source-over' : BLEND[layer.blendMode || 'normal'] || 'source-over';
  const fx = hasRenderableEffects(layer);

  if (layer.children) {
    const off = new OffscreenCanvas(psd.width, psd.height);
    renderChildren(psd, layer.children, off.getContext('2d')!, opt);
    applyMask(off, layer, 0, 0);
    if (fx) {
      // 그룹 효과: 그룹 영역만 잘라서 효과를 입힌다 (문서 전체 크기로 하면 느림)
      // ag-psd 는 그룹 영역을 0 으로 주므로 하위 레이어 영역을 합쳐 쓴다 (하위 효과가 번진 만큼 여유)
      const gb = groupBounds(layer, psd), pad = 200;
      const gl = Math.max(0, gb[0] - pad), gt = Math.max(0, gb[1] - pad);
      const gw = Math.min(psd.width, gb[2] + pad) - gl, gh = Math.min(psd.height, gb[3] + pad) - gt;
      if (gw > 0 && gh > 0) {
        const part = new OffscreenCanvas(gw, gh);
        part.getContext('2d')!.drawImage(off, gl, gt, gw, gh, 0, 0, gw, gh);
        const r = renderEffects(part, gl, gt, layer, globalAngleOf(psd), layer.fillOpacity ?? 1);
        return { img: r.canvas, x: r.x, y: r.y, alpha: r.body, ax: r.x, ay: r.y, opacity: layer.opacity ?? 1, baseOpacity: layer.opacity ?? 1, blend };
      }
    }
    return { img: off, x: 0, y: 0, alpha: off, ax: 0, ay: 0, opacity: layer.opacity ?? 1, baseOpacity: layer.opacity ?? 1, blend };
  }

  if (layer.adjustment) return null; // 조정 레이어는 반영하지 않는다 (경고로 안내)
  if (opt.skipText && layer.text) return null;
  if (!layer.imageData) return null;
  const lc = pixelsToCanvas(layer.imageData);
  if (!lc) return null;
  const x0 = layer.left ?? 0;
  const y0 = layer.top ?? 0;
  applyMask(lc, layer, x0, y0);
  if (fx) {
    // 칠 불투명도는 본체·오버레이에만, 레이어 불투명도는 효과 포함 전체에
    const r = renderEffects(lc, x0, y0, layer, globalAngleOf(psd), layer.fillOpacity ?? 1);
    return { img: r.canvas, x: r.x, y: r.y, alpha: r.body, ax: r.x, ay: r.y, opacity: layer.opacity ?? 1, baseOpacity: layer.opacity ?? 1, blend };
  }
  return { img: lc, x: x0, y: y0, alpha: lc, ax: x0, ay: y0, opacity: (layer.opacity ?? 1) * (layer.fillOpacity ?? 1), baseOpacity: layer.opacity ?? 1, blend };
}

function drawLayer(psd: Psd, layer: Layer, clipped: Layer[], ctx: Ctx, opt: RenderOptions) {
  if (layer.children) {
    const direct = (layer.blendMode === 'pass through' || !layer.blendMode) && (layer.opacity ?? 1) >= 1 && !(layer.mask && !layer.mask.disabled) && !clipped.length && !hasRenderableEffects(layer);
    if (direct) {
      renderChildren(psd, layer.children, ctx, opt);
      return;
    }
  }
  const r = renderLayer(psd, layer, opt);
  if (!r) return;
  ctx.save();
  ctx.globalAlpha = r.opacity;
  ctx.globalCompositeOperation = r.blend;
  ctx.drawImage(r.img, r.x, r.y);
  ctx.restore();

  // 클리핑 마스크: 위 레이어를 지금까지의 합성 위에 자기 혼합모드로 섞되, 기준 레이어 알파 안에서만 (포토샵 방식)
  for (const c of clipped) {
    if (!isUsable(c, psd)) continue;
    const cr = renderLayer(psd, c, opt);
    if (!cr) continue;
    const tmp = new OffscreenCanvas(r.alpha.width, r.alpha.height);
    const t = tmp.getContext('2d')!;
    t.drawImage(cr.img, cr.x - r.ax, cr.y - r.ay);
    t.globalCompositeOperation = 'destination-in';
    t.drawImage(r.alpha, 0, 0);
    ctx.save();
    ctx.globalAlpha = cr.opacity * r.baseOpacity;
    ctx.globalCompositeOperation = cr.blend;
    ctx.drawImage(tmp, r.ax, r.ay);
    ctx.restore();
  }
}

export function renderDocument(psd: Psd, opt: RenderOptions, background = '#ffffff'): OffscreenCanvas {
  const c = new OffscreenCanvas(psd.width, psd.height);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, psd.width, psd.height);
  renderChildren(psd, psd.children, ctx, opt);
  return c;
}

/** 합성 이미지가 비어 있는지 (최대 호환성 끄고 저장한 PSD 는 합성 이미지가 없음) */
export function isBlank(pd: PixelData | undefined): boolean {
  if (!pd || !pd.width) return true;
  const d = pd.data;
  const step = Math.max(4, Math.floor(d.length / 4 / 5000) * 4);
  const first = [d[0], d[1], d[2], d[3]].join();
  for (let i = 0; i < d.length; i += step) if ([d[i], d[i + 1], d[i + 2], d[i + 3]].join() !== first) return false;
  return true;
}
