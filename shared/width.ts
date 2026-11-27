// 고도몰 상세 영역 폭 (규칙 7-2·7-5) — 화면·서버·함수 공용 (node: 모듈 금지)
// 고도몰 상세 영역은 최대 860px. PSD 가 더 넓으면 860px 로 두고 전체를 비율대로 줄이고, 좁으면 늘리지 않고 가운데에 둔다.
// 게시판 글(이벤트·프로모션)은 본문 영역이 최대 980px (규칙 7-2-2, 아이티켓 이벤트 게시판 실측 2026-11-27)

import type { GodoTarget } from './types.ts';

export const GODO_MAX_W = 860;
export const GODO_BOARD_MAX_W = 980;

/** 고도몰 올릴 곳별 최대 폭 — 상품 상세 860 · 게시판 980 */
export const godoCap = (target?: GodoTarget) => (target === 'board' ? GODO_BOARD_MAX_W : GODO_MAX_W);

/** 최상위 최대 폭 = min(PSD 폭, 올릴 곳 최대 폭) */
export const godoMaxWidth = (psdW: number, target?: GodoTarget) => Math.min(psdW, godoCap(target));

const r4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * 최상위 폭·배율 CSS. 크기 숫자는 PSD px 그대로 쓰고 calc(N * var(--u)) 로 줄인다.
 * --u = 상세 영역 폭 / PSD 폭 (cqw). 오래된 브라우저 대체값(vw)도 최대 폭 상한에 맞춰 min(최대폭/PSD폭 px, 100vw/PSD폭).
 */
export function godoRootCss(prefix: string, psdW: number, target?: GodoTarget) {
  const maxW = godoMaxWidth(psdW, target);
  const cap = r4(maxW / psdW);
  return `.${prefix}{--u:min(${cap}px,calc(100vw / ${psdW}));container-type:inline-size;width:100%;max-width:${maxW}px;margin:0 auto}
@supports (width:1cqw){.${prefix}>*{--u:calc(100cqw / ${psdW})}}`;
}
