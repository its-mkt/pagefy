// 규칙 7-6 글자 선택 막기 (고도몰) — 상세 영역 안 모든 요소의 글자 선택을 막는다 (예외 없음, 사용자 지시 2026-11-20).
// 처음의 "모델명·사양만 허용" 예외는 사용자 지시로 폐기됨. 기준: ~/.claude/tools/psd2html/build.js 281~282행.
//  - !important: 스킨 CSS 가 user-select:text 를 걸어도 다시 선택되지 않게
//  - 범위는 상세 영역(.prefix) 안만 — body·* 에 걸면 상품 옵션·후기 입력칸까지 막혀 쇼핑몰이 고장 남 (7-6 2항)
//  - 보안 기능 아님 (7-6 3항): 소스 보기·개발자 도구·캡처로는 가져갈 수 있다

export function selectCss(prefix: string) {
  const p = `.${prefix}`;
  return [
    `${p},${p} *,${p} *::before,${p} *::after{-webkit-user-select:none!important;-moz-user-select:none!important;-ms-user-select:none!important;user-select:none!important;-webkit-touch-callout:none!important}`,
    `${p}::selection,${p} *::selection{background:transparent!important}`,
    `${p} img{-webkit-user-drag:none!important;user-drag:none!important}`,
  ].join('\n');
}
