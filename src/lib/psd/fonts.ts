// 규칙 5절 폰트 매핑 표 (웹폰트) — PSD PostScript 이름 → 웹폰트. 화면·워커·Node 점검 스크립트 공용 (순수 모듈)
// 글꼴을 더할 때: 웹 사용 라이선스(5절 8항)·버전 고정·CORS 허용 주소(5절 9항)를 확인하고, 규칙 원본 5절 표에도 같은 줄을 추가한다.

export interface WebFont {
  /** 규칙·화면에 쓰는 이름 */
  family: string;
  /** PSD PostScript 이름 */
  test: RegExp;
  /** CSS 에 쓰는 우리만의 이름 (스킨이 부르는 같은 이름 글꼴과 겹치지 않게 — 5절 9항). Pretendard 는 fontLock 이 따로 처리 */
  cssName?: string;
  /** 굵기 → 버전 고정 woff2 주소. 쓴 굵기만 @font-face 로 선언한다 */
  faces?: Record<number, string>;
  /** faces 대신 통째로 부르는 CSS (@import) */
  importUrl?: string;
  /** 굵기별로 부르는 CSS (@import, 쓴 굵기만) — 분할 조각이 든 CSS 를 쓰는 글꼴 */
  imports?: Record<number, string>;
  /** PSD 이름 → 굵기 (스타일 이름이 Bold·Medium 같은 보통 이름이 아닌 글꼴) */
  weight?: (font: string) => number;
  /** 라이선스·출처 (확인한 날짜) */
  source: string;
}

/** 1Thin ~ 9Black 처럼 숫자로 굵기를 붙인 글꼴의 파일 이름 */
const NUMBERED = ['1Thin', '2ExtraLight', '3Light', '4Regular', '5Medium', '6SemiBold', '7Bold', '8ExtraBold', '9Black'];
const numbered = (url: (style: string) => string) => Object.fromEntries(NUMBERED.map((s, i) => [(i + 1) * 100, url(s)]));

export const WEB_FONTS: WebFont[] = [
  { family: 'Pretendard', test: /^Pretendard-/i, source: 'SIL OFL · jsdelivr orioncactus/pretendard@v1.3.9 (fontLock)' },
  {
    family: 'Paperlogy',
    test: /^Paperlogy-?[1-9](Thin|ExtraLight|Light|Regular|Medium|SemiBold|Bold|ExtraBold|Black)$/i,
    importUrl: 'https://cdn.jsdelivr.net/gh/fonts-archive/Paperlogy/Paperlogy.css',
    source: 'SIL OFL · jsdelivr fonts-archive/Paperlogy (버전 고정 없음 — 5절 9항 미해결)',
  },
  {
    family: 'Freesentation',
    test: /^Freesentation-?[1-9](Thin|ExtraLight|Light|Regular|Medium|SemiBold|Bold|ExtraBold|Black)$/i,
    cssName: 'dp-freesentation',
    faces: numbered((s) => `https://cdn.jsdelivr.net/gh/projectnoonnu/2404@1.0/Freesentation-${s}.woff2`),
    source: 'SIL OFL (freesentation.blog) · jsdelivr projectnoonnu/2404@1.0 (2026-11-27 확인)',
  },
  // ↓ 2026-11-27 추가: 공유 폴더 PSD 242개(최근 6개월)에서 쓰인 글꼴 중 웹 사용 라이선스·버전 고정·CORS 허용 주소를 확인한 것 (근거는 규칙 5절 표)
  {
    family: 'SUIT',
    test: /^SUIT-(Thin|ExtraLight|Light|Regular|Medium|SemiBold|Bold|ExtraBold|Heavy)$/i,
    cssName: 'dp-suit',
    faces: Object.fromEntries(
      (['Thin', 'ExtraLight', 'Light', 'Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold', 'Heavy'] as const).map((s, i) => [(i + 1) * 100, `https://cdn.jsdelivr.net/gh/sun-typeface/SUIT@2.0.5/fonts/static/woff2/SUIT-${s}.woff2`]),
    ),
    source: 'SIL OFL (noonnu 845) · jsdelivr sun-typeface/SUIT@2.0.5',
  },
  {
    family: 'NanumSquareNeo',
    test: /^NanumSquareNeo((TTF|OTF)?-(aLt|bRg|cBd|dEb|eHv)|-?variable-\w+)$/i,
    cssName: 'dp-nanumsquareneo',
    weight: (f) => {
      const m = /-(aLt|bRg|cBd|dEb|eHv)$/i.exec(f);
      if (m) return { alt: 300, brg: 400, cbd: 700, deb: 800, ehv: 900 }[m[1].toLowerCase()]!;
      return styleWeight(f.slice(f.lastIndexOf('-') + 1));
    },
    faces: Object.fromEntries(
      ([[300, 'aLt'], [400, 'bRg'], [700, 'cBd'], [800, 'dEb'], [900, 'eHv']] as const).map(([w, s]) => [w, `https://cdn.jsdelivr.net/npm/nanumsquareneo@0.0.5/woff2/NanumSquareNeoTTF-${s}.woff2`]),
    ),
    source: '네이버 나눔글꼴 라이선스 (noonnu 1053, 웹 사용 가능) · jsdelivr npm nanumsquareneo@0.0.5',
  },
  {
    family: 'NanumSquare',
    test: /^NanumSquare(L|R|B|EB)$/,
    cssName: 'dp-nanumsquare',
    weight: (f) => ({ L: 300, R: 400, B: 700, EB: 800 })[/(L|R|B|EB)$/.exec(f)![1] as 'L' | 'R' | 'B' | 'EB'],
    faces: { 300: 'L', 400: 'R', 700: 'B', 800: 'EB' } as Record<number, string>,
    source: '네이버 나눔글꼴 라이선스 (noonnu 37, 웹 사용 가능) · jsdelivr moonspam/NanumSquare@2.0',
  },
  {
    family: 'GmarketSans',
    test: /^GmarketSans(TTF)?(Light|Medium|Bold)$/i,
    cssName: 'dp-gmarketsans',
    faces: { 300: 'Light', 500: 'Medium', 700: 'Bold' } as Record<number, string>,
    source: 'G마켓 자유 사용·재배포 (noonnu 366) · jsdelivr projectnoonnu/noonfonts_2001@1.1 (woff 만 있음)',
  },
  {
    family: 'Cafe24Ohsquare',
    test: /^Cafe24Ohsquare(OTF)?$/i,
    cssName: 'dp-cafe24ohsquare',
    faces: { 400: 'https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2001@1.1/Cafe24Ohsquare.woff' },
    source: '카페24 아네모네 — 사용 범위 제한 없음·OFL (noonnu 363) · jsdelivr projectnoonnu/noonfonts_2001@1.1 (woff 만 있음)',
  },
  {
    family: 'Cafe24Ohsquareair',
    test: /^Cafe24-?Ohsquare-?air(-?OTF)?$/i,
    cssName: 'dp-cafe24ohsquareair',
    faces: { 400: 'https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2202@1.0/Cafe24Ohsquareair.woff' },
    source: '카페24 아네모네 에어 — 사용 범위 제한 없음·OFL (noonnu 852) · jsdelivr projectnoonnu/noonfonts_2202@1.0 (woff 만 있음)',
  },
  {
    family: 'S-CoreDream',
    test: /^S-CoreDream-[1-9](Thin|ExtraLight|Light|Regular|Medium|Bold|ExtraBold|Heavy|Black)$/i,
    cssName: 'dp-scoredream',
    // 6Bold·8Heavy 처럼 이름과 숫자가 어긋나므로 앞 숫자 × 100 을 굵기로
    weight: (f) => Number(/-([1-9])/.exec(f)![1]) * 100,
    faces: Object.fromEntries(
      ['1Thin', '2ExtraLight', '3Light', '4Regular', '5Medium', '6Bold', '7ExtraBold', '8Heavy', '9Black'].map((s, i) => [(i + 1) * 100, `https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_six@1.2/S-CoreDream-${s}.woff`]),
    ),
    source: '에스코어 드림 — 무료 사용·배포 형태 그대로·출처 표기 권장 (noonnu 223) · jsdelivr projectnoonnu/noonfonts_six@1.2 (woff 만 있음)',
  },
  {
    family: 'Noto Sans KR',
    test: /^NotoSansKR-(Thin|Light|DemiLight|Regular|Medium|Bold|Black)$/i,
    cssName: 'Noto Sans KR',
    weight: (f) => (/DemiLight$/i.test(f) ? 350 : styleWeight(f.slice(f.lastIndexOf('-') + 1))),
    // 분할 조각(unicode-range)이 든 굵기별 CSS — 쓴 글자 조각만 받는다
    imports: Object.fromEntries([100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => [w, `https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-kr@5.3.1/${w}.css`])),
    source: 'SIL OFL (noonnu 34) · jsdelivr npm @fontsource/noto-sans-kr@5.3.1 (분할 조각)',
  },
];

// 파일 이름만 적은 faces 를 전체 주소로 (나눔스퀘어·G마켓 산스)
for (const f of WEB_FONTS) {
  if (f.family === 'NanumSquare') f.faces = Object.fromEntries(Object.entries(f.faces!).map(([w, s]) => [w, `https://cdn.jsdelivr.net/gh/moonspam/NanumSquare@2.0/NanumSquare${s}.woff2`]));
  if (f.family === 'GmarketSans') f.faces = Object.fromEntries(Object.entries(f.faces!).map(([w, s]) => [w, `https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2001@1.1/GmarketSans${s}.woff`]));
}

const STYLE_WEIGHT: [RegExp, number][] = [
  [/thin|hairline/i, 100],
  [/extralight|ultralight/i, 200],
  [/demilight/i, 350],
  [/light/i, 300],
  [/semibold|demibold/i, 600],
  [/extrabold|ultrabold/i, 800],
  [/black|heavy/i, 900],
  [/bold/i, 700],
  [/medium/i, 500],
];
/** 스타일 이름 → 굵기 (보통 이름) */
export const styleWeight = (style: string) => STYLE_WEIGHT.find(([re]) => re.test(style))?.[1] ?? 400;

/**
 * 앞부분이 잘린 이름 ("-5Medium" 처럼 1Thin~9Black 만 남은 것). 페이퍼로지·프리젠테이션이 같은 굵기 이름을 써서
 * 어느 글꼴인지 이름만으로는 알 수 없다 (2026-11-27 PSD 242개 조사: 7개 PSD 에서 이렇게 읽힘, 파일 어디에도 글꼴 이름이 없음)
 */
export const isTruncatedNumbered = (font: string) => /^-?[1-9](Thin|ExtraLight|Light|Regular|Medium|SemiBold|Bold|ExtraBold|Black)$/i.test(font);

export const webFontOf = (font: string): WebFont | undefined => WEB_FONTS.find((m) => m.test.test(font));

/** 쓴 굵기만 담은 @import·@font-face (고도몰 공통 CSS 맨 앞). font-display:block — 5절 9항 */
export function webFontCss(used: Map<string, Set<number>>): { imports: string[]; faces: string[] } {
  const imports: string[] = [];
  const faces: string[] = [];
  for (const [family, weights] of used) {
    const f = WEB_FONTS.find((m) => m.family === family);
    if (!f) continue;
    const ws = [...weights].sort((a, b) => a - b);
    if (f.importUrl) imports.push(`@import url("${f.importUrl}");`);
    if (f.imports) {
      const keys = Object.keys(f.imports).map(Number);
      for (const u of new Set(ws.map((w) => f.imports![w] ?? f.imports![nearest(keys, w)]))) imports.push(`@import url("${u}");`);
    }
    if (f.faces && f.cssName) {
      for (const w of ws) {
        const url = f.faces[w] ?? f.faces[nearest(Object.keys(f.faces).map(Number), w)];
        const format = url.endsWith('.woff2') ? 'woff2' : 'woff';
        faces.push(`@font-face{font-family:'${f.cssName}';src:url("${url}") format("${format}");font-weight:${w};font-style:normal;font-display:block}`);
      }
    }
  }
  return { imports, faces };
}

const nearest = (list: number[], w: number) => list.reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a));
