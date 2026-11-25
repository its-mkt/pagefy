// 처음 쓰는 사람을 위한 단계별 안내 — 가리킨 칸을 밝게 두르고 옆에 설명 카드를 띄운다 (내용·순서는 lib/tour.ts).
// 클릭은 막지 않는다: 안내를 보면서 바로 칸에 입력할 수 있게 (어둡게 두른 면은 클릭이 지나간다). 페이지 스크롤만 안내 중에 막는다
// 닫기(건너뛰기·Esc·마지막 「알겠어요」) = 그 단계는 다시 띄우지 않음. 도움말의 「처음 안내 다시 보기」로 처음처럼
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from './Button';
import { TOURS, markTourSeen, tourSeen, type TourStage, type TourStep } from '../lib/tour';

const el = (s: TourStep) => document.querySelector<HTMLElement>(`[data-tour="${s.target}"]`);
const PAD = 6;
const CARD_W = 320;

export default function Tour({ stage }: { stage: TourStage | null }) {
  const [steps, setSteps] = useState<TourStep[]>([]);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const next = useRef<HTMLButtonElement>(null);

  // 단계가 바뀌면 아직 안 본 안내만 — 화면이 다 그려진 뒤(가리킬 칸이 생긴 뒤)에 고른다
  useEffect(() => {
    setSteps([]);
    setI(0);
    if (!stage || tourSeen(stage)) return;
    const t = window.setTimeout(() => setSteps(TOURS[stage].filter((s) => el(s))), 400);
    return () => window.clearTimeout(t);
  }, [stage]);

  const step = steps[i];
  const close = () => {
    if (stage) markTourSeen(stage);
    setSteps([]);
  };

  // 가리킨 칸을 화면 가운데로 옮기고, 스크롤·창 크기가 바뀌면 위치를 다시 잰다
  useLayoutEffect(() => {
    if (!step) return setRect(null);
    const target = el(step);
    if (!target) return setRect(null);
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const measure = () => setRect(target.getBoundingClientRect());
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    next.current?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [step]);

  // 안내 중에는 페이지 스크롤을 막는다 (휠·터치·키보드) — 둘러진 칸과 카드가 어긋나지 않게 (2026-11-25 의견).
  // 안내가 칸을 옮기는 scrollIntoView 는 그대로 된다. 창이 아주 낮으면(카드가 화면 밖에 걸릴 수 있음) 막지 않는다 — 갇히지 않게
  const active = steps.length > 0;
  useEffect(() => {
    if (!active || window.innerHeight < 500) return;
    const root = document.documentElement;
    const gap = window.innerWidth - root.clientWidth; // 사라질 스크롤바 폭 — 화면이 옆으로 흔들리지 않게 채운다
    const prev = { overflow: root.style.overflow, paddingRight: root.style.paddingRight };
    root.style.overflow = 'hidden';
    if (gap > 0) root.style.paddingRight = `${gap}px`;
    return () => {
      root.style.overflow = prev.overflow;
      root.style.paddingRight = prev.paddingRight;
    };
  }, [active]);

  useEffect(() => {
    if (!step) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  if (!step || !rect) return null;
  // 카드는 칸 아래에, 아래 자리가 모자라면 위에. 가로는 칸 왼쪽에 맞추되 화면 안으로
  const below = window.innerHeight - rect.bottom > 220 || rect.top < 220;
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - CARD_W - 8);
  const last = i === steps.length - 1;
  return (
    <>
      <div className="tour__ring" style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }} aria-hidden="true" />
      <div
        className="tour__card"
        role="dialog"
        aria-label={step.title}
        style={{ left, width: CARD_W, ...(below ? { top: rect.bottom + PAD + 10 } : { bottom: window.innerHeight - rect.top + PAD + 10 }) }}
      >
        <p className="tour__count">
          처음 안내 {i + 1}/{steps.length}
        </p>
        <b className="tour__title">{step.title}</b>
        <p className="tour__body">{step.body}</p>
        <div className="tour__acts">
          {!last && (
            <button type="button" className="link-btn tour__skip" onClick={close}>
              건너뛰기
            </button>
          )}
          {i > 0 && (
            <Button type="button" size="sm" onClick={() => setI(i - 1)}>
              이전
            </Button>
          )}
          {/* 단계가 바뀌면 이 단추에 초점 (Enter 로 다음) — 공용 Button 은 ref 를 받지 않아 같은 모양의 button 으로 */}
          <button ref={next} type="button" className="btn btn--sm btn--primary" onClick={() => (last ? close() : setI(i + 1))}>
            {last ? '알겠어요' : '다음'}
          </button>
        </div>
      </div>
    </>
  );
}
