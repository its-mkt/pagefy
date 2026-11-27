// 문자 속성(밑줄·취소선·가짜 굵게·첨자 등) — 옮길 수 있는 것은 CSS 로, 못 옮기는 것은 이미지에 남기는지 (규칙 4-2) — yarn test
import type { Layer } from 'ag-psd';
import { describe, expect, it } from 'vitest';
import { generateMarkup } from '../src/lib/codegen';
import { textInfo } from '../src/lib/psd/extract';
import type { GenerateMeta, Plan, PsdSummary } from '../shared/types';

const font = { name: 'Pretendard-Bold' };
/** 앞 3글자 "가나다" + 뒤 3글자 "라마바" 두 범위, 뒤 범위에만 style 을 준다 */
const layer = (style: Record<string, unknown>): Layer =>
  ({
    id: 1,
    left: 100,
    top: 100,
    right: 300,
    bottom: 140,
    text: {
      text: '가나다라마바',
      transform: [1, 0, 0, 1, 100, 135],
      style: { font, fontSize: 40, fillColor: { r: 0, g: 0, b: 0 } },
      styleRuns: [
        { length: 3, style: {} },
        { length: 3, style },
      ],
    },
  }) as unknown as Layer;

const info = (style: Record<string, unknown>) => textInfo(layer(style), 't1')!;

describe('글자 속성 → CSS 또는 이미지', () => {
  it('밑줄·취소선은 범위에 deco 로 남기고 이미지로 보내지 않는다', () => {
    const t = info({ underline: true, strikethrough: true });
    expect(t.bakeHint).toBeUndefined();
    expect(t.runs?.map((r) => r.deco)).toEqual([undefined, 'underline line-through']);
  });

  it.each([
    [{ fauxBold: true }, '가짜 굵게'],
    [{ fauxItalic: true }, '가짜 기울임'],
    [{ fontBaseline: 1 }, '위 첨자'],
    [{ fontBaseline: 2 }, '아래 첨자'],
    [{ fontCaps: 1 }, '작은 대문자'],
    [{ baselineShift: 5 }, '글자 일부만 기준선 이동'],
    [{ fontCaps: 2 }, '글자 일부만 모두 대문자'],
  ])('%o → 이미지 (%s)', (style, why) => {
    expect(info(style).bakeHint).toContain(why);
  });

  it('공백에만 걸린 속성은 무시한다', () => {
    const l = layer({});
    l.text!.text = '가나다   ';
    l.text!.styleRuns = [
      { length: 3, style: {} },
      { length: 3, style: { fauxBold: true, underline: true } },
    ];
    expect(textInfo(l, 't1')!.bakeHint).toBeUndefined();
  });

  it('codegen 이 밑줄 범위에 text-decoration-line 을 준다', () => {
    const t = info({ underline: true });
    const summary = { fileName: 'a.psd', width: 860, height: 400, dpi: 72, layers: [], texts: [t], hiddenCount: 0, fonts: [{ name: font.name, mapped: true, count: 1 }], warnings: [] } as unknown as PsdSummary;
    const plan = { prefix: 'ta', sections: [{ id: 's00', name: '본문', y0: 0, y1: 400 }], images: [], engine: 'code', photos: [], keepInImage: [], headings: {} } as unknown as Plan;
    const meta: GenerateMeta = { productName: 'ta', channel: 'itket' as GenerateMeta['channel'], slug: 'ta', rev: '20261127', publicRoot: 'https://example.com/data/detail', date: '2026-11-27' };
    const html = generateMarkup(meta, summary, plan).sections.map((s) => s.html).join('');
    expect(html).toMatch(/<span style="[^"]*text-decoration-line:underline[^"]*">라마바<\/span>/);
  });
});
