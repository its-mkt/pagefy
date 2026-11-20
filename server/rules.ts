// 마크업 규칙 읽기: 공유 폴더 원본을 매번 읽는다 (규칙을 고치면 다음 생성부터 바로 반영)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_RULES_FILE = '\\\\192.168.1.254\\마케팅팀\\A_상세페이지\\detail_to_markup.md';
const LOCAL_COPY = path.join(HERE, '..', 'rules', 'detail_to_markup.md');

export interface Rules {
  text: string;
  source: string;
  updatedAt: string | null;
  fallback: boolean;
}

export function loadRules(): Rules {
  const primary = process.env.RULES_FILE || DEFAULT_RULES_FILE;
  for (const [file, fallback] of [
    [primary, false],
    [LOCAL_COPY, true],
  ] as const) {
    try {
      const text = fs.readFileSync(file, 'utf8');
      const st = fs.statSync(file);
      return { text, source: file, updatedAt: st.mtime.toISOString(), fallback };
    } catch {
      // 다음 후보로
    }
  }
  throw new Error(`규칙 파일을 찾을 수 없습니다: ${primary} (사본: ${LOCAL_COPY})`);
}
