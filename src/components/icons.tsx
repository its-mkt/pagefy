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

/** 그림 + 빗금 — 이미지 지우기 (변환 내역 「이미지 서버에서 지우기」) */
export function ImageOffIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 3l18 18M9 4h11v11M20 20H4V6M4 16l5-5 3 3M14 10h.01" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" />
    </svg>
  );
}

/** 연필 — 고치기 (변환 내역 「작업 정보 편집」) */
export function PencilIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

/** 더 보기 — 가로 점 세 개 (변환 내역 줄 끝 메뉴) */
export function MoreIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8h.01M8 8h.01M13 8h.01" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square" />
    </svg>
  );
}

/** 눈 — 미리보기 (결과 화면의 「에디터 미리보기」) */
export function EyeIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

/** 복제 — 겹친 두 장 + 더하기 (변환 내역의 「다른 판매처용 복제」) */
export function CopyIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 8V4h12v12h-4M4 8h12v12H4zM10 11v6M7 14h6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" />
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
