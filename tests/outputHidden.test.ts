// 숨긴 글자 점검: 코드 생성의 줄 감싸개(font-size:0)는 제외하되 진짜 숨긴 글자는 잡는지 — yarn test
import { describe, expect, it } from 'vitest';
import { INLINE_ROW_STYLE } from '../src/lib/codegen';
import { withoutLayoutRows } from '../src/lib/output';

const HIDDEN = /display\s*:\s*none|font-size\s*:\s*0(px)?\s*[;"]/i;
const flagged = (html: string) => HIDDEN.test(withoutLayoutRows(html));

describe('숨긴 글자 점검', () => {
  it('칸을 나란히 놓는 감싸개는 제외', () => {
    expect(flagged(`<div style="${INLINE_ROW_STYLE};margin-top:25px">\n  <p style="font-size:20px">칸</p></div>`)).toBe(false);
  });
  it('감싸개에 직접 글자가 있으면 잡는다', () => {
    expect(flagged(`<div style="${INLINE_ROW_STYLE}">숨은 글자</div>`)).toBe(true);
  });
  it('다른 font-size:0 · display:none 은 잡는다', () => {
    expect(flagged('<p style="font-size:0;">a</p>')).toBe(true);
    expect(flagged('<p style="display:none">a</p>')).toBe(true);
  });
});
