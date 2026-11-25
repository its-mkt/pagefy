import type { ButtonHTMLAttributes } from 'react';

/**
 * 공용 버튼. 기존 클래스 조합을 props 로 옮긴 것 (화면 모양은 그대로)
 * - variant: primary(강조) · soft(연한 면) · danger(삭제 확인 상태)
 * - size: sm 작은 버튼 · icon 아이콘만 있는 버튼
 * - className: 이 버튼만의 추가 클래스 (예: header__new)
 */
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'soft' | 'danger';
  size?: 'sm';
  icon?: boolean;
  className?: string;
};

export function Button({ variant, size, icon, className, ...rest }: ButtonProps) {
  const cls = [
    'btn',
    size === 'sm' && 'btn--sm',
    variant === 'primary' && 'btn--primary',
    variant === 'soft' && 'btn--soft',
    variant === 'danger' && 'is-danger',
    icon && 'btn--icon',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return <button className={cls} {...rest} />;
}
