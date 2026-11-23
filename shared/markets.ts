// 오픈마켓 플랫폼별 기준 (채널 "오픈마켓"에서 고른다) — 화면·서버 공용 (node: 모듈 금지)
// 마켓마다 상세 에디터가 받는 HTML·폭이 다르다. 공식 가이드를 확인하거나 시험용 HTML 을 붙여넣어 본 값으로 맞추고, 확인한 항목은 verified 를 true 로.
// width: 상세 영역 최대 폭 px — PSD 가 더 넓으면 이 폭에 맞춰 전체를 비율대로 줄여 만든다 (null = PSD 폭 그대로)

export type Market = 'smartstore' | 'coupang' | 'st11' | 'gmarket' | 'lotteon' | 'himart' | 'compuzone' | 'other';

export interface MarketSpec {
  label: string;
  width: number | null;
  /** 담당자에게 보여 줄 주의 사항 */
  note: string;
  /** 폭·주의 사항을 공식 가이드나 실제 붙여넣기로 확인했는지 */
  verified: boolean;
  /** 출력에 적용하는 플랫폼 규칙 (규칙 원본 7-4 표 근거) */
  rules?: {
    /** max-width 를 쓰지 않는다 (ESM: "iframe, Script, 및 max-width 등은 사용 불가") — 바깥 폭은 width 로 */
    noMaxWidth?: boolean;
    /** <table> 을 쓰지 않는다 (스마트스토어: table 이 있으면 모바일 미리보기 안 됨) — 여러 칸 줄은 inline-block 으로 */
    noTable?: boolean;
    /** 이미지 한 장의 세로:가로 최대 비 (ESM: 1:3 보다 길면 등록 안 됨) — 배경·사진을 이 비율 안으로 나눈다 */
    maxImgRatio?: number;
  };
}

export const MARKETS: Record<Market, MarketSpec> = {
  // 값·주의 사항은 규칙 원본 7-4 표(조사일 2026-11-23)와 같게 — 바꿀 때는 둘 다 고친다
  smartstore: {
    label: '스마트스토어',
    width: 848,
    note: '상세 권장 폭 848px [공식]. 외부 이미지가 있으면 모바일은 PC 화면 캡처로 보여 줘 글자가 작아짐. <style>·외부 링크는 지워짐. 모바일에서는 HTML 글자 크기가 무시되고 고정됨 [공식]. table 은 모바일 미리보기가 안 돼 쓰지 않음',
    verified: true,
    rules: { noTable: true },
  },
  coupang: {
    label: '쿠팡',
    width: 780,
    note: '상세 폭 780px (업계 기준). 저장할 때 이미지를 쿠팡 서버로 복사 — 나중에 이미지를 바꿔도 반영 안 됨. GIF 는 jpg 로 바뀜',
    verified: false,
  },
  st11: {
    label: '11번가',
    width: null,
    note: '공식 PC 폭 없음 (보통 800~831px) — PSD 폭 그대로. 11번가 밖 링크는 자동 삭제',
    verified: false,
  },
  gmarket: {
    label: 'G마켓',
    width: 860,
    note: '상세 폭 860px [공식] (옥션은 980px). iframe·script·max-width 사용 불가 [공식] → max-width 없이 만듦. 이미지는 https, 1장 1000KB 이하 권장, 세로가 가로의 3배를 넘지 않게 나눔(업로드 규칙을 안전하게 따름)',
    verified: true,
    rules: { noMaxWidth: true, maxImgRatio: 3 },
  },
  lotteon: {
    label: '롯데온',
    width: 750,
    note: '상세 권장 폭 750px [공식 가이드]. 롯데온 밖 링크·일부 태그는 예고 없이 지워질 수 있음',
    verified: true,
  },
  himart: {
    label: '하이마트',
    width: null,
    note: '공개 규격 없음 — PSD 폭 그대로. 담당 MD 에게 규격 문서 요청 필요',
    verified: false,
  },
  compuzone: {
    label: '컴퓨존',
    width: null,
    note: '공개 규격 없음 — PSD 폭 그대로. 모바일에서 상세 이미지가 폭 100% 로 늘고 표 칸 여백(td padding)이 무시됨',
    verified: false,
  },
  other: {
    label: '기타 오픈마켓',
    width: null,
    note: 'PSD 폭 그대로 만든다',
    verified: false,
  },
};

export const DEFAULT_MARKET: Market = 'smartstore';

/** 이 마켓 기준 출력 폭 (PSD 폭보다 넓히지 않는다) */
export const marketWidth = (m: Market | undefined, psdW: number) => {
  const w = MARKETS[m ?? 'other']?.width;
  return w ? Math.min(psdW, w) : psdW;
};

/** 저장된 값·예전 작업에서 온 플랫폼을 표에 있는 값으로 (없거나 모르는 값이면 기본 플랫폼) */
export const normMarket = (m: unknown): Market => (typeof m === 'string' && m in MARKETS ? (m as Market) : DEFAULT_MARKET);
