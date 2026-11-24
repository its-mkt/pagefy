// 운영 기록 계산 (월 경계·상한·평가 검사·사용 기록 감싸기) — yarn test
import { describe, expect, it } from 'vitest';
import { budgetOf, monthKST, monthStartISO, nextMonth } from '../shared/ops';
import { checkFeedback, trackRun } from '../core/ops';
import type { StreamEvent } from '../shared/types';

describe('달 계산 (한국 시간)', () => {
  it('UTC 로 전날 15시 이후는 한국 다음 날', () => {
    expect(monthKST(new Date('2026-11-30T14:59:59Z'))).toBe('2026-11');
    expect(monthKST(new Date('2026-11-30T15:00:00Z'))).toBe('2026-12');
  });
  it('해 넘김', () => {
    expect(nextMonth('2026-12')).toBe('2027-01');
    expect(nextMonth('2026-01', -1)).toBe('2025-12');
    expect(nextMonth('2026-11', -5)).toBe('2026-06');
  });
  it('달 시작 시각', () => {
    expect(new Date(monthStartISO('2026-12')).toISOString()).toBe('2026-11-30T15:00:00.000Z');
  });
});

describe('월 상한', () => {
  it('상한에 닿으면 막고, 그 달을 풀면 안 막는다', () => {
    expect(budgetOf('2026-11', 100, 99.99, null).blocked).toBe(false);
    expect(budgetOf('2026-11', 100, 100, null).blocked).toBe(true);
    expect(budgetOf('2026-11', 100, 130, '2026-11')).toMatchObject({ blocked: false, unblocked: true });
    // 지난달에 푼 것은 이번 달에 적용되지 않는다
    expect(budgetOf('2026-12', 100, 130, '2026-11')).toMatchObject({ blocked: true, unblocked: false });
  });
});

describe('결과 평가 검사', () => {
  const ok = { jobId: 'j1', product: 'P', verdict: 'edited' as const, areas: ['linebreak' as const] };
  it('올바른 값은 통과', () => expect(checkFeedback(ok)).toBeNull());
  it('모르는 고친 곳·평가 값은 거절', () => {
    expect(checkFeedback({ ...ok, areas: ['x' as never] })).not.toBeNull();
    expect(checkFeedback({ ...ok, verdict: 'good' as never })).not.toBeNull();
    expect(checkFeedback({ ...ok, jobId: '' })).not.toBeNull();
    expect(checkFeedback({ ...ok, note: 'a'.repeat(501) })).not.toBeNull();
  });
});

describe('사용 기록 감싸기', () => {
  it('이벤트를 그대로 넘기고, 설정이 없으면 DB 에 쓰지 않는다', async () => {
    const got: StreamEvent[] = [];
    const run = trackRun(null, { email: 'a@b.c', action: 'plan' }, (e) => got.push(e));
    run.send({ type: 'status', message: '…' });
    run.send({ type: 'done', stopReason: 'end_turn', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, costUsd: 0.5 }, model: 'claude-opus-5-5' });
    await run.finish(false);
    expect(got.map((e) => e.type)).toEqual(['status', 'done']);
  });
});
