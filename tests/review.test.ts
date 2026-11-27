// 마크업 재검증 3단계 (src/lib/review.ts) — yarn test
import { describe, expect, it } from 'vitest';
import { buildReviewRequest, parseReviewOutput, reviewKey, reviewMarkup, reviewText } from '../src/lib/review';
import type { GenerateMeta, Plan, PsdSummary, TextInfo } from '../shared/types';

const text = (id: number, s: string, extra: Partial<TextInfo> = {}): TextInfo =>
  ({ id, path: `t${id}`, text: s, lines: s.split('\n'), b: [0, id * 100, 400, id * 100 + 40], font: 'Pretendard-Bold', size: 24, lineHeight: 30, weight: 700, color: '000000', ls: 0, align: 'left', shape: 'point', baseline: id * 100 + 30, lineTop: id * 100, anchorX: 0, ...extra }) as TextInfo;

const summary = (texts: TextInfo[]): PsdSummary => ({ fileName: 'a.psd', width: 860, height: 1200, dpi: 72, layers: texts.map((t) => ({ id: t.id, name: t.path, path: t.path, kind: 'text', b: t.b })), texts, hiddenCount: 0, fonts: [], warnings: [] });

const BASE = 'https://img.example.com/detail/itket/zgx';
const godoMeta: GenerateMeta = { productName: 'ZGX Nano', channel: 'itket', slug: 'zgx', rev: '20261127', publicRoot: 'https://img.example.com/detail', date: '2026-11-27' };
const plan = (extra: Partial<Plan> = {}): Plan => ({ prefix: 'dp-zgx', sections: [{ id: 's00', name: '메인', y0: 0, y1: 1200 }] as Plan['sections'], images: [{ file: 's00_bg-main.jpg', kind: 'bg', source: 'notext', x0: 0, y0: 0, x1: 860, y1: 1200 }], engine: 'code', ...extra });

const wrap = (body: string, style = '@supports (width:1cqw){.dp-zgx{--u:1cqw}}.dp-zgx{max-width:860px;margin:0 auto}.dp-zgx *{user-select:none!important}') =>
  `<!-- ▼▼▼ 복사 시작 -->\n<style>${style}</style>\n<div class="dp-zgx">${body}</div>\n<!-- ▲▲▲ 복사 끝 -->`;

const find = (passes: ReturnType<typeof reviewMarkup>, key: string, re: RegExp) => passes.find((p) => p.key === key)!.findings.find((f) => re.test(f.message));

describe('reviewMarkup', () => {
  it('규칙대로 만든 고도몰 마크업은 세 단계 모두 오류·확인 없음', () => {
    const s = summary([text(1, 'ZGX Nano AI 워크스테이션'), text(2, '128GB 통합 메모리')]);
    const html = wrap(
      `<section class="dp-zgx-s00" aria-labelledby="dp-zgx-s00-h"><h2 id="dp-zgx-s00-h" class="dp-zgx-t1">ZGX Nano AI 워크스테이션</h2><p class="dp-zgx-t2">128GB 통합 메모리</p>` +
        `<img src="${BASE}/s00_img1-front.jpg" alt="ZGX Nano 정면" width="860" height="400" loading="eager"></section>`,
    );
    const passes = reviewMarkup({ html, summary: s, plan: plan(), meta: godoMeta, baseUrl: BASE, kept: new Map() });
    for (const p of passes) expect(p.findings.filter((f) => f.level === 'error' || f.level === 'warn')).toEqual([]);
    expect(passes.map((p) => p.key)).toEqual(['rules', 'seo', 'layers']);
  });

  it('고도몰 금지(h3·접두사 밖 선택자), 빈 alt 제목, 단계 건너뜀, 숨긴 글자, 태그 짝을 잡는다', () => {
    const s = summary([text(1, '제목'), text(2, '본문')]);
    const html = wrap(
      `<h2>제목</h2><h4>소</h4><h3>x</h3><p style="display:none">숨김</p><p>본문<div>블록</div></p><h2><img src="${BASE}/a.jpg" alt="" width="1"></h2><span>안 닫힘`,
      '.dp-zgx{max-width:860px}.dp-zgx *{user-select:none!important} body{margin:0}',
    );
    const passes = reviewMarkup({ html, summary: s, plan: plan(), meta: godoMeta, baseUrl: BASE, kept: new Map() });
    expect(find(passes, 'rules', /h3>~<h6>/)?.level).toBe('error');
    expect(find(passes, 'rules', /선택자/)?.samples).toContain('body');
    expect(find(passes, 'seo', /건너뜀/)?.level).toBe('warn');
    expect(find(passes, 'seo', /숨긴 글자/)?.level).toBe('error');
    expect(find(passes, 'seo', /<p> 안에 블록/)?.level).toBe('error');
    expect(find(passes, 'seo', /제목 안 이미지인데 alt/)?.level).toBe('error');
    expect(find(passes, 'seo', /엇갈려 닫힌/)?.samples?.join()).toMatch(/span/);
    expect(find(passes, 'seo', /엇갈려|닫히지 않은/)).toBeTruthy();
  });

  it('텍스트 레이어가 이미지가 된 곳: 계획이 남긴 제목은 확인, alt 원문 없으면 오류, 어디에도 없으면 오류', () => {
    const s = summary([text(1, '큰 제목 문구입니다', { size: 40 }), text(2, '라벨', { size: 12 }), text(3, '빠진 글자')]);
    const html = wrap(`<h2>다른 제목</h2><img src="${BASE}/s00_bg-main.jpg" alt="큰 제목 문구입니다" width="860" height="1200">`);
    const kept = new Map<number, string>([
      [1, '사진 위 글자'],
      [2, '도표 라벨'],
    ]);
    const passes = reviewMarkup({ html, summary: s, plan: plan({ keepInImage: [{ id: 1, reason: '사진 위 글자' }, { id: 2, reason: '도표 라벨' }] }), meta: godoMeta, baseUrl: BASE, kept });
    expect(find(passes, 'layers', /제목·큰 글자/)?.samples?.[0]).toMatch(/#1/);
    expect(find(passes, 'layers', /alt 에 원문이 없는/)?.samples?.[0]).toMatch(/#2/);
    expect(find(passes, 'layers', /어디에도|alt 에도 없는/)?.samples?.[0]).toMatch(/#3/);
    expect(reviewText(passes)).toMatch(/^마크업 재검증 \(코드 3단계\):/);
  });

  it('오픈마켓: <style>·스마트스토어 table·G마켓 max-width·긴 이미지·파일명 alt', () => {
    const s = summary([text(1, '제목')]);
    const om = (market: GenerateMeta['market']) => ({ ...godoMeta, channel: 'openmarket' as const, market });
    const base = 'https://img.example.com/detail/openmarket/smartstore/zgx';
    const html = `<style>.a{}</style><div style="max-width:848px"><table><tr><td><img src="${base}/s00_bg-main.jpg" alt="s00_bg-main.jpg" width="848"></td></tr></table></div>`;
    const ss = reviewMarkup({ html, summary: s, plan: plan(), meta: om('smartstore'), baseUrl: base, kept: new Map([[1, '오픈마켓 섹션 이미지에 들어간 글자']]) });
    expect(find(ss, 'rules', /<style>/)?.level).toBe('error');
    expect(find(ss, 'rules', /<table>/)?.level).toBe('error');
    expect(find(ss, 'seo', /파일 이름이 alt/)?.level).toBe('error');
    const gm = reviewMarkup({ html, summary: s, plan: plan({ images: [{ file: 's00_bg-main.jpg', kind: 'bg', source: 'notext', x0: 0, y0: 0, x1: 100, y1: 400 }] }), meta: om('gmarket'), baseUrl: base, kept: new Map() });
    expect(find(gm, 'rules', /max-width — ESM/)?.level).toBe('error');
    expect(find(gm, 'rules', /3배 넘는/)?.level).toBe('error');
  });
});

describe('Claude 정밀 검토 요청·응답', () => {
  const s = summary([text(1, '제목'), text(2, '라벨')]);
  const html = wrap(`<h2 class="dp-zgx-t1" style="font-size:20px">제목</h2><img src="${BASE}/s00_bg-main.jpg" alt="라벨" width="860" height="1200" loading="lazy">`);
  const input = { html, summary: s, plan: plan({ headings: { '1': 2 } }), meta: godoMeta, baseUrl: BASE, kept: new Map([[2, '도표 라벨']]) };

  it('뼈대는 style·class·크기 속성을 빼고 src 는 파일 이름만, 텍스트에 제목 단계·이미지 사유를 붙인다', () => {
    const req = buildReviewRequest(input, reviewMarkup(input));
    expect(req.markup).toBe('<div><h2>제목</h2><img src="s00_bg-main.jpg" alt="라벨"></div>');
    expect(req.texts).toEqual([
      { id: 1, text: '제목', size: 24, weight: 700, heading: 2 },
      { id: 2, text: '라벨', size: 24, weight: 700, kept: '도표 라벨' },
    ]);
    expect(reviewKey(req)).toBe(reviewKey(buildReviewRequest(input, [])));
  });

  it('응답 JSON 을 단계별로 읽고, 모르는 단계·빈 문구는 버리고, 모르는 level 은 참고로', () => {
    const r = parseReviewOutput('앞말\n<review>\n```json\n{"summary":"대체로 맞음","passes":[{"key":"seo","findings":[{"level":"warn","message":"h2 가 장식 문구","where":"s01","fix":"주제 문구를 h2 로"},{"level":"x","message":"참고"},{"message":""}]},{"key":"nope","findings":[{"level":"error","message":"버림"}]}],"falsePositives":[{"finding":"숨긴 글자","why":"감싸개"}]}\n```\n</review>');
    expect(r.summary).toBe('대체로 맞음');
    expect(r.passes.seo).toEqual([
      { level: 'warn', message: 'h2 가 장식 문구', where: 's01', fix: '주제 문구를 h2 로' },
      { level: 'info', message: '참고', where: undefined, fix: undefined },
    ]);
    expect(r.passes.rules).toEqual([]);
    expect(r.falsePositives).toEqual([{ finding: '숨긴 글자', why: '감싸개' }]);
    expect(() => parseReviewOutput('없음')).toThrow(/review/);
    expect(reviewText(reviewMarkup(input), r)).toMatch(/Claude·확인\] h2 가 장식 문구/);
  });
});
