// 머리 오른쪽 프로필 — 광고 인사이트(HeaderProfileMenu·Avatar)와 같은 모양: 로그인하면 동그라미 사진(없으면 이름 첫 글자),
// 누르면 내 정보(사진·이름·이메일) + 로그아웃 메뉴. 사진·이름은 같은 Supabase 계정의 user_metadata(광고 인사이트 "내 계정 설정")를 쓴다.
import { useEffect, useRef, useState } from 'react';

export interface ProfileUser {
  email: string;
  name?: string;
  avatarUrl?: string;
}

function Avatar({ user, size = 'sm' }: { user: ProfileUser; size?: 'sm' | 'lg' }) {
  const [broken, setBroken] = useState(false);
  const initial = (user.name?.trim() || user.email || 'P')[0].toUpperCase();
  return (
    <span className={`pf-avatar${size === 'lg' ? ' pf-avatar--lg' : ''}`} aria-hidden="true">
      {user.avatarUrl && !broken ? <img src={user.avatarUrl} alt="" onError={() => setBroken(true)} /> : initial}
    </span>
  );
}

export default function ProfileMenu({ user, onLogout }: { user: ProfileUser; onLogout?: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // 바깥을 누르거나 Esc 로 닫기
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  return (
    <div ref={box} className="profile">
      <button
        type="button"
        className="profile__btn"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="사용자 프로필"
        title={user.name ? `${user.name} (${user.email})` : user.email}
      >
        <Avatar user={user} />
      </button>
      {open && (
        <div role="menu" className="profile__pop" aria-label="계정 메뉴">
          <div className="profile__user">
            <Avatar user={user} size="lg" />
            <div className="profile__info">
              <b>{user.name || user.email.split('@')[0]}</b>
              <span>{user.email}</span>
            </div>
          </div>
          <a role="menuitem" className="profile__item" href="/ad-insight/" title="사진·이름은 광고 인사이트의 내 계정 설정에서 바꿉니다">
            계정 관리 (광고 인사이트)
          </a>
          {onLogout && (
            <button
              type="button"
              role="menuitem"
              className="profile__item profile__item--out"
              onClick={() => {
                setOpen(false);
                onLogout();
              }}
            >
              로그아웃
            </button>
          )}
        </div>
      )}
    </div>
  );
}
