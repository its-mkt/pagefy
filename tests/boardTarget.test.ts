// 고도몰 올릴 곳(상품 상세 860 · 게시판 980, 규칙 7-2-2) — 최상위 최대 폭·배율과 점검 기준이 따라 바뀌는지 — yarn test
import { describe, expect, it } from 'vitest';
import { generateMarkup } from '../src/lib/codegen';
import { checkOutput } from '../src/lib/output';
import { godoMaxWidth, godoRootCss } from '../shared/width';
import { sameMeta } from '../src/lib/jobs';
import type { GenerateMeta, Plan, PsdSummary } from '../shared/types';

const summary = (width: number): PsdSummary =>
  ({ fileName: 'b.psd', width, height: 600, dpi: 72, layers: [], texts: [], hiddenCount: 0, fonts: [], warnings: [] }) as unknown as PsdSummary;
const plan: Plan = { prefix: 'dp-b', sections: [{ id: 's00', name: '본문', y0: 0, y1: 600 }], images: [], engine: 'code', photos: [], keepInImage: [], headings: {} } as unknown as Plan;
const meta: GenerateMeta = { productName: 'b', channel: 'itket', slug: 'b', rev: '20261127', publicRoot: 'https://example.com/data/detail', date: '2026-11-27' };

describe('올릴 곳별 최대 폭', () => {
  it('상품 상세는 860, 게시판은 980 상한 (좁은 PSD 는 PSD 폭)', () => {
    expect(godoMaxWidth(960)).toBe(860);
    expect(godoMaxWidth(960, 'board')).toBe(960);
    expect(godoMaxWidth(1200, 'board')).toBe(980);
    expect(godoMaxWidth(750, 'board')).toBe(750);
  });
  it('vw 대체값도 상한에 맞춘다', () => {
    expect(godoRootCss('dp-b', 1200, 'board')).toContain('--u:min(0.8167px,calc(100vw / 1200))');
    expect(godoRootCss('dp-b', 1200, 'board')).toContain('max-width:980px');
    expect(godoRootCss('dp-b', 1200)).toContain('max-width:860px');
  });
  it('코드 생성 CSS 에 올릴 곳 폭이 들어간다', () => {
    expect(generateMarkup(meta, summary(960), plan).bundle.style).toContain('max-width:860px');
    expect(generateMarkup({ ...meta, target: 'board' }, summary(960), plan).bundle.style).toContain('max-width:960px');
  });
  it('점검은 올릴 곳 기준으로 본다 (게시판 960 결과를 860 기준으로 경고하지 않음)', () => {
    const style = generateMarkup({ ...meta, target: 'board' }, summary(960), plan).bundle.style;
    const out = { html: `<style>${style}</style><div class="dp-b"></div>`, report: '' } as never;
    const warns = (t?: 'board') => checkOutput(out, summary(960), meta.publicRoot, undefined, t).filter((c) => /max-width/.test(c.message)).map((c) => c.message);
    expect(warns('board')).toEqual([]);
    expect(warns().length).toBeGreaterThan(0);
  });
  it('올릴 곳이 바뀌면 다시 계산 대상 (sameMeta)', () => {
    expect(sameMeta(meta, { ...meta, target: 'board' })).toBe(false);
    expect(sameMeta(meta, { ...meta })).toBe(true);
  });
});

describe('게시판 이미지 경로 (/data/post/<채널>/<게시판>/<슬러그>, 2026-11-27)', () => {
  it('상품 상세는 그대로, 게시판은 detail 옆 post 아래', async () => {
    const { imageBaseUrl } = await import('../shared/types');
    expect(imageBaseUrl(meta)).toBe('https://example.com/data/detail/itket/b');
    expect(imageBaseUrl({ ...meta, target: 'board', board: 'event' })).toBe('https://example.com/data/post/itket/event/2026/b');
    expect(imageBaseUrl({ ...meta, channel: 'openmarket', market: 'coupang', target: 'board', board: 'event' } as never)).toBe('https://example.com/data/detail/openmarket/coupang/b');
  });
  it('업로드도 같은 곳 — FTP /data/post, 공개 주소 …/data/post (게시판 폴더 없으면 거절)', async () => {
    const { publicUrlOf, checkTarget } = await import('../core/upload');
    const cfg = { host: 'h', port: 21, user: 'u', pass: 'p', root: '/data/detail', publicBase: 'https://example.com/data/detail' };
    const t = { channel: 'itket', slug: 'b', publicRoot: cfg.publicBase, target: 'board' as const, board: 'event', year: '2026' };
    expect(publicUrlOf(cfg, t, 's00_bg1.jpg')).toBe('https://example.com/data/post/itket/event/2026/b/s00_bg1.jpg');
    expect(checkTarget(cfg, t)).toBeNull();
    expect(checkTarget(cfg, { ...t, board: '' })).toMatch(/게시판/);
    expect(checkTarget(cfg, { ...t, board: '../x' })).toMatch(/게시판/);
    expect(checkTarget(cfg, { ...t, year: '' })).toMatch(/연도/);
    expect(checkTarget(cfg, { ...t, year: '../' })).toMatch(/연도/);
  });
  it('목록 있는 쇼핑몰은 목록 안 값만, 없는 쇼핑몰은 넣은 값', async () => {
    const { pickBoard } = await import('../shared/types');
    expect(pickBoard('itket', 'notice')).toBe('notice');
    expect(pickBoard('itket', 'zzz')).toBe('event');
    expect(pickBoard('oncore', 'news')).toBe('news');
  });
});

describe('아이티켓 게시판 폴더 이름 (2026-11-27 사용자 결정)', () => {
  it('notice · event · case-study · archives · newsletter, 기본은 event', async () => {
    const { GODO_BOARDS, defaultBoard, imageBaseUrl } = await import('../shared/types');
    expect(GODO_BOARDS.itket!.slice(0, 5).map((b) => b.id)).toEqual(['notice', 'event', 'case-study', 'archives', 'newsletter']);
    expect(defaultBoard('itket')).toBe('event');
    expect(imageBaseUrl({ ...meta, target: 'board', board: 'case-study' })).toBe('https://example.com/data/post/itket/case-study/2026/b');
  });
});

describe('게시판 연도 폴더 (/data/post/<채널>/<게시판>/YYYY/<슬러그>, 2026-11-27)', () => {
  it('연도는 작업 판(rev)의 연도', async () => {
    const { imageBaseUrl, boardYear } = await import('../shared/types');
    expect(boardYear('20270105-2')).toBe('2027');
    expect(imageBaseUrl({ ...meta, rev: '20270105', target: 'board', board: 'newsletter' })).toBe('https://example.com/data/post/itket/newsletter/2027/b');
  });
});
