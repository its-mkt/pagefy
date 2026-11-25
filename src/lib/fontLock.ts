// 규칙 5절 9항 폰트 고정 (고도몰) — 기기·브라우저·스킨과 상관없이 같은 Pretendard v1.3.9 가 나오게 한다.
// 검증본: ~/.claude/tools/psd2html/build.js (ZGX Nano, 2026-11-20 iPhone·iPad·Android·PC 실페이지 확인) 의 fontFaces 를 옮김.
//  - 우리만 쓰는 이름 'dp-pretendard' 로 @font-face 를 직접 선언 (스킨이 부르는 최신 'Pretendard' 와 이름이 겹치지 않게)
//  - 공식 분할 조각 중 이 페이지 글자가 든 조각만, 굵기별로, unicode-range 를 실제 쓴 글자로 좁힌다
//  - 조각에 없는 글자·담당자가 나중에 고친 글자는 다음 이름 'Pretendard'(같은 v1.3.9 @import)로 그려진다
// 모델이 이 계산을 할 수 없으므로 코드가 만들고, 모델 CSS 의 font-family 도 코드가 고친다.
import type { PsdSummary } from '../../shared/types';
import { PRETENDARD_FILES, PRETENDARD_RANGES, PRETENDARD_SUBSET_BASE, PRETENDARD_VERSION } from './fonts/pretendardSubsets';

export const FONT_FAMILY = 'dp-pretendard';
/** Pretendard 전체 CSS ('Pretendard' 이름) — 고도몰 대체 @import 와 오픈마켓 위치 대조에서 쓴다 */
export const PRETENDARD_CSS_URL = `https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v${PRETENDARD_VERSION}/dist/web/static/pretendard.min.css`;
const FALLBACK_IMPORT = `@import url("${PRETENDARD_CSS_URL}");`;

type Range = [number, number];
let parsed: Range[][] | null = null;
const ranges = () =>
  (parsed ??= PRETENDARD_RANGES.map((s) =>
    s.split(',').map((r) => {
      const [a, z] = r.trim().replace(/^U\+/i, '').split('-').map((h) => parseInt(h, 16));
      return [a, z ?? a] as Range;
    }),
  ));

/** PSD 텍스트 레이어에서 Pretendard 로 쓰는 글자를 굵기별로 모은다 (이미지로 구운 글자도 섞여도 해가 없음) */
export function pretendardChars(summary: PsdSummary): Map<number, Set<number>> {
  const out = new Map<number, Set<number>>();
  const add = (font: string, weight: number, text: string) => {
    if (!/^Pretendard/i.test(font)) return;
    const w = Math.min(900, Math.max(100, Math.round(weight / 100) * 100));
    const set = out.get(w) ?? out.set(w, new Set()).get(w)!;
    for (const c of text) {
      const cp = c.codePointAt(0)!;
      // 공백(U+20)·줄바꿈 없는 공백(U+A0)도 넣는다 — 폭이 폰트마다 달라 줄바꿈 위치가 바뀜
      if (cp >= 32 && cp !== 127) set.add(cp);
    }
    // 가운데·오른쪽 정렬의 끝 공백은 &nbsp;(U+A0)로 나간다(규칙 4-1) → 조각에 없으면 대체 폰트 폭으로 그려져 줄 위치가 몇 px 흔들린다
    if (set.has(32)) set.add(0xa0);
  };
  for (const t of summary.texts) {
    // 모두 대문자(caps) 레이어는 화면에 대문자로 나오므로 대문자도 넣는다
    const each = (font: string, weight: number, text: string) => add(font, weight, t.caps ? text + text.toUpperCase() : text);
    if (t.runs?.length) for (const r of t.runs) each(r.font, r.weight, r.text);
    else each(t.font, t.weight, t.text);
  }
  return out;
}

export interface FontFaces {
  rules: string[];
  /** 조각에 없는 글자 (굵기 → 글자) — 대체 폰트로 그려진다 */
  missing: { weight: number; chars: string }[];
}

export function fontFaces(chars: Map<number, Set<number>>): FontFaces {
  const rules: string[] = [];
  const missing: FontFaces['missing'] = [];
  for (const [w, set] of [...chars].sort((a, b) => a[0] - b[0])) {
    const name = PRETENDARD_FILES[w];
    if (!name) continue;
    const left = new Set(set);
    ranges().forEach((rs, i) => {
      const mine = [...left].filter((c) => rs.some(([a, z]) => c >= a && c <= z)).sort((a, b) => a - b);
      if (!mine.length) return;
      mine.forEach((c) => left.delete(c));
      const rg: Range[] = []; // 이어지는 코드는 범위로 묶기
      for (const c of mine) {
        const l = rg[rg.length - 1];
        if (l && c === l[1] + 1) l[1] = c;
        else rg.push([c, c]);
      }
      const ur = rg.map(([a, z]) => (a === z ? `U+${a.toString(16)}` : `U+${a.toString(16)}-${z.toString(16)}`)).join(',');
      rules.push(`@font-face{font-family:'${FONT_FAMILY}';font-style:normal;font-weight:${w};font-display:block;src:url(${PRETENDARD_SUBSET_BASE}${name}.subset.${i}.woff2) format('woff2');unicode-range:${ur}}`);
    });
    if (left.size) missing.push({ weight: w, chars: [...left].map((c) => String.fromCodePoint(c)).join('') });
  }
  return { rules, missing };
}

/** 'Pretendard' 로 시작하는 font-family 값 앞에 'dp-pretendard' 를 붙인다 (CSS·인라인 style 공통, 이미 붙었으면 그대로) */
export function lockFamily(s: string): string {
  // @font-face 안의 font-family 는 글꼴 이름 선언이라 건드리지 않는다
  return s
    .split(/(@font-face\s*\{[^}]*\})/i)
    .map((part, i) => (i % 2 ? part : lockPart(part)))
    .join('');
}

// 뒤에 , ; } " ' !important 가 오거나 끝
const FAMILY_RE = /(font-family\s*:\s*)(['"]?)Pretendard(?: Variable)?\2(?=\s*(?:[,;"'}!]|$))/gi;
// font 단축 속성: font: 700 16px/1.5 'Pretendard', sans-serif (크기 뒤 첫 글꼴)
const SHORTHAND_RE = /(\bfont\s*:[^;{}]*?\d(?:px|em|rem|%|pt)(?:\s*\/\s*[\d.]+(?:px|em|rem|%)?)?\s+)(['"]?)Pretendard(?: Variable)?\2(?=\s*(?:[,;"'}!]|$))/gi;

function lockPart(s: string): string {
  const put = (_m: string, p: string, q: string) => `${p}'${FONT_FAMILY}',${q}Pretendard${q}`;
  return s.replace(FAMILY_RE, put).replace(SHORTHAND_RE, put);
}

export interface FontLock {
  /** <style> 맨 앞에 둘 @import (모델이 쓴 @import 도 여기로 끌어올림) */
  imports: string[];
  /** @import 뒤에 둘 @font-face + 고정 CSS */
  css: string;
  /** 모델 CSS (font-family 고침, @import 뺌) */
  rest: string;
  faces: number;
  missing: FontFaces['missing'];
}

/** 모델이 쓴 공통·섹션 CSS 에 폰트 고정을 입힌다 */
export function applyFontLock(prefix: string, summary: PsdSummary, modelCss: string): FontLock {
  const others: string[] = [];
  let usedPretendard = /pretendard/i.test(modelCss);
  // @import 는 <style> 맨 앞에 있어야 효과가 있다 → 끌어올림. Pretendard 는 버전 고정한 대체 하나만 남긴다
  const rest = lockFamily(
    // 주소 안의 ; (Google Fonts 의 wght@400;700 등) 에서 끊기지 않게 따옴표·url() 단위로 읽는다
    modelCss.replace(/@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)|"([^"]*)"|'([^']*)')[^;]*;\s*/gi, (m, a?: string, b?: string, c?: string, d?: string, e?: string) => {
      const url = a ?? b ?? c ?? d ?? e ?? '';
      if (!/pretendard/i.test(url) && !others.includes(m.trim())) others.push(m.trim());
      return '';
    }),
  );
  const chars = pretendardChars(summary);
  if (chars.size) usedPretendard = true;
  const imports = usedPretendard ? [FALLBACK_IMPORT, ...others] : others;
  const { rules, missing } = fontFaces(chars);
  const p = `.${prefix}.${prefix}`;
  const fixed = [
    `${p}{font-synthesis:none;font-kerning:normal;font-variant-ligatures:normal;font-feature-settings:normal;-webkit-text-size-adjust:100%;text-size-adjust:100%;color-scheme:only light}`,
    `${p} a[href^="tel:"],${p} a[x-apple-data-detectors]{color:inherit!important;font:inherit!important;text-decoration:none!important;pointer-events:none}`,
  ];
  return {
    imports,
    css: [`/* 폰트 고정 (규칙 5절 9항) — Pagefy 가 PSD 글자로 자동 생성. 문구를 고치면 조각에 없는 글자는 'Pretendard' 로 그려짐 */`, ...rules, ...fixed].join('\n'),
    rest,
    faces: rules.length,
    missing,
  };
}
