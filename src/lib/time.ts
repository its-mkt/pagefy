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
export function dayHeading(t: number) {
  const diff = Math.round((dayStart(Date.now()) - dayStart(t)) / 86_400_000);
  if (diff === 0) return '오늘';
  if (diff === 1) return '어제';
  const d = new Date(t);
  const thisYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('ko-KR', { year: thisYear ? undefined : 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
}

/** 시각 — 14:05 */
export const clock = (t: number) => new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * 표에 쓰는 날짜·시각 — 2026.11.06 19:34 (2026-11-26 사용자: 연도 포함·두 자리·24시간)
 * 자릿수가 늘 같아 표에서 세로로 줄이 맞는다. toLocaleString 은 모양을 고정할 수 없어 직접 잇는다
 */
export function when(t: number | string) {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 목록 날짜 칸 — 오늘은 「오늘 12:16 pm」, 어제 이전은 「2026.11.25」 (2026-11-26 사용자)
 * 목록은 최근 순이라 지난 작업은 날짜면 충분하다. 정확한 시각은 툴팁으로
 */
export function listDate(t: number) {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  if (dayStart(t) !== dayStart(Date.now())) return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
  const h = d.getHours();
  return `오늘 ${p(h % 12 || 12)}:${p(d.getMinutes())} ${h < 12 ? 'am' : 'pm'}`;
}

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
