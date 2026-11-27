// 화면(브라우저)과 서버가 함께 쓰는 데이터 모양
import { normMarket } from './markets.ts';

/** 고도몰 쇼핑몰 4곳 (2026-11-25: zbyhp·cadkorea 추가 — 같은 고도몰 상세 에디터) */
export type GodoChannel = 'itket' | 'oncore' | 'zbyhp' | 'cadkorea';
export type Channel = GodoChannel | 'openmarket';

export const CHANNEL_LABEL: Record<Channel, string> = {
  itket: '아이티켓 (고도몰)',
  oncore: '온코어 (고도몰)',
  zbyhp: 'zbyhp (고도몰)',
  cadkorea: 'cadkorea (고도몰)',
  openmarket: '오픈마켓 (인라인 전용)',
};

/**
 * 고도몰에서 올릴 곳 — 상품 상세(기본) · 게시판 글(이벤트·프로모션, 규칙 7-2-2).
 * 에디터는 같고 본문 폭(최대 860 / 980)·페이지 제목 구조가 다르다 (2026-11-27 실측)
 */
export type GodoTarget = 'detail' | 'board';
export const GODO_TARGET_LABEL: Record<GodoTarget, string> = { detail: '상품 상세', board: '게시판' };

/**
 * 게시판 고르기 — 이미지 서버 폴더 /data/post/<채널>/<게시판>/<슬러그>/ 의 <게시판> (2026-11-27 사용자 결정).
 * 폴더 이름은 사용자가 정한 영문 소문자 (2026-11-27: notice · event · case-study · archives · newsletter — 고도몰 bdId 와 다름).
 * 순서는 사이트 메뉴 순서. 기업소식은 네이버 블로그라 없음. 기획전은 다루지 않는다 (2026-11-27 사용자).
 * 목록이 없는 쇼핑몰은 화면에서 폴더 이름을 직접 넣는다
 */
export const GODO_BOARDS: Partial<Record<GodoChannel, { id: string; label: string }[]>> = {
  itket: [
    { id: 'notice', label: '공지사항' },
    { id: 'event', label: '프로모션' },
    { id: 'case-study', label: '구축사례' },
    { id: 'archives', label: '자료실' },
    { id: 'newsletter', label: '뉴스레터' },
  ],
};
/** 처음 고를 게시판 — 가장 많이 쓸 프로모션 (목록에 없으면 첫째) */
const BOARD_DEFAULT = 'event';
/** 게시판 폴더 이름 규칙 (영문 소문자·숫자·하이픈, 40자까지) */
export const BOARD_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const boardIdOk = (id?: string) => !!id && id.length <= 40 && BOARD_ID_RE.test(id);
/** 쇼핑몰의 기본 게시판 — 목록이 있으면 프로모션(없으면 첫째), 목록이 없으면 빈 값(직접 입력) */
export const defaultBoard = (ch: Channel) => {
  const list = GODO_BOARDS[ch as GodoChannel];
  return list ? (list.find((b) => b.id === BOARD_DEFAULT) ?? list[0]).id : '';
};
/** 실제로 쓸 게시판 — 목록이 있는 쇼핑몰은 목록 안 값만(아니면 기본값), 없으면 넣은 값 그대로 (화면 표시와 이미지 주소가 같게) */
export function pickBoard(ch: Channel, id?: string) {
  const list = GODO_BOARDS[ch as GodoChannel];
  return list ? (list.some((b) => b.id === id) ? id! : defaultBoard(ch)) : (id ?? '');
}
/** 게시판 이름 — 목록에 있으면 메뉴 이름, 없으면 폴더 이름 그대로 */
export const boardLabel = (ch: Channel, id?: string) => GODO_BOARDS[ch as GodoChannel]?.find((b) => b.id === id)?.label ?? id ?? '';

/** PSD 레이어 한 개 (보이는 레이어만, 그룹 계층은 path 로 표현) */
export interface LayerInfo {
  id: number;
  name: string;
  /** 그룹 경로 (예: "s01 메인/제품") */
  path: string;
  kind: 'group' | 'text' | 'pixel' | 'smartObject' | 'shape' | 'fill' | 'adjustment';
  /** [left, top, right, bottom] 문서 px */
  b: [number, number, number, number];
  opacity?: number;
  blend?: string;
  clip?: boolean;
  mask?: boolean;
  /** 켜진 레이어 효과 (dropShadow, stroke …) */
  fx?: string[];
  /** 채우기 레이어 정보 (단색·그라데이션) */
  fill?: string;
}

/** 글자 범위 하나 (한 텍스트 레이어 안에서 스타일이 바뀌는 단위) */
export interface TextRun {
  text: string;
  font: string;
  size: number;
  weight: number;
  color: string;
  /** letter-spacing em */
  ls: number;
  /** 밑줄·취소선 → text-decoration-line 값 (규칙 4-2) */
  deco?: 'underline' | 'line-through' | 'underline line-through';
}

/** 텍스트 레이어 한 개 + 미리 계산한 CSS 값 (규칙 4절·4-1) */
export interface TextInfo {
  id: number;
  path: string;
  text: string;
  /** \r·\n·\u0003 기준으로 나눈 줄 */
  lines: string[];
  b: [number, number, number, number];
  /** 대표(첫 글자) 스타일 */
  font: string;
  size: number;
  lineHeight: number;
  /** 줄마다 행간이 다를 때만 — 줄 순서대로, 각 줄에서 가장 큰 행간 (규칙 4-1). lineHeight = 첫 줄 값 */
  lineHeights?: number[];
  /**
   * 줄마다 그 줄 문단의 포토샵 정렬 원문 (left·center·right·justify-left·justify-center·justify-right·justify-all) —
   * 문단마다 정렬이 다르거나 양쪽 정렬일 때만. align 은 첫 문단 값
   */
  lineAligns?: string[];
  /** 줄마다 그 앞의 문단 간격 px (첫 줄 0). 문단마다 spaceBefore/After 가 다를 때를 위해 — 하나라도 0 이 아닐 때만 */
  paraGaps?: number[];
  weight: number;
  color: string;
  ls: number;
  align: 'left' | 'center' | 'right' | 'justify';
  caps?: boolean;
  /** 점 텍스트/상자 텍스트 */
  shape: 'point' | 'box';
  /** 첫 줄 기준선 y */
  baseline: number;
  /** CSS 줄 상자 위쪽 y (Pretendard 공식: 기준선 − (line-height/2 + 0.35×크기)) */
  lineTop: number;
  /** 정렬 기준 x (left=왼쪽, center=가운데, right=오른쪽) */
  anchorX: number;
  /** 상자(단락) 텍스트의 상자 폭 px — 포토샵이 이 폭에서 자동 줄바꿈한다 */
  boxWidth?: number;
  /** 레이어·바깥 그룹 불투명도의 곱 (1 이면 없음) */
  opacity?: number;
  /** 스타일이 섞여 있을 때만 */
  runs?: TextRun[];
  /** 문단 간격 (px) */
  spaceBefore?: number;
  spaceAfter?: number;
  /** 이미지로 구워야 할 이유 (뒤틀기·패스 위 글자 등) */
  bakeHint?: string;
  fx?: string[];
  /** 드롭섀도 → CSS text-shadow 값 (문서 px, 변형 배율 적용). color 는 rgba() */
  shadows?: { x: number; y: number; blur: number; color: string }[];
  /** 색상 오버레이(혼합 모드 보통) — 글자색을 이 색으로 덮는다. color 는 hex(# 없음), opacity 0~1 */
  overlay?: { color: string; opacity: number };
  /** 획(색 하나, 가운데·바깥) → -webkit-text-stroke. size 는 문서 px, color 는 rgba() (2026-11-27) */
  stroke?: { size: number; position: 'center' | 'outside'; color: string };
  /** 외부 광선(단색) → 번짐만 있는 text-shadow. blur 문서 px, spread 0~1, color 는 rgba() (2026-11-27) */
  glow?: { blur: number; spread: number; color: string };
  /**
   * 그라데이션 오버레이(선형) → background-clip:text. angle 은 포토샵 각도(°, 위쪽 +), scale·offset 은 포토샵 값(1 = 100%),
   * stops 의 t 는 레이어 영역 기준 0~1 (반전 적용됨), opacity 는 효과 불투명도 (2026-11-27)
   */
  gradient?: { angle: number; scale: number; offset: [number, number]; stops: { t: number; color: string }[]; opacity: number };
  /** 웹폰트 표에 없는 폰트 */
  unmappedFont?: boolean;
}

export interface PsdSummary {
  fileName: string;
  width: number;
  height: number;
  dpi: number;
  layers: LayerInfo[];
  texts: TextInfo[];
  hiddenCount: number;
  /** mapped: 웹폰트 표에 있음 / bake: 규칙 5절 "이미지로 굽는 폰트" */
  fonts: { name: string; mapped: boolean; bake?: boolean; count: number }[];
  warnings: string[];
}

/** 미리보기 조각 (Claude 에게 보내는 PSD 렌더 이미지) */
export interface Tile {
  y0: number;
  y1: number;
  /** JPEG base64 (data: 접두사 없음) */
  data: string;
}

/**
 * 서버 폴더 경로(공개 주소 루트 아래) — <채널>/<슬러그>, 오픈마켓은 openmarket/<플랫폼>/<슬러그> (규칙 6-1).
 * 2026-11-24 부터 날짜(rev) 폴더 없이 제품 폴더 하나에 올리고, 고친 이미지는 확인받은 뒤 같은 이름으로 덮어쓴다.
 * 2026-11-25 부터 오픈마켓은 플랫폼 폴더를 한 단계 더 — 플랫폼마다 이미지 자르는 자리가 달라 같은 이름 파일이 서로 덮어쓰지 않게
 */
/** 게시판 글 연도 폴더 — 작업 판(rev, YYYYMMDD)의 연도. 작업을 만든 해로 고정돼 다음 해에 고쳐 올려도 폴더가 그대로다 */
export const boardYear = (rev?: string) => (/^\d{4}/.test(rev || '') ? rev!.slice(0, 4) : '');

export function imageFolder(meta: { channel: Channel; slug: string; market?: string; target?: 'board'; board?: string; rev?: string; year?: string }) {
  if (meta.channel === 'openmarket') return `openmarket/${normMarket(meta.market)}/${meta.slug}`;
  // 게시판 글: post 루트 아래 <채널>/<게시판>/<연도>/<슬러그> (2026-11-27 사용자 결정 — 같은 해 글끼리 파일 이름이 겹치지 않게 슬러그 폴더를 둔다)
  if (meta.target === 'board') return `${meta.channel}/${meta.board || 'etc'}/${meta.year || boardYear(meta.rev) || 'etc'}/${meta.slug}`;
  return `${meta.channel}/${meta.slug}`;
}

/**
 * 올릴 곳에 따른 이미지 루트 — 상품 상세는 설정 루트(…/data/detail) 그대로, 게시판은 그 옆의 …/data/post.
 * 공개 주소 루트·FTP 루트 모두 이 함수로 바꿔 화면 주소와 실제 올린 곳이 어긋나지 않게 한다 (core/upload.ts)
 */
export function rootFor(root: string, target?: 'board') {
  const r = root.replace(/\/+$/, '');
  return target === 'board' ? `${r.replace(/\/detail$/, '')}/post` : r;
}

/** 이미지 주소 폴더 — <공개 주소 루트(게시판은 …/post)>/<imageFolder> */
export function imageBaseUrl(meta: { publicRoot: string; channel: Channel; slug: string; market?: string; target?: 'board'; board?: string; rev?: string }) {
  return `${rootFor(meta.publicRoot, meta.channel === 'openmarket' ? undefined : meta.target)}/${imageFolder(meta)}`;
}

export interface GenerateMeta {
  productName: string;
  channel: Channel;
  /** 이미지 서버 폴더 이름 (규칙 6-1, 영문 소문자·숫자·하이픈 — 한 번 정하면 바꾸지 않음) */
  slug: string;
  /** 작업 판 번호(날짜). 2026-11-24 부터 이미지 주소에는 쓰지 않고, 작업 주소(?rev=)·작업 구분에만 쓴다 */
  rev: string;
  /** 이미지 공개 주소 루트 (예: https://itketweb.hgodo.com/data/detail) */
  publicRoot: string;
  /** 생성일 YYYY-MM-DD (복사 구간 주석용) */
  date: string;
  /** 채널이 오픈마켓일 때 플랫폼 (shared/markets.ts — 폭 등 기준이 다름) */
  market?: import('./markets.ts').Market;
  /** 고도몰에서 올릴 곳 — 게시판일 때만 'board' (없으면 상품 상세. 오픈마켓에는 넣지 않는다) */
  target?: 'board';
  /** 게시판 폴더 이름 (target 'board' 일 때만 — GODO_BOARDS 의 id 또는 직접 넣은 영문). 이미지는 /data/post/<채널>/<게시판>/<rev 연도>/<슬러그>/ */
  board?: string;
}

export interface GenerateRequest {
  meta: GenerateMeta;
  summary: PsdSummary;
  tiles: Tile[];
  /** 담당자 추가 지시 (선택) */
  extra?: string;
  /** 수정 요청: 이전 응답 원문 + 고칠 내용 (여러 번 이어질 수 있음) */
  revisions?: { previous: string; feedback: string }[];
}

/** Claude 가 <plan> 에 돌려주는 이미지 자르기 계획 */
export interface PlanImage {
  file: string;
  kind: 'bg' | 'img' | 'txt' | 'ico' | 'gif';
  /** notext = 글자를 뺀 합성, composite = PSD 원본 합성, layer = 레이어 하나 */
  source: 'notext' | 'composite' | 'layer';
  layerId?: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  alt?: string;
  /** source "notext" 위에 PSD 원본 합성(composite)을 덧그릴 영역들 [x0,y0,x1,y1] — 이미지에 남기는 글자(keepInImage)를 배경에 살린다 */
  patches?: [number, number, number, number][];
}

/** 구조 계획(코드 생성 방식): 글자와 겹치지 않는 전체 폭 사진 띠 → <img alt> (규칙 8-2 7항) */
export interface PlanPhoto {
  /** 들어갈 섹션 id */
  section: string;
  y0: number;
  y1: number;
  /** 파일명용 영문 소문자·하이픈 (예: hero-product) */
  role: string;
  alt: string;
}

export interface PlanSection {
  id: string;
  name: string;
  y0: number;
  y1: number;
}

export interface Plan {
  prefix: string;
  sections: PlanSection[];
  images: PlanImage[];
  bakedTexts?: { layerId: number; file: string; reason: string }[];
  /** 오픈마켓(인라인 전용)일 때 바깥 div 의 style 값 */
  wrapperStyle?: string;
  /**
   * 'code' = 구조 계획만 Claude 가 정하고 마크업은 프로그램이 PSD 값으로 만든다 (psd2html build.js 방식, 2026-11-23~).
   * 없으면 예전 방식(섹션별로 Claude 가 마크업 작성) — 저장된 옛 작업용
   */
  engine?: 'code';
  /** engine 'code': 전체 폭 사진 띠 */
  photos?: PlanPhoto[];
  /** engine 'code': 이미지(배경)에 그대로 남길 텍스트 레이어 — bakeHint 있는 것은 프로그램이 자동으로 더한다 */
  keepInImage?: { id: number; reason: string }[];
  /** engine 'code': 텍스트 레이어 id → 제목 단계 (2 = 섹션 대제목 h2, 3·4 = 소제목). 없는 레이어는 p */
  headings?: Record<string, 2 | 3 | 4>;
}

/**
 * 생성은 두 단계로 한다 (Supabase 무료 함수 150초 제한 안에 끝나도록):
 * 1) 계획: 섹션 나누기·이미지 자르기·공통 스타일·작성 지침  2) 섹션별 마크업 (동시에 여러 개)
 */
export interface PlanRequest {
  meta: GenerateMeta;
  summary: PsdSummary;
  tiles: Tile[];
  extra?: string;
  /** 구조 계획 수정 요청: 지난 계획 응답 원문 + 고칠 내용 */
  revision?: { previous: string; feedback: string };
}

/** 계획 단계 결과 (화면이 응답에서 꺼낸 것) — 섹션 요청에 그대로 다시 보낸다 */
export interface PlanBundle {
  plan: Plan;
  /** 공통 CSS (고도몰용 <style> 안에 들어감, 오픈마켓은 빈 값) */
  style: string;
  /** 섹션 작성 지침 (색·글자 크기 체계·반복 요소 이름·섹션별 제목 등) */
  notes: string;
}

export interface SectionRequest {
  meta: GenerateMeta;
  /** 문서 크기·폰트·경고만 (레이어·텍스트 전체는 보내지 않음) */
  doc: { fileName: string; width: number; height: number; dpi: number; fonts: PsdSummary['fonts']; warnings: string[] };
  bundle: PlanBundle;
  sectionId: string;
  /** 이 섹션 범위의 텍스트·레이어 */
  texts: TextInfo[];
  layers: LayerInfo[];
  /** 이 섹션 범위의 PSD 렌더 타일 */
  tiles: Tile[];
  extra?: string;
  /** 수정 요청: 지난 결과 + 고칠 내용 */
  revision?: { previous: string; feedback: string };
}

/**
 * 마크업 재검증 — Claude 정밀 검토 (2026-11-27). 만든 마크업의 뼈대(스타일·class 를 뺀 HTML)와 텍스트 레이어 목록,
 * 코드 재검증 결과를 보내 판단이 필요한 것(제목 의미·이미지로 남긴 글자가 맞는지·alt 문구·핵심 사실·읽기 순서·구조화)을 본다. 타일 이미지는 보내지 않는다 (비용)
 */
export interface ReviewRequest {
  meta: GenerateMeta;
  doc: { fileName: string; width: number; height: number };
  /** 복사 구간에서 <style>·style·class 를 뺀 HTML (src 는 파일 이름만) */
  markup: string;
  /** 보이는 텍스트 레이어 (heading = 계획의 제목 단계, kept = 이미지에 남긴 사유) */
  texts: { id: number; text: string; size: number; weight: number; heading?: number; kept?: string }[];
  /** 잘라 낸 이미지 (alt 는 계획 값) */
  images: { file: string; kind: string; alt?: string }[];
  /** 코드 재검증 3단계가 찾은 것 (한 줄씩, 단계 key 를 앞에) */
  codeFindings: string[];
}

export interface HealthInfo {
  ok: boolean;
  mock: boolean;
  hasKey: boolean;
  model: string;
  /** 섹션 생성(옛 방식) effort */
  effort: string;
  /** 구조 계획 effort — 지금 생성 방식에서 Claude 를 부르는 건 계획뿐이라 화면 머리에 이 값을 보여 준다 */
  planEffort?: string;
  rules: { source: string; updatedAt: string | null; fallback: boolean };
  /** 이미지 호스팅 업로드를 쓸 수 있음 (서버에 FTP 접속 정보가 있음) */
  upload?: boolean;
  /** 이번 달 사용액·월 상한 (배포 함수만 — 로컬 서버는 MOCK 일 때 예시 값) */
  budget?: import('./ops.ts').BudgetInfo;
  /** 고도몰 등록 확인을 쓸 수 있음 (서버에 아이티켓 고도몰 오픈 API 키가 있음 — core/godo.ts) */
  godo?: boolean;
}

/** 고도몰 상품 조회 결과 (core/godo.ts — 오픈 API Goods_Search, 읽기 전용) */
export interface GodoGoods {
  goodsNo: string;
  name: string;
  /** 상품 등록일 YYYY-MM-DD HH:mm:ss (KST) */
  regDt: string | null;
  /** 상품 마지막 수정일 — 상세설명이 아니어도(가격·재고 등) 상품이 바뀌면 갱신된다 */
  modDt: string | null;
  /** PC 상세설명 HTML */
  description: string;
  descriptionMobile: string;
  /** 모바일 상세설명을 PC 와 같게 씀 */
  mobileSameAsPc: boolean;
  /** 쇼핑몰에 진열 중 */
  displayed: boolean;
  /** 쇼핑몰 상품 페이지 */
  url: string;
}

/** 서버 → 화면 SSE 이벤트 */
export type StreamEvent =
  | { type: 'status'; message: string }
  | { type: 'thinking'; text: string }
  | { type: 'text'; text: string }
  | { type: 'done'; stopReason: string | null; usage: UsageInfo; model: string }
  /** usage: 실패했어도 이미 쓴 비용 (거절·시간 초과 등) — 화면이 작업 비용에 더한다 */
  | { type: 'error'; message: string; usage?: UsageInfo; model?: string };

/** 에이전트 한 턴의 SSE 이벤트 (서버 → 화면). 마지막에 turn 이벤트로 assistant 블록을 넘긴다 */
export type TurnEvent =
  | { type: 'status'; message: string }
  | { type: 'thinking'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string }
  | {
      type: 'turn';
      stopReason: string | null;
      usage: UsageInfo;
      model: string;
      /** 이번 턴의 글(text 블록 이어붙임) */
      text: string;
      /** 화면이 실행할 도구 호출 */
      toolUses: { id: string; name: string; input: unknown }[];
    }
  | { type: 'error'; message: string };

/** 화면 → 서버: 이번 턴 앞에 붙일 user 블록 (도구 결과·수정 요청 글) */
export type TurnBlock =
  | { type: 'text'; text: string }
  | {
      type: 'tool_result';
      tool_use_id: string;
      is_error?: boolean;
      content: ({ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png'; data: string } })[];
    };

export interface UsageInfo {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** 대략 비용 (USD) */
  costUsd: number;
}
