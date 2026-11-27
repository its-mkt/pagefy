// 글자 뺀 배경 = 원본 합성 + 텍스트 자리만 브라우저 합성 — 덮을 자리·테두리 색 차이 계산 (yarn test)
import { describe, expect, it } from 'vitest';
import { fxSpread, patchRect, patchRects, ringArea, ringDiff, type Rect } from '../src/lib/psd/hybrid';
import type { TextInfo } from '../shared/types';

const t = (b: [number, number, number, number], extra: Partial<TextInfo> = {}) => ({ id: 1, text: '가나', b, size: 20, ...extra }) as unknown as TextInfo;

describe('덮을 자리', () => {
  it('bounds + 여유(최소 3px · 크기 12%)', () => expect(patchRect(t([100, 100, 200, 130]), 1000, 1000)).toEqual([97, 97, 203, 133]));
  it('그림자 거리·번짐만큼 더 넓힌다', () => {
    const tt = t([100, 100, 200, 130], { shadows: [{ x: 4, y: 6, blur: 2, color: 'rgba(0,0,0,1)' }] });
    expect(fxSpread(tt)).toBe(9);
    expect(patchRect(tt, 1000, 1000)).toEqual([88, 88, 212, 142]);
  });
  it('값을 못 읽은 효과는 글자 크기 절반', () => expect(fxSpread(t([0, 0, 1, 1], { fx: ['outerGlow'] }))).toBe(10));
  it('문서 밖은 자르고 빈 글자는 뺀다', () => {
    expect(patchRect(t([0, 0, 50, 20]), 40, 1000)).toEqual([0, 0, 40, 23]);
    expect(patchRects([t([0, 0, 50, 20], { text: '  ' })], 100, 100)).toEqual([]);
  });
});

describe('테두리 색 차이', () => {
  // 10×10 영역, 가운데 4×4 가 덮은 자리
  const area: Rect = [0, 0, 10, 10];
  const r: Rect = [3, 3, 7, 7];
  const fill = (v: (x: number, y: number) => number) => {
    const a = new Uint8ClampedArray(10 * 10 * 4);
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) a.fill(v(x, y), (y * 10 + x) * 4, (y * 10 + x) * 4 + 3);
    return a;
  };
  it('바깥이 같으면 0 (안쪽 차이는 세지 않음)', () => {
    expect(ringDiff(fill(() => 100), fill((x, y) => (x >= 3 && x < 7 && y >= 3 && y < 7 ? 0 : 100)), area, r, [r])).toBe(0);
  });
  it('바깥 색이 다르면 그 차이', () => expect(ringDiff(fill(() => 100), fill(() => 130), area, r, [r])).toBe(30));
  it('다른 텍스트 자리는 빼고 센다', () => {
    const other: Rect = [0, 0, 10, 3];
    expect(ringDiff(fill(() => 100), fill((_, y) => (y < 3 ? 0 : 100)), area, r, [r, other])).toBe(0);
  });
  it('읽을 영역은 문서 안으로', () => expect(ringArea([1, 1, 99, 50], 100, 60)).toEqual([0, 0, 100, 53]));
});
