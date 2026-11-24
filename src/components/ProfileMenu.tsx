// 머리 오른쪽 프로필 — 광고 인사이트(HeaderProfileMenu·Avatar)와 같은 모양: 로그인하면 동그라미 사진(없으면 이름 첫 글자),
// 누르면 내 정보(사진·이름·이메일) + 로그아웃 메뉴. 사진·이름은 같은 Supabase 계정의 user_metadata(광고 인사이트 "내 계정 설정")를 쓴다.
import { useState } from 'react';
import { DropdownMenu } from 'radix-ui';

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
  // 열기·닫기·바깥 클릭·Esc·화살표 키 이동·포커스 되돌리기는 Radix DropdownMenu 가 맡는다
  return (
    <DropdownMenu.Root modal={false}>
      <div className="profile">
        <DropdownMenu.Trigger className="profile__btn" aria-label="사용자 프로필" title={user.name ? `${user.name} (${user.email})` : user.email}>
          <Avatar user={user} />
        </DropdownMenu.Trigger>
      </div>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="profile__pop" align="end" sideOffset={8} collisionPadding={8} aria-label="계정 메뉴">
          <div className="profile__user">
            <Avatar user={user} size="lg" />
            <div className="profile__info">
              <b>{user.name || user.email.split('@')[0]}</b>
              <span>{user.email}</span>
            </div>
          </div>
          <DropdownMenu.Separator className="profile__sep" />
          <DropdownMenu.Item asChild className="profile__item">
            <a href="/ad-insight/" title="사진·이름은 광고 인사이트의 내 계정 설정에서 바꿉니다">
              계정 관리 (광고 인사이트)
            </a>
          </DropdownMenu.Item>
          {onLogout && (
            <>
              <DropdownMenu.Separator className="profile__sep" />
              <DropdownMenu.Item className="profile__item profile__item--out" onSelect={() => onLogout()}>
                로그아웃
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
