// Claude 응답 해석(계획 <plan>/<report> — 옛 방식은 <style>/<notes> 도, 섹션 <section_html>/<section_css>/<section_notes>) + 자동 점검
import type { Plan, PsdSummary } from '../../shared/types';
import { fontFaces, pretendardChars } from './fontLock';
import { INLINE_ROW_STYLE, keepMap } from './codegen';
import { GODO_MAX_W, godoMaxWidth } from '../../shared/width';
import { UPLOAD_FILE_RE } from '../../core/upload';
import { MARKETS, type Market } from '../../shared/markets';

/** 합친 결과 (점검·미리보기·저장에 쓰는 모양) */
export interface ParsedOutput {
  plan: Plan | null;
  planError?: string;
  html: string;
  report: string;
}

function block(text: string, tag: string): string | null {
  const open = text.indexOf(`<${tag}>`);
  if (open < 0) return null;
  const close = text.indexOf(`</${tag}>`, open);
  return text.slice(open + tag.length + 2, close < 0 ? undefined : close).trim();
}

const stripFence = (s: string) => s.replace(/^```[a-z]*\s*|\s*```$/g, '').trim();

export interface ParsedPlan {
  plan: Plan | null;
  error?: string;
  style: string;
  notes: string;
  report: string;
}

const toId = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.round(n) : null;
};

/** 구조 계획(engine 'code') 필드 정리: 형식이 틀린 항목은 버리고, 고칠 수 있는 것은 고친다 */
function normalizeCodePlan(plan: Plan) {
  const sections = plan.sections;
  if (plan.photos != null) {
    const list = Array.isArray(plan.photos) ? plan.photos : [];
    plan.photos = list.flatMap((p) => {
      if (!p || typeof p !== 'object') return [];
      const y0 = Math.round(Number(p.y0));
      const y1 = Math.round(Number(p.y1));
      if (!Number.isFinite(y0) || !Number.isFinite(y1) || y0 >= y1) return [];
      const role =
        String(p.role ?? '')
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '') || 'photo';
      let section = typeof p.section === 'string' ? p.section : '';
      if (!sections.some((s) => s.id === section)) {
        const home = sections.find((s) => y0 >= s.y0 && y0 < s.y1) ?? sections[sections.length - 1];
        section = home.id;
      }
      return [{ section, y0, y1, role, alt: String(p.alt ?? '').trim() }];
    });
  }
  if (plan.keepInImage != null) {
    const list = Array.isArray(plan.keepInImage) ? plan.keepInImage : [];
    plan.keepInImage = list.flatMap((k) => {
      const id = toId(typeof k === 'object' && k ? k.id : k);
      return id == null ? [] : [{ id, reason: String((typeof k === 'object' && k ? k.reason : '') ?? '') }];
    });
  }
  if (plan.headings != null) {
    const src = typeof plan.headings === 'object' && !Array.isArray(plan.headings) ? plan.headings : {};
    const out: Record<string, 2 | 3 | 4> = {};
    for (const [k, v] of Object.entries(src)) {
      const id = toId(k);
      const lv = Number(v);
      if (id != null && (lv === 2 || lv === 3 || lv === 4)) out[String(id)] = lv;
    }
    plan.headings = out;
  }
  if (!plan.engine && (plan.photos || plan.keepInImage || plan.headings)) plan.engine = 'code';
  if (plan.engine !== 'code') delete plan.engine;
}

/**
 * JSON 읽기. 실패하면 Claude 가 흔히 남기는 끝 쉼표·주석(// … , /* … *​/)만 지우고 한 번 더 읽는다
 * (문자열 안의 // 는 건드리지 않게 문자열을 건너뛰며 지운다)
 */
function parseLenient(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch (first) {
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '"') {
        let j = i + 1;
        while (j < s.length && s[j] !== '"') j += s[j] === '\\' ? 2 : 1;
        out += s.slice(i, j + 1);
        i = j;
      } else if (c === '/' && s[i + 1] === '/') {
        while (i < s.length && s[i] !== '\n') i++;
        out += '\n';
      } else if (c === '/' && s[i + 1] === '*') {
        const end = s.indexOf('*/', i + 2);
        i = end < 0 ? s.length : end + 1;
      } else out += c;
    }
    try {
      return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
    } catch {
      throw first;
    }
  }
}

export function parsePlanOutput(text: string): ParsedPlan {
  const raw = block(text, 'plan');
  let plan: Plan | null = null;
  let error: string | undefined;
  if (raw) {
    try {
      plan = parseLenient(stripFence(raw)) as Plan;
      if (!plan || typeof plan !== 'object') throw new Error('plan 이 객체가 아님');
      if (!Array.isArray(plan.sections) || !plan.sections.length) throw new Error('sections 가 비어 있음');
      // 섹션 좌표가 "1200" 처럼 문자열로 와도 쓴다 (안 그러면 섹션이 모두 버려지고 문서 전체가 섹션 하나가 됨). null 항목은 버린다
      plan.sections = plan.sections
        .filter((s) => s && typeof s === 'object')
        .map((s) => ({ ...s, id: String(s.id ?? ''), name: String(s.name ?? ''), y0: Number(s.y0), y1: Number(s.y1) }));
      if (!Array.isArray(plan.images)) plan.images = [];
      normalizeCodePlan(plan);
    } catch (e) {
      plan = null;
      error = `계획 JSON 해석 실패: ${(e as Error).message}`;
    }
  } else error = '응답에 <plan> 블록이 없습니다.';
  return { plan, error, style: stripFence(block(text, 'style') ?? ''), notes: block(text, 'notes') ?? '', report: block(text, 'report') ?? '' };
}

export interface ParsedSection {
  html: string;
  css: string;
  notes: string;
  error?: string;
}

export function parseSectionOutput(text: string): ParsedSection {
  const html = stripFence(block(text, 'section_html') ?? '');
  return { html, css: stripFence(block(text, 'section_css') ?? ''), notes: block(text, 'section_notes') ?? '', error: html ? undefined : '응답에 <section_html> 블록이 없습니다.' };
}

export const COPY_START = '▼▼▼';
export const COPY_END = '▲▲▲';

/** 담당자가 붙여넣을 복사 구간만 */
export function copySection(html: string): string {
  const s = html.indexOf(COPY_START);
  const e = html.indexOf(COPY_END);
  if (s < 0 || e < 0) return html;
  const from = html.indexOf('-->', s) + 3;
  const to = html.lastIndexOf('<!--', e);
  return html.slice(from, to).trim();
}

/**
 * 코드 생성의 여러 칸 줄 감싸개(INLINE_ROW_STYLE) 여는 태그만 지운다 — 바로 뒤가 태그일 때만.
 * 감싸개에 직접 글자가 있거나 다른 곳의 font-size:0 은 그대로 남아 점검에 잡힌다
 */
export function withoutLayoutRows(html: string) {
  return html.replace(new RegExp(`<div style="${INLINE_ROW_STYLE}[^"]*">(?=\\s*<)`, 'g'), '<div>');
}

/** 업로더(core/upload.ts)와 같은 규칙 — 화면 점검은 통과했는데 업로드에서 거절되는 일이 없게 */
const FILE_RE = UPLOAD_FILE_RE;

export interface Check {
  level: 'error' | 'warn' | 'ok';
  message: string;
  /** 'plan' = Claude 구조 계획(섹션·사진 띠·이미지에 남길 글자·제목 단계)을 바로잡으면 사라지는 문제 — 「문제 자동 수정」 대상 */
  fix?: 'plan';
}

/** 규칙 6-1·7절·8-4 중 코드로 확인할 수 있는 것만 자동 점검 (화면 대조는 사람이 한다) */
/** kept: 이미지에 일부러 남긴 글자 id (코드 생성 방식) — 텍스트 누락 검사에서 뺀다 */
export function checkOutput(out: ParsedOutput, summary: PsdSummary, baseUrl: string, kept?: Set<number>): Check[] {
  const checks: Check[] = [];
  const add = (level: Check['level'], message: string, fix?: Check['fix']) => checks.push({ level, message, fix });
  const { plan, html } = out;
  if (out.planError) add('error', out.planError);
  if (!html) add('error', '응답에 <html> 블록이 없습니다.');

  if (plan) {
    const files = new Set<string>();
    for (const im of plan.images || []) {
      if (!FILE_RE.test(im.file)) add('error', `파일명 규칙(6-1) 위반: ${im.file}`, 'plan');
      if (files.has(im.file)) add('error', `파일명 중복: ${im.file}`, 'plan');
      files.add(im.file);
      if (!(im.x0 >= 0 && im.y0 >= 0 && im.x1 <= summary.width && im.y1 <= summary.height && im.x1 > im.x0 && im.y1 > im.y0)) add('error', `${im.file}: 자르기 영역이 문서 밖이거나 비어 있음 (${im.x0},${im.y0}~${im.x1},${im.y1})`, 'plan');
      if (im.y1 - im.y0 > 3000) add('warn', `${im.file}: 세로 ${im.y1 - im.y0}px — 3,000px 넘으면 나누기 (6절)`, 'plan');
      if (im.source === 'layer' && im.layerId == null) add('error', `${im.file}: source "layer" 인데 layerId 없음`);
      // 코드 생성 방식의 kind 'txt' 는 글자 모양으로만 칠하는 배경(background-clip:text)이라 겹치는 게 맞다
      if (im.source === 'composite' && !(plan.engine === 'code' && im.kind === 'txt')) {
        const hit = summary.texts.filter((t) => !(t.b[3] <= im.y0 || t.b[1] >= im.y1 || t.b[2] <= im.x0 || t.b[0] >= im.x1));
        const baked = new Set([...(plan.bakedTexts || []).map((b) => b.layerId), ...(plan.engine === 'code' ? keepMap(summary, plan, !/<style/i.test(html)).keys() : [])]);
        const live = hit.filter((t) => !baked.has(t.id));
        if (live.length) add('warn', `${im.file}: 글자 포함 원본 합성인데 HTML 글자 ${live.length}개와 영역이 겹침 → 글자가 두 번 보일 수 있음 (${live.slice(0, 3).map((t) => t.lines[0]).join(' / ')})`, 'plan');
      }
      if (html && !html.includes(`${baseUrl}/${im.file}`)) add('warn', `${im.file}: plan 에는 있는데 HTML 에서 쓰지 않음`, 'plan');
      if (im.kind === 'gif') add('warn', `${im.file}: 움직이는 GIF 는 자동으로 만들 수 없어 정지 이미지로 저장합니다. 원본 GIF 로 바꿔 주세요.`);
    }
    if (html) {
      const used = [...html.matchAll(/https:\/\/[^"')\s]+/g)].map((m) => m[0]).filter((u) => u.startsWith(baseUrl + '/'));
      for (const u of new Set(used)) {
        const f = u.slice(baseUrl.length + 1);
        if (!files.has(f)) add('error', `HTML 이 plan 에 없는 이미지를 씀: ${f}`);
      }
    }
  }

  if (html) {
    const copy = copySection(html);
    const h1 = (copy.match(/<h1[\s>]/gi) || []).length;
    if (h1) add('error', `복사 구간에 <h1> ${h1}개 (8-2: 쓰지 않음)`);
    if (/<script[\s>]/i.test(copy)) add('error', '복사 구간에 <script> (7-1 금지)');
    if (/<iframe[\s>]|<form[\s>]/i.test(copy)) add('error', '복사 구간에 <iframe>/<form> (7-1 금지)');
    if (/position\s*:\s*absolute/i.test(copy)) add('error', 'position:absolute 사용 (5절·7-1 금지)');
    if (/naver\.me|bit\.ly|han\.gl/i.test(copy)) add('error', '외부 단축 URL (7-1 금지)');
    const imgs = [...copy.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
    const noAlt = imgs.filter((t) => !/\salt=/.test(t));
    // G마켓·옥션(ESM)은 가이드대로 height 를 일부러 뺀다 (codegen 섹션 이미지) — 이미지 주소 폴더 openmarket/<플랫폼>/ 로 안다
    const market = /\/openmarket\/([a-z0-9]+)\//.exec(baseUrl)?.[1] as Market | undefined;
    const noHeightOk = !!(market && MARKETS[market]?.rules?.noMaxWidth);
    const noSize = imgs.filter((t) => !/\swidth=/.test(t) || (!noHeightOk && !/\sheight=/.test(t)));
    if (noAlt.length) add('error', `alt 없는 <img> ${noAlt.length}개`);
    if (noSize.length) add('warn', `width·height 속성 없는 <img> ${noSize.length}개 (7-1)`);
    const h2 = (copy.match(/<h2[\s>]/gi) || []).length;
    if (!h2) add('warn', '<h2> 가 하나도 없음 (8-2 제목 구조)', 'plan');
    if (/display\s*:\s*none|font-size\s*:\s*0(px)?\s*[;"]/i.test(withoutLayoutRows(copy))) add('warn', '숨긴 글자 의심 (display:none / font-size:0) — 8-2 9항');
    // 7-5 모바일 = 이미지처럼 비율 축소만 (화면 폭에 따른 재배치·최소 글자 크기 금지)
    if (/@media\b[^{]*\b(max|min)-width|@container\b/i.test(copy)) add('warn', '@media 폭 조건·@container 규칙 사용 — 7-5: 휴대폰에서도 비율 축소만 (재배치·글자 크기 변경 금지)');
    if (/max\(\s*\d+(\.\d+)?px\s*,\s*calc\(/i.test(copy)) add('warn', 'max(…px, calc(…)) 최소 글자 크기 — 7-5: 글자만 커지면 배경과 어긋나므로 쓰지 않음');
    const goodomall = /<style[\s>]/i.test(copy);
    if (goodomall) {
      // 7-2: 고도몰 상세 영역은 최대 860px → 최상위 max-width 는 min(PSD 폭, 860)px
      const maxW = godoMaxWidth(summary.width);
      const widths = [...copy.matchAll(/max-width\s*:\s*(\d+(?:\.\d+)?)px/gi)].map((m) => +m[1]);
      if (!widths.includes(maxW)) add('warn', `최상위 max-width:${maxW}px 가 없음 — 고도몰 상세 영역 최대 ${GODO_MAX_W}px (7-2)${summary.width > GODO_MAX_W ? `, PSD 폭 ${summary.width}px 는 ${GODO_MAX_W}px 안에서 비율대로 줄임` : ''}`);
      if (widths.some((w) => w > GODO_MAX_W)) add('warn', `max-width ${Math.max(...widths)}px — 고도몰 상세 영역은 최대 ${GODO_MAX_W}px (7-2)`);
      // 7-6: 글자 선택 막기 — 상세 영역 안 전부, 예외 없음
      if (!/user-select\s*:\s*none\s*!important/i.test(copy)) add('warn', '글자 선택 막기(user-select:none!important)가 없음 (7-6)');
      if (/user-select\s*:\s*(text|auto|all)/i.test(copy)) add('warn', '선택을 다시 허용하는 user-select:text/auto/all 이 있음 — 7-6: 예외 없이 모두 막음');
      // 클래스 없이 body·html·* 처럼 페이지 전체에 거는 선택자 (.dp-x * 는 괜찮음)
      const styleText = [...copy.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import[^;]*;/gi, '');
      const unscoped = [...styleText.matchAll(/([^{}]+)\{[^}]*user-select[^}]*\}/gi)].flatMap((m) => m[1].split(',')).map((s) => s.trim()).filter((s) => s && !/\.[\w-]/.test(s));
      if (unscoped.length) add('error', `user-select 를 상세 영역 밖까지 걸었음 (${unscoped.slice(0, 3).join(', ')}) — 7-6 2항: 상세 영역(.prefix) 안만 (쇼핑몰 입력칸까지 막힘)`);
      // 7-2-1: 아이티켓 스킨이 상세 영역 h3 를 숨김 (.item_goods_sec h3{display:none})
      const h3 = (copy.match(/<h3[\s>]/gi) || []).length;
      if (h3) add('error', `복사 구간에 <h3> ${h3}개 — 아이티켓 스킨이 상세 영역 h3 를 숨김 (7-2-1). 소제목은 <p role="heading" aria-level="3">`);
      // 5절 9항 폰트 고정 — 조각에 없는 글자는 대체 폰트로 그려진다
      for (const m of fontFaces(pretendardChars(summary)).missing) add('warn', `폰트 조각에 없는 글자 (굵기 ${m.weight}): ${m.chars.slice(0, 20)} → 'Pretendard' 대체로 표시 (5절 9항)`);
    }
    // 텍스트 누락 검사 (9절 4항): 보이는 텍스트 레이어 첫 줄이 HTML 글자나 alt 에 있는지
    const plain = copy.replace(/<br\s*\/?>/gi, '\n').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const norm = (s: string) => s.replace(/\s+/g, '');
    const hay = norm(plain.replace(/<[^>]+>/g, ' ')) + norm([...copy.matchAll(/alt="([^"]*)"/g)].map((m) => m[1]).join(' '));
    const missing = summary.texts.filter((t) => !kept?.has(t.id) && t.lines.some((l) => l.trim() && !hay.includes(norm(l))));
    if (missing.length) add('warn', `HTML 글자·alt 에서 못 찾은 텍스트 레이어 ${missing.length}개: ${missing.slice(0, 5).map((t) => `"${t.lines.find((l) => l.trim())?.slice(0, 20)}"`).join(', ')}${missing.length > 5 ? ' …' : ''}`, 'plan');
    if (!checks.some((c) => c.level !== 'ok')) add('ok', '자동 점검 통과 (화면 대조·실제 채널 등록은 사람이 확인)');
  }
  return checks;
}
