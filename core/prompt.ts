// Claude 에게 보내는 지시문·자료 구성 (로컬 서버와 Supabase 함수가 같이 쓴다 — Node·Deno 공용, 순수 TS)
// 생성은 두 단계: 1) 계획(plan)  2) 섹션별 마크업(section). 무료 Supabase 함수 150초 제한 안에 끝나도록 나눴다.
import type Anthropic from '@anthropic-ai/sdk';
import type { GenerateMeta, PlanRequest, SectionRequest, Tile } from '../shared/types.ts';

/** 두 단계 공통 지시 (시스템 프롬프트 앞부분). 규칙 본문은 원본 그대로 뒤에 붙인다 → 두 단계가 같은 캐시를 쓴다 */
const SERVICE_PREFACE = `너는 통이미지 디자인(상품 상세페이지·랜딩·콘텐츠) PSD를 HTML 마크업으로 바꾸는 웹 서비스 "Pagefy" 안에서 일한다.
아래 <rules> 는 팀이 정한 "상세페이지 마크업 변환 규칙" 원본이다. 이 규칙을 그대로 따른다.

<service_context>
이 규칙은 원래 Claude Code + Photoshop MCP 작업용으로 쓰였다. 이 서비스에서는 역할이 이렇게 나뉜다.
- PSD 읽기(3절)는 프로그램이 이미 했다. 너는 프로그램이 뽑은 "보이는 레이어 목록 + 텍스트 레이어 값"과 PSD 합성 렌더 조각(타일 이미지)을 받는다.
  숨김 레이어는 이미 빠져 있다. 텍스트 값(size·lineHeight·ls·lineTop·anchorX·baseline)은 규칙 4-1 공식으로 미리 계산돼 있으니 그 숫자를 그대로 쓴다. 다시 환산하지 않는다.
- 이미지 자르기·저장은 프로그램이 한다. 너는 계획 단계에서 "어느 영역을 어떤 파일명으로 자를지"만 정한다.
- 이미지 업로드(6절 FTP)와 9절 검증(브라우저 대조·URL 200 확인)은 사람과 프로그램이 한다. 너는 하지 않고, 보고의 "미검증 항목"에 적는다.
- 작업은 두 단계로 나뉜다 (서버 실행 시간 제한 때문). ① 계획: 섹션·이미지·공통 스타일·작성 지침을 정한다. ② 섹션: 계획을 받아 섹션 하나의 마크업만 쓴다.
  섹션들은 따로 동시에 만들어진 뒤 프로그램이 순서대로 합친다. 그래서 섹션끼리 겹치는 이름·스타일은 계획 단계에서 정하고, 섹션 단계는 그것을 그대로 따른다.
- 네가 따를 핵심: 1절 기본 원칙, 4절·4-1 변환, 5절 레이아웃·폰트, 6-1 파일명·경로, 7절 HTML 작성 방식(채널별), 8절 검색 최적화, 10절 하지 말 것.

자료 해석:
- 좌표는 모두 PSD 원본 px (문서 왼쪽 위 = 0,0). b = [left, top, right, bottom].
- 텍스트 lineTop = CSS 줄 상자 위쪽 y, anchorX = 정렬 기준 x (left 면 왼쪽 끝, center 면 가운데, right 면 오른쪽 끝).
- runs 가 있으면 글자 범위별 스타일이 섞인 것이다 → <strong>/<span> 으로 나눈다.
- bakeHint 가 있는 텍스트는 이미지로 굽는 것을 검토한다 (4절 표). bakeHint 가 "규칙 5절 이미지로 굽는 폰트"로 시작하면 검토 없이 반드시 굽는다. 구우면 kind "txt" 이미지로 계획에 넣고 alt 에 원문 전체.
- 타일 이미지는 PSD 합성 렌더(글자 포함)를 자른 것이다. 디자인 확인·섹션 경계·사진 영역 판단에 쓴다. 글자는 타일에서 읽지 말고 텍스트 레이어 값을 쓴다(1절 1항).

이미지 소스 (plan.images[].source):
- "notext": 텍스트 레이어를 뺀 합성. 섹션 배경(kind "bg")에 쓴다. 프로그램이 브라우저로 다시 합성한 것이라 조정 레이어와 일부 효과(내부 그림자·경사·새틴·패턴)가 빠지고, 그림자·광선·오버레이·획은 근사치다. 프로그램 경고에 그런 레이어가 있으면 그 영역은 composite 를 검토한다.
- "composite": PSD 원본 합성(글자 포함, 가장 정확). 글자와 겹치지 않는 사진 띠(kind "img")에 쓴다. 텍스트 레이어 bounds 와 겹치면 글자가 두 번 보이므로 겹치지 않게 자른다.
- "layer": 레이어 하나의 픽셀(투명 PNG, 효과 미포함). 구운 글자(kind "txt")·아이콘(kind "ico")에 쓴다. layerId 필수, 좌표는 그 레이어 bounds. 텍스트 레이어와 작은 레이어(100만 px 이하)만 된다.
- 영역 규칙: 0 ≤ x0 < x1 ≤ 문서 폭, 0 ≤ y0 < y1 ≤ 문서 높이, 정수 px. bg 한 장 세로 3000px 이하(6절). 섹션 경계는 텍스트 bounds 가 걸치지 않는 y 에서 자른다.
- 파일명은 6-1 규칙(s<2자리>_<종류><순번>[-<내용>].<jpg|png|gif>). 사진·배경은 .jpg, 투명이 필요하면 .png. 파일명 앞 s<2자리> 는 그 이미지가 들어갈 섹션 id 와 같게 한다.
- HTML 안 이미지 주소 = <image_base_url>/<파일명> (절대 URL). 계획에 없는 파일을 HTML 에서 쓰지 않는다.
</service_context>`;

export function buildSystem(rulesText: string): Anthropic.Beta.BetaTextBlockParam[] {
  return [{ type: 'text', text: `${SERVICE_PREFACE}\n\n<rules>\n${rulesText}\n</rules>`, cache_control: { type: 'ephemeral' } }];
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
지금은 ① 계획 단계다. 마크업은 쓰지 말고 아래 네 블록만 출력한다 (블록 밖에 다른 글 없이).

<plan>
{"prefix":"dp-...","sections":[{"id":"s00","name":"메인 비주얼","y0":0,"y1":1300}],
 "images":[{"file":"s00_bg1.jpg","kind":"bg","source":"notext","x0":0,"y0":0,"x1":860,"y1":575},
           {"file":"s00_img1-hero-product.jpg","kind":"img","source":"composite","x0":0,"y0":575,"x1":860,"y1":1085,"alt":"..."}],
 "bakedTexts":[{"layerId":123,"file":"s00_txt1-hero-title.png","reason":"뒤틀기"}],
 "wrapperStyle":"(오픈마켓일 때만: 바깥 div 의 인라인 style. 고도몰이면 빼라)"}
</plan>
<style>
(고도몰: 복사 구간 맨 앞 <style> 에 들어갈 공통 CSS — 웹폰트 @import, 최상위 .prefix 와 --u 정의(7-2), 스킨 CSS 방어, 섹션들이 같이 쓸 공통 클래스.
 섹션별 CSS 는 넣지 않는다. 모든 선택자는 .prefix 로 시작. 오픈마켓이면 이 블록은 비워 둔다)
</style>
<notes>
(섹션 단계 작성자에게 줄 지침, 짧게: 색·글자 크기 체계, 반복 요소와 그 클래스 이름(또는 오픈마켓 인라인 스타일 패턴),
 섹션별로 무엇을 h2/h3 로 할지와 표·목록으로 만들 부분, 이미지별 쓰임(배경/img), 섹션 사이 간격 처리)
</notes>
<report>
(계획 단계 보고: 섹션 수와 나눈 근거, 이미지로 구울 텍스트와 사유, 폰트 매핑, CSS로 못 옮겨 이미지 처리할 효과, 검색 최적화 제안(8-3 4항), 미검증 항목)
</report>

섹션 나누기: PSD 디자인 섹션 단위로 나누되, 한 섹션이 세로 2000px 를 넘거나 텍스트 레이어가 15개를 넘으면 글자가 걸치지 않는 위치에서 더 나눈다
(섹션 하나를 120초 안에 쓸 수 있어야 한다). id 는 s00 부터 차례로, 섹션은 위에서 아래로 빈틈없이 이어지게 (앞 섹션 y1 = 다음 섹션 y0, 마지막 y1 = 문서 높이).
plan 은 올바른 JSON 이어야 한다 (주석·끝 쉼표 금지).
</task>`;

export function buildPlanMessages(req: PlanRequest): Anthropic.Beta.BetaMessageParam[] {
  const { meta, summary, tiles } = req;
  const head = `${jobBlock(meta)}

${docBlock(summary, `\n사용 레이어 ${summary.layers.length}개 / 제외(숨김) ${summary.hiddenCount}개 / 텍스트 ${summary.texts.length}개`)}

<layers>
${JSON.stringify(summary.layers)}
</layers>

<texts>
${JSON.stringify(summary.texts)}
</texts>
${extraBlock(req.extra)}
아래는 PSD 합성 렌더 타일이다 (위에서부터 순서대로, 각 타일 위에 원본 y 범위를 적었다).`;
  return [{ role: 'user', content: [{ type: 'text', text: head }, ...tileBlocks(tiles), { type: 'text', text: PLAN_TASK }] }];
}

function sectionTask(req: SectionRequest) {
  const goodomall = req.meta.channel !== 'openmarket';
  return `<task>
지금은 ② 섹션 단계다. 위 계획의 섹션 ${req.sectionId} 하나만 마크업한다. 다른 섹션·문서 머리·복사 구간 주석·공통 <style> 은 쓰지 않는다 (프로그램이 합친다).
아래 세 블록만 출력한다 (블록 밖에 다른 글 없이).

<section_html>
(이 섹션 요소 하나. 맨 앞에 <!-- ${req.sectionId} 섹션이름 --> 주석.
 ${goodomall ? `<section class="{prefix}-sec {prefix}-${req.sectionId}" aria-labelledby="{prefix}-${req.sectionId}-h"> … </section> 형태, 크기는 calc(n * var(--u)) (7-2), 스타일은 클래스로` : '<div style="…"> … </div> 형태, 모든 스타일 인라인·px 고정 (7-3), class 는 위치 표시용으로만'}
 이 섹션의 이미지는 계획의 파일명 그대로 image_base_url 뒤에 붙여 절대 주소로 쓴다)
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
