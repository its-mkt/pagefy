// 배경 블록 이음매 흰 줄 방지 (2026-11-27): background-size 세로값 = min-height 값 — yarn test
// `100% auto` 는 폭×비율로 따로 계산돼 반올림 차이로 틈이 생기고, `100% 100%` 는 글자가 넘치면 배경이 늘어난다
import { describe, expect, it } from 'vitest';
import { generateMarkup } from '../src/lib/codegen';
import type { GenerateMeta, Plan, PsdSummary, TextInfo } from '../shared/types';

const text = (id: number, y: number): TextInfo =>
  ({ id, path: `t${id}`, text: `본문 ${id}`, lines: [`본문 ${id}`], b: [100, y, 400, y + 30], font: 'Pretendard-Regular', size: 24, lineHeight: 31, weight: 400, color: '000000', ls: 0, align: 'left', shape: 'point', baseline: y + 24, lineTop: y, anchorX: 100 }) as TextInfo;

const texts = [text(1, 200), text(2, 900)];
const summary = { fileName: 'bg.psd', width: 860, height: 1333, dpi: 72, layers: [], texts, hiddenCount: 0, fonts: [{ name: 'Pretendard-Regular', mapped: true, count: 2 }], warnings: [] } as unknown as PsdSummary;
// 경계 667 은 860 폭 기준 소수점이 나오는 높이 (화면 폭으로 줄이면 반올림 차이가 생기는 경우)
const plan = { prefix: 'bg', sections: [{ id: 's00', name: '위', y0: 0, y1: 667 }, { id: 's01', name: '아래', y0: 667, y1: 1333 }], images: [], engine: 'code', photos: [], keepInImage: [], headings: {} } as unknown as Plan;
const meta: GenerateMeta = { productName: 'bg', channel: 'itket' as GenerateMeta['channel'], slug: 'bg', rev: '20261127', publicRoot: 'https://example.com/data/detail', date: '2026-11-27' };

describe('배경 블록 이음매', () => {
  const out = generateMarkup(meta, summary, plan);
  const html = out.sections.map((s) => s.html).join('\n');
  const blocks = [...html.matchAll(/<div class="dp-bg-sec" style="([^"]*)"/g)].map((m) => m[1]);

  it('모든 배경 블록의 background-size 세로값이 min-height 와 같다', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    for (const st of blocks) {
      const size = /background-size:100% ([^;]+);/.exec(st)?.[1];
      const minH = /min-height:([^;]+);/.exec(st)?.[1];
      expect(size).toBeTruthy();
      expect(size).toBe(minH);
    }
  });

  it('공통 CSS 에 100% auto 가 남아 있지 않다', () => {
    expect(out.style ?? '').not.toContain('100% auto');
    expect(html).not.toContain('100% auto');
    expect(html).not.toContain('100% 100%');
  });
});
