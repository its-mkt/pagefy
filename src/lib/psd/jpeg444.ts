// 색 정보를 줄이지 않는(4:4:4) JPEG 인코딩 (2026-11-27, 규칙 6절 용량·화질)
// 브라우저 convertToBlob('image/jpeg') 은 품질과 관계없이 색을 가로·세로 절반(4:2:0)으로 줄여 저장한다 → 작은 글자·얇은 선·
// 빨강·파랑 글자 가장자리가 번진다 (실제 업로드 15장 모두 4:2:0 확인, 품질 92 로 올려도 번짐은 남음). jpeg-js 는 세 성분 모두 1×1 표본.
// 품질 92 로 만들고, 1MB(규칙 6절 · ESM FAQ 1000KB)를 넘을 때만 다음 값으로 낮춘다.
import encodeJpeg from 'jpeg-js/lib/encoder.js';
import { IMAGE_MAX_BYTES } from '../imageLimits';

const JPEG_QUALITIES = [92, 88, 84, 78, 70];

type Rgba = { data: Uint8ClampedArray | Uint8Array; width: number; height: number };

/** RGBA 픽셀 → 4:4:4 JPEG 바이트 (알파는 무시 — 투명 영역은 호출하는 쪽에서 흰색으로 먼저 채운다) */
export function encodeJpeg444(img: Rgba, quality: number): Uint8Array<ArrayBuffer> {
  // jpeg-js 는 CommonJS 로 묶이면 결과를 Node 의 Buffer.from 으로 만든다 → 브라우저·워커에는 Buffer 가 없어
  // 인코딩하는 동안에만 같은 일을 하는 최소 대체를 두고 바로 치운다 (같은 워커의 다른 라이브러리가 Buffer 가 있다고 오해하지 않게)
  const g = globalThis as { Buffer?: unknown };
  const shim = typeof g.Buffer === 'undefined';
  if (shim) g.Buffer = { from: (a: ArrayLike<number>) => new Uint8Array(a) };
  try {
    const out = encodeJpeg(img, quality).data as Uint8Array<ArrayBuffer>;
    // 대체가 만든 배열은 그대로 쓰고, Node Buffer(테스트)는 큰 공용 메모리의 일부일 수 있어 필요한 부분만 복사
    return out.byteOffset === 0 && out.byteLength === out.buffer.byteLength ? out : new Uint8Array(out); // Buffer.slice 는 복사하지 않는다
  } finally {
    if (shim) delete g.Buffer;
  }
}

/** 1MB 를 넘지 않는 가장 높은 품질로 */
export function encodeJpegUnder(img: Rgba, max = IMAGE_MAX_BYTES): Uint8Array<ArrayBuffer> {
  let bytes!: Uint8Array<ArrayBuffer>;
  for (const q of JPEG_QUALITIES) {
    bytes = encodeJpeg444(img, q);
    if (bytes.length <= max) break;
  }
  return bytes;
}
