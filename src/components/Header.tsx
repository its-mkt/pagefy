import { useRef } from 'react';
import { Plus } from 'lucide-react';
import { Button } from './Button';
import type { HealthInfo } from '../../shared/types';
import { BUDGET_WARN_RATIO, type BudgetInfo } from '../../shared/ops';
import { CLOUD } from '../lib/api';
import ProfileMenu, { type ProfileUser } from './ProfileMenu';
import { Tip, TipWrap } from './ui';
import logo from '../assets/pagefy.svg';

/**
 * 화면 (주소 #jobs · #job · #tester · #help · #admin, 없으면 만들기).
 * job = 목록에서 연 작업 페이지 — 메뉴에 없는 별도 화면이라 어느 메뉴도 켜지지 않는다 (목록은 「변환 내역」 메뉴로)
 */
export type View = 'work' | 'jobs' | 'job' | 'tester' | 'help' | 'admin';

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
  /** 지금 화면과 바꾸기 — 있으면 메뉴(만들기·변환 내역·에디터 테스트·도움말·관리) */
  view?: View;
  onView?: (v: View) => void;
  /** 관리 메뉴를 보일지 (광고 인사이트 역할 admin) */
  showAdmin?: boolean;
  /** 이번 달 사용액이 상한의 80% 를 넘으면 관리 메뉴 옆에 점 */
  budgetAlert?: boolean;
}

export default function Header({ health, error, user, onLogout, onNewPsd, newPsdDisabled, onHome, homeBusy, view, onView, showAdmin, budgetAlert }: Props) {
  const pick = useRef<HTMLInputElement>(null);
  const rulesLabel = CLOUD ? '규칙: 저장소 사본' : health?.rules.fallback ? '규칙: 로컬 사본' : '규칙: 공유 폴더 원본';
  return (
    <header className="header">
      {/* 첫 화면으로 — 새 탭 열기(가운데 클릭 등)는 주소로, 그냥 누르면 새로고침 없이 화면만 바꾼다 */}
      <Tip content={homeBusy ? '만드는 중에는 첫 화면으로 갈 수 없습니다' : '첫 화면으로'}>
      <a
        className={`header__title ${homeBusy ? 'is-busy' : ''}`}
        href={window.location.pathname}
        aria-disabled={homeBusy || undefined}
        onClick={(e) => {
          if (!onHome || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          onHome();
        }}
      >
        {/* 파비콘과 같은 로고 (its.itket.com icons/pagefy.svg — 보라 네모 + 변환 화살표) */}
        <img className="header__mark" src={logo} alt="" aria-hidden="true" />
        {/* 로고 + 이름만 (설명 문구는 뺌 — 2026-11-26 사용자). 무엇을 하는 곳인지는 첫 화면·도움말에 있다 */}
        <h1>Pagefy</h1>
      </a>
      </Tip>
      {/* 메뉴는 몇 개뿐이라 사이드바 대신 머리 안 탭으로 (결과 미리보기·변환 내역 거르기에 화면 폭을 다 쓰려고) */}
      {view && onView && (
        <nav className="header__nav" aria-label="메뉴">
          {(
            [
              // 메뉴 이름 (2026-11-26 사용자) — 변환 · 변환 이력 · 쇼핑몰 미리보기(옛 에디터 테스트) · 도움말.
              // 관리자는 관리자만 가끔 쓰는 화면이라 프로필 드롭다운으로 옮겼다 (2026-11-26 사용자)
              ['work', '변환', ''],
              ['jobs', '변환 이력', '#jobs'],
              ['tester', '쇼핑몰 미리보기', '#tester'],
              ['help', '도움말', '#help'],
            ] as const
          ).map(([v, label, hash]) => (
            <a
              key={v}
              href={`${window.location.pathname}${hash}`}
              // 작업 페이지(job)는 메뉴에 없는 화면 — 어느 메뉴도 켜지 않는다. 목록은 「변환 내역」 메뉴를 눌러 본다 (2026-11-26 사용자)
              className={`header__tab${view === v ? ' is-on' : ''}`}
              aria-current={view === v ? 'page' : undefined}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                // 「변환」은 로고와 같다 (2026-11-27 사용자): 다른 화면이면 변환 화면으로 돌아오고, 변환 화면에서 누르면 첫 화면(PSD 올리기 + 최근 작업).
                // 만드는 중·읽는 중에는 goHome 이 그대로 둔다
                if (v === 'work' && onHome) onHome();
                else onView(v);
              }}
            >
              {label}
            </a>
          ))}
        </nav>
      )}
      <div className="header__status">
        {error && <span className="badge badge--error">{error}</span>}
        {/* 담당자에게는 문제가 있을 때만 눈에 띄게. 평소에는 규칙 수정 시각만 흐리게 (모델 등 자세한 값은 마우스를 올리면) */}
        {health?.mock && <span className="badge badge--warn">MOCK 모드 (Claude 호출 안 함)</span>}
        {health && !health.mock && !health.hasKey && <span className="badge badge--error">{CLOUD ? "API 키 미등록 (Supabase 비밀값)" : "API 키 없음 (.env)"}</span>}
        {health && !CLOUD && health.rules.fallback && <Tip content={health.rules.source}><span className="badge badge--warn" tabIndex={0}>규칙: 공유 폴더 접근 불가 → 로컬 사본</span></Tip>}
        {/* 쓰는 Claude 모델·생각 깊이(effort)와 이번 달 남은 한도를 한 칩에 (2026-11-27 사용자: 따로 두지 말고 합치고 글자 강약으로만 구분).
            남은 한도 = Pagefy 월 상한 대비 이번 달 사용액 (Anthropic 계정 잔액이 아님). 규칙 출처·수정 시각·사용액은 마우스를 올리면 */}
        {health && <StatusChip health={health} rulesLabel={rulesLabel} />}
        {/* 스크롤해도 늘 보이는 머리에 둔다 — 긴 결과를 보다가도 바로 다음 PSD 로 */}
        {onNewPsd && (
          <>
            <TipWrap disabled={newPsdDisabled} content={newPsdDisabled ? '만드는 중에는 다른 PSD 를 열 수 없습니다' : '다른 PSD 를 골라 새로 마크업합니다 — 화면에 끌어다 놓아도 됩니다 (지금 작업은 「변환 이력」에 저장돼 있음)'}>
            <Button type="button" size="sm" className="header__new" disabled={newPsdDisabled} onClick={() => pick.current?.click()}>
              <Plus />
              새 PSD
            </Button>
            </TipWrap>
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
        {user && (
          <ProfileMenu
            user={user}
            onLogout={onLogout}
            // 관리자 화면 — 관리자에게만. 이번 달 사용액 경고 점은 프로필 사진과 메뉴 항목에 붙는다
            admin={showAdmin && onView ? { onOpen: () => onView('admin'), active: view === 'admin', alert: !!budgetAlert } : undefined}
          />
        )}
      </div>
    </header>
  );
}

/** claude-opus-5-5 → Opus 5.5, claude-fable-5-2 → Fable 5.2 (모르는 모양이면 그대로) */
function modelLabel(id: string) {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?$/.exec(id);
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}` : id;
}

const usd = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: n < 100 ? 2 : 0 })}`;

/** 이번 달 남은 한도 설명 (칩 툴팁) */
const budgetTip = (b: BudgetInfo) =>
  `${b.month} 사용 ${usd(b.spentUsd)} / 월 상한 ${usd(b.capUsd)}${b.unblocked ? ' · 관리자가 이번 달 상한을 풀었음' : ''}\nPagefy 에서 쓴 Claude 비용 기준 (Anthropic 계정 잔액과는 다름)`;

/**
 * 모델 · 남은 한도 칩 — 라벨은 흐리게, 값은 진하게, 사이는 얇은 세로선.
 * 한도 80% 를 넘으면 칩 전체를 주의(호박), 다 쓰면(막힘) 빨강. MOCK·키 없음이면 모델은 빼고 한도만 (그때는 따로 경고 배지가 뜬다)
 */
function StatusChip({ health, rulesLabel }: { health: HealthInfo; rulesLabel: string }) {
  const showModel = !health.mock && health.hasKey;
  const b = health.budget;
  if (!showModel && !b) return null;
  const effort = health.planEffort ?? health.effort;
  const left = b ? Math.max(0, b.capUsd - b.spentUsd) : 0;
  const ratio = b && b.capUsd > 0 ? b.spentUsd / b.capUsd : 1;
  const tone = !b ? '' : b.blocked ? 'badge--error' : ratio >= BUDGET_WARN_RATIO ? 'badge--warn' : '';
  const updated = health.rules.updatedAt ? ` · ${new Date(health.rules.updatedAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })} 수정본` : '';
  const tip = [showModel && `구조 계획: ${health.model} · effort ${effort}\n${rulesLabel} (${health.rules.source})${updated}`, b && budgetTip(b)].filter(Boolean).join('\n\n');
  return (
    <Tip content={tip}>
      <span className={`badge header__info ${tone}`} tabIndex={0}>
        {showModel && (
          <span>
            <span className="header__info-k">Claude</span> <b className="header__info-v">{modelLabel(health.model)}</b> <span className="header__info-k">· {effort}</span>
          </span>
        )}
        {showModel && b && <span className="header__info-sep" aria-hidden="true" />}
        {b &&
          (b.blocked ? (
            <span>
              <b className="header__info-v">한도 소진</b> <span className="header__info-k">· {usd(b.spentUsd)} / {usd(b.capUsd)}</span>
            </span>
          ) : (
            <span>
              <span className="header__info-k">남은 한도</span> <b className="header__info-v">{usd(left)}</b> <span className="header__info-k">/ {usd(b.capUsd)}</span>
            </span>
          ))}
      </span>
    </Tip>
  );
}
