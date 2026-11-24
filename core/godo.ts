// 고도몰 오픈 API — 상품 조회만 (읽기 전용). 붙여넣은 상세설명이 Pagefy 결과와 같은지 화면이 비교하도록 상세설명·수정일을 돌려준다.
// 로컬 서버(Node)·Supabase 함수(Deno) 공용 — node: 모듈 금지. 키는 서버에만 두고 화면으로 보내지 않는다.
// 키: 아이티켓 고도몰 (광고 인사이트 Apps Script 의 GODO_PARTNER_KEY · GODO_USER_KEY 와 같은 값)
import type { GodoGoods } from '../shared/types.ts';

export interface GodoConfig {
  partnerKey: string;
  userKey: string;
}

const ENDPOINT = 'https://openhub.godo.co.kr/godomall5/goods/Goods_Search.php';
/** 아이티켓 쇼핑몰 상품 페이지 (확인 결과에 링크로 보여 준다) */
export const ITKET_GOODS_URL = 'https://itket.com/goods/goods_view.php?goodsNo=';

/** get('PARTNER_KEY' | 'USER_KEY') → 설정 (없으면 null = 기능 끔). 복사할 때 끼어든 공백·줄바꿈은 키에 포함되지 않으므로 지운다 */
export function godoConfigFrom(get: (k: 'PARTNER_KEY' | 'USER_KEY') => string | undefined): GodoConfig | null {
  const clean = (v: string | undefined) => (v || '').replace(/\s/g, '');
  const partnerKey = clean(get('PARTNER_KEY'));
  const userKey = clean(get('USER_KEY'));
  return partnerKey && userKey ? { partnerKey, userKey } : null;
}

/** 상품번호 검사 — 숫자만 (화면이 상품 주소에서 뽑아 보낸다) */
export function checkGoodsNo(v: unknown): string | null {
  return typeof v === 'string' && /^\d{1,10}$/.test(v) ? null : '상품번호는 숫자만 넣어 주세요 (상품 주소의 goodsNo= 뒤 숫자).';
}

/** <tag>값</tag> 또는 <tag><![CDATA[값]]></tag> 의 첫 값 */
function tag(xml: string, name: string): string | null {
  const m = new RegExp(`<${name}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))</${name}>`).exec(xml);
  return m ? (m[1] ?? m[2] ?? '') : null;
}

/** 오픈 API 는 상세설명 HTML 을 \" · \r\n 처럼 역슬래시로 감싸 보낸다 → 원래 HTML 로 */
function unslash(s: string) {
  return s.replace(/\\(r|n|t|["'\\/])/g, (_, c: string) => (c === 'r' ? '\r' : c === 'n' ? '\n' : c === 't' ? '\t' : c));
}

/** 0000-00-00 00:00:00 같은 빈 날짜는 null */
const date = (v: string | null) => (v && !v.startsWith('0000') ? v : null);

/** 상품 하나 조회. 없는 상품이면 null */
export async function fetchGoods(cfg: GodoConfig, goodsNo: string, signal?: AbortSignal): Promise<GodoGoods | null> {
  const body = new URLSearchParams({ partner_key: cfg.partnerKey, key: cfg.userKey, goodsNo });
  const r = await fetch(ENDPOINT, { method: 'POST', body, signal });
  if (!r.ok) throw new Error(`고도몰 API 응답 ${r.status}`);
  const xml = await r.text();
  const code = tag(xml, 'code');
  if (code !== '000') throw new Error(`고도몰 API: ${tag(xml, 'msg') || '알 수 없는 오류'} (${code ?? '응답 형식 다름'})`);
  if (tag(xml, 'goodsNo') !== goodsNo) return null;
  const desc = unslash(tag(xml, 'goodsDescription') || '');
  return {
    goodsNo,
    name: tag(xml, 'goodsNm') || '',
    regDt: date(tag(xml, 'regDt')),
    modDt: date(tag(xml, 'modDt')),
    description: desc,
    descriptionMobile: unslash(tag(xml, 'goodsDescriptionMobile') || ''),
    mobileSameAsPc: tag(xml, 'goodsDescriptionSameFl') === 'y',
    displayed: tag(xml, 'goodsDisplayFl') === 'y',
    url: ITKET_GOODS_URL + goodsNo,
  };
}
