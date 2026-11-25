// Radix Colors(@radix-ui/colors) 12단계 색을 SCSS 믹스인으로 만든다 → src/styles/_radix-colors.scss
// 화면 테마 전환이 :root[data-theme] + prefers-color-scheme 이라 패키지의 .dark-theme CSS 를 그대로 못 써서 값만 옮긴다.
// 쓰는 색: indigo(강조) · slate(회색) · red(오류) · green(성공) · amber(주의) · orange(이미지에 남긴 글자 표시·오픈마켓 배지) · violet(고도몰 배지). 다시 만들기: node scripts/gen-radix-colors.mjs
import fs from 'node:fs';
import * as c from '@radix-ui/colors';

/** indigoA7 · indigoDarkA7 → indigo-a7, indigo9 → indigo-9 */
const varName = (k) => k.replace('Dark', '').replace(/^([a-z]+)(A?)(\d+)$/, (_, n, al, d) => `${n}-${al ? 'a' : ''}${d}`);
const SCALES = ['indigo', 'slate', 'red', 'green', 'amber', 'orange', 'violet'];
const block = (dark) =>
  SCALES.flatMap((name) => {
    const solid = c[`${name}${dark ? 'Dark' : ''}`];
    const alpha = c[`${name}${dark ? 'Dark' : ''}A`];
    return [...Object.entries(solid), ...Object.entries(alpha)].map(([k, v]) => `  --${varName(k)}: ${v};`);
  }).join('\n');

const out = `// 자동 생성 — scripts/gen-radix-colors.mjs (@radix-ui/colors). 손으로 고치지 않는다
// 단계 뜻(Radix): 1-2 바탕 · 3-5 요소 바탕(보통·올림·누름) · 6-8 테두리 · 9-10 진한 색(단추) · 11-12 글자
@mixin radix-light {
${block(false)}
}

@mixin radix-dark {
${block(true)}
}
`;
fs.writeFileSync(new URL('../src/styles/_radix-colors.scss', import.meta.url), out);
console.log('src/styles/_radix-colors.scss', out.split('\n').length, 'lines');
