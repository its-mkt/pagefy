// 점검 문구 → 디자이너용 쉬운 말 (무슨 뜻 + 할 일). 원래 문구(규칙 절 번호·px·태그)는 화면에서 「자세히」 안에 접어 둔다.
// 점검 자체(src/lib/output.ts · layoutCheck.ts)는 그대로 두고 보여 주는 말만 바꾼다 — 새 점검을 추가하면 여기도 한 줄 맞춘다
import type { Check } from './output';
import { OM_FIXED_PX_NOTE } from './checkNotes';

export interface PlainCheck {
  /** 무슨 일인지 (한 줄) */
  what: string;
  /** 무엇을 하면 되는지 */
  todo?: string;
}

const FIX = '「문제 자동 수정」으로 고칠 수 있습니다.';
const ADMIN = '붙여넣기 전에 「진단 정보 복사」를 눌러 관리자에게 보내 주세요.';
const count = (m: string, re: RegExp) => m.match(re)?.[1];

const RULES: [RegExp, (m: string, c: Check) => PlainCheck][] = [
  [/^자동 점검 통과/, () => ({ what: '자동 점검을 모두 통과했습니다.', todo: '미리보기로 PSD 와 한 번 더 비교하고, 붙여넣은 화면도 확인하세요.' })],
  [/^PSD 위치 대조: (\d+)\/(\d+)/, (m) => {
    const [, pass, total] = m.match(/^PSD 위치 대조: (\d+)\/(\d+)/)!;
    return Number(pass) === Number(total)
      ? { what: `글자 ${total}개가 모두 PSD 와 같은 자리에 있습니다.` }
      : { what: `글자 ${total}개 중 ${Number(total) - Number(pass)}개가 PSD 와 자리가 어긋납니다.`, todo: '아래 미리보기의 「나란히 비교」로 어긋난 곳을 보고, 눈에 띄면 「대조 결과로 고치기」나 「수정 요청」을 쓰세요.' };
  }],
  // 오픈마켓 모바일은 구조적 한계 (px 고정 인라인) — 자동 수정·수정 요청으로 안 고쳐지니 그렇게 알려 준다. 일반 규칙보다 먼저 본다
  [new RegExp(OM_FIXED_PX_NOTE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), () => ({ what: '휴대폰에서는 글자가 화면에 맞춰 줄지 않아 잘리거나 옆으로 넘칠 수 있습니다 (오픈마켓 HTML 의 한계).', todo: '「수정 요청」으로는 고쳐지지 않습니다. 붙여넣은 뒤 휴대폰 상품 화면을 확인하고, 깨져 보이면 관리자에게 알려 주세요.' })],
  [/^위치 대조 실패/, () => ({ what: '글자 위치 비교를 하지 못했습니다.', todo: '결과는 쓸 수 있습니다. 미리보기로 직접 비교해 주세요.' })],
  [/찾지 못한 글자 (\d+)개/, (m) => ({ what: `PSD 글자 ${count(m, /(\d+)개/)}개를 HTML 에서 찾지 못했습니다.`, todo: '이미지에 그려 둔 글자(숫자 라벨 등)면 괜찮습니다. 빠진 문구가 보이면 「수정 요청」으로 알려 주세요.' })],
  [/못 찾은 텍스트 레이어 (\d+)개/, (m) => ({ what: `PSD 글자 중 ${count(m, /(\d+)개/)}개가 HTML 에 들어가지 않았습니다.`, todo: `이미지에 그려 둔 글자라면 그대로 둬도 됩니다. 빠진 문구가 있으면 ${FIX}` })],
  [/<h2> 가 하나도 없음/, () => ({ what: '검색·접근성용 소제목 구조가 없습니다.', todo: `붙여넣는 데는 문제없습니다. ${FIX}` })],
  [/폰트 조각에 없는 글자/, () => ({ what: '몇몇 글자가 Pretendard 기본 글꼴로 보일 수 있습니다.', todo: '미리보기에서 그 글자 모양을 확인하세요. 거슬리면 그 문구를 이미지로 굽도록 수정 요청하세요.' })],
  [/GIF/, () => ({ what: '움직이는 GIF 는 정지 이미지로 저장했습니다.', todo: '움직여야 하면 올린 뒤 원본 GIF 파일로 바꿔 주세요.' })],
  [/글자가 두 번 보일 수 있음/, () => ({ what: '이미지 속 글자와 HTML 글자가 겹쳐 두 번 보일 수 있습니다.', todo: '미리보기에서 그 자리를 확인하고, 겹치면 「수정 요청」으로 알려 주세요.' })],
  [/3,000px/, () => ({ what: '아주 긴 이미지가 있습니다 (쇼핑몰에서 늦게 뜰 수 있음).', todo: FIX })],
  [/파일명|자르기 영역|plan 에 없는 이미지|HTML 에서 쓰지 않음|layerId/, () => ({ what: '이미지 자르기 정보에 문제가 있습니다.', todo: `${FIX} 안 되면 다시 만들어 주세요.` })],
  [/max-width|user-select|@media|max\(|@container/, () => ({ what: '쇼핑몰 화면 규칙과 다른 코드가 있습니다.', todo: ADMIN })],
  [/<h1>|<h3>|<script>|<iframe>|absolute|단축 URL|alt 없는|width·height|숨긴 글자/, (_m, c) => ({ what: '쇼핑몰 규칙에 맞지 않는 HTML 이 있습니다.', todo: c.fix === 'plan' ? FIX : ADMIN })],
  [/<html> 블록|응답/, () => ({ what: '만든 결과를 읽지 못했습니다.', todo: '다시 만들어 주세요. 계속되면 관리자에게 알려 주세요.' })],
];

export function plainCheck(c: Check): PlainCheck {
  for (const [re, f] of RULES) if (re.test(c.message)) return f(c.message, c);
  if (c.level === 'error') return { what: '그대로 붙여넣으면 문제가 생길 수 있는 점이 있습니다.', todo: c.fix === 'plan' ? FIX : ADMIN };
  if (c.level === 'warn') return { what: '확인이 필요한 점이 있습니다.', todo: '「자세히」를 보고 미리보기에서 확인하세요.' };
  return { what: c.message };
}
