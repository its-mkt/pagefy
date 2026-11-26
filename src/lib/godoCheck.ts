// 고도몰 등록 확인 — 상품 상세설명(오픈 API)과 지금 Pagefy 결과(복사 구간)를 비교한다
// 이미지 주소의 제품 폴더(/detail/<채널>/<슬러그>/)나 최상위 class(dp-…)가 있으면 Pagefy 결과를 붙인 것으로 본다
import type { GodoGoods } from '../../shared/types';

export type GodoStatus = 'latest' | 'old' | 'other' | 'empty';

export interface GodoCheck {
  status: GodoStatus;
  /** old 일 때: 글자·이미지는 같고 코드(CSS 등)만 다름 */
  sameContent?: boolean;
  /** other 일 때: 등록된 상세설명이 쓰는 이미지 폴더 (예: itket/zgx-nano-ai-station) — 다른 슬러그로 만든 예전 결과인지 알려 준다 */
  folderSeen?: string;
  goods: GodoGoods;
  /** 확인한 시각 (ISO) */
  checkedAt: string;
}

/** 공백·줄바꿈 차이는 무시 (고도몰 편집기가 줄바꿈을 바꿔 저장해도 같은 것으로) */
const norm = (s: string) => s.replace(/\r/g, '').replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();
const textOf = (s: string) =>
  s
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
/** 이미지 파일 이름 목록 (주소의 날짜 폴더가 달라도 같은 파일이면 같게) */
const imagesOf = (s: string, folder: string) =>
  [...new Set(s.split(folder).slice(1).map((x) => x.split(/['")\s]/)[0].replace(/^\d{8}\//, '')))].sort().join('|');

/**
 * html = 지금 결과의 복사 구간 (copySection), folder = 'detail/<채널>/<슬러그>/'
 */
export function compareGodo(goods: GodoGoods, html: string, folder: string): GodoCheck {
  const base = { goods, checkedAt: new Date().toISOString() };
  const d = goods.description;
  if (!d.trim()) return { ...base, status: 'empty' };
  if (norm(d) === norm(html)) return { ...base, status: 'latest' };
  const root = /^\s*<div class="(dp-[a-z0-9-]+)/.exec(html)?.[1];
  const ours = d.includes(folder) || (!!root && new RegExp(`class="${root}[" ]`).test(d));
  if (!ours) {
    // 이미지 주소의 …/detail/<채널>/<슬러그>/ (오픈마켓은 openmarket/<플랫폼>/<슬러그>) — 같은 제품을 다른 슬러그로 만든 결과일 때 보여 준다
    const seen = /\/detail\/((?:openmarket\/[a-z0-9-]+\/)?[a-z0-9]+\/[a-z0-9-]+)\//i.exec(d)?.[1];
    return { ...base, status: 'other', ...(seen ? { folderSeen: seen } : {}) };
  }
  const sameContent = textOf(d) === textOf(html) && imagesOf(d, folder) === imagesOf(html, folder);
  return { ...base, status: 'old', sameContent };
}

/** 상품번호 또는 상품 주소(…goods_view.php?goodsNo=123) → 번호 */
export function goodsNoOf(input: string): string | null {
  const v = input.trim();
  if (/^\d{1,10}$/.test(v)) return v;
  return /[?&]goodsNo=(\d{1,10})/.exec(v)?.[1] ?? null;
}

/** 제품(채널/슬러그)마다 연결한 상품번호를 이 브라우저에 기억 */
const KEY = (folder: string) => `pagefy.godo:${folder}`;
export function rememberedGoodsNo(folder: string): string {
  try {
    return localStorage.getItem(KEY(folder)) || '';
  } catch {
    return '';
  }
}
export function rememberGoodsNo(folder: string, no: string) {
  try {
    localStorage.setItem(KEY(folder), no);
  } catch {
    // 저장 못 해도 이번 확인은 된다
  }
}
