import { fmtDur, useElapsed } from '../lib/time';

/** 흐른 시간 — 「42초 지남」 처럼 1초마다 바뀐다 (만드는 중 · PSD 여는 중) */
export default function Elapsed({ since, className, suffix = '' }: { since: number; className?: string; suffix?: string }) {
  const ms = useElapsed(since);
  return (
    <span className={className}>
      {fmtDur(ms)}
      {suffix}
    </span>
  );
}
