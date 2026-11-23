// Supabase 함수 배포 준비: core/ 와 shared/(types·width) 를 함수 폴더 안으로 복사한다 (함수는 자기 폴더 밖 파일을 못 읽음)
// usage: yarn sync:rules && yarn build:function  → supabase/functions/pagefy 를 배포
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FN = path.join(ROOT, 'supabase', 'functions', 'pagefy');

const copy = (from: string, to: string) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  console.log(`  ${path.relative(ROOT, from)} → ${path.relative(ROOT, to)}`);
};

for (const f of fs.readdirSync(path.join(ROOT, 'core')).filter((n) => n.endsWith('.ts'))) copy(path.join(ROOT, 'core', f), path.join(FN, 'core', f));
for (const f of ['types.ts', 'width.ts']) copy(path.join(ROOT, 'shared', f), path.join(FN, 'shared', f));
console.log('완료 — supabase/functions/pagefy 를 배포하세요 (index.ts, deno.json, core/*, shared/types.ts·width.ts)');
