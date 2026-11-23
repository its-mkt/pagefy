// Claude 에게 보내는 지시문·자료 구성 (로컬 서버와 Supabase 함수가 같이 쓴다 — Node·Deno 공용, 순수 TS)
// 현재 생성 방식 = 구조 계획(plan, engine "code") 한 번 → 마크업은 화면 프로그램이 PSD 값으로 만든다 (psd2html build.js 방식, 2026-11-23~).
// 섹션별 마크업(section)은 옛 방식으로 저장된 작업(engine 없음)을 이어 하거나 고칠 때만 쓴다.
import type Anthropic from '@anthropic-ai/sdk';
import type { GenerateMeta, PlanRequest, SectionRequest, Tile } from '../shared/types.ts';
import { trimRules } from './rules.ts';
import { GODO_MAX_W, godoRootCss } from '../shared/width.ts';

/** 두 단계 공통 지시 (시스템 프롬프트 앞부분). 규칙 본문은 원본 그대로 뒤에 붙인다 → 두 단계가 같은 캐시를 쓴다 */
const SERVICE_PREFACE = `너는 통이미지 디자인(상품 상세페이지·랜딩·콘텐츠) PSD를 HTML 마크업으로 바꾸는 웹 서비스 "Pagefy" 안에서 일한다.
아래 <rules> 는 팀이 정한 "상세페이지 마크업 변환 규칙" 원본이다. 이 규칙을 그대로 따른다.

<service_context>
이 규칙은 원래 Claude Code + Photoshop MCP 작업용으로 쓰였다. 이 서비스에서는 역할이 이렇게 나뉜다.
- PSD 읽기(3절)는 프로그램이 이미 했다. 너는 프로그램이 뽑은 "보이는 레이어 목록 + 텍스트 레이어 값"과 PSD 합성 렌더 조각(타일 이미지)을 받는다.
  숨김 레이어는 이미 빠져 있다. 텍스트 값(size·lineHeight·ls·lineTop·anchorX·baseline)은 규칙 4-1 공식으로 미리 계산돼 있다. 다시 환산하지 않는다.
- 현재 서비스는 "구조 계획" 방식이다. 너는 구조(섹션 경계·사진 띠·이미지에 남길 글자·제목 단계)만 정하고,
  HTML·CSS(글자 위치·크기·줄바꿈·자간·색·폰트)와 배경 이미지 자르기·파일명은 프로그램이 PSD 값으로 만든다.
  섹션 단계 요청(옛 방식으로 만든 작업)을 받으면 그 요청의 <task> 와 함께 온 계획대로 그 섹션의 마크업을 쓴다.
- 이미지 업로드(6절 FTP)와 9절 검증(브라우저 대조·URL 200 확인)은 사람과 프로그램이 한다. 너는 하지 않고, 보고의 "미검증 항목"에 적는다.
- 고도몰 폰트 고정(5절 9항)은 프로그램이 한다: 'dp-pretendard' @font-face(쓴 글자만 담은 조각)·버전 고정 Pretendard @import·font-synthesis·text-size-adjust·color-scheme·전화번호 링크 방지,
  font-family 'Pretendard' 앞에 'dp-pretendard' 붙이기. 마크업을 쓰는 경우에도 Pretendard @import·@font-face 와 그 고정 속성은 쓰지 않는다.
- 고도몰 상세 영역은 최대 860px 이다(7-2). 최상위 max-width 는 min(PSD 폭, 860)px — PSD 가 더 넓으면 860px 안에서 전체가 비율대로 줄고, 좁으면 늘리지 않고 가운데.
  크기 숫자는 PSD px 그대로 calc(N * var(--u)), --u = 100cqw / PSD 폭. 이것도 프로그램이 넣는다.
- 고도몰 글자 선택 막기(7-6, 상세 영역 안 전부·예외 없음)는 프로그램이 CSS 를 넣는다. user-select·::selection·user-drag CSS 를 쓰지 않는다.
- 모바일은 이미지처럼 비율 축소만 한다(7-5). @media·@container 재배치·글자 크기 변경, max(12px, …) 최소 글자 크기를 쓰지 않는다.
- 네가 따를 핵심: 1절 기본 원칙, 4절(이미지로 굽는 텍스트 판단), 5절 레이아웃·폰트, 7절 HTML 작성 방식(채널별), 8절 검색 최적화(제목 구조·alt), 10절 하지 말 것.

자료 해석:
- 좌표는 모두 PSD 원본 px (문서 왼쪽 위 = 0,0). b = [left, top, right, bottom].
- 텍스트 lineTop = CSS 줄 상자 위쪽 y, anchorX = 정렬 기준 x (left 면 왼쪽 끝, center 면 가운데, right 면 오른쪽 끝).
- runs 가 있으면 글자 범위별 스타일이 섞인 것이다. lineHeights 가 있으면 줄마다 행간이 다른 것이다(줄 순서대로, 그 줄의 가장 큰 행간 = 4-1).
- fx 에 "fill N%" 가 있으면 글자 칠 불투명도다. "fill 0%" 와 stroke 가 같이 있으면 속 빈 외곽선 글자다.
- bakeHint 가 있는 텍스트는 이미지로 굽는 대상이다 (4절 표). bakeHint 가 "규칙 5절 이미지로 굽는 폰트"로 시작하면 검토 없이 반드시 굽는다.
- 타일 이미지는 PSD 합성 렌더(글자 포함)를 자른 것이다. 디자인 확인·섹션 경계·사진 영역 판단에 쓴다. 글자는 타일에서 읽지 말고 텍스트 레이어 값을 쓴다(1절 1항).
- 프로그램이 만드는 배경은 텍스트 레이어를 뺀 브라우저 재합성이라 조정 레이어와 일부 효과(내부 그림자·경사·새틴·패턴)가 빠지고 그림자·광선·오버레이·획은 근사치다.
  프로그램 경고에 그런 레이어가 있으면 보고에 적는다.
</service_context>`;

export function buildSystem(rulesText: string): Anthropic.Beta.BetaTextBlockParam[] {
  return [{ type: 'text', text: `${SERVICE_PREFACE}\n\n<rules>\n${trimRules(rulesText)}\n</rules>`, cache_control: { type: 'ephemeral' } }];
}

export function imageBaseUrl(meta: GenerateMeta) {
  return `${meta.publicRoot.replace(/\/+$/, '')}/${meta.channel}/${meta.slug}/${meta.rev}`;
}

const channelFolder = (m: GenerateMeta) => ({ itket: '아이티켓', oncore: '온코어', openmarket: '오픈마켓' })[m.channel];
const htmlMode = (m: GenerateMeta) => (m.channel === 'openmarket' ? '7-3 오픈마켓 공용 (인라인 전용)' : '7-2 고도몰용 (<style> + 고유 접두사)');

function jobBlock(meta: GenerateMeta) {
  return `<job>
제품명(폴더명): ${meta.productName}
채널 폴더: ${channelFolder(meta)} (${meta.channel}) → HTML 작성 방식: ${htmlMode(meta)}
제품슬러그: ${meta.slug} / rev: ${meta.rev} / 작성일: ${meta.date}
image_base_url: ${imageBaseUrl(meta)}
결과 파일: ${meta.productName}.html (이미지: img/${meta.rev}/)
</job>`;
}

function docBlock(d: { fileName: string; width: number; height: number; dpi: number; fonts: { name: string; mapped: boolean; bake?: boolean; count: number }[]; warnings: string[] }, extra = '') {
  return `<psd>
파일: ${d.fileName} / ${d.width}×${d.height}px / ${d.dpi}ppi${extra}
폰트: ${d.fonts.map((f) => `${f.name}×${f.count}${f.bake ? ' (이미지로 굽는 폰트)' : f.mapped ? '' : ' (웹폰트 표에 없음)'}`).join(', ') || '없음'}
${d.warnings.length ? `프로그램 경고:\n${d.warnings.map((w) => `- ${w}`).join('\n')}` : ''}
</psd>`;
}

function tileBlocks(tiles: Tile[]): Anthropic.Beta.BetaContentBlockParam[] {
  const out: Anthropic.Beta.BetaContentBlockParam[] = [];
  tiles.forEach((t, i) => {
    out.push({ type: 'text', text: `타일 ${i + 1}/${tiles.length}: y ${t.y0}~${t.y1}px` });
    out.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: t.data } });
  });
  return out;
}

const extraBlock = (extra?: string) =>
  extra?.trim() ? `\n<extra_instructions>\n담당자 추가 지시 (규칙과 충돌하면 규칙을 따르고 보고에 적는다):\n${extra.trim()}\n</extra_instructions>\n` : '';

const PLAN_TASK = `<task>
지금은 구조 계획 단계다. HTML·CSS 는 쓰지 말고 아래 두 블록만 출력한다 (블록 밖에 다른 글 없이).
글자 위치·크기·줄바꿈·자간·색·폰트와 배경 이미지 자르기·파일명은 모두 프로그램이 PSD 값으로 계산한다. 너는 구조만 정한다.

<plan>
{"prefix":"dp-...","engine":"code",
 "sections":[{"id":"s00","name":"메인 비주얼","y0":0,"y1":1300}],
 "photos":[{"section":"s00","y0":575,"y1":1085,"role":"hero-product","alt":"..."}],
 "keepInImage":[{"id":123,"reason":"..."}],
 "headings":{"101":2,"105":3}}
</plan>
<report>
(보고: 섹션 수와 나눈 근거, 사진 띠로 뺀 영역과 판단, 이미지에 남긴 글자와 사유, 폰트 매핑, CSS로 못 옮겨 이미지에 남는 효과, 검색 최적화 제안(8-3 4항), 미검증 항목)
</report>

항목별 기준:
- prefix: 규칙의 고유 접두사 규칙을 따른다 (dp- 로 시작). engine 은 항상 "code".
- sections: PSD 디자인의 섹션 단위로 위에서 아래로 빈틈없이 나눈다 (첫 y0 = 0, 앞 섹션 y1 = 다음 섹션 y0, 마지막 y1 = 문서 높이). id 는 s00 부터 차례로, name 은 섹션 제목을 짧게.
  글자 수·높이로 더 쪼개지 않는다 (세로 3000px 넘는 배경은 프로그램이 나눈다). 경계 y 는 어떤 텍스트 bounds(b)도 가로지르지 않아야 한다.
- photos: 글자와 겹치지 않는 전체 폭 제품·정보 사진 띠. 배경이 아니라 <img alt> 로 나간다 (8-2 7항).
  문서 폭 전체를 쓰고, 어떤 텍스트 레이어 bounds(b)와도 세로 범위가 겹치지 않아야 한다. section 은 띠가 들어갈 섹션 id 이고 y0·y1 은 그 섹션 안이다.
  alt 를 줄 만한 사진(제품 외관·구성·사용 장면·화면·인증 배지 등)만 넣는다. 장식 배경·무늬·그라데이션은 넣지 않는다 (배경으로 남는다).
  role 은 파일명용 영문 소문자·하이픈 (예: hero-product), alt 는 그림 내용을 설명하는 한국어.
- keepInImage: HTML 글자로 바꾸지 않고 배경 픽셀에 그대로 남길 텍스트 레이어 id(<texts> 의 id)와 사유.
  bakeHint 가 있는 텍스트와 fx 에 stroke·colorOverlay·dropShadow 가 있는 텍스트는 프로그램이 자동으로 더하므로 적지 않는다.
  그 밖에 남겨야 할 것만 적는다: 도표·그림에 구워진 번호 라벨, 로고 타입, 사진 위에 얹혀 사진과 함께 있어야 하는 글자 등. 없으면 [].
- headings: 텍스트 레이어 id → 제목 단계. 글자가 있는 섹션마다 대제목 하나만 2 (h2), 소제목은 3·4 (8-2 1항, 7-2-1 — 고도몰 소제목 태그 처리는 프로그램이 한다).
  적지 않은 텍스트는 본문(p)이 된다. id 는 <texts> 의 id.

plan 은 올바른 JSON 이어야 한다 (주석·끝 쉼표 금지). id 는 숫자로 쓰고, headings 의 키만 문자열이다.
</task>`;

export function buildPlanMessages(req: PlanRequest): Anthropic.Beta.BetaMessageParam[] {
  const { meta, summary, tiles } = req;
  const head = `${jobBlock(meta)}

${docBlock(summary, `\n사용 레이어 ${summary.layers.length}개 / 제외(숨김) ${summary.hiddenCount}개 / 텍스트 ${summary.texts.length}개${meta.channel === 'openmarket' ? '' : `\n최상위 폭·배율 (고도몰 최대 ${GODO_MAX_W}px, 프로그램이 넣는다 — 참고용):\n${godoRootCss('{prefix}', summary.width)}`}`)}

<layers>
${JSON.stringify(summary.layers)}
</layers>

<texts>
${JSON.stringify(summary.texts)}
</texts>
${extraBlock(req.extra)}
아래는 PSD 합성 렌더 타일이다 (위에서부터 순서대로, 각 타일 위에 원본 y 범위를 적었다).`;
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: [{ type: 'text', text: head }, ...tileBlocks(tiles), { type: 'text', text: PLAN_TASK }] }];
  if (req.revision) {
    messages.push({ role: 'assistant', content: req.revision.previous });
    messages.push({ role: 'user', content: `수정 요청:\n${req.revision.feedback}\n\n고친 구조 계획을 같은 두 블록(<plan>, <report>)으로 전체 다시 써 줘.` });
  }
  return messages;
}

function sectionTask(req: SectionRequest) {
  const goodomall = req.meta.channel !== 'openmarket';
  return `<task>
지금은 섹션 단계다 (옛 방식 작업: 계획 + 섹션별 마크업). 위 계획의 섹션 ${req.sectionId} 하나만 마크업한다. 다른 섹션·문서 머리·복사 구간 주석·공통 <style> 은 쓰지 않는다 (프로그램이 합친다).
font-family 는 'Pretendard', … 로만 쓴다 (앞의 'dp-pretendard' 는 프로그램이 붙인다). Paperlogy 등 다른 웹폰트가 필요하면 계획의 공통 <style> 을 따른다.
텍스트 값은 받은 숫자를 그대로 쓴다. runs 는 <strong>/<span> 으로, lineHeights 는 줄을 나눠 각 줄에 그 값을, "fill 0%" + stroke 는 color:transparent + -webkit-text-stroke 로.
아래 세 블록만 출력한다 (블록 밖에 다른 글 없이).

<section_html>
(이 섹션 요소 하나. 맨 앞에 <!-- ${req.sectionId} 섹션이름 --> 주석.
 ${goodomall ? `<section class="{prefix}-sec {prefix}-${req.sectionId}" aria-labelledby="{prefix}-${req.sectionId}-h"> … </section> 형태, 크기는 calc(n * var(--u)) (7-2), 스타일은 클래스로` : '<div style="…"> … </div> 형태, 모든 스타일 인라인·px 고정 (7-3), class 는 위치 표시용으로만'}
 이 섹션의 이미지는 계획의 파일명 그대로 image_base_url 뒤에 붙여 절대 주소로 쓴다. 계획에 없는 파일은 쓰지 않는다)
</section_html>
<section_css>
${goodomall ? '(이 섹션 전용 CSS. 모든 선택자는 .{prefix} .{prefix}-' + req.sectionId + ' 로 시작. 공통 CSS 에 이미 있는 것은 다시 쓰지 않는다)' : '(오픈마켓이므로 비워 둔다)'}
</section_css>
<section_notes>
(1~3줄: 이 섹션에서 이미지로 구운 텍스트, 계획과 다르게 한 것과 이유, 남은 문제)
</section_notes>
</task>`;
}

export function buildSectionMessages(req: SectionRequest): Anthropic.Beta.BetaMessageParam[] {
  const { meta, bundle } = req;
  const sec = bundle.plan.sections.find((s) => s.id === req.sectionId);
  // 모든 섹션 요청이 똑같이 갖는 앞부분 (계획) → 캐시 지점. 섹션별 자료는 그 뒤에 둔다
  const shared = `${jobBlock(meta)}

${docBlock(req.doc)}

<plan_result>
<plan>
${JSON.stringify(bundle.plan)}
</plan>
<style>
${bundle.style}
</style>
<notes>
${bundle.notes}
</notes>
</plan_result>
${extraBlock(req.extra)}`;
  const images = bundle.plan.images.filter((im) => im.file.startsWith(`${req.sectionId}_`));
  const specific = `<section_input>
섹션: ${req.sectionId} ${sec ? `"${sec.name}" y ${sec.y0}~${sec.y1}px (섹션 높이 ${sec.y1 - sec.y0}px — 섹션 안 좌표는 y - ${sec.y0})` : ''}
이 섹션 이미지: ${images.map((im) => `${im.file} (${im.kind}, ${im.x0},${im.y0}~${im.x1},${im.y1}${im.alt ? `, alt "${im.alt}"` : ''}) → ${imageBaseUrl(meta)}/${im.file}`).join(' | ') || '없음'}
<layers>
${JSON.stringify(req.layers)}
</layers>
<texts>
${JSON.stringify(req.texts)}
</texts>
</section_input>
아래는 이 섹션 범위의 PSD 합성 렌더 타일이다.`;
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    { type: 'text', text: shared, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: specific },
    ...tileBlocks(req.tiles),
    { type: 'text', text: sectionTask(req) },
  ];
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content }];
  if (req.revision) {
    messages.push({ role: 'assistant', content: req.revision.previous });
    messages.push({ role: 'user', content: `수정 요청:\n${req.revision.feedback}\n\n고친 결과를 같은 세 블록(<section_html>, <section_css>, <section_notes>)으로 전체 다시 써 줘.` });
  }
  return messages;
}
