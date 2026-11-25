// 에디터 테스트 「변환 내역에서 불러오기」 단추 — 불러온 결과가 있으면 그 이름을 보인다
import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import TesterJobPicker from '../src/components/TesterJobPicker';

const search = async () => ({ jobs: [], more: false });

describe('TesterJobPicker 단추 글자', () => {
  it('불러온 결과가 없으면 안내 문구', () => {
    const html = renderToString(h(TesterJobPicker, { search, onPick: () => {}, busy: false }));
    expect(html).toContain('작업을 골라 불러오기');
    expect(html).not.toContain('is-on');
  });
  it('불러온 결과가 있으면 그 이름 (제품명 · 판매처)', () => {
    const html = renderToString(h(TesterJobPicker, { search, onPick: () => {}, busy: false, value: "카드뉴스_퍼플 · 아이티켓" }));
    expect(html).toContain('카드뉴스_퍼플 · 아이티켓');
    expect(html).toContain('is-on');
    expect(html).not.toContain('작업을 골라 불러오기');
  });
  it('불러오는 중에는 진행 표시', () => {
    expect(renderToString(h(TesterJobPicker, { search, onPick: () => {}, busy: true, value: "이전 결과" }))).toContain('불러오는 중…');
  });
});
