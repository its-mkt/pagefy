// 자른 이미지 한 장 용량 목표 (규칙 6절 1MB · ESM FAQ 1000KB) — 인코더(psd/jpeg444.ts, 워커)와 결과 화면(1MB 넘는 이미지 표시)이 함께 쓴다.
// 워커에도 들어가므로 다른 모듈을 불러오지 않는다
export const IMAGE_MAX_BYTES = 1024 * 1024;
