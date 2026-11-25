// 변환 내역 기간 거르기 — 선택 상자 모양 단추를 누르면 「빠른 선택(전체·오늘·최근 7일·최근 30일)」 + 「달력(날·기간)」이 함께 열린다.
// 달력 조작은 광고 인사이트 DatePicker 와 같다: 첫 번째로 누른 날 = 시작일, 두 번째 = 종료일(같은 날·하나만 누르면 그날 하루),
// 세 번째로 누르면 처음부터, 「적용」을 눌러야 거른다. 바깥 클릭·Esc 로 닫으면 적용하지 않는다. 빠른 선택은 누르면 바로 적용.
// 열고 닫기·바깥 클릭·Esc·포커스 되돌리기는 Radix Popover 가 맡는다
import { useMemo, useState } from 'react';
import { Button } from './Button';
import { Popover } from 'radix-ui';
import { Chevron } from './icons';
import { WEEKDAY_LABELS, dayLabel, daysOfMonth, fromDayKey, orderedRange, rangeDays, rangeLabel, toDayKey, type DayRange } from '../lib/dayRange';
import { nextMonth } from '../../shared/ops';

export interface Period {
  /** 최근 n일 (빠른 선택) */
  days?: number;
  /** 달력에서 고른 날·기간 */
  range?: DayRange;
}

const PRESETS: { days?: number; label: string }[] = [{ label: '전체 기간' }, { days: 1, label: '오늘' }, { days: 7, label: '최근 7일' }, { days: 30, label: '최근 30일' }];

/** 단추에 보일 글자 */
export const periodLabel = (p: Period) => (p.range ? rangeLabel(p.range) : (PRESETS.find((x) => x.days === p.days)?.label ?? '전체 기간'));

export default function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const [open, setOpen] = useState(false);
  const today = toDayKey(new Date());
  // 적용 전에 고른 범위 · 시작일만 누르고 종료일을 기다리는 중 · 마우스가 올라간 날(기간 미리 칠하기)
  const [draft, setDraft] = useState<DayRange | null>(null);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState(today.slice(0, 7));

  const onOpenChange = (o: boolean) => {
    if (o) {
      setDraft(value.range ?? null);
      setAnchor(null);
      setHover(null);
      setView((value.range?.to ?? today).slice(0, 7));
    }
    setOpen(o);
  };
  const apply = (p: Period) => {
    onChange(p);
    setOpen(false);
  };

  const vy = +view.slice(0, 4);
  const vm = +view.slice(5, 7);
  const prev = nextMonth(view, -1);
  const next = nextMonth(view);
  const cells = useMemo(() => {
    const lead = fromDayKey(`${view}-01`).getDay();
    const out: (string | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= daysOfMonth(view); d++) out.push(`${view}-${String(d).padStart(2, '0')}`);
    while (out.length % 7) out.push(null);
    return out;
  }, [view]);

  const pick = (day: string) => {
    if (!anchor) {
      setAnchor(day);
      setDraft({ from: day, to: day });
      return;
    }
    setDraft(orderedRange(anchor, day));
    setAnchor(null);
  };
  // 달력에 칠할 범위 — 기간을 고르는 중이면 시작일~마우스 위치, 아니면 고른 범위
  const shown = anchor ? orderedRange(anchor, hover || anchor) : draft;
  const summary = anchor ? '종료일을 누르세요 (같은 날을 다시 누르면 하루)' : draft ? `${rangeLabel(draft)}${draft.from === draft.to ? '' : ` · ${rangeDays(draft)}일`}` : '시작일을 누르세요';
  const on = !!(value.days || value.range);

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger className={`sel sel--md period${on ? ' is-on' : ''}`} aria-label={`기간: ${periodLabel(value)}`}>
        <span className="sel__value">{periodLabel(value)}</span>
        <span className="sel__chev">
          <Chevron dir="down" />
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="period__pop" align="end" sideOffset={4} collisionPadding={8} aria-label="기간 고르기">
          <ul className="period__presets" aria-label="빠른 선택">
            {PRESETS.map((p) => {
              const cur = !value.range && value.days === p.days;
              return (
                <li key={p.label}>
                  <button type="button" className={`period__preset${cur ? ' is-on' : ''}`} aria-pressed={cur} onClick={() => apply({ days: p.days })}>
                    {p.label}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="period__cal">
            <div className="period__head">
              <button type="button" className="period__nav" aria-label="이전 달" onClick={() => setView(prev)}>
                <Chevron className="period__prev" />
              </button>
              <b className="period__title" aria-live="polite">
                {vy}년 {vm}월
              </b>
              <button type="button" className="period__nav" aria-label="다음 달" disabled={next > today.slice(0, 7)} onClick={() => setView(next)}>
                <Chevron />
              </button>
            </div>
            <div className="period__grid" role="grid" onMouseLeave={() => setHover(null)}>
              {WEEKDAY_LABELS.map((w, i) => (
                <span key={w} className={`period__wd${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}`} role="columnheader">
                  {w}
                </span>
              ))}
              {cells.map((day, i) => {
                if (!day) return <span key={`e${i}`} />;
                const inRange = !!shown && day >= shown.from && day <= shown.to;
                const cls = ['period__day', i % 7 === 0 ? 'sun' : i % 7 === 6 ? 'sat' : '', day === today ? 'today' : '', inRange ? 'in' : '', shown && day === shown.from ? 'start' : '', shown && day === shown.to ? 'end' : '']
                  .filter(Boolean)
                  .join(' ');
                return (
                  <button
                    key={day}
                    type="button"
                    className={cls}
                    role="gridcell"
                    disabled={day > today}
                    aria-selected={inRange}
                    aria-label={dayLabel(day)}
                    onMouseEnter={() => anchor && setHover(day)}
                    onClick={() => pick(day)}
                  >
                    {+day.slice(8)}
                  </button>
                );
              })}
            </div>
            <p className="period__sum">{summary}</p>
            {/* 「오늘」은 왼쪽 빠른 선택에 있으므로 달력 아래에는 적용만 (광고 인사이트 달력의 「오늘」 단추는 겹쳐서 뺌) */}
            <div className="period__actions">
              <Button type="button" size="sm" variant="primary" disabled={!draft} onClick={() => draft && apply({ range: draft })}>
                적용
              </Button>
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
