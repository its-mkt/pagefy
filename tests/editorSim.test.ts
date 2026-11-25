// 에디터 테스트의 인라인 CSS 나누기·지우기 — 괄호·따옴표 안 ; 를 자르지 않는지 — yarn test
import { describe, expect, it } from 'vitest';
import { EDITORS, editorFor, filterDecls, splitDecls } from '../src/lib/editorSim';

describe('splitDecls', () => {
  it('괄호·따옴표 안의 ; 는 나누지 않는다', () => {
    expect(splitDecls('color:red; background:url("data:image/png;base64,AA") no-repeat;;font-family:"a;b"')).toEqual([
      'color:red',
      'background:url("data:image/png;base64,AA") no-repeat',
      'font-family:"a;b"',
    ]);
  });
});

describe('filterDecls', () => {
  it('calc·var 가 든 선언과 max-width 만 뺀다', () => {
    const r = filterDecls('width:100%;max-width:860px;font-size:calc(18 * var(--u));--u:1px', (p, v) => p === 'max-width' || /\b(var|calc)\(/.test(v));
    expect(r.style).toBe('width:100%;--u:1px');
    expect(r.removed).toEqual(['max-width:860px', 'font-size:calc(18 * var(--u))']);
  });
  it('속성 이름은 소문자로 비교한다 (CSS 변수는 그대로)', () => {
    expect(filterDecls('Border-Radius:4px', (p) => p === 'border-radius').style).toBe('');
  });
});

describe('EDITORS', () => {
  it('플랫폼 id 가 겹치지 않고 폭이 있다', () => {
    expect(new Set(EDITORS.map((e) => e.id)).size).toBe(EDITORS.length);
    for (const e of EDITORS) expect(e.pcWidth).toBeGreaterThan(300);
  });
});

describe('editorFor (판매처 → 흉내 낼 에디터)', () => {
  it('고도몰은 SE2, 오픈마켓은 플랫폼별, 기타는 스마트스토어', () => {
    expect(editorFor({ channel: 'oncore' })).toBe('godo');
    expect(editorFor({ channel: 'openmarket', market: 'coupang' })).toBe('coupang');
    expect(editorFor({ channel: 'openmarket', market: 'other' })).toBe('smartstore');
  });
});
