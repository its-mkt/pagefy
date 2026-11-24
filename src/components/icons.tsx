// 공용 아이콘 — 같은 그림을 화면마다 따로 그리지 않게 한곳에 모은다
// 모두 글자색(currentColor)을 따르고 화면 읽기 프로그램에는 숨긴다(aria-hidden). 크기는 쓰는 곳의 class 로 정한다

interface IconProps {
  className?: string;
}

/** 꺾쇠 — right: 접기 제목(펼치면 돌려 씀), down: 선택 상자 */
export function Chevron({ className, dir = 'right' }: IconProps & { dir?: 'right' | 'down' }) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <path d={dir === 'down' ? 'M4 6l4 4 4-4' : 'M6 4l4 4-4 4'} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" />
    </svg>
  );
}

/** 체크 표시 (체크박스·완료 단계) */
export function CheckIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
    </svg>
  );
}

/** 올리기 (PSD 놓는 칸·화면 전체 끌어다 놓기 안내판) */
export function UploadIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" />
    </svg>
  );
}

/** 휴지통 */
export function TrashIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" />
    </svg>
  );
}

/** 자물쇠 (로그인·권한 안내) */
export function LockIcon({ className }: IconProps) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
