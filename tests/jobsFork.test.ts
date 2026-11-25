// 같은 PSD 를 다른 판매처로 만들 때 새 작업 (forkJob) — 원래 작업은 그대로, 같은 묶음만 계획을 옮긴다
import { describe, expect, it } from 'vitest';
import { forkJob, matchFilter, platformMoved, samePlatform, settingsToSave, type Job } from '../src/lib/jobs';
import type { Settings } from '../src/components/SettingsPanel';

const settings: Settings = { productName: '제품', channel: 'itket', market: 'smartstore', slug: 'p', rev: '20261125', publicRoot: 'https://x', extra: '' };
const meta = { productName: '제품', channel: 'itket' as const, slug: 'p', rev: '20261125', publicRoot: 'https://x', date: '2026-11-25' };
const src = {
  id: 'a', createdAt: 1, updatedAt: 1, fileKey: 'k', fileName: 'a.psd', fileSize: 10, settings, state: 'done', meta,
  plan: { bundle: { plan: { engine: 'code', sections: [] } }, report: '', raw: '' }, sections: {}, failed: {}, html: '<p>', revisionCount: 2,
} as unknown as Job;

describe('samePlatform', () => {
  it('고도몰은 채널만, 오픈마켓은 플랫폼까지', () => {
    expect(samePlatform({ channel: 'itket', market: 'coupang' }, { channel: 'itket' })).toBe(true);
    expect(samePlatform({ channel: 'itket' }, { channel: 'oncore' })).toBe(false);
    expect(samePlatform({ channel: 'openmarket', market: 'coupang' }, { channel: 'openmarket', market: 'smartstore' })).toBe(false);
  });
});

describe('forkJob', () => {
  it('같은 묶음이면 계획을 옮기고 결과·수정 횟수는 비운다', () => {
    const nj = forkJob(src, { ...settings, channel: 'oncore' }, { keepPlan: true, planMeta: { ...meta, channel: 'oncore' } });
    expect(nj.id).not.toBe(src.id);
    expect(nj.fileKey).toBe('k');
    expect(nj.plan).toBe(src.plan);
    expect(nj.meta?.channel).toBe('oncore');
    expect(nj.html).toBeUndefined();
    expect(nj.revisionCount).toBe(0);
    expect(src.meta?.channel).toBe('itket'); // 원래 작업은 그대로
  });
  it('고도몰 → 오픈마켓은 계획 없이 시작 (Claude 1회)', () => {
    const nj = forkJob(src, { ...settings, channel: 'openmarket', market: 'coupang' }, { keepPlan: true });
    expect(nj.plan).toBeUndefined();
    expect(nj.meta).toBeUndefined();
    expect(nj.state).toBe('ready');
  });
});

describe('settingsToSave · platformMoved (판매처는 작업의 고정 값)', () => {
  it('계획을 받은 작업은 판매처를 바꿔도 고정 판매처로 저장', () => {
    const s = { ...settings, channel: 'openmarket' as const, market: 'coupang' as const, productName: '새 이름' };
    expect(platformMoved(src, s)).toBe(true);
    const saved = settingsToSave(src, s);
    expect(saved.channel).toBe('itket');
    expect(saved.productName).toBe('새 이름'); // 다른 설정은 저장
  });
  it('계획 전 작업은 아직 고정되지 않음', () => {
    const s = { ...settings, channel: 'oncore' as const };
    expect(platformMoved({ meta: undefined }, s)).toBe(false);
    expect(settingsToSave({ meta: undefined, settings }, s).channel).toBe('oncore');
  });
});

describe('matchFilter (브라우저 사본 거르기)', () => {
  const j = (note?: Job['note']) => ({ ...src, note }) as Job;
  it('테스트 제외는 기록 없는 작업도 남긴다', () => {
    expect(matchFilter(j(), { test: 'hide' })).toBe(true);
    expect(matchFilter(j({ test: true }), { test: 'hide' })).toBe(false);
    expect(matchFilter(j({ test: true }), { test: 'only' })).toBe(true);
  });
  it('검색은 담당자·메모까지', () => {
    expect(matchFilter(j({ assignee: '홍길동', memo: '리뉴얼 시안' }), { q: '시안' })).toBe(true);
    expect(matchFilter(j({ assignee: '홍길동' }), { q: '길동' })).toBe(true);
    expect(matchFilter(j(), { q: '없는말' })).toBe(false);
  });
});
