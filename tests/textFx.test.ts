// 텍스트 레이어 효과(획·외부 광선·그라데이션 오버레이·드롭섀도) → CSS 로 옮기는지, 못 옮기면 이미지에 남기는지 — yarn test
import { describe, expect, it } from 'vitest';
import { generateMarkup, gradientCss, keepMap } from '../src/lib/codegen';
import type { GenerateMeta, Plan, PsdSummary, TextInfo } from '../shared/types';

const text = (id: number, extra: Partial<TextInfo> = {}): TextInfo =>
  ({
    id,
    path: `t${id}`,
    text: `제목 ${id}`,
    lines: [`제목 ${id}`],
    b: [100, 100 + id * 100, 300, 140 + id * 100],
    font: 'Pretendard-Bold',
    size: 40,
    lineHeight: 52,
    weight: 700,
    color: 'ffffff',
    ls: 0,
    align: 'left',
    shape: 'point',
    baseline: 135 + id * 100,
    lineTop: 135 + id * 100 - 40,
    anchorX: 100,
    ...extra,
  }) as TextInfo;

const summary = (texts: TextInfo[]): PsdSummary =>
  ({ fileName: 'fx.psd', width: 860, height: 1000, dpi: 72, layers: [], texts, hiddenCount: 0, fonts: [{ name: 'Pretendard-Bold', mapped: true, count: texts.length }], warnings: [] }) as unknown as PsdSummary;

const plan: Plan = { prefix: 'fx', sections: [{ id: 's00', name: '본문', y0: 0, y1: 1000 }], images: [], engine: 'code', photos: [], keepInImage: [], headings: {} } as unknown as Plan;
const meta: GenerateMeta = { productName: 'fx', channel: 'itket' as GenerateMeta['channel'], slug: 'fx', rev: '20261127', publicRoot: 'https://example.com/data/detail', date: '2026-11-27' };

const stroke = { size: 3, position: 'outside' as const, color: 'rgba(0,0,0,1)' };
const glow = { blur: 10, spread: 0, color: 'rgba(255,200,0,0.75)' };
const gradient = { angle: 90, scale: 1, offset: [0, 0] as [number, number], stops: [{ t: 0, color: 'rgba(255,0,0,1)' }, { t: 1, color: 'rgba(0,0,255,1)' }], opacity: 1 };

describe('텍스트 효과 → 이미지에 남길지', () => {
  it('값을 읽은 획·광선·그라데이션은 HTML 글자로 둔다', () => {
    const m = keepMap(summary([text(1, { fx: ['stroke'], stroke }), text(2, { fx: ['outerGlow'], glow }), text(3, { fx: ['gradientOverlay'], gradient })]), plan);
    expect(m.size).toBe(0);
  });
  it('값이 없는 옛 저장 작업의 획·광선은 예전처럼 이미지로', () => {
    const m = keepMap(summary([text(1, { fx: ['stroke'] }), text(2, { fx: ['outerGlow'] })]), plan);
    expect([...m.keys()].sort()).toEqual([1, 2]);
  });
  it('칠 0% + 획(외곽선 글자)은 HTML, 칠 0% + 그림자만은 이미지', () => {
    const m = keepMap(summary([text(1, { fx: ['stroke', 'fill 0%'], stroke }), text(2, { fx: ['dropShadow', 'fill 0%'], shadows: [{ x: 2, y: 2, blur: 4, color: 'rgba(0,0,0,0.5)' }] })]), plan);
    expect([...m.keys()]).toEqual([2]);
  });
});

describe('텍스트 효과 → CSS', () => {
  const html = generateMarkup(
    meta,
    summary([
      text(1, { fx: ['stroke'], stroke }),
      text(2, { fx: ['outerGlow', 'dropShadow'], glow, shadows: [{ x: 2, y: 3, blur: 4, color: 'rgba(0,0,0,0.5)' }] }),
      text(3, { fx: ['gradientOverlay'], gradient }),
      text(4, { fx: ['stroke', 'fill 0%'], stroke: { ...stroke, position: 'outside' } }),
    ]),
    plan,
  ).sections.map((s) => s.html).join('\n');
  const tag = (id: number) => html.split('\n').find((l) => l.includes(`제목 ${id}<`)) ?? '';

  it('바깥 획 = 두 배 굵기 text-stroke + paint-order', () => {
    expect(tag(1)).toMatch(/-webkit-text-stroke:calc\(6 \* var\(--u\)\) rgba\(0,0,0,1\)/);
    expect(tag(1)).toContain('paint-order:stroke fill');
  });
  it('외부 광선은 드롭섀도 뒤에 번짐만 있는 text-shadow 로', () => {
    expect(tag(2)).toMatch(/text-shadow:calc\(2 \* var\(--u\)\) calc\(3 \* var\(--u\)\) calc\(4 \* var\(--u\)\) rgba\(0,0,0,0\.5\),0 0 calc\(10 \* var\(--u\)\) rgba\(255,200,0,0\.75\)/);
  });
  it('그라데이션 오버레이 = background-clip:text', () => {
    expect(tag(3)).toContain('background-clip:text');
    expect(tag(3)).toContain('-webkit-text-fill-color:transparent');
    expect(tag(3)).toMatch(/background-image:linear-gradient\(0deg,/);
  });
  it('칠 0% 외곽선 글자는 획 굵기 그대로, 칠 아래에 깔지 않는다', () => {
    expect(tag(4)).toMatch(/-webkit-text-stroke:calc\(3 \* var\(--u\)\)/);
    expect(tag(4)).not.toContain('paint-order');
  });
});

describe('gradientCss — 레이어 영역 기준 정지점을 글자 상자 기준으로', () => {
  // 레이어 영역 y 100~140, 글자 상자 y 80~160: 위→아래(포토샵 -90°) 그라데이션의 0·1 은 상자 25%·75%
  const t = text(0, { b: [0, 100, 200, 140], gradient: { ...gradient, angle: -90 } });
  it('세로 그라데이션', () => {
    const css = gradientCss(t, { left: 0, top: 80, width: 200, height: 80 }, null)!;
    expect(css).toBe('linear-gradient(180deg,rgba(255,0,0,1) 25%,rgba(0,0,255,1) 75%)');
  });
  it('효과 불투명도가 1 보다 작으면 정지점 알파를 줄이고 글자색을 아래에 깐다', () => {
    const css = gradientCss({ ...t, gradient: { ...t.gradient!, opacity: 0.5 } }, { left: 0, top: 100, width: 200, height: 40 }, '#ffffff')!;
    expect(css).toBe('linear-gradient(180deg,rgba(255,0,0,0.5) 0%,rgba(0,0,255,0.5) 100%),linear-gradient(#ffffff,#ffffff)');
  });
});
