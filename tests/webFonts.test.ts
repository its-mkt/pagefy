// 웹폰트 표(fonts.ts): 표 글꼴은 실제 글자 + 쓴 굵기만 @font-face, 잘린 이름은 이미지로 — yarn test
import { describe, expect, it } from 'vitest';
import { generateMarkup, keepMap } from '../src/lib/codegen';
import { isTruncatedNumbered, webFontCss, webFontOf } from '../src/lib/psd/fonts';
import { isBakeFont, weightOf } from '../src/lib/psd/extract';
import type { GenerateMeta, Plan, PsdSummary, TextInfo } from '../shared/types';

const text = (id: number, font: string, weight: number, extra: Partial<TextInfo> = {}): TextInfo =>
  ({ id, path: `t${id}`, text: `글자 ${id}`, lines: [`글자 ${id}`], b: [100, 100 * id, 300, 100 * id + 40], font, size: 40, lineHeight: 52, weight, color: '000000', ls: 0, align: 'left', shape: 'point', baseline: 100 * id + 35, lineTop: 100 * id - 5, anchorX: 100, ...extra }) as TextInfo;

const summary = (texts: TextInfo[]) => ({ fileName: 'f.psd', width: 860, height: 1000, dpi: 72, layers: [], texts, hiddenCount: 0, fonts: [], warnings: [] }) as unknown as PsdSummary;
const plan = { prefix: 'wf', sections: [{ id: 's00', name: '본문', y0: 0, y1: 1000 }], images: [], engine: 'code', photos: [], keepInImage: [], headings: {} } as unknown as Plan;
const meta = { productName: 'wf', channel: 'itket', slug: 'wf', rev: '20261127', publicRoot: 'https://example.com/d', date: '2026-11-27' } as unknown as GenerateMeta;

describe('2026-11-27 추가 글꼴', () => {
  it.each([
    ['SUIT-ExtraBold', 'SUIT', 800],
    ['NanumSquareNeo-cBd', 'NanumSquareNeo', 700],
    ['NanumSquareNeoTTF-eHv', 'NanumSquareNeo', 900],
    ['NanumSquareNeovariable-Heavy', 'NanumSquareNeo', 900],
    ['NanumSquareEB', 'NanumSquare', 800],
    ['GmarketSansTTFMedium', 'GmarketSans', 500],
    ['Cafe24OhsquareOTF', 'Cafe24Ohsquare', 400],
    ['Cafe24-Ohsquareair-OTF', 'Cafe24Ohsquareair', 400],
    ['S-CoreDream-6Bold', 'S-CoreDream', 600],
    ['S-CoreDream-8Heavy', 'S-CoreDream', 800],
    ['NotoSansKR-DemiLight', 'Noto Sans KR', 350],
  ])('%s → %s %i', (ps, family, w) => {
    expect(webFontOf(ps)?.family).toBe(family);
    expect(weightOf(ps)).toBe(w);
  });

  it('woff 파일은 format("woff"), 분할 조각 글꼴은 굵기별 @import', () => {
    const { faces, imports } = webFontCss(new Map([['GmarketSans', new Set([700])], ['Noto Sans KR', new Set([350, 700])]]));
    expect(faces[0]).toContain('GmarketSansBold.woff") format("woff")');
    expect(imports).toEqual(['@import url("https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-kr@5.3.1/300.css");', '@import url("https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-kr@5.3.1/700.css");']);
  });

  it('Forma DJR(HP 상용)는 이미지로 굽는 폰트', () => {
    expect(isBakeFont('FormaDJRKoreanMicro-Bold')).toBe(true);
    expect(webFontOf('FormaDJRKoreanMicro-Bold')).toBeUndefined();
  });
});

describe('웹폰트 표', () => {
  it('글꼴 이름 판정', () => {
    expect(webFontOf('Freesentation-5Medium')?.family).toBe('Freesentation');
    expect(webFontOf('Paperlogy-8ExtraBold')?.family).toBe('Paperlogy');
    expect(webFontOf('Pretendard-Bold')?.family).toBe('Pretendard');
    // 잘린 이름은 어느 글꼴인지 모르므로 표에서 찾지 않는다
    expect(webFontOf('-5Medium')).toBeUndefined();
    expect(isTruncatedNumbered('-5Medium')).toBe(true);
    expect(isTruncatedNumbered('Freesentation-5Medium')).toBe(false);
  });

  it('쓴 굵기만 버전 고정 주소로 선언한다', () => {
    const { faces, imports } = webFontCss(new Map([['Freesentation', new Set([500, 800])]]));
    expect(imports).toEqual([]);
    expect(faces).toHaveLength(2);
    expect(faces[0]).toContain("font-family:'dp-freesentation'");
    expect(faces[0]).toContain('projectnoonnu/2404@1.0/Freesentation-5Medium.woff2');
    expect(faces[1]).toContain('Freesentation-8ExtraBold.woff2');
    expect(faces.every((f) => f.includes('font-display:block'))).toBe(true);
  });

  it('프리젠테이션 글자는 실제 글자로, 잘린 이름 글자는 이미지로', () => {
    const s = summary([text(1, 'Freesentation-5Medium', 500), text(2, '-8ExtraBold', 800, { bakeHint: '글꼴 이름이 잘려(-8ExtraBold) …' })]);
    expect([...keepMap(s, plan).keys()]).toEqual([2]);
    const r = generateMarkup(meta, s, plan);
    const html = r.sections.map((x) => x.html).join('');
    expect(html).toContain("font-family:'dp-freesentation','Pretendard'");
    expect(JSON.stringify(r.bundle)).toContain('Freesentation-5Medium.woff2');
  });
});
