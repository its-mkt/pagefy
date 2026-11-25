// 공용 선택 상자 — Radix Select (radix-ui) 위에 우리 모양(.sel, 모서리 0)을 입힌다
// - 단추를 누르면 아래(자리가 모자라면 위)로 목록이 열린다. 그룹 제목(고도몰·오픈마켓 등)과 고른 항목 체크 표시
// - 키보드·글자로 찾기·접근성(listbox/option)·바깥 클릭 닫기·포커스 관리는 Radix 가 맡는다
// - Radix 값은 문자열이라 숫자 값(배율 등)은 String 으로 넘기고 고를 때 원래 값으로 되돌린다 (빈 문자열은 __empty__)
import type { ReactNode } from 'react';
import { Select as S } from 'radix-ui';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';

export interface SelectOption<V extends string | number> {
  value: V;
  label: ReactNode;
  /** 글자로 찾기·접근성 이름용 (label 이 글자가 아닐 때) */
  text?: string;
  disabled?: boolean;
}
export interface SelectGroup<V extends string | number> {
  group: string;
  options: SelectOption<V>[];
}
type Item<V extends string | number> = SelectOption<V> | SelectGroup<V>;

interface Props<V extends string | number> {
  value: V;
  onChange: (v: V) => void;
  options: Item<V>[];
  'aria-label': string;
  /** sm = 높이 2rem (도구 줄), md = 2.25rem (입력 칸과 같은 높이) */
  size?: 'sm' | 'md';
  disabled?: boolean;
  className?: string;
  title?: string;
}

const isGroup = <V extends string | number>(i: Item<V>): i is SelectGroup<V> => 'group' in i;
/** Radix 는 빈 문자열 값을 받지 않는다(지움 용도로 예약) → 「전체」 같은 빈 값은 다른 키로 바꿔 넘긴다 */
const keyOf = (v: string | number) => (v === '' ? '__empty__' : String(v));
const textOf = <V extends string | number>(o: SelectOption<V>) => o.text ?? (typeof o.label === 'string' || typeof o.label === 'number' ? String(o.label) : String(o.value));


export default function Select<V extends string | number>({ value, onChange, options, size = 'md', disabled, className, title, ...rest }: Props<V>) {
  const flat = options.flatMap((i) => (isGroup(i) ? i.options : [i]));
  const current = flat.find((o) => o.value === value);
  const byKey = new Map(flat.map((o) => [keyOf(o.value), o.value]));

  const item = (o: SelectOption<V>) => (
    <S.Item key={keyOf(o.value)} value={keyOf(o.value)} disabled={o.disabled} textValue={textOf(o)} className="sel__opt">
      <S.ItemText>{o.label}</S.ItemText>
      <S.ItemIndicator className="sel__check">
        <Check />
      </S.ItemIndicator>
    </S.Item>
  );

  return (
    <S.Root
      value={keyOf(value)}
      onValueChange={(k) => {
        const v = byKey.get(k);
        if (v !== undefined && v !== value) onChange(v);
      }}
      disabled={disabled}
    >
      <S.Trigger className={`sel sel--${size}${className ? ` ${className}` : ''}`} aria-label={`${rest['aria-label']}: ${current ? textOf(current) : ''}`} title={title}>
        <span className="sel__value">
          <S.Value />
        </span>
        <S.Icon className="sel__chev">
          <ChevronDown />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content className="sel__list" position="popper" sideOffset={4} collisionPadding={8}>
          <S.ScrollUpButton className="sel__scroll">
            <ChevronUp />
          </S.ScrollUpButton>
          <S.Viewport className="sel__viewport">
            {options.map((it, gi) =>
              isGroup(it) ? (
                <S.Group key={`g-${it.group}`} className="sel__group">
                  {gi > 0 && <S.Separator className="sel__sep" />}
                  <S.Label className="sel__ghead">{it.group}</S.Label>
                  {it.options.map(item)}
                </S.Group>
              ) : (
                item(it)
              ),
            )}
          </S.Viewport>
          <S.ScrollDownButton className="sel__scroll">
            <ChevronDown />
          </S.ScrollDownButton>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}
