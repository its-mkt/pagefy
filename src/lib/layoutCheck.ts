// 생성 HTML 을 PSD 폭으로 렌더해 텍스트 레이어 위치와 대조 (규칙 4-1 검증 기준, 9절 3·5항)
// - 각 텍스트 레이어 첫 줄의 기준선(baseline)·가로 위치를 PSD 값과 비교: 세로 ±3px, 가로 ±6px
// - 모바일 360px 에서 가로 스크롤 여부
// 화면 밖 iframe 에서 재므로 미리보기에는 영향 없음
import type { PsdSummary, TextInfo } from '../../shared/types';
import type { Check } from './output';

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

function waitLoad(f: HTMLIFrameElement) {
  return new Promise<void>((res) => {
    if (f.contentDocument?.readyState === 'complete' && f.contentDocument.body?.childNodes.length) res();
    else f.addEventListener('load', () => res(), { once: true });
  });
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

export async function checkLayout(html: string, summary: PsdSummary): Promise<LayoutResult> {
  const W = summary.width;
  const f = document.createElement('iframe');
  f.setAttribute('sandbox', 'allow-same-origin');
  f.style.cssText = `position:fixed;left:-20000px;top:0;width:${W}px;height:1000px;border:0;visibility:hidden`;
  f.srcdoc = html;
  document.body.appendChild(f);
  try {
    await waitLoad(f);
    const doc = f.contentDocument!;
    // 스크롤바가 폭을 먹으면 전체가 축소돼 위치가 밀린다 (규칙 9절 2항: 스크롤바 숨김)
    const hide = doc.createElement('style');
    hide.textContent = 'html{scrollbar-width:none}html::-webkit-scrollbar{display:none}';
    doc.head.appendChild(hide);
    await settle(doc);

    const { str, pos } = charMap(doc);
    const chosen = new Set<number>();
    // 1~3글자 짧은 문구(숫자 라벨 등)는 PSD 위치 근처에 없으면 "못 찾음"으로 본다
    const SHORT = 3;
    type Cand = { start: number; end: number; a?: HTMLElement; b?: HTMLElement };
    type Target = { t: TextInfo; key: string; cands: Cand[]; trail: number };
    const targets: Target[] = [];
    for (const t of summary.texts) {
      const line = t.lines.find((l) => nonSpace(l));
      if (!line) continue;
      const key = nonSpace(line);
      // 같은 문구가 여러 곳에 있을 수 있으므로 후보를 모두 재서 PSD 위치에 가장 가까운 것을 고른다
      const cands: Cand[] = [];
      for (let i = str.indexOf(key); i >= 0 && cands.length < 60; i = str.indexOf(key, i + 1)) cands.push({ start: i, end: i + key.length - 1 });
      // 가운데·오른쪽 정렬은 포토샵이 끝 공백까지 넣어 정렬한다 (규칙 4-1) → 끝 공백 수를 기억해 폭을 더한다
      targets.push({ t, key, cands, trail: line.length - line.trimEnd().length });
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
      return { x: r.left, y: r.top + sy };
    };

    const meas = doc.createElement('canvas').getContext('2d')!;
    const spaceWidth = (el: HTMLElement, n: number) => {
      if (!n || !el.parentElement) return 0;
      const cs = getComputedStyle(el.parentElement);
      meas.font = cs.font;
      (meas as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
      return meas.measureText(' '.repeat(n)).width;
    };

    const items: LayoutItem[] = [];
    for (const tg of targets) {
      const t = tg.t;
      let best: { dy: number; dx: number | null; score: number; start: number } | null = null;
      for (const c of tg.cands) {
        if (chosen.has(c.start)) continue;
        const a = rectOf(c.a!);
        const b = rectOf(c.b!);
        const dy = a.y - t.baseline;
        // 시작·끝 표식이 같은 줄일 때만 가로 비교 (줄이 바뀌었으면 줄바꿈 위치가 다른 것)
        let dx: number | null = null;
        if (Math.abs(b.y - a.y) < 2) {
          const bx = t.align === 'left' ? b.x : b.x + spaceWidth(c.b!, tg.trail);
          const x = t.align === 'center' ? (a.x + bx) / 2 : t.align === 'right' ? bx : a.x;
          dx = x - t.anchorX;
        }
        const score = Math.abs(dy) + (dx == null ? 50 : Math.abs(dx));
        if (!best || score < best.score) best = { dy, dx, score, start: c.start };
      }
      // 짧은 문구가 PSD 위치 근처에 없으면 다른 곳의 같은 글자다 → 못 찾음(이미지로 구웠을 수 있음)
      if (!best || (tg.key.length <= SHORT && best.score > 60)) {
        items.push({ id: t.id, text: tg.key.slice(0, 20), dy: null, dx: null, ok: false });
        continue;
      }
      chosen.add(best.start);
      const ok = Math.abs(best.dy) <= TOL_Y && best.dx != null && Math.abs(best.dx) <= TOL_X;
      items.push({ id: t.id, text: tg.key.slice(0, 20), dy: Math.round(best.dy * 10) / 10, dx: best.dx == null ? null : Math.round(best.dx * 10) / 10, ok });
    }

    // 7-5 비율 축소 비교용 PSD 폭 높이 (글자 위치 표식이 들어간 같은 상태에서 잰다)
    const pageHeight = () => doc.body.getBoundingClientRect().height;
    const hPc = pageHeight();

    // 모바일 360px 가로 스크롤 (9절 5항)
    f.style.width = '360px';
    await new Promise((r) => setTimeout(r, 200));
    const overflow360 = Math.max(0, (doc.scrollingElement?.scrollWidth ?? 360) - 360);
    // 7-5 모바일 = 이미지처럼 비율 축소: 높이도 폭 비율대로 줄어야 한다 (360px 폰 → 고도몰 상세 영역 약 323px)
    const scaleGap: { width: number; gap: number }[] = [];
    for (const w of [360, 323]) {
      f.style.width = `${w}px`;
      await new Promise((r) => setTimeout(r, 200));
      scaleGap.push({ width: w, gap: Math.round((pageHeight() - (hPc * w) / W) * 10) / 10 });
    }

    const found = items.filter((i) => i.dy != null);
    const pass = found.filter((i) => i.ok).length;
    const bad = found.filter((i) => !i.ok).sort((a, b) => Math.abs(b.dy ?? 0) + Math.abs(b.dx ?? 99) - (Math.abs(a.dy ?? 0) + Math.abs(a.dx ?? 99)));
    const notFound = items.length - found.length;
    const checks: Check[] = [];
    if (found.length) {
      checks.push({
        level: pass === found.length ? 'ok' : pass / found.length >= 0.8 ? 'warn' : 'error',
        message: `PSD 위치 대조: ${pass}/${found.length} 통과 (기준선 세로 ±${TOL_Y}px·가로 ±${TOL_X}px)${bad.length ? ` — 어긋남 큰 순: ${bad.slice(0, 4).map((i) => `"${i.text}" ${fmt(i)}`).join(', ')}` : ''}`,
      });
    }
    if (notFound) checks.push({ level: 'warn', message: `위치 대조 못 한 텍스트 ${notFound}개 (HTML 글자에서 첫 줄을 못 찾음 — 이미지로 구웠거나 빠짐)` });
    // 반올림·이미지 높이 차이로 0.5% 또는 3px 까지는 같은 것으로 본다
    const offScale = scaleGap.filter((g) => Math.abs(g.gap) > Math.max(3, ((hPc * g.width) / W) * 0.005));
    if (hPc > 0)
      checks.push(
        offScale.length
          ? { level: 'warn', message: `모바일 비율 축소 아님 (7-5): ${offScale.map((g) => `${g.width}px 폭에서 높이가 비율보다 ${g.gap > 0 ? '+' : ''}${g.gap}px`).join(', ')} — 글자·여백이 폭 비율대로 줄지 않는 곳이 있음` }
          : { level: 'ok', message: `모바일 비율 축소 확인 (360·323px 폭 높이 = PC 높이 × 비율)` },
      );
    checks.push(overflow360 > 0 ? { level: 'error', message: `모바일 360px 에서 가로 스크롤 ${overflow360}px 생김 (9절 5항)` } : { level: 'ok', message: '모바일 360px 가로 스크롤 없음' });

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
