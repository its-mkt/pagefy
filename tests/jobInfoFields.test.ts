// 작업 기록 칸 — 담당자는 필수: 비운 채 만들기·저장을 누른 뒤(showError)에만 빨간 테두리와 안내
import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import JobInfoFields, { hasAssignee } from '../src/components/JobInfoFields';

const draw = (assignee: string, showError: boolean) => renderToString(h(JobInfoFields, { value: { assignee }, onChange: () => {}, showError }));

describe('JobInfoFields 담당자 (필수)', () => {
  it('이름표는 「담당자 (필수)」, 처음에는 빨간 표시 없음', () => {
    const html = draw('', false);
    expect(html).toContain('담당자 (필수)');
    expect(html).not.toContain('is-bad');
    expect(html).toContain('data-attn'); // 비었으니 커서를 옮길 칸으로는 표시
  });
  it('비운 채 누르면 빨간 테두리와 안내', () => {
    const html = draw('  ', true);
    expect(html).toContain('is-bad');
    expect(html).toContain('담당자를 입력해 주세요');
  });
  it('입력하면 표시가 풀린다', () => {
    const html = draw('홍길동', true);
    expect(html).not.toContain('is-bad');
    expect(html).not.toContain('data-attn');
    expect(hasAssignee({ assignee: '홍길동' })).toBe(true);
    expect(hasAssignee({ assignee: '  ' })).toBe(false);
  });
});
