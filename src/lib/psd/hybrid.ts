// 「글자 뺀 배경」= PSD 원본 합성 + 텍스트 자리만 브라우저 합성 (2026-11-27)
// 예전에는 문서 전체를 브라우저가 다시 합성해서(renderDocument skipText) 글자와 상관없는 곳까지 조정 레이어·특수 효과·혼합 모드가
// 빠지거나 틀어졌다. 원본 합성(최대 호환성)은 Photoshop 이 그린 그대로라 정확하므로 기본으로 쓰고,
// 글자를 지워야 하는 텍스트 레이어 둘레(효과가 퍼진 만큼 포함)만 브라우저 합성 그림으로 덮는다.
// 덮은 자리 테두리에서 원본과 색이 많이 다르면(글자 밑에 브라우저가 못 그리는 효과가 있음) 경고한다.
import type { TextInfo } from '../../../shared/types';

export type Rect = [number, number, number, number];

/** 덮은 자리 가장자리를 원본과 섞는 폭 (px) — 경계선이 보이지 않게 */
export const FEATHER = 4;
/** 테두리 색 차이 경고 기준 (0~255 채널 평균 차이) */
export const RING_WARN = 10;

/** 텍스트 효과가 bounds 밖으로 퍼지는 거리 (그림자·광선·획) — 값을 못 읽은 효과는 글자 크기의 절반 */
export function fxSpread(t: TextInfo): number {
  const sh = Math.max(0, ...(t.shadows || []).map((s) => Math.max(Math.abs(s.x), Math.abs(s.y)) + s.blur * 1.5));
  const st = t.stroke ? t.stroke.size * (t.stroke.position === 'center' ? 0.5 : 1) : 0;
  const gl = t.glow ? t.glow.blur * 1.5 : 0;
  const unknown = (t.fx || []).some((f) => ['stroke', 'outerGlow', 'dropShadow'].includes(f) && !(f === 'stroke' ? t.stroke : f === 'outerGlow' ? t.glow : t.shadows?.length)) ? t.size * 0.5 : 0;
  return Math.max(sh, st, gl, unknown);
}

/**
 * 덮을 자리 = 텍스트 레이어 bounds + 여유(안티앨리어싱·효과 퍼짐). 문서 밖은 자른다. 빈 글자·크기 없는 레이어는 뺀다.
 * 이미지로 남길 글자도 덮는다 — 그 자리는 codegen 이 원본 합성에서 잘라 다시 얹으므로 결과는 같다
 */
export function patchRect(t: TextInfo, W: number, H: number): Rect | null {
  if (!t.text.trim() || t.b[2] <= t.b[0] || t.b[3] <= t.b[1]) return null;
  const pad = Math.ceil(Math.max(3, t.size * 0.12) + fxSpread(t));
  const r: Rect = [Math.max(0, Math.floor(t.b[0] - pad)), Math.max(0, Math.floor(t.b[1] - pad)), Math.min(W, Math.ceil(t.b[2] + pad)), Math.min(H, Math.ceil(t.b[3] + pad))];
  return r[2] > r[0] && r[3] > r[1] ? r : null;
}

export function patchRects(texts: TextInfo[], W: number, H: number): Rect[] {
  return texts.map((t) => patchRect(t, W, H)).filter((r): r is Rect => !!r);
}

const inside = (x: number, y: number, r: Rect) => x >= r[0] && x < r[2] && y >= r[1] && y < r[3];

/** 테두리 비교에 읽을 영역 (덮은 자리 + band, 문서 안으로) */
export function ringArea(r: Rect, W: number, H: number, band = 3): Rect {
  return [Math.max(0, r[0] - band), Math.max(0, r[1] - band), Math.min(W, r[2] + band), Math.min(H, r[3] + band)];
}

/**
 * 덮은 자리 바로 바깥 테두리(ringArea 안, r 밖)에서 원본(a)과 브라우저 합성(b)의 평균 색 차이 (0~255).
 * 다른 텍스트 자리에 들어간 픽셀은 뺀다 (거기는 원래 글자가 있어 다른 게 맞음). 셀 픽셀이 없으면 0.
 * a·b 는 area 영역만 읽은 RGBA (폭 = area 폭). 성능을 위해 2px 간격으로 센다
 */
export function ringDiff(a: Uint8ClampedArray, b: Uint8ClampedArray, area: Rect, r: Rect, all: Rect[]): number {
  let sum = 0;
  let n = 0;
  const aw = area[2] - area[0];
  for (let y = area[1]; y < area[3]; y += 2) {
    for (let x = area[0]; x < area[2]; x += 2) {
      if (inside(x, y, r)) continue;
      if (all.some((o) => o !== r && inside(x, y, o))) continue;
      const i = ((y - area[1]) * aw + (x - area[0])) * 4;
      sum += (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
      n++;
    }
  }
  return n ? sum / n : 0;
}

/**
 * 원본 합성 위에 텍스트 자리만 브라우저 합성(notext)을 덮어 「글자 뺀 배경」을 만든다 (워커 전용 — OffscreenCanvas).
 * 가장자리 FEATHER px 은 흐리게 섞어 경계가 보이지 않게 한다. seams = 테두리 색 차이가 RING_WARN 을 넘은 글자
 */
export function hybridBackground(composite: OffscreenCanvas, notext: OffscreenCanvas, texts: TextInfo[]): { canvas: OffscreenCanvas; seams: { text: string; diff: number }[] } {
  const W = composite.width;
  const H = composite.height;
  const out = new OffscreenCanvas(W, H);
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#ffffff'; // 브라우저 합성(renderDocument)과 같은 흰 바탕 — 원본 합성에 투명한 곳이 있어도 같게
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(composite, 0, 0);
  const pairs = texts.map((t) => ({ t, r: patchRect(t, W, H) })).filter((p): p is { t: TextInfo; r: Rect } => !!p.r);
  const live = pairs.map((p) => p.t);
  const rects = pairs.map((p) => p.r);
  const cctx = composite.getContext('2d')!;
  const nctx = notext.getContext('2d')!;
  const seams: { text: string; diff: number }[] = [];
  rects.forEach((r, i) => {
    const e: Rect = [Math.max(0, r[0] - FEATHER), Math.max(0, r[1] - FEATHER), Math.min(W, r[2] + FEATHER), Math.min(H, r[3] + FEATHER)];
    const w = e[2] - e[0];
    const h = e[3] - e[1];
    const tmp = new OffscreenCanvas(w, h);
    const tc = tmp.getContext('2d')!;
    tc.drawImage(notext, e[0], e[1], w, h, 0, 0, w, h);
    // 덮을 모양: 자리 + 반 페더를 칠하고 반 페더만큼 흐리게 → 자리 안은 거의 불투명, 바깥 페더 폭에서 0 으로
    const m = new OffscreenCanvas(w, h);
    const mc = m.getContext('2d')!;
    mc.filter = `blur(${FEATHER / 2}px)`;
    mc.fillStyle = '#000';
    mc.fillRect(r[0] - e[0] - FEATHER / 2, r[1] - e[1] - FEATHER / 2, r[2] - r[0] + FEATHER, r[3] - r[1] + FEATHER);
    tc.globalCompositeOperation = 'destination-in';
    tc.drawImage(m, 0, 0);
    ctx.drawImage(tmp, e[0], e[1]);
    // 경계가 보일지: 자리 바로 바깥에서 원본과 브라우저 합성이 얼마나 다른지
    const area = ringArea(r, W, H);
    const aw = area[2] - area[0];
    const ah = area[3] - area[1];
    if (aw > 0 && ah > 0) {
      const d = ringDiff(cctx.getImageData(area[0], area[1], aw, ah).data, nctx.getImageData(area[0], area[1], aw, ah).data, area, r, rects);
      if (d > RING_WARN) seams.push({ text: live[i].text.replace(/\s+/g, ' ').trim().slice(0, 15), diff: Math.round(d) });
    }
  });
  return { canvas: out, seams };
}
