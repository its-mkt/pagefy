// 운영 기록(비용 상한·사용 기록·결과 평가·관리 화면) — 화면·로컬 서버·Supabase 함수 공용 타입

/** 이번 달 사용액과 상한 (월 = 한국 시간 기준 YYYY-MM) */
export interface BudgetInfo {
  month: string;
  capUsd: number;
  spentUsd: number;
  /** 상한에 닿아 새 생성을 막는 중 */
  blocked: boolean;
  /** 관리자가 이번 달 상한을 풀었음 (계속 생성 가능) */
  unblocked: boolean;
}

/** 상한 대비 몇 % 에서 경고를 띄울지 */
export const BUDGET_WARN_RATIO = 0.8;

export type FeedbackVerdict = 'asis' | 'edited';

/** 「고쳐서 썼어요」일 때 어디를 고쳤는지 (다음 개선 대상을 고르는 데 쓴다) */
export const FEEDBACK_AREAS = [
  { id: 'position', label: '글자 위치' },
  { id: 'linebreak', label: '줄바꿈' },
  { id: 'text', label: '글자 내용·크기' },
  { id: 'image', label: '이미지' },
  { id: 'other', label: '기타' },
] as const;
export type FeedbackArea = (typeof FEEDBACK_AREAS)[number]['id'];

export interface FeedbackRequest {
  jobId: string;
  product: string;
  verdict: FeedbackVerdict;
  areas: FeedbackArea[];
  note?: string;
}

export interface AdminStats {
  month: string;
  budget: BudgetInfo;
  runs: { total: number; ok: number; failed: number; cancelled: number; timeouts: number; avgPlanMs: number | null };
  /** 사람별 (비용 많은 순) */
  users: { email: string; runs: number; costUsd: number; failed: number }[];
  /** 최근 실패 20건 */
  failures: { at: string; email: string; action: string; product: string | null; kind: string | null; error: string | null; durationMs: number | null }[];
  feedback: { total: number; asis: number; edited: number; areas: Record<string, number> };
  /** 최근 평가 20건 */
  recentFeedback: { at: string; email: string; product: string | null; verdict: FeedbackVerdict; areas: string[]; note: string | null }[];
  /** 최근 6개월 (오래된 달부터) */
  months: { month: string; costUsd: number; plans: number }[];
}

export interface AdminSettingsRequest {
  /** 월 상한 바꾸기 (USD, 1 이상) */
  capUsd?: number;
  /** true = 이번 달 상한 풀기, false = 다시 막기 */
  unblock?: boolean;
}

/** 한국 시간 기준 YYYY-MM */
export function monthKST(d = new Date()): string {
  const k = new Date(d.getTime() + 9 * 3600_000);
  return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** YYYY-MM 의 시작 시각 (한국 시간 1일 0시, ISO) */
export function monthStartISO(month: string): string {
  return `${month}-01T00:00:00+09:00`;
}

/** 다음 달 YYYY-MM */
export function nextMonth(month: string, step = 1): string {
  const [y, m] = month.split('-').map(Number);
  const t = y * 12 + (m - 1) + step;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

export function budgetOf(month: string, capUsd: number, spentUsd: number, unblockedMonth: string | null): BudgetInfo {
  const unblocked = unblockedMonth === month;
  return { month, capUsd, spentUsd: Math.round(spentUsd * 100) / 100, blocked: !unblocked && spentUsd >= capUsd, unblocked };
}
