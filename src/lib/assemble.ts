// 계획 + 섹션별 결과 → 규칙 7-1 모양의 완전한 HTML 문서 (복사 구간 주석 포함)
import type { GenerateMeta, PlanBundle } from '../../shared/types';

export interface SectionOut {
  id: string;
  name: string;
  html: string;
  css: string;
  notes: string;
  raw: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const indent = (s: string, n = 2) => s.split('\n').map((l) => (l ? ' '.repeat(n) + l : l)).join('\n');

export function assembleHtml(meta: GenerateMeta, bundle: PlanBundle, sections: SectionOut[]): string {
  const { plan } = bundle;
  const goodomall = meta.channel !== 'openmarket';
  const channel = goodomall ? '고도몰' : '오픈마켓';
  const body = sections.map((s) => indent(s.html || `<!-- ${s.id} ${s.name}: 생성 실패 -->`)).join('\n\n');
  const css = [bundle.style, ...sections.map((s) => s.css).filter(Boolean)].filter(Boolean).join('\n\n');
  const wrapperOpen = goodomall ? `<div class="${plan.prefix}">` : `<div class="${plan.prefix}"${plan.wrapperStyle ? ` style="${plan.wrapperStyle.replace(/"/g, '&quot;')}"` : ''}>`;
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(meta.productName)} 상세페이지</title></head>
<body style="margin:0">
<!-- ▼▼▼ 여기부터 복사 (${esc(meta.productName)} / 채널: ${channel} / 작성일 ${meta.date}) ▼▼▼ -->
${goodomall && css ? `<style>\n${css}\n</style>\n` : ''}${wrapperOpen}
${body}
</div>
<!-- ▲▲▲ 여기까지 복사 ▲▲▲ -->
</body></html>
`;
}

/** 계획 보고 + 섹션별 메모를 하나의 완료 보고로 */
export function assembleReport(planReport: string, sections: SectionOut[]): string {
  const notes = sections.filter((s) => s.notes.trim()).map((s) => `- ${s.id} ${s.name}: ${s.notes.trim().replace(/\n+/g, ' / ')}`);
  return `${planReport.trim()}${notes.length ? `\n\n[섹션별 메모]\n${notes.join('\n')}` : ''}`;
}
