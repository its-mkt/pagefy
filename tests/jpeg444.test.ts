// 자른 이미지 JPEG 가 색을 줄이지 않는 4:4:4 · 품질 92 인지, 1MB 를 넘으면 품질만 낮추는지 (2026-11-27) — yarn test
import { describe, expect, it } from 'vitest';
import { encodeJpeg444, encodeJpegUnder } from '../src/lib/psd/jpeg444';

/** SOF0 의 성분별 표본 계수(0x11 = 줄이지 않음)와 첫 양자화 표 첫 값 */
function inspect(b: Uint8Array) {
  let i = 2;
  const out: { samp?: number[]; dq0?: number; w?: number; h?: number } = {};
  while (i < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    const len = (b[i + 2] << 8) | b[i + 3];
    if (m === 0xdb && out.dq0 == null) out.dq0 = b[i + 5];
    if (m === 0xc0) {
      out.h = (b[i + 5] << 8) | b[i + 6];
      out.w = (b[i + 7] << 8) | b[i + 8];
      out.samp = [0, 1, 2].map((k) => b[i + 11 + k * 3]);
    }
    if (m === 0xda) break;
    i += 2 + len;
  }
  return out;
}

const img = (w: number, h: number, noise = false) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    data[p * 4] = noise ? (p * 2654435761) >>> 24 : 230;
    data[p * 4 + 1] = noise ? (p * 40503) & 255 : 0;
    data[p * 4 + 2] = noise ? (p * 69069) >>> 24 : 18;
    data[p * 4 + 3] = 255;
  }
  return { data, width: w, height: h };
};

describe('4:4:4 JPEG', () => {
  it('세 성분 모두 표본을 줄이지 않고(0x11) 크기를 지킨다', () => {
    const r = inspect(encodeJpeg444(img(37, 21), 92));
    expect(r.samp).toEqual([0x11, 0x11, 0x11]);
    expect([r.w, r.h]).toEqual([37, 21]);
  });

  it('보통 이미지는 품질 92 그대로', () => {
    expect(inspect(encodeJpegUnder(img(200, 200))).dq0).toBe(3); // IJG 품질 92 의 첫 값 (16 × 0.16 → 3)
  });

  it('1MB 를 넘으면 품질만 낮춘다', () => {
    const big = img(300, 300, true);
    const r = inspect(encodeJpegUnder(big, encodeJpeg444(big, 92).length - 1));
    expect(r.dq0).toBeGreaterThan(3);
    expect(r.samp).toEqual([0x11, 0x11, 0x11]);
  });

  it('Node Buffer 결과도 공용 메모리가 아닌 제 크기 배열로 돌려준다', () => {
    const b = encodeJpeg444(img(16, 16), 92);
    expect(b.byteOffset).toBe(0);
    expect(b.byteLength).toBe(b.buffer.byteLength);
  });
});
