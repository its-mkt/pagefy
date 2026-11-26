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

/** 관리자 메뉴 (관리자에게만) — active = 지금 관리자 화면, alert = 이번 달 사용액이 상한의 80% 넘음 */
interface AdminItem {
  onOpen: () => void;
  active: boolean;
  alert: boolean;
}

const ALERT_TEXT = '이번 달 사용액이 상한의 80% 를 넘었습니다';

export default function ProfileMenu({ user, onLogout, admin }: { user: ProfileUser; onLogout?: () => void; admin?: AdminItem }) {
  // 열기·닫기·바깥 클릭·Esc·화살표 키 이동·포커스 되돌리기는 Radix DropdownMenu 가 맡는다
  return (
    <DropdownMenu.Root modal={false}>
      <div className="profile">
        <DropdownMenu.Trigger className="profile__btn" aria-label={admin?.alert ? `사용자 프로필 — ${ALERT_TEXT}` : '사용자 프로필'} title={user.name ? `${user.name} (${user.email})` : user.email}>
          <Avatar user={user} />
        </DropdownMenu.Trigger>
        {/* 관리자 메뉴가 메뉴 줄에서 여기로 옮겨 와서, 사용액 경고 점도 사진에 붙인다 */}
        {admin?.alert && <span className="header__dot profile__dot" aria-hidden="true" />}
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
          {admin && (
            <DropdownMenu.Item className={`profile__item${admin.active ? ' is-on' : ''}`} onSelect={admin.onOpen} aria-current={admin.active ? 'page' : undefined}>
              관리자
              {admin.alert && <span className="header__dot profile__item-dot" role="img" aria-label={ALERT_TEXT} title={ALERT_TEXT} />}
            </DropdownMenu.Item>
          )}
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
