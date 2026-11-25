// 캔버스에 없는 포토샵 혼합 모드는 픽셀로 직접 섞는다 (일반 모드로 그리면 흰 바탕 로고가 흰 상자로 보임 — 2026-11-25 Fury PSD 의 divide)

/** 직접 계산하는 모드: 아래색 b, 위색 s (0~255) → 섞은 색 */
export const MANUAL_BLEND = {
  divide: (b: number, s: number) => (s === 0 ? 255 : Math.min(255, (b * 255) / s)),
  subtract: (b: number, s: number) => Math.max(0, b - s),
  'linear burn': (b: number, s: number) => Math.max(0, b + s - 255),
} as const;
export type ManualBlend = keyof typeof MANUAL_BLEND;

/** 섞기 (W3C 합성식): dst·src 는 RGBA 배열, alpha 는 레이어 불투명도 — dst 를 바꾼다 */
export function blendPixels(dst: Uint8ClampedArray, src: Uint8ClampedArray, alpha: number, mode: ManualBlend) {
  const f = MANUAL_BLEND[mode];
  for (let i = 0; i < dst.length; i += 4) {
    const as = (src[i + 3] / 255) * alpha;
    if (!as) continue;
    const ab = dst[i + 3] / 255;
    const ao = as + ab * (1 - as);
    for (let c = 0; c < 3; c++) {
      const mixed = (1 - ab) * src[i + c] + ab * f(dst[i + c], src[i + c]);
      dst[i + c] = (as * mixed + ab * dst[i + c] * (1 - as)) / ao;
    }
    dst[i + 3] = ao * 255;
  }
}

/** ctx 의 (x, y) 에 img 를 직접 섞어 그린다. ctx 는 이동 변환만 있다고 본다 (그룹 캔버스) */
export function drawManual(ctx: OffscreenCanvasRenderingContext2D, img: OffscreenCanvas, x: number, y: number, alpha: number, mode: ManualBlend) {
  const { e, f } = ctx.getTransform();
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  const x0 = Math.max(0, Math.round(x + e));
  const y0 = Math.max(0, Math.round(y + f));
  const x1 = Math.min(cw, Math.round(x + e) + img.width);
  const y1 = Math.min(ch, Math.round(y + f) + img.height);
  if (x1 <= x0 || y1 <= y0) return;
  const w = x1 - x0;
  const h = y1 - y0;
  const dst = ctx.getImageData(x0, y0, w, h);
  const src = img.getContext('2d')!.getImageData(x0 - Math.round(x + e), y0 - Math.round(y + f), w, h);
  blendPixels(dst.data, src.data, alpha, mode);
  ctx.putImageData(dst, x0, y0);
}
