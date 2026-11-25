// 캔버스에 없는 혼합 모드 픽셀 계산 — yarn test
import { describe, expect, it } from 'vitest';
import { blendPixels, MANUAL_BLEND } from '../src/lib/psd/blend';

const px = (r: number, g: number, b: number, a = 255) => new Uint8ClampedArray([r, g, b, a]);

describe('divide', () => {
  it('위가 흰색이면 아래색 그대로 (흰 바탕 로고의 바탕이 사라짐)', () => {
    const d = px(10, 20, 30);
    blendPixels(d, px(255, 255, 255), 1, 'divide');
    expect([...d]).toEqual([10, 20, 30, 255]);
  });
  it('위가 검정이면 흰색 (검은 글자가 흰 글자로)', () => {
    const d = px(10, 20, 30);
    blendPixels(d, px(0, 0, 0), 1, 'divide');
    expect([...d]).toEqual([255, 255, 255, 255]);
  });
  it('투명한 위 픽셀은 바꾸지 않는다', () => {
    const d = px(10, 20, 30);
    blendPixels(d, px(0, 0, 0, 0), 1, 'divide');
    expect([...d]).toEqual([10, 20, 30, 255]);
  });
  it('식', () => expect(MANUAL_BLEND.divide(100, 200)).toBeCloseTo(127.5));
});
