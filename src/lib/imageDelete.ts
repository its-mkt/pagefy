// 변환 내역 「이미지 서버에서 지우기」 — 무엇을 지울지 정하기 (화면 없이 계산만, tests/imageDelete.test.ts)
// 이 작업의 HTML 이 가리키는 제품 폴더 이미지 중, 같은 폴더를 쓰는 다른 작업(복제·다른 판)의 HTML 도 가리키는 것은 남긴다
import { UPLOAD_FILE_RE } from '../../core/upload';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** HTML 이 <base>/<파일명> 으로 가리키는 이미지 파일명 (6-1 규칙에 맞는 것만, 중복 없이 처음 나온 순서) */
export function filesInHtml(html: string, base: string): string[] {
  const re = new RegExp(`${escapeRe(base.replace(/\/+$/, ''))}/([^"'\\s)?#<>/]+)`, 'g');
  const out = new Set<string>();
  for (const m of html.matchAll(re)) if (UPLOAD_FILE_RE.test(m[1])) out.add(m[1]);
  return [...out];
}

export interface DeletePlan {
  /** 지워도 되는 파일 (다른 작업이 쓰지 않음) */
  del: string[];
  /** 다른 작업도 써서 남기는 파일 — by = 그 작업 이름들 */
  keep: { file: string; by: string[] }[];
}

export function planDelete(html: string, base: string, others: { name: string; html?: string }[]): DeletePlan {
  const used = new Map<string, string[]>();
  for (const o of others) {
    if (!o.html) continue;
    for (const f of filesInHtml(o.html, base)) used.set(f, [...(used.get(f) ?? []), o.name]);
  }
  const del: string[] = [];
  const keep: DeletePlan['keep'] = [];
  for (const f of filesInHtml(html, base)) {
    const by = used.get(f);
    if (by) keep.push({ file: f, by: [...new Set(by)] });
    else del.push(f);
  }
  return { del, keep };
}
