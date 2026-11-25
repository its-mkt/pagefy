// 탭 문자를 포토샵 탭 위치(36px)처럼 벌리는지 — yarn test
import { describe, expect, it } from 'vitest';
import { nextTab, tabbedWidth, tabHtml, tabStopPx } from '../src/lib/tabs';

const len = (n: number) => `${n}px`;

describe('탭', () => {
  it('72dpi 기본 간격 36px', () => expect(tabStopPx(72)).toBe(36));
  it('다음 탭 위치 (딱 맞으면 그다음)', () => {
    expect(nextTab(10, 36)).toBe(36);
    expect(nextTab(36, 36)).toBe(72);
  });
  it('줄 폭은 탭 위치로 건너뛴다', () => expect(tabbedWidth('1\tabc', 36, (s) => s.length * 10)).toBe(66));
  it('줄 첫 조각: 번호를 탭 위치까지의 칸으로', () =>
    expect(tabHtml('2\tAudio jack', '2\tAudio jack', '', 18, 36, len)).toBe('<span style="display:inline-block;min-width:36px">2</span>Audio jack'));
  it('탭 두 개', () =>
    expect(tabHtml('a\tb\tc', 'a\tb\tc', '', 18, 36, len)).toBe('<span style="display:inline-block;min-width:36px">a</span><span style="display:inline-block;min-width:36px">b</span>c'));
});
