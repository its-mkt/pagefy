// 고도몰 상세 영역 폭 (규칙 7-2·7-5) — 화면·서버·함수 공용 (node: 모듈 금지)
// 고도몰 상세 영역은 최대 860px. PSD 가 더 넓으면 860px 로 두고 전체를 비율대로 줄이고, 좁으면 늘리지 않고 가운데에 둔다.

export const GODO_MAX_W = 860;

/** 최상위 최대 폭 = min(PSD 폭, 860) */
export const godoMaxWidth = (psdW: number) => Math.min(psdW, GODO_MAX_W);

const r4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * 최상위 폭·배율 CSS. 크기 숫자는 PSD px 그대로 쓰고 calc(N * var(--u)) 로 줄인다.
 * --u = 상세 영역 폭 / PSD 폭 (cqw). 오래된 브라우저 대체값(vw)도 860 상한에 맞춰 min(860/PSD폭 px, 100vw/PSD폭).
 */
export function godoRootCss(prefix: string, psdW: number) {
  const cap = r4(godoMaxWidth(psdW) / psdW);
  return `.${prefix}{--u:min(${cap}px,calc(100vw / ${psdW}));container-type:inline-size;width:100%;max-width:${godoMaxWidth(psdW)}px;margin:0 auto}
@supports (width:1cqw){.${prefix}>*{--u:calc(100cqw / ${psdW})}}`;
}
