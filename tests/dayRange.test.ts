// 변환 내역 기간 거르기 (PeriodPicker) 의 날짜 계산
import { describe, expect, it } from 'vitest';
import { orderedRange, rangeDays, rangeLabel, rangeMs, fromDayKey } from '../src/lib/dayRange';

describe('dayRange', () => {
  it('거꾸로 누른 기간도 앞뒤를 바로잡는다', () => {
    expect(orderedRange('2026-11-20', '2026-11-03')).toEqual({ from: '2026-11-03', to: '2026-11-20' });
  });
  it('범위 글자 · 일수', () => {
    expect(rangeLabel({ from: '2026-11-05', to: '2026-11-05' })).toBe('2026.11.05');
    expect(rangeLabel({ from: '2026-11-01', to: '2026-11-05' })).toBe('2026.11.01 ~ 11.05');
    expect(rangeLabel({ from: '2025-12-30', to: '2026-01-02' })).toBe('2025.12.30 ~ 2026.01.02');
    expect(rangeDays({ from: '2026-11-01', to: '2026-11-05' })).toBe(5);
  });
  it('종료일은 그날 끝까지 포함 (다음 날 0시 미만)', () => {
    const { start, end } = rangeMs({ from: '2026-11-30', to: '2026-11-30' });
    expect(start).toBe(fromDayKey('2026-11-30').getTime());
    expect(end).toBe(fromDayKey('2026-12-01').getTime());
  });
});
