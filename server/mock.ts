// MOCK=1 일 때: Claude 를 부르지 않고 받은 자료로 단순한 예시 결과를 만들어 스트리밍한다 (화면 흐름 점검용, 비용 없음)
// 결과 품질은 실제 Claude 결과와 다르다. 레이아웃 공식만 대략 맞춘 예시다
import type { Plan, PlanRequest, SectionRequest, StreamEvent, TextInfo } from '../shared/types.ts';
import { godoRootCss } from '../shared/width.ts';
import { imageBaseUrl } from '../core/prompt.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function cutPoints(height: number, texts: TextInfo[], maxH = 1500): number[] {
  const cuts = [0];
  let y = 0;
  while (height - y > maxH) {
    let c = y + maxH;
    // 글자가 걸치지 않는 위치까지 위로 올린다
    while (c > y + 200 && texts.some((t) => t.b[1] - 4 < c && t.b[3] + 4 > c)) c -= 10;
    cuts.push(c);
    y = c;
  }
  cuts.push(height);
  return cuts;
}

/** 글자가 걸치지 않는 y 인지 */
const clearAt = (texts: TextInfo[], y: number) => !texts.some((t) => t.b[1] < y && t.b[3] > y);

/** 구조 계획(engine 'code') 예시: 문서를 2~3등분(글자가 걸치지 않는 y), 글자 없는 200px 이상 띠 하나를 사진으로, 섹션마다 가장 큰 글자 = h2 */
export function mockPlanOutput(req: PlanRequest): string {
  const { summary: s, meta } = req;
  const prefix = `dp-${meta.slug.split('-').slice(0, 2).join('-') || 'mock'}`;
  const n = s.height >= 3000 ? 3 : 2;
  const cuts = [0];
  for (let i = 1; i < n; i++) {
    const target = Math.round((s.height * i) / n);
    // 목표 y 에서 위아래로 넓혀 가며 글자가 걸치지 않는 곳을 찾는다
    let c: number | null = null;
    for (let d = 0; d < s.height / (2 * n) && c == null; d += 10) {
      if (target - d > cuts[cuts.length - 1] + 50 && clearAt(s.texts, target - d)) c = target - d;
      else if (target + d < s.height - 50 && clearAt(s.texts, target + d)) c = target + d;
    }
    if (c != null && c > cuts[cuts.length - 1]) cuts.push(c);
  }
  cuts.push(s.height);
  const sections = cuts.slice(0, -1).map((y0, i) => ({ id: `s${String(i).padStart(2, '0')}`, name: `섹션 ${i + 1}`, y0, y1: cuts[i + 1] }));

  // 글자 없는 가장 긴 세로 띠 (섹션 경계를 넘지 않게)
  let photo: { section: string; y0: number; y1: number } | null = null;
  for (const sec of sections) {
    const busy = s.texts
      .filter((t) => t.b[3] > sec.y0 && t.b[1] < sec.y1)
      .map((t) => [Math.max(sec.y0, t.b[1]), Math.min(sec.y1, t.b[3])] as const)
      .sort((a, b) => a[0] - b[0]);
    let y = sec.y0;
    for (const [a, b] of [...busy, [sec.y1, sec.y1] as const]) {
      if (a - y >= 200 && (!photo || a - y > photo.y1 - photo.y0)) photo = { section: sec.id, y0: Math.ceil(y), y1: Math.floor(a) };
      y = Math.max(y, b);
    }
  }

  const headings: Record<string, 2 | 3 | 4> = {};
  for (const sec of sections) {
    const inSec = s.texts.filter((t) => t.b[1] >= sec.y0 && t.b[1] < sec.y1 && !t.bakeHint);
    const top = inSec.reduce<TextInfo | null>((m, t) => (!m || t.size > m.size ? t : m), null);
    if (top) headings[String(top.id)] = 2;
  }

  const plan: Plan = {
    prefix,
    engine: 'code',
    sections,
    images: [],
    photos: photo ? [{ ...photo, role: 'mock-photo', alt: 'MOCK 예시 사진 설명' }] : [],
    keepInImage: [],
    headings,
  };
  const report = `- 원본: ${s.fileName} (${s.width}×${s.height}) / 채널: ${meta.channel}\n- 섹션 ${sections.length}개 (문서 높이를 기계적으로 나눔)${req.revision ? '\n- 수정 요청 받음 — MOCK 은 내용을 바꾸지 않음' : ''}\n- ※ MOCK 모드 예시 결과입니다. Claude 를 부르지 않았습니다.\n- 미검증 항목: 전부`;
  return `<plan>\n${JSON.stringify(plan, null, 1)}\n</plan>\n<report>\n${report}\n</report>`;
}

/** 옛 방식(섹션별 마크업) 계획 예시 — 지금은 쓰지 않지만 섹션 MOCK 점검용으로 남긴다 */
export function mockLegacyPlanOutput(req: PlanRequest): string {
  const { summary: s, meta } = req;
  const W = s.width;
  const prefix = `dp-${meta.slug.split('-').slice(0, 2).join('-') || 'mock'}`;
  const cuts = cutPoints(s.height, s.texts);
  const plan: Plan = { prefix, sections: [], images: [] };
  for (let i = 0; i < cuts.length - 1; i++) {
    const id = `s${String(i).padStart(2, '0')}`;
    plan.sections.push({ id, name: `섹션 ${i + 1}`, y0: cuts[i], y1: cuts[i + 1] });
    plan.images.push({ file: `${id}_bg1.jpg`, kind: 'bg', source: 'notext', x0: 0, y0: cuts[i], x1: W, y1: cuts[i + 1] });
  }
  if (meta.channel === 'openmarket') plan.wrapperStyle = `max-width:${W}px;margin:0 auto;font-family:'Pretendard','Noto Sans KR','Malgun Gothic',sans-serif;word-break:keep-all`;
  const style =
    meta.channel === 'openmarket'
      ? ''
      : `@import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css');
${godoRootCss(prefix, W)}
.${prefix} { font-family:'Pretendard','Noto Sans KR','Malgun Gothic',sans-serif; word-break:keep-all; overflow-wrap:anywhere; }
.${prefix} * { margin:0; padding:0; font:inherit; color:inherit; letter-spacing:inherit; }
.${prefix} .${prefix}-sec { display:flow-root; background-size:100% auto; background-repeat:no-repeat; }`;
  const report = `- 원본: ${s.fileName} (${s.width}×${s.height}) / 채널: ${meta.channel}\n- 섹션 ${plan.sections.length}개 (1500px 단위로 기계적으로 나눔)\n- ※ MOCK 모드 예시 결과입니다. Claude 를 부르지 않았습니다.\n- 미검증 항목: 전부`;
  return `<plan>\n${JSON.stringify(plan, null, 1)}\n</plan>\n<style>\n${style}\n</style>\n<notes>\nMOCK: 글자는 PSD 위치대로 흐름 배치.\n</notes>\n<report>\n${report}\n</report>`;
}

export function mockSectionOutput(req: SectionRequest): string {
  const { bundle, meta } = req;
  const W = req.doc.width;
  const prefix = bundle.plan.prefix;
  const sec = bundle.plan.sections.find((s) => s.id === req.sectionId)!;
  const base = imageBaseUrl(meta);
  const bg = bundle.plan.images.find((im) => im.file.startsWith(`${sec.id}_bg`));
  const inline = meta.channel === 'openmarket';
  const unit = (n: number) => (inline ? `${n.toFixed(1)}px` : `calc(${n.toFixed(1)} * var(--u))`);
  let cursor = sec.y0;
  const rows = req.texts
    .filter((t) => t.lineTop >= sec.y0 && t.lineTop < sec.y1)
    .sort((a, b) => a.lineTop - b.lineTop)
    .map((t) => {
      const mt = Math.max(0, t.lineTop - cursor);
      cursor = Math.max(cursor, t.lineTop + t.lineHeight * t.lines.length);
      const style = [
        `margin-top:${unit(mt)}`,
        t.align === 'left' ? `margin-left:${unit(t.anchorX)}` : '',
        `font-size:${unit(t.size)}`,
        `line-height:${unit(t.lineHeight)}`,
        `font-weight:${t.weight}`,
        `color:#${t.color}`,
        t.ls ? `letter-spacing:${t.ls}em` : '',
        t.align !== 'left' ? `text-align:${t.align}` : '',
      ]
        .filter(Boolean)
        .join(';');
      return `    <p style="${style}">${t.lines.map(esc).join('<br>')}</p>`;
    });
  const bgStyle = bg ? `background-image:url('${base}/${bg.file}');` : '';
  const html = inline
    ? `<!-- ${sec.id} ${sec.name} -->\n<div class="${prefix}-${sec.id}" style="${bgStyle}background-size:100% auto;background-repeat:no-repeat;min-height:${sec.y1 - sec.y0}px;overflow:hidden">\n${rows.join('\n')}\n</div>`
    : `<!-- ${sec.id} ${sec.name} -->\n<section class="${prefix}-sec ${prefix}-${sec.id}" style="${bgStyle}min-height:calc(${sec.y1 - sec.y0} * var(--u))">\n${rows.join('\n')}\n</section>`;
  void W;
  return `<section_html>\n${html}\n</section_html>\n<section_css>\n</section_css>\n<section_notes>\nMOCK 섹션${req.revision ? ' (수정 요청 받음 — MOCK 은 내용을 바꾸지 않음)' : ''}\n</section_notes>`;
}

export async function mockStream(out: string, send: (e: StreamEvent) => void, signal: AbortSignal) {
  send({ type: 'status', message: 'MOCK 모드: Claude 를 부르지 않고 예시 결과를 만듭니다.' });
  const chunk = Math.max(200, Math.ceil(out.length / 20));
  for (let i = 0; i < out.length; i += chunk) {
    if (signal.aborted) return;
    send({ type: 'text', text: out.slice(i, i + chunk) });
    await new Promise((r) => setTimeout(r, 30));
  }
  send({ type: 'done', stopReason: 'end_turn', model: 'mock', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 } });
}
