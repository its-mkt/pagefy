// 오픈마켓 섹션 이미지를 제목 줄 기준 띠로 나누고 제목 띠를 <hN> 로 감싸는지 (2026-11-27, 검색·AI 용) — yarn test
import { describe, expect, it } from 'vitest';
import { generateMarkup, sectionStrips } from '../src/lib/codegen';
import type { GenerateMeta, Plan, PsdSummary, TextInfo } from '../shared/types';

const text = (id: number, y: number, h: number, size: number, s = `글자${id}`): TextInfo =>
  ({ id, path: `t${id}`, text: s, lines: [s], b: [100, y, 500, y + h], font: 'Pretendard-Bold', size, lineHeight: size * 1.3, weight: 700, color: '000000', ls: 0, align: 'left', shape: 'point', baseline: y + h * 0.8, lineTop: y, anchorX: 100 }) as TextInfo;

const sec = { y0: 0, y1: 1000 };
// 작은 머리글(100~120) · 대제목(200~260) · 본문 두 줄(400~430, 450~480) · 사진 띠(아래 빈 곳)
const eyebrow = text(1, 100, 20, 16, 'NEW');
const title = text(2, 200, 60, 48, 'HP Pro Mini 260');
const body1 = text(3, 400, 30, 20, '작고 강력한 PC');
const body2 = text(4, 450, 30, 20, '사무실 어디에나');
const texts = [eyebrow, title, body1, body2];

describe('sectionStrips', () => {
  it('제목 위·아래 빈 줄에서 자르고 제목 띠에 단계를 준다', () => {
    const { strips } = sectionStrips(sec, texts, texts, { '2': 2 });
    expect(strips.map((s) => [s.y0, s.y1])).toEqual([
      [0, 160],
      [160, 330],
      [330, 1000],
    ]);
    expect(strips[1]).toMatchObject({ alt: 'HP Pro Mini 260', level: 2 });
    expect(strips[0]).toMatchObject({ alt: 'NEW', level: undefined });
    expect(strips[2].alt).toBe('작고 강력한 PC · 사무실 어디에나');
  });

  it('띠를 이어 붙이면 섹션 전체와 같다 (빈틈·겹침 없음)', () => {
    const { strips } = sectionStrips(sec, texts, texts, { '1': 3, '2': 2 });
    expect(strips[0].y0).toBe(0);
    expect(strips[strips.length - 1].y1).toBe(1000);
    strips.slice(1).forEach((s, i) => expect(s.y0).toBe(strips[i].y1));
  });

  it('계획에 h2 가 없으면 가장 큰 글자를 h2 로', () => {
    const { strips, autoH2 } = sectionStrips(sec, texts, texts, {});
    expect(autoH2?.id).toBe(2);
    expect(strips.find((s) => s.level === 2)?.alt).toBe('HP Pro Mini 260');
  });

  it('자르는 줄이 다른 글자 상자를 지나면 자르지 않는다', () => {
    const side = { ...text(5, 150, 200, 20, '옆 설명'), b: [600, 150, 800, 350] as [number, number, number, number] };
    const { strips } = sectionStrips(sec, [...texts, side], [...texts, side], { '2': 2 });
    // 제목 위(160)·아래(330)가 옆 설명(150~350)을 지나므로 띠가 하나
    expect(strips).toHaveLength(1);
    expect(strips[0].level).toBeUndefined();
  });

  it('나란히 놓인 제목 사이에 40px 보다 얇은 띠를 만들지 않는다', () => {
    const a = text(1, 100, 40, 30, '왼쪽 제목');
    const b = { ...text(2, 141, 40, 30, '아래 제목') };
    const { strips } = sectionStrips(sec, [a, b], [a, b], { '1': 3, '2': 3 });
    expect(strips.every((s) => s.y1 - s.y0 >= 40)).toBe(true);
  });

  it('h4 에서는 자르지 않는다 (h4 글자는 들어간 띠의 alt 에)', () => {
    const { strips } = sectionStrips(sec, texts, texts, { '2': 2, '3': 4 });
    expect(strips.some((s) => s.alt === '작고 강력한 PC')).toBe(false);
    expect(strips.find((s) => s.alt.includes('작고 강력한 PC'))?.level).toBeUndefined();
  });

  it('세로 제한을 넘는 띠는 더 나눈다', () => {
    const { strips } = sectionStrips({ y0: 0, y1: 5000 }, texts, texts, { '2': 2 }, 2000);
    expect(strips.every((s) => s.y1 - s.y0 <= 2000)).toBe(true);
  });
});

describe('오픈마켓 출력', () => {
  it('제목 띠는 <h2> 안의 이미지, 나머지는 띠별 alt', () => {
    const summary = { fileName: 'a.psd', width: 860, height: 1000, dpi: 72, layers: [], texts, hiddenCount: 0, fonts: [{ name: 'Pretendard-Bold', mapped: true, count: 4 }], warnings: [] } as unknown as PsdSummary;
    const plan = { prefix: 'om', sections: [{ id: 's00', name: '메인', y0: 0, y1: 1000 }], images: [], engine: 'code', photos: [], keepInImage: [], headings: { '2': 2 } } as unknown as Plan;
    const meta = { productName: 'om', channel: 'openmarket', market: 'smartstore', slug: 'om', rev: '20261127', publicRoot: 'https://example.com/data/detail', date: '2026-11-27' } as unknown as GenerateMeta;
    const html = generateMarkup(meta, summary, plan).sections.map((s) => s.html).join('\n');
    expect(html).toMatch(/<h2 style="margin:0;padding:0"><img [^>]*alt="HP Pro Mini 260"[^>]*><\/h2>/);
    expect(html).toContain('alt="작고 강력한 PC · 사무실 어디에나"');
    expect((html.match(/<img /g) || []).length).toBe(3);
    // 모든 이미지에 alt 값 (11번가·G마켓·롯데온 가이드), 스마트스토어는 height 속성 유지
    expect(html).not.toContain('alt=""');
    expect(html).toMatch(/<img [^>]*height="\d+"/);
  });

  it('G마켓은 height 속성·height:auto 를 뺀다 (ESM 모바일 가이드)', () => {
    const summary = { fileName: 'a.psd', width: 860, height: 1000, dpi: 72, layers: [], texts, hiddenCount: 0, fonts: [], warnings: [] } as unknown as PsdSummary;
    const plan = { prefix: 'om', sections: [{ id: 's00', name: '메인', y0: 0, y1: 1000 }], images: [], engine: 'code', photos: [], keepInImage: [], headings: { '2': 2 } } as unknown as Plan;
    const meta = { productName: 'om', channel: 'openmarket', market: 'gmarket', slug: 'om', rev: '20261127', publicRoot: 'https://example.com/d', date: '2026-11-27' } as unknown as GenerateMeta;
    const html = generateMarkup(meta, summary, plan).sections.map((s) => s.html).join('\n');
    expect(html).not.toMatch(/height=|height:/);
    expect(html).not.toContain('max-width');
  });
});
