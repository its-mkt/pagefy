// 점검 문구 → 쉬운 말: 실제로 나오는 문구가 일반 문구("확인이 필요한 점")로 빠지지 않는지 — yarn test
import { describe, expect, it } from 'vitest';
import { plainCheck } from '../src/lib/plainCheck';

const GENERIC = ['확인이 필요한 점이 있습니다.', '그대로 붙여넣으면 문제가 생길 수 있는 점이 있습니다.'];

describe('plainCheck', () => {
  const cases: [string, 'error' | 'warn' | 'ok', RegExp][] = [
    ['PSD 위치 대조: 2/94 통과 (기준선 세로 ±3px·가로 ±6px) — 어긋남 큰 순: "24시간7일" 세로 +1588.5px', 'error', /94개 중 92개/],
    ['PSD 위치 대조: 104/104 통과 (기준선 세로 ±3px·가로 ±6px)', 'ok', /모두/],
    ['HTML 에서 찾지 못한 글자 21개 — 빠졌거나 이미지로 들어갔을 수 있으니 미리보기에서 확인', 'warn', /21개/],
    ['HTML 글자·alt 에서 못 찾은 텍스트 레이어 3개: "a", "b"', 'warn', /3개/],
    ['<h2> 가 하나도 없음 (8-2 제목 구조)', 'warn', /소제목/],
    ["폰트 조각에 없는 글자 (굵기 700): 뷁 → 'Pretendard' 대체로 표시 (5절 9항)", 'warn', /기본 글꼴/],
    ['복사 구간에 <h3> 2개 — 아이티켓 스킨이 상세 영역 h3 를 숨김 (7-2-1)', 'error', /HTML/],
    ['자동 점검 통과 (화면 대조·실제 채널 등록은 사람이 확인)', 'ok', /통과/],
  ];
  for (const [message, level, want] of cases) {
    it(message.slice(0, 30), () => {
      const p = plainCheck({ level, message });
      expect(GENERIC).not.toContain(p.what);
      expect(p.what).toMatch(want);
      expect(p.what).not.toMatch(/\d절|px|<h\d>/); // 규칙 절 번호·px·태그는 쉬운 말에 넣지 않는다
    });
  }
  it('모르는 문구는 수준별 일반 문구', () => {
    expect(plainCheck({ level: 'warn', message: '새 점검' }).what).toBe(GENERIC[0]);
  });
});
