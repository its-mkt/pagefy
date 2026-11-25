// 섹션 경계가 글자를 가로지르면 가까운 빈 곳으로 옮기는지 — yarn test
import { describe, expect, it } from 'vitest';
import { clearCut } from '../src/lib/codegen';
import type { TextInfo } from '../shared/types';

const t = (y0: number, y1: number) => ({ id: y0, text: 'a', b: [0, y0, 100, y1] }) as unknown as TextInfo;

describe('clearCut', () => {
  const texts = [t(100, 140), t(150, 190)];
  it('가로지르지 않으면 그대로', () => expect(clearCut(texts, 145, 0, 1000)).toBe(145));
  it('글자 가운데면 가까운 위쪽 빈 곳으로', () => expect(clearCut(texts, 120, 0, 1000)).toBe(100));
  it('아래가 더 가까우면 아래로', () => expect(clearCut(texts, 135, 0, 1000)).toBe(140));
  it('앞뒤 경계 밖으로는 안 옮긴다', () => expect(clearCut(texts, 120, 110, 130)).toBeNull());
});
