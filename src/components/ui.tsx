// 공용 화면 객체 — Radix Primitives(radix-ui) 위에 우리 모양(모서리 0 · 토큰 색)을 입힌다. 스타일은 styles/_radix.scss
// 동작(키보드·포커스·접근성 속성·바깥 클릭)은 Radix 가 맡고, 여기서는 모양과 쓰기 쉬운 props 만 정한다
import type { ReactNode } from 'react';
import { Checkbox, Collapsible, ToggleGroup, Tooltip } from 'radix-ui';
import { Check, ChevronRight } from 'lucide-react';

/**
 * 접어 두는 영역 (예전 <details>/<summary>). className 은 바깥 묶음에 그대로 붙어 기존 여백 규칙(.fold · .more · .raw …)을 쓴다.
 * 제목 단추는 .sum, 펼친 내용은 .sum-body
 */
export function Fold({ summary, className, defaultOpen, children }: { summary: ReactNode; className?: string; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <Collapsible.Root className={className} defaultOpen={defaultOpen}>
      <Collapsible.Trigger className="sum">
        <ChevronRight className="sum__chev" aria-hidden="true" />
        <span>{summary}</span>
      </Collapsible.Trigger>
      <Collapsible.Content className="sum-body">{children}</Collapsible.Content>
    </Collapsible.Root>
  );
}

/** 글자가 붙은 체크박스 (label 전체를 눌러도 바뀐다) */
export function CheckField({ checked, onChange, children, className, disabled }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; className?: string; disabled?: boolean }) {
  return (
    <label className={`ck${className ? ` ${className}` : ''}${disabled ? ' is-off' : ''}`}>
      <Checkbox.Root className="ck__box" checked={checked} onCheckedChange={(v) => onChange(v === true)} disabled={disabled}>
        <Checkbox.Indicator className="ck__mark">
          <Check />
        </Checkbox.Indicator>
      </Checkbox.Root>
      <span className="ck__text">{children}</span>
    </label>
  );
}

/**
 * 마우스를 올리거나 키보드로 초점을 주면 뜨는 설명 (예전 title 속성). children 은 초점을 받을 수 있는 요소 하나여야 한다 —
 * 단추·링크가 아니면 tabIndex={0} 을 준다. 줄바꿈(\n)은 그대로 보인다
 */
export function Tip({ content, children, side = 'bottom' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  if (!content) return <>{children}</>;
  return (
    <Tooltip.Provider delayDuration={250} skipDelayDuration={150}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="tip" side={side} sideOffset={6} collisionPadding={8}>
            {content}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

/**
 * 비활성일 수 있는 단추에 붙이는 설명. 비활성(disabled) 단추는 마우스·초점 이벤트를 받지 않아 Tip 이 뜨지 않는다 →
 * 바깥 span(.tipwrap)이 대신 받는다. 비활성일 때만 span 에 초점이 가게 해 키보드로도 이유를 볼 수 있다.
 * 꼭 알아야 하는 이유(만들기 막힘 등)는 이것만 쓰지 말고 단추 옆에 글로도 보인다
 */
export function TipWrap({ content, disabled, children, side }: { content: ReactNode; disabled?: boolean; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  if (!content) return <>{children}</>;
  return (
    <Tip content={content} side={side}>
      <span className="tipwrap" tabIndex={disabled ? 0 : undefined}>
        {children}
      </span>
    </Tip>
  );
}

/** 몇 개 중 하나 고르기 단추 묶음 (.seg) — 고른 것을 다시 눌러도 꺼지지 않는다. 화살표 키로 옮겨 다닌다 */
export function Seg<V extends string>({ value, onChange, items, className, ...rest }: { value: V; onChange: (v: V) => void; items: { value: V; label: ReactNode }[]; className?: string; 'aria-label': string }) {
  return (
    <ToggleGroup.Root
      type="single"
      className={`seg${className ? ` ${className}` : ''}`}
      value={value}
      onValueChange={(v) => v && v !== value && onChange(v as V)}
      aria-label={rest['aria-label']}
    >
      {items.map((it) => (
        <ToggleGroup.Item key={it.value} value={it.value} className="seg__item">
          {it.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
