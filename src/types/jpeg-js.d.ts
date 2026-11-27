// jpeg-js 는 타입 선언이 없다 — 쓰는 인코더만 (src/lib/psd/jpeg444.ts)
declare module 'jpeg-js/lib/encoder.js' {
  export default function encode(img: { data: ArrayLike<number>; width: number; height: number }, quality?: number): { data: ArrayLike<number>; width: number; height: number };
}
