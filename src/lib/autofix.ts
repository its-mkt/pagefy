// 「문제 자동 수정」 — 자동 점검 결과 중 Claude 구조 계획으로 고칠 수 있는 것만 골라 수정 요청 글을 만든다.
// 코드 생성 방식은 Claude 가 섹션·사진 띠·이미지에 남길 글자·제목 단계만 정하고 위치·크기·자간은 코드가 PSD 값으로 계산한다.
// → 위치 어긋남·모바일 비율·폰트 등은 Claude 에게 다시 시켜도 바뀌지 않으므로(비용만 듦) 자동 수정 대상이 아니다.
import type { Check } from './output';
import type { LayoutResult } from './layoutCheck';

/** 구조 계획으로 고칠 수 있는 점검 — 점검을 만드는 곳(output.ts·layoutCheck.ts·codegen.ts)에서 fix: 'plan' 을 붙인다 */
export const isPlanFixable = (c: Check) => c.level !== 'ok' && c.fix === 'plan';

/** 자동 수정 요청 글 — 고칠 수 있는 문제가 없으면 null */
export function fixRequest(checks: Check[], layout?: LayoutResult): string | null {
  const fix = checks.filter(isPlanFixable);
  if (!fix.length) return null;
  const lines = fix.map((c) => `- ${c.message}`);
  const lost = (layout?.items ?? []).filter((i) => i.dy == null);
  if (lost.length) {
    lines.push(
      '',
      `HTML 에서 찾지 못한 글자 ${lost.length}개 (텍스트 레이어 id · 첫 줄):`,
      ...lost.slice(0, 40).map((i) => `- #${i.id} "${i.text}"`),
      '이 글자가 사진 띠에 구워졌거나 빠졌다면 HTML 글자로 나오게 고쳐 줘. 단 제품 사진·도표 안의 작은 라벨처럼 이미지에 남기는 게 맞는 글자는 그대로 둬.',
    );
  }
  return [
    '[자동 점검 결과로 고칠 것]',
    ...lines,
    '',
    '위 문제만 고치고, 문제와 상관없는 섹션·사진 띠·제목 단계는 이전 계획 그대로 유지해 줘. 이미지에 남기는 글자(keepInImage)를 새로 늘리는 방식으로 고치지 마.',
  ].join('\n');
}

/** 결과 비교 점수 — 모두 적을수록 좋음 */
export interface FixScore {
  err: number;
  warn: number;
  /** 위치 대조에서 HTML 에서 찾지 못한 글자 */
  lost: number;
  /** 이미지에 남긴 글자 (keepMap) — 대조·누락 검사에서 빠지므로, 늘리면 점검이 좋아 보이기만 한다 */
  kept: number;
}

export function fixScore(checks: Check[], layout: LayoutResult | undefined, kept: number): FixScore {
  return {
    err: checks.filter((c) => c.level === 'error').length,
    warn: checks.filter((c) => c.level === 'warn').length,
    lost: (layout?.items ?? []).filter((i) => i.dy == null).length,
    kept,
  };
}

/**
 * a 가 b 보다 나아졌나.
 * 오류·못 찾은 글자·이미지에 남긴 글자 중 하나라도 늘면 아님 (글자를 이미지로 구워 점검을 피하거나, 확인 1건을 고치며 글자를 잃는 경우)
 * 그 밖엔 오류·확인·못 찾은 글자 중 하나라도 줄었으면 나아짐 (오류가 줄면 확인은 늘어도 됨)
 */
export function improved(a: FixScore, b: FixScore) {
  if (a.err > b.err || a.lost > b.lost || a.kept > b.kept) return false;
  if (a.err < b.err) return true;
  return a.warn < b.warn || a.lost < b.lost;
}

export const fmtScore = (s: FixScore) => `오류 ${s.err} · 확인 ${s.warn}${s.lost ? ` · 못 찾은 글자 ${s.lost}` : ''}${s.kept ? ` · 이미지에 남긴 글자 ${s.kept}` : ''}`;
