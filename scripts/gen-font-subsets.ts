// Pretendard v1.3.9 공식 분할 조각(woff2-dynamic-subset) 표를 만든다 → src/lib/fonts/pretendardSubsets.ts
// 규칙 5절 9항 폰트 고정: 굵기별로 실제 쓴 글자가 든 조각만 선언하려면 조각마다 담긴 글자 범위가 필요하다.
// 조각 92개의 글자 범위는 굵기와 상관없이 같으므로 범위만 한 벌 저장한다 (원본 CSS 600KB → 표 약 33KB).
// usage: yarn gen:fonts   (버전을 바꿀 때만 다시 돌린다)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '1.3.9';
const CSS_URL = `https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v${VERSION}/dist/web/static/pretendard-dynamic-subset.css`;
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'fonts', 'pretendardSubsets.ts');

const res = await fetch(CSS_URL);
if (!res.ok) throw new Error(`${CSS_URL} → ${res.status}`);
const css = await res.text();

const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => {
  const b = m[1];
  const file = b.match(/woff2-dynamic-subset\/([^)]*\.woff2)/)![1];
  return { weight: +b.match(/font-weight:\s*(\d+)/)![1], name: file.replace(/\.subset\..*/, ''), index: +file.match(/subset\.(\d+)\./)![1], range: b.match(/unicode-range:\s*([^;]*)/)![1].trim() };
});

const ranges: string[] = [];
const files: Record<number, string> = {};
for (const f of faces) {
  if (ranges[f.index] && ranges[f.index] !== f.range) throw new Error(`조각 ${f.index} 의 글자 범위가 굵기마다 다름 — 표 형식을 바꿔야 함`);
  ranges[f.index] = f.range;
  files[f.weight] = f.name;
}
if (ranges.length !== new Set(faces.map((f) => f.index)).size) throw new Error('조각 번호가 비어 있음');

const body = `// 자동 생성 — scripts/gen-font-subsets.ts (yarn gen:fonts). 손으로 고치지 않는다.
// 출처: ${CSS_URL}
export const PRETENDARD_VERSION = '${VERSION}';
export const PRETENDARD_SUBSET_BASE = 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v${VERSION}/packages/pretendard/dist/web/static/woff2-dynamic-subset/';
/** 굵기 → 파일 이름 앞부분 (\`\${이름}.subset.\${번호}.woff2\`) */
export const PRETENDARD_FILES: Record<number, string> = ${JSON.stringify(files)};
/** 조각 번호 → unicode-range */
export const PRETENDARD_RANGES: string[] = ${JSON.stringify(ranges)};
`;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, body);
console.log(`→ ${path.relative(process.cwd(), OUT)} (조각 ${ranges.length}개, 굵기 ${Object.keys(files).length}개, ${body.length.toLocaleString()}자)`);
