// 계획 + 섹션별 결과 → 규칙 7-1 모양의 완전한 HTML 문서 (복사 구간 주석 포함)
import type { GenerateMeta, PlanBundle, PsdSummary } from '../../shared/types';
import { applyFontLock, lockFamily } from './fontLock';
import { selectCss } from './selectable';

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

export function assembleHtml(meta: GenerateMeta, bundle: PlanBundle, sections: SectionOut[], summary?: PsdSummary): string {
  const { plan } = bundle;
  const goodomall = meta.channel !== 'openmarket';
  const channel = goodomall ? '고도몰' : '오픈마켓';
  const rawCss = [bundle.style, ...sections.map((s) => s.css).filter(Boolean)].filter(Boolean).join('\n\n');
  // 고도몰: 폰트 고정 블록(규칙 5절 9항)을 코드가 만들어 <style> 앞에 둔다. 오픈마켓은 <style> 을 못 써서 해당 없음
  const lock = goodomall && summary ? applyFontLock(plan.prefix, summary, rawCss) : null;
  // 고도몰: 글자 선택 막기(규칙 7-6) — 상세 영역 안 모든 요소, 예외 없음
  const fixedCss = goodomall ? [lock?.css, `/* 글자 선택 막기 (규칙 7-6) — 상세 영역 안 전부, 예외 없음. 보안 기능 아님 */\n${selectCss(plan.prefix)}`].filter(Boolean).join('\n\n') : '';
  const css = goodomall ? [...(lock?.imports ?? []), fixedCss, (lock ? lock.rest : rawCss).trim()].filter(Boolean).join('\n\n') : rawCss;
  const body = sections.map((s) => indent(s.html ? (lock ? lockFamily(s.html) : s.html) : `<!-- ${s.id} ${s.name}: 생성 실패 -->`)).join('\n\n');
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
