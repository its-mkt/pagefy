// 단계 표시 — 실제 진행대로 표시하고, 완료한 ②·③(과 지난 단계를 보는 중이면 지금 단계)만 눌러서 그 화면으로 간다
import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import Stepper from '../src/components/Stepper';

const buttons = (html: string) => (html.match(/<button/g) || []).length;

describe('Stepper', () => {
  it('누를 곳이 없으면 단추 없음 (onPick 없음 · ① 단계)', () => {
    expect(buttons(renderToString(h(Stepper, { step: 4 })))).toBe(0);
    expect(buttons(renderToString(h(Stepper, { step: 1, onPick: () => {} })))).toBe(0);
  });
  it('④ 에서는 ②·③ 을 눌러 볼 수 있다 (① 은 아님)', () => {
    const html = renderToString(h(Stepper, { step: 4, onPick: () => {} }));
    expect(buttons(html)).toBe(2);
    expect(html).toContain('확인·설정 화면 보기');
  });
  it('② 를 보는 중이면 ③ 과 지금 단계 ④ 로 돌아가는 단추', () => {
    const html = renderToString(h(Stepper, { step: 4, shown: 2, onPick: () => {} }));
    expect(buttons(html)).toBe(2);
    expect(html).toContain('지금 단계로 돌아가기');
    expect(html).toMatch(/is-done is-shown/);
  });
});
