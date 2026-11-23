import { useRef } from 'react';
import type { HealthInfo } from '../../shared/types';
import { CLOUD } from '../lib/api';
import ProfileMenu, { type ProfileUser } from './ProfileMenu';
import logo from '../assets/pagefy.svg';

interface Props {
  health: HealthInfo | null;
  error: string | null;
  /** 로그인한 사용자 (배포 화면) — 있으면 오른쪽 끝에 동그라미 프로필 */
  user?: ProfileUser;
  onLogout?: () => void;
  /** 새 PSD 고르기 — 있으면 「새 PSD」 버튼 (로그인·권한 확인 뒤에만 넘긴다) */
  onNewPsd?: (f: File) => void;
  /** 생성 중·읽는 중엔 막는다 (생성 중에 다른 PSD 를 열면 만들던 작업이 멈춤) */
  newPsdDisabled?: boolean;
  /** Pagefy(제목)를 누르면 첫 화면으로 */
  onHome?: () => void;
  /** 생성 중·읽는 중이면 첫 화면으로 가지 않는다 (작업을 잃지 않게) */
  homeBusy?: boolean;
}

export default function Header({ health, error, user, onLogout, onNewPsd, newPsdDisabled, onHome, homeBusy }: Props) {
  const pick = useRef<HTMLInputElement>(null);
  const rulesLabel = CLOUD ? '규칙: 저장소 사본' : health?.rules.fallback ? '규칙: 로컬 사본' : '규칙: 공유 폴더 원본';
  return (
    <header className="header">
      {/* 첫 화면으로 — 새 탭 열기(가운데 클릭 등)는 주소로, 그냥 누르면 새로고침 없이 화면만 바꾼다 */}
      <a
        className={`header__title ${homeBusy ? 'is-busy' : ''}`}
        href={window.location.pathname}
        title={homeBusy ? '만드는 중에는 첫 화면으로 갈 수 없습니다' : '첫 화면으로'}
        aria-disabled={homeBusy || undefined}
        onClick={(e) => {
          if (!onHome || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          onHome();
        }}
      >
        {/* 파비콘과 같은 로고 (its.itket.com icons/pagefy.svg — 보라 네모 + 변환 화살표) */}
        <img className="header__mark" src={logo} alt="" aria-hidden="true" />
        <div>
          <h1>Pagefy</h1>
          <p>상세페이지 PSD 를 쇼핑몰에 붙여넣을 HTML 로 바꿔 줍니다.</p>
        </div>
      </a>
      <div className="header__status">
        {error && <span className="badge badge--error">{error}</span>}
        {/* 담당자에게는 문제가 있을 때만 눈에 띄게. 평소에는 규칙 수정 시각만 흐리게 (모델 등 자세한 값은 마우스를 올리면) */}
        {health?.mock && <span className="badge badge--warn">MOCK 모드 (Claude 호출 안 함)</span>}
        {health && !health.mock && !health.hasKey && <span className="badge badge--error">{CLOUD ? "API 키 미등록 (Supabase 비밀값)" : "API 키 없음 (.env)"}</span>}
        {health && !CLOUD && health.rules.fallback && <span className="badge badge--warn" title={health.rules.source}>규칙: 공유 폴더 접근 불가 → 로컬 사본</span>}
        {health && (CLOUD || !health.rules.fallback) && (
          <span className="header__meta" title={`${rulesLabel} (${health.rules.source}) · ${health.model} · effort ${health.effort}`}>
            {health.rules.updatedAt ? `규칙 ${new Date(health.rules.updatedAt).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })} 수정본` : "규칙 적용 중"}
          </span>
        )}
        {/* 스크롤해도 늘 보이는 머리에 둔다 — 긴 결과를 보다가도 바로 다음 PSD 로 */}
        {onNewPsd && (
          <>
            <button
              type="button"
              className="btn btn--sm header__new"
              disabled={newPsdDisabled}
              title={newPsdDisabled ? '만드는 중에는 다른 PSD 를 열 수 없습니다' : '다른 PSD 를 골라 새로 마크업합니다 — 화면에 끌어다 놓아도 됩니다 (지금 작업은 「최근 작업」에 저장돼 있음)'}
              onClick={() => pick.current?.click()}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
              </svg>
              새 PSD
            </button>
            <input
              ref={pick}
              type="file"
              accept=".psd"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) onNewPsd(f);
              }}
            />
          </>
        )}
        {user && <ProfileMenu user={user} onLogout={onLogout} />}
      </div>
    </header>
  );
}
