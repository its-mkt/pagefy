// 날짜·시간 표기 — 화면마다 따로 만들지 않고 여기서 같이 쓴다 (변환 내역 · 관리 화면 · 진행 시간)
import { useEffect, useState } from 'react';

/** 걸린 시간 — 「42초」 / 「3분 5초」 */
export function fmtDur(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}초` : `${Math.floor(s / 60)}분${s % 60 ? ` ${s % 60}초` : ''}`;
}

/** 초 단위로 반올림한 ms — 나눠 보여 줄 때 합이 전체와 맞게 */
export const secMs = (ms: number) => Math.round(ms / 1000) * 1000;

/** 얼마 전 — 방금 / n분 전 / n시간 전 / 11. 20. */
export function ago(t: number) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}시간 전`;
  return new Date(t).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
}

/** 그날 0시 (ms) */
export const dayStart = (t: number) => new Date(t).setHours(0, 0, 0, 0);

/** 날짜 묶음 머리 — 오늘 / 어제 / 11월 20일 (목) (올해가 아니면 연도도) */
export function dayLabel(t: number) {
  const diff = Math.round((dayStart(Date.now()) - dayStart(t)) / 86_400_000);
  if (diff === 0) return '오늘';
  if (diff === 1) return '어제';
  const d = new Date(t);
  const thisYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('ko-KR', { year: thisYear ? undefined : 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
}

/** 시각 — 14:05 */
export const clock = (t: number) => new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });

/** 날짜 머리 아래 시간 칸 — 오늘은 「n분 전」, 그 전은 시각만 */
export const timeOf = (t: number) => (dayStart(t) === dayStart(Date.now()) ? ago(t) : clock(t));

/** 표에 쓰는 날짜·시각 — 11. 20. 14:05 */
export const when = (t: number | string) => new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** since(Date.now) 부터 흐른 ms — 1초마다 다시 그린다 */
export function useElapsed(since: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [since]);
  return Math.max(0, now - since);
}
