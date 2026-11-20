// 공유 폴더의 규칙 원본을 저장소 사본(rules/detail_to_markup.md)으로 복사한다.
// 배포된 Supabase 함수는 사내 공유 폴더를 읽을 수 없어 GitHub 의 이 사본을 읽는다 → 규칙을 고쳤으면 이걸 돌리고 커밋·push 하면 10분 안에 반영된다.
// usage: yarn sync:rules
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = process.env.RULES_FILE || '\\\\192.168.1.254\\마케팅팀\\A_상세페이지\\detail_to_markup.md';
const COPY = path.join(ROOT, 'rules', 'detail_to_markup.md');

let text: string;
let updatedAt: string;
try {
  text = fs.readFileSync(SOURCE, 'utf8');
  updatedAt = fs.statSync(SOURCE).mtime.toISOString();
  fs.writeFileSync(COPY, text);
  console.log(`원본에서 복사: ${SOURCE} (${updatedAt})`);
} catch {
  text = fs.readFileSync(COPY, 'utf8');
  updatedAt = fs.statSync(COPY).mtime.toISOString();
  console.warn(`⚠ 공유 폴더를 읽지 못해 저장소 사본을 씁니다: ${COPY}`);
}

console.log(`→ rules/detail_to_markup.md (${text.length.toLocaleString()}자) — 커밋·push 하면 배포 서비스에 반영 (10분 이내)`);
void updatedAt;
