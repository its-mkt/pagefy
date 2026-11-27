// 생성 HTML 을 PSD 폭으로 렌더해 텍스트 레이어 위치와 대조 (규칙 4-1 검증 기준, 9절 3·5항)
// - 각 텍스트 레이어 첫 줄의 기준선(baseline)·가로 위치를 PSD 값과 비교: 세로 ±3px, 가로 ±6px
// - 모바일 360px 에서 가로 스크롤 여부
// 화면 밖 iframe 에서 재므로 미리보기에는 영향 없음
import type { GodoTarget, PsdSummary, TextInfo } from '../../shared/types';
import type { Check } from './output';
import { godoMaxWidth } from '../../shared/width';
import { PRETENDARD_CSS_URL } from './fontLock';
import { OM_FIXED_PX_NOTE } from './checkNotes';

export const TOL_Y = 3;
export const TOL_X = 6;

export interface LayoutItem {
  id: number;
  text: string;
  dy: number | null;
  dx: number | null;
  ok: boolean;
}

export interface LayoutResult {
  items: LayoutItem[];
  notFound: number;
  overflow360: number;
  /** 7-5 비율 축소: 좁은 폭 높이 − PC 높이×비율 (px, 폭별) */
  scaleGap: { width: number; gap: number }[];
  checks: Check[];
  feedback: string;
}

const nonSpace = (s: string) => s.replace(/\s+/g, '');

/** 복사 구간에 <style> 이 있으면 고도몰 (오픈마켓은 인라인 스타일만) */
const isGoodomall = (html: string) => /<style[\s>]/i.test(html);

function waitLoad(f: HTMLIFrameElement) {
  return new Promise<void>((res) => {
    if (f.contentDocument?.readyState === 'complete' && f.contentDocument.body?.childNodes.length) res();
    else f.addEventListener('load', () => res(), { once: true });
  });
}

/**
 * 오픈마켓 HTML 은 <style>·웹폰트를 넣지 못해(규칙 7-3) 그대로 그리면 검사하는 PC 에 깔린 글꼴에 따라 결과가 달라진다
 * (Pretendard 가 없는 PC 에서 한글 제목이 6px 내려가 모두 「어긋남」이 됨, 2026-11-25) → 대조 화면에서만 PSD 와 같은 Pretendard 를 불러온다.
 * 실패하면 false (네트워크 차단 등)
 */
async function loadCheckFont(doc: Document): Promise<boolean> {
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = PRETENDARD_CSS_URL;
  const ok = await new Promise<boolean>((resolve) => {
    const t = window.setTimeout(() => resolve(false), 8000);
    link.onload = () => (window.clearTimeout(t), resolve(true));
    link.onerror = () => (window.clearTimeout(t), resolve(false));
    doc.head.appendChild(link);
  });
  // 글꼴 파일은 레이아웃이 글자를 쓸 때 받기 시작한다 → 한 번 배치시켜 두면 settle 의 fonts.ready 가 기다린다
  void doc.body.offsetHeight;
  return ok;
}

async function settle(doc: Document) {
  try {
    await doc.fonts.ready;
  } catch {
    // 글꼴 상태를 못 읽어도 진행
  }
  await new Promise((r) => setTimeout(r, 300));
}

interface CharPos {
  node: Text;
  offset: number;
}

/** 공백을 뺀 글자 → (텍스트 노드, 위치) 지도 */
function charMap(doc: Document) {
  const chars: string[] = [];
  const pos: CharPos[] = [];
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const p = n.parentElement;
      if (!p || ['STYLE', 'SCRIPT', 'TITLE'].includes(p.tagName)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const s = n.data;
    for (let i = 0; i < s.length; i++) {
      if (/\s/.test(s[i]) || s[i] === ' ') continue;
      chars.push(s[i]);
      pos.push({ node: n, offset: i });
    }
  }
  return { str: chars.join(''), pos };
}

/** 위치 뒤 순서로 정렬 (뒤에서부터 표식을 넣어야 앞쪽 위치가 안 바뀜) */
function cmpDesc(a: CharPos, b: CharPos) {
  if (a.node === b.node) return b.offset - a.offset;
  return a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : -1;
}

/**
 * skip: 이미지에 일부러 남긴 글자(keepMap) — HTML 에 없는 게 맞으므로 대조·「못 찾음」에서 뺀다
 * marketW: 오픈마켓 출력 폭 (shared/markets.ts marketWidth — 코드 생성이 쓴 폭과 같은 값). 없으면 PSD 폭
 */
export async function checkLayout(html: string, summary: PsdSummary, skip: ReadonlySet<number> = new Set(), marketW?: number, target?: GodoTarget): Promise<LayoutResult> {
  const W = summary.width;
  // 고도몰 상세 영역은 최대 860px (규칙 7-2) → PSD 가 더 넓으면 860px 로 렌더하고 잰 값을 PSD px 로 되돌린다 (k 배)
  // 오픈마켓은 플랫폼 폭으로 줄여 만들었으면 그 폭으로 렌더한다
  const VW = isGoodomall(html) ? godoMaxWidth(W, target) : Math.min(W, marketW ?? W);
  const k = W / VW;
  const f = document.createElement('iframe');
  f.setAttribute('sandbox', 'allow-same-origin');
  f.style.cssText = `position:fixed;left:-20000px;top:0;width:${VW}px;height:1000px;border:0;visibility:hidden`;
  f.srcdoc = html;
  document.body.appendChild(f);
  try {
    await waitLoad(f);
    const doc = f.contentDocument!;
    // 스크롤바가 폭을 먹으면 전체가 축소돼 위치가 밀린다 (규칙 9절 2항: 스크롤바 숨김)
    const hide = doc.createElement('style');
    hide.textContent = 'html{scrollbar-width:none}html::-webkit-scrollbar{display:none}';
    doc.head.appendChild(hide);
    const openmarket = !isGoodomall(html);
    const checkFont = openmarket ? await loadCheckFont(doc) : true;
    await settle(doc);

    const { str, pos } = charMap(doc);
    const chosen = new Set<number>();
    // 1~3글자 짧은 문구(숫자 라벨 등)는 PSD 위치 근처에 없으면 "못 찾음"으로 본다
    const SHORT = 3;
    type Cand = { start: number; end: number; a?: HTMLElement; b?: HTMLElement };
    type Target = { t: TextInfo; key: string; cands: Cand[]; trail: number; lead: number };
    const targets: Target[] = [];
    for (const t of summary.texts) {
      if (skip.has(t.id)) continue;
      const line = t.lines.find((l) => nonSpace(l));
      if (!line) continue;
      const key = nonSpace(line);
      // 같은 문구가 여러 곳에 있을 수 있으므로 후보를 모두 재서 PSD 위치에 가장 가까운 것을 고른다
      const cands: Cand[] = [];
      for (let i = str.indexOf(key); i >= 0 && cands.length < 60; i = str.indexOf(key, i + 1)) cands.push({ start: i, end: i + key.length - 1 });
      // 가운데·오른쪽 정렬은 포토샵이 끝 공백까지 넣어 정렬한다 (규칙 4-1) → 끝 공백 수를 기억해 폭을 더한다
      // 줄 앞 공백(&nbsp;)도 폭을 차지한다 — 표식은 첫 글자에 있으므로 그 폭을 빼서 줄 시작 x 를 구한다
      targets.push({ t, key, cands, trail: line.length - line.trimEnd().length, lead: line.length - line.trimStart().length });
    }

    // 표식(높이 0 inline-block) 넣기: top = 그 줄 기준선, left = 글자 시작/끝 x
    type Mark = { el: HTMLElement; p: CharPos; after: boolean };
    const marks: Mark[] = [];
    for (const tg of targets) {
      for (const c of tg.cands) {
        c.a = doc.createElement('span');
        c.b = doc.createElement('span');
        marks.push({ el: c.a, p: pos[c.start], after: false }, { el: c.b, p: pos[c.end], after: true });
      }
    }
    const insertAt = (m: Mark) => ({ node: m.p.node, offset: m.p.offset + (m.after ? 1 : 0) });
    [...marks].sort((x, y) => cmpDesc(insertAt(x), insertAt(y))).forEach((m) => {
      m.el.style.cssText = 'display:inline-block;width:0;height:0;overflow:hidden;vertical-align:baseline;margin:0;padding:0';
      const r = doc.createRange();
      const ip = insertAt(m);
      r.setStart(ip.node, ip.offset);
      r.insertNode(m.el);
    });
    const sy = doc.scrollingElement?.scrollTop ?? 0;
    const rectOf = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return { x: r.left * k, y: (r.top + sy) * k };
    };

    const meas = doc.createElement('canvas').getContext('2d')!;
    const spaceWidth = (el: HTMLElement, n: number) => {
      if (!n || !el.parentElement) return 0;
      const cs = getComputedStyle(el.parentElement);
      // cs.font(축약)는 font-kerning 등이 기본값이 아니면 빈 문자열이라 캔버스가 10px 로 잰다 → 낱개 값으로 만든다
      meas.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      (meas as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
      return meas.measureText(' '.repeat(n)).width * k;
    };

    const items: LayoutItem[] = [];
    for (const tg of targets) {
      const t = tg.t;
      let best: { dy: number; dx: number | null; score: number; start: number; wrappedBox: boolean } | null = null;
      for (const c of tg.cands) {
        if (chosen.has(c.start)) continue;
        const a = rectOf(c.a!);
        const b = rectOf(c.b!);
        const dy = a.y - t.baseline;
        // 시작·끝 표식이 같은 줄일 때만 가로 비교 (줄이 바뀌었으면 줄바꿈 위치가 다른 것)
        let dx: number | null = null;
        const ax = a.x - spaceWidth(c.a!, tg.lead);
        const sameLine = Math.abs(b.y - a.y) < 2;
        if (sameLine) {
          const bx = t.align === 'left' ? b.x : b.x + spaceWidth(c.b!, tg.trail);
          const x = t.align === 'center' ? (ax + bx) / 2 : t.align === 'right' ? bx : ax;
          dx = x - t.anchorX;
        } else if (t.align === 'left' || t.align === 'justify') dx = ax - t.anchorX; // 첫 문단이 여러 줄로 자동 줄바꿈돼도 왼쪽 정렬은 시작 x 로 비교
        // 가운데·오른쪽 정렬 상자 텍스트가 첫 문단에서 자동 줄바꿈되면 끝 x 를 알 수 없다 → 세로만 비교
        const wrappedBox = !sameLine && dx == null && t.shape === 'box';
        const score = Math.abs(dy) + (dx == null ? (wrappedBox ? 0 : 50) : Math.abs(dx));
        if (!best || score < best.score) best = { dy, dx, score, start: c.start, wrappedBox };
      }
      // 짧은 문구가 PSD 위치 근처에 없으면 다른 곳의 같은 글자다 → 못 찾음(이미지로 구웠을 수 있음)
      if (!best || (tg.key.length <= SHORT && best.score > 60 * k)) {
        items.push({ id: t.id, text: tg.key.slice(0, 20), dy: null, dx: null, ok: false });
        continue;
      }
      chosen.add(best.start);
      const ok = Math.abs(best.dy) <= TOL_Y * k && (best.dx != null ? Math.abs(best.dx) <= TOL_X * k : best.wrappedBox); // 허용치는 화면 px 기준 (860 상한으로 줄면 PSD px 로 k 배)
      items.push({ id: t.id, text: tg.key.slice(0, 20), dy: Math.round(best.dy * 10) / 10, dx: best.dx == null ? null : Math.round(best.dx * 10) / 10, ok });
    }

    // 7-5 비율 축소 비교용 PSD 폭 높이 (글자 위치 표식이 들어간 같은 상태에서 잰다)
    const pageHeight = () => doc.body.getBoundingClientRect().height;
    const hPc = pageHeight();

    // 모바일 360px 가로 스크롤 (9절 5항)
    f.style.width = '360px';
    await new Promise((r) => setTimeout(r, 200));
    const overflow360 = Math.max(0, (doc.scrollingElement?.scrollWidth ?? 360) - 360);
    // 모바일에서 가장 작은 글자 — 비율 축소(7-5)라 PSD 의 작은 글자가 그대로 작아진다. 미리보기 대신 숫자로 알려 준다
    let minFont: { px: number; text: string } | null = null;
    for (const el of doc.body.querySelectorAll<HTMLElement>('*')) {
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent ?? '').join('').trim();
      if (!own) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const px = parseFloat(doc.defaultView!.getComputedStyle(el).fontSize);
      if (px > 0 && (!minFont || px < minFont.px)) minFont = { px, text: own.slice(0, 14) };
    }
    // 7-5 모바일 = 이미지처럼 비율 축소: 높이도 폭 비율대로 줄어야 한다 (360px 폰 → 고도몰 상세 영역 약 323px)
    const scaleGap: { width: number; gap: number }[] = [];
    for (const w of [360, 323]) {
      f.style.width = `${w}px`;
      await new Promise((r) => setTimeout(r, 200));
      scaleGap.push({ width: w, gap: Math.round((pageHeight() - (hPc * w) / VW) * 10) / 10 });
    }

    const found = items.filter((i) => i.dy != null);
    const pass = found.filter((i) => i.ok).length;
    const bad = found.filter((i) => !i.ok).sort((a, b) => Math.abs(b.dy ?? 0) + Math.abs(b.dx ?? 99) - (Math.abs(a.dy ?? 0) + Math.abs(a.dx ?? 99)));
    const notFound = items.length - found.length;
    const checks: Check[] = [];
    if (!checkFont) checks.push({ level: 'warn', message: '위치 대조용 글꼴(Pretendard)을 불러오지 못해 이 PC 글꼴로 대조했습니다 — 어긋남 표시가 부정확할 수 있습니다.' });
    if (found.length) {
      checks.push({
        level: pass === found.length ? 'ok' : pass / found.length >= 0.8 ? 'warn' : 'error',
        message: `PSD 위치 대조: ${pass}/${found.length} 통과 (기준선 세로 ±${TOL_Y}px·가로 ±${TOL_X}px${k !== 1 ? `, PSD ${W}px → ${VW}px 로 렌더해 PSD px 로 환산` : ""}${openmarket ? ', Pretendard 로 대조 — 오픈마켓 실제 화면은 대체 글꼴이라 몇 px 다를 수 있음' : ''})${bad.length ? ` — 어긋남 큰 순: ${bad.slice(0, 4).map((i) => `"${i.text}" ${fmt(i)}`).join(', ')}` : ''}`,
      });
    }
    if (notFound) checks.push({ level: 'warn', message: `HTML 에서 찾지 못한 글자 ${notFound}개 — 빠졌거나 이미지로 들어갔을 수 있으니 미리보기에서 확인`, fix: 'plan' });
    // 반올림·이미지 높이 차이로 0.5% 또는 3px 까지는 같은 것으로 본다
    const offScale = scaleGap.filter((g) => Math.abs(g.gap) > Math.max(3, ((hPc * g.width) / VW) * 0.005));
    if (hPc > 0)
      checks.push(
        offScale.length
          ? { level: 'warn', message: `모바일 비율 축소 아님 (7-5): ${offScale.map((g) => `${g.width}px 폭에서 높이가 비율보다 ${g.gap > 0 ? '+' : ''}${g.gap}px`).join(', ')} — 글자·여백이 폭 비율대로 줄지 않는 곳이 있음${openmarket ? ` — ${OM_FIXED_PX_NOTE}` : ''}` }
          : { level: 'ok', message: `모바일 비율 축소 확인 (360·323px 폭 높이 = PC 높이 × 비율)` },
      );
    checks.push(overflow360 > 0 ? { level: 'error', message: `모바일 360px 에서 가로 스크롤 ${overflow360}px 생김 (9절 5항)${openmarket ? ` — ${OM_FIXED_PX_NOTE}` : ''}` } : { level: 'ok', message: '모바일 360px 가로 스크롤 없음' });
    if (minFont) {
      const px = Math.round(minFont.px * 10) / 10;
      // 규칙 7-5 는 모바일 작은 글자를 허용한다(최소 글자 크기 없음) → 오류·확인이 아니라 참고로만 보여 준다
      checks.push({
        level: 'ok',
        message: `모바일 360px 에서 가장 작은 글자 약 ${px}px ("${minFont.text}")${px < 6 ? ' — 규칙상 비율 축소만 하므로(7-5) 그대로 둠. 읽기 어렵다면 PSD 에서 키우거나 완료 보고의 제안으로' : ''}`,
      });
    }

    const feedback = bad.length
      ? `PSD 자동 대조 결과 위치가 다른 텍스트 ${bad.length}개 (기준선 기준, +는 PSD보다 아래·오른쪽):\n${bad
          .slice(0, 25)
          .map((i) => `- #${i.id} "${i.text}": ${fmt(i)}`)
          .join('\n')}\n위치를 PSD 값(texts 의 baseline·anchorX)에 맞게 고쳐 줘. 가로가 "줄바꿈 다름"이면 PSD와 같은 위치에서 줄을 바꿔 줘.`
      : '';
    return { items, notFound, overflow360, scaleGap, checks, feedback };
  } finally {
    f.remove();
  }
}

function fmt(i: LayoutItem) {
  const y = i.dy == null ? '' : `세로 ${i.dy > 0 ? '+' : ''}${i.dy}px`;
  const x = i.dx == null ? '줄바꿈 다름' : `가로 ${i.dx > 0 ? '+' : ''}${i.dx}px`;
  return `${y} / ${x}`;
}
