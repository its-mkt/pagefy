import type { HealthInfo } from '../../shared/types';
import { CLOUD } from '../lib/api';
import ProfileMenu, { type ProfileUser } from './ProfileMenu';

interface Props {
  health: HealthInfo | null;
  error: string | null;
  /** 로그인한 사용자 (배포 화면) — 있으면 오른쪽 끝에 동그라미 프로필 */
  user?: ProfileUser;
  onLogout?: () => void;
}

export default function Header({ health, error, user, onLogout }: Props) {
  const rulesLabel = CLOUD ? '규칙: 저장소 사본' : health?.rules.fallback ? '규칙: 로컬 사본' : '규칙: 공유 폴더 원본';
  return (
    <header className="header">
      <div className="header__title">
        <i className="header__mark" aria-hidden="true">
          {/* 통이미지 한 장을 HTML 블록 여러 개로 나눈다 */}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square">
            <rect x="4" y="3" width="16" height="18" />
            <path d="M4 9h16M4 15h16" />
          </svg>
        </i>
        <div>
          <h1>Pagefy</h1>
          <p>통이미지 디자인(PSD)을 팀 규칙(detail_to_markup.md)대로 HTML 마크업으로 바꿔 줍니다.</p>
        </div>
      </div>
      <div className="header__status">
        {error && <span className="badge badge--error">{error}</span>}
        {health && (
          <>
            {health.mock ? (
              <span className="badge badge--warn">MOCK 모드 (Claude 호출 안 함)</span>
            ) : health.hasKey ? (
              <span className="badge badge--ok">{health.model} · effort {health.effort}</span>
            ) : (
              <span className="badge badge--error">{CLOUD ? 'API 키 미등록 (Supabase 비밀값)' : 'API 키 없음 (.env)'}</span>
            )}
            <span className={`badge ${!CLOUD && health.rules.fallback ? 'badge--warn' : ''}`} title={health.rules.source}>
              {rulesLabel}
              {health.rules.updatedAt && ` · ${new Date(health.rules.updatedAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })} 수정`}
            </span>
          </>
        )}
        {user && <ProfileMenu user={user} onLogout={onLogout} />}
      </div>
    </header>
  );
}
