// 일·기간 (YYYY-MM-DD) 도우미 — 광고 인사이트 src/utils/dayRange.ts 에서 Pagefy 에 쓰는 것만 옮겨 왔다 (같은 팀 화면끼리 달력 동작·표시를 같게).
// 저쪽을 고치면 여기도 맞춘다. 모두 이 PC 의 로컬 날짜 기준

/** 일·기간 — 하루만 고르면 from === to */
export interface DayRange {
  from: string;
  to: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Date → 'YYYY-MM-DD' (로컬 날짜 기준) */
export const toDayKey = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 'YYYY-MM-DD' → Date (로컬 자정) */
export const fromDayKey = (key: string): Date => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

/** 그 달의 날짜 수 ('2026-11' → 30) */
export const daysOfMonth = (month: string): number => new Date(+month.slice(0, 4), +month.slice(5, 7), 0).getDate();

/** 'YYYY-MM-DD' 에서 n 일 뒤 (음수면 앞) */
export const addDays = (key: string, n: number): string => {
  const d = fromDayKey(key);
  d.setDate(d.getDate() + n);
  return toDayKey(d);
};

/** 시작·끝이 뒤바뀌어도 앞뒤를 바로잡는다 */
export const orderedRange = (a: string, b: string): DayRange => (a <= b ? { from: a, to: b } : { from: b, to: a });

export const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

/** '2026-11-05' → '2026.11.05 (목)' */
export const dayLabel = (day: string): string => `${day.replace(/-/g, '.')} (${WEEKDAY_LABELS[fromDayKey(day).getDay()]})`;

/** 범위 표시 글자 — 하루면 '2026.11.05', 기간이면 '2026.11.01 ~ 11.05' (해가 다르면 끝에도 연도) */
export const rangeLabel = (r: DayRange): string => {
  if (r.from === r.to) return r.from.replace(/-/g, '.');
  const sameYear = r.from.slice(0, 4) === r.to.slice(0, 4);
  const end = sameYear ? r.to.slice(5).replace('-', '.') : r.to.replace(/-/g, '.');
  return `${r.from.replace(/-/g, '.')} ~ ${end}`;
};

/** 일수 (양 끝 포함) */
export const rangeDays = (r: DayRange): number => Math.round((fromDayKey(r.to).getTime() - fromDayKey(r.from).getTime()) / 86400000) + 1;

/** 범위를 시각(ms)으로 — 시작일 0시 이상, 종료일 다음 날 0시 미만 */
export const rangeMs = (r: DayRange): { start: number; end: number } => ({ start: fromDayKey(r.from).getTime(), end: fromDayKey(addDays(r.to, 1)).getTime() });
