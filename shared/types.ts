// 화면(브라우저)과 서버가 함께 쓰는 데이터 모양

export type Channel = 'itket' | 'oncore' | 'openmarket';

export const CHANNEL_LABEL: Record<Channel, string> = {
  itket: '아이티켓 (고도몰)',
  oncore: '온코어 (고도몰)',
  openmarket: '오픈마켓 (인라인 전용)',
};

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

export interface GenerateMeta {
  productName: string;
  channel: Channel;
  slug: string;
  rev: string;
  /** 이미지 공개 주소 루트 (예: https://itketweb.hgodo.com/data/detail) */
  publicRoot: string;
  /** 생성일 YYYY-MM-DD (복사 구간 주석용) */
  date: string;
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

export interface HealthInfo {
  ok: boolean;
  mock: boolean;
  hasKey: boolean;
  model: string;
  effort: string;
  rules: { source: string; updatedAt: string | null; fallback: boolean };
}

/** 서버 → 화면 SSE 이벤트 */
export type StreamEvent =
  | { type: 'status'; message: string }
  | { type: 'thinking'; text: string }
  | { type: 'text'; text: string }
  | { type: 'done'; stopReason: string | null; usage: UsageInfo; model: string }
  | { type: 'error'; message: string };

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
