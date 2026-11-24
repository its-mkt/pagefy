import { useEffect, useRef, useState } from 'react';
import { listInfo, TRASH_DAYS, type Job, type JobState } from '../lib/jobs';
import { fmtBytes } from '../lib/util';
import { SHARED_ROOT } from '../lib/sharedFolder';

/** 다른 PC 에서 열 PSD 가 있는 곳 (「공유 폴더에 저장」이 PSD 를 넣는 폴더) */
const PSD_DIR = String.raw`${SHARED_ROOT}\채널\제품명`;

interface Props {
  jobs: Job[];
  currentId: string | null;
  /** 생성 중엔 다른 작업을 열거나 지우지 않는다 */
  busy: boolean;
  /** 로그인한 계정에 저장 중이면 true (아니면 이 브라우저에만) */
  account: boolean;
  /** 더 오래된 작업이 남아 있음 */
  more: boolean;
  /** 목록을 읽는 중 (처음 열 때·더 보기) */
  loading: boolean;
  onMore: () => void;
  /** file: 이 브라우저에 PSD 원본이 없을 때 사용자가 고른 PSD */
  onOpen: (job: Job, file?: File) => void;
  onRemove: (id: string) => void;
  /** PSD 원본 없이 저장된 결과(HTML) 보기 */
  onView: (job: Job) => void;
  /** 휴지통 목록 — null 이면 닫힘(최근 작업을 보여 줌) */
  trash: Job[] | null;
  /** 휴지통 개수 (머리의 「휴지통 n」) */
  trashN: number;
  trashLoading: boolean;
  onTrashOpen: () => void;
  onTrashClose: () => void;
  onRestore: (id: string) => void;
  /** 영구 삭제 */
  onPurge: (id: string) => void;
}

const STATE: Record<JobState, { label: string; tone: string }> = {
  ready: { label: '준비', tone: '' },
  running: { label: '만드는 중', tone: 'acc' },
  stopped: { label: '중단됨', tone: 'warn' },
  error: { label: '오류', tone: 'error' },
  done: { label: '완료', tone: 'ok' },
};

/** 스켈레톤 줄의 제목 자리 — 길이를 조금씩 달리해 실제 목록처럼 보이게 */
const SKEL_NAMES = ['상세페이지 제품명 자리', '제품명 자리 표시', '상세페이지 제품 이름 자리 표시'];

function ago(t: number) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}시간 전`;
  return new Date(t).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
}

function progress(j: Job) {
  const i = listInfo(j);
  if (!i.secs) return j.state === 'ready' ? '만들기 전' : '계획 전';
  // 코드 생성 방식은 섹션을 따로 요청하지 않는다 (계획만 있으면 마크업을 다시 만들 수 있음)
  if (i.engine === 'code') return `섹션 ${i.secs}개`;
  return `섹션 ${i.done}/${i.secs}`;
}

/** 휴지통에서 자동 삭제까지 남은 날 */
function daysLeft(deletedAt: number) {
  return Math.max(0, Math.ceil((deletedAt + TRASH_DAYS * 86_400_000 - Date.now()) / 86_400_000));
}

/** 작업 목록 — 계정(또는 이 브라우저)에 저장돼 새로고침·다른 PC 에서도 이어서 볼 수 있다 */
export default function JobsPanel(props: Props) {
  const { jobs, currentId, busy, account, more, loading, onMore, onOpen, onRemove, onView, trash, trashN, onTrashOpen, onRestore } = props;
  // PSD 원본이 이 브라우저에 없는 작업: 파일 고르기 창을 띄워 같은 PSD 를 받는다
  const picker = useRef<HTMLInputElement>(null);
  const [pickFor, setPickFor] = useState<Job | null>(null);
  // 지운 직후 「되돌리기」 알림 — 휴지통을 찾아가지 않아도 바로 되돌린다 (잘못 누른 경우가 많음)
  const [removed, setRemoved] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    if (!removed) return;
    const t = window.setTimeout(() => setRemoved(null), 10_000);
    return () => window.clearTimeout(t);
  }, [removed]);
  const remove = (j: Job) => {
    onRemove(j.id);
    setRemoved({ id: j.id, name: j.settings.productName || j.fileName });
  };
  if (trash) return <TrashView {...props} trash={trash} />;
  if (!jobs.length && !loading && !trashN) return null;

  return (
    <section className="panel jobs">
      <div className="jobs__head">
        <h2 className="panel__title">
          최근 작업 <small>{account ? '내 계정에 저장 (다른 PC에서도 보임) · PSD 원본은 이 PC에만' : '이 브라우저에만 저장 · 최근 8개'}</small>
          {loading && jobs.length > 0 && (
            <span className="jobs__loading" role="status">
              <i className="jobs__spin" aria-hidden="true" /> 불러오는 중…
            </span>
          )}
        </h2>
        {trashN > 0 && (
          <button type="button" className="btn btn--sm btn--ghost jobs__trash" onClick={onTrashOpen} title={`지운 작업 — ${TRASH_DAYS}일 안에 복원할 수 있습니다`}>
            <TrashIcon /> 휴지통 {trashN}
          </button>
        )}
      </div>
      {/* 목록은 계정에 저장돼 어느 PC 에서나 보이지만 PSD 원본은 만든 PC 에만 있다 → 다른 PC 에선 공유 폴더의 PSD 로 연다 */}
      {account && jobs.length > 0 && (
        <p className="jobs__guide">
          <b>다른 PC에서 만든 작업 열기</b>
          <span>
            「PSD 고르기」를 누르고 공유 폴더 <code>{PSD_DIR}</code> 안의 같은 PSD를 고르면 이어서 열립니다.
            만든 PC에서 결과 화면의 「공유 폴더에 저장」을 눌러 두면 PSD가 그 폴더에 들어갑니다.
          </span>
        </p>
      )}
      {removed && (
        <p className="jobs__undo" role="status">
          <span>
            「{removed.name}」을(를) 휴지통으로 옮겼습니다 ({TRASH_DAYS}일 안에 복원 가능).
          </span>
          <button
            type="button"
            className="btn btn--sm"
            disabled={busy}
            onClick={() => {
              onRestore(removed.id);
              setRemoved(null);
            }}
          >
            되돌리기
          </button>
          <button type="button" className="jobs__undo-x" aria-label="알림 닫기" onClick={() => setRemoved(null)}>
            ×
          </button>
        </p>
      )}
      {!jobs.length && !loading && <p className="hint jobs__empty">최근 작업이 없습니다.</p>}
      {loading && !jobs.length && (
        <ul className="jobs__list" role="status" aria-label="작업 목록 불러오는 중">
          {[0, 1, 2].map((i) => (
            // 실제 줄과 같은 칸·글자·버튼을 그대로 쓰고 글자만 감춘다 → 높이·여백·칸 너비가 실제 목록과 같다
            <li key={i} className="jobs__row jobs__row--skel" aria-hidden="true">
              <span className="jobs__name">
                <b>
                  <span className="skel">{SKEL_NAMES[i]}</span>
                </b>
                <small>
                  <span className="skel">{SKEL_NAMES[i]}.psd · 000.00MB</span>
                </small>
              </span>
              <span className="badge skel">완료</span>
              <span className="jobs__prog">
                <span className="skel">섹션 00개</span>
              </span>
              <span className="jobs__time">
                <span className="skel">00분 전</span>
              </span>
              <span className="jobs__acts">
                <span className="btn btn--sm skel">열기</span>
                <span className="btn btn--sm btn--ghost skel">지우기</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <ul className="jobs__list" hidden={!jobs.length}>
        {jobs.map((j) => {
          const st = STATE[j.state];
          const cur = j.id === currentId;
          return (
            <li key={j.id} className={`jobs__row ${cur ? 'is-cur' : ''}`}>
              <span className="jobs__name" title={j.error}>
                <b>{j.settings.productName || j.fileName}</b>
                <small>
                  {j.fileName} · {fmtBytes(j.fileSize)}
                  {j.noFile ? ' · 이 PC에 PSD 없음' : ''}
                </small>
              </span>
              <span className={`badge ${st.tone ? `badge--${st.tone}` : ''}`}>{st.label}</span>
              <span className="jobs__prog">{progress(j)}</span>
              <span className="jobs__time">{ago(j.updatedAt)}</span>
              <span className="jobs__acts">
                {cur ? (
                  <span className="jobs__cur">열려 있음</span>
                ) : (
                  j.noFile ? (
                    <>
                    {listInfo(j).html && (
                      <button className="btn btn--sm" disabled={busy} title="PSD 원본 없이 저장된 HTML을 봅니다." onClick={() => onView(j)}>
                        결과 보기
                      </button>
                    )}
                    <button
                      className="btn btn--sm"
                      disabled={busy}
                      title={`이 PC 브라우저에 PSD 원본이 없습니다. 공유 폴더(${PSD_DIR})의 같은 PSD를 고르면 이어서 열립니다.`}
                      onClick={() => {
                        setPickFor(j);
                        picker.current?.click();
                      }}
                    >
                      PSD 고르기
                    </button>
                    </>
                  ) : (
                    <button className="btn btn--sm" disabled={busy} onClick={() => onOpen(j)}>
                      열기
                    </button>
                  )
                )}
                {/* 휴지통으로 옮기기만 하므로(기간 안에 복원 가능) 한 번에 누르면 된다 */}
                <button className="btn btn--sm btn--ghost" disabled={busy && cur} title={`휴지통으로 옮깁니다 (${TRASH_DAYS}일 안에 복원 가능)`} onClick={() => remove(j)}>
                  지우기
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      {more && (
        <div className="jobs__more">
          <button className="btn btn--sm btn--ghost" disabled={loading} onClick={onMore}>
            {loading ? '불러오는 중…' : '더 보기'}
          </button>
        </div>
      )}
      <input
        ref={picker}
        type="file"
        accept=".psd"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f && pickFor) onOpen(pickFor, f);
          setPickFor(null);
        }}
      />
    </section>
  );
}

function TrashIcon() {
  return (
    <svg className="jobs__ico" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" />
    </svg>
  );
}

/** 휴지통 — 최근 작업 자리를 바꿔 보여 준다. 복원 / 영구 삭제(두 번 눌러 확정) */
function TrashView({ trash, trashLoading, busy, onTrashClose, onRestore, onPurge }: Props & { trash: Job[] }) {
  const [armed, setArmed] = useState<string | null>(null);
  return (
    <section className="panel jobs jobs--trash">
      <div className="jobs__head">
        <h2 className="panel__title">
          <TrashIcon /> 휴지통 <small>{TRASH_DAYS}일 지나면 자동으로 영구 삭제됩니다</small>
          {trashLoading && (
            <span className="jobs__loading" role="status">
              <i className="jobs__spin" aria-hidden="true" /> 불러오는 중…
            </span>
          )}
        </h2>
        <button type="button" className="btn btn--sm btn--ghost" onClick={onTrashClose}>
          ← 최근 작업
        </button>
      </div>
      {!trash.length && !trashLoading && <p className="hint jobs__empty">휴지통이 비었습니다.</p>}
      <ul className="jobs__list" hidden={!trash.length}>
        {trash.map((j) => (
          <li key={j.id} className="jobs__row">
            <span className="jobs__name">
              <b>{j.settings.productName || j.fileName}</b>
              <small>
                {j.fileName} · {fmtBytes(j.fileSize)}
              </small>
            </span>
            <span className="badge">지움</span>
            <span className="jobs__prog">{j.deletedAt ? `${ago(j.deletedAt)} 지움` : ''}</span>
            <span className="jobs__time">{j.deletedAt ? `${daysLeft(j.deletedAt)}일 후 삭제` : ''}</span>
            <span className="jobs__acts">
              <button className="btn btn--sm" disabled={busy || trashLoading} onClick={() => onRestore(j.id)}>
                복원
              </button>
              <button
                className={`btn btn--sm btn--ghost ${armed === j.id ? 'is-danger' : ''}`}
                disabled={busy || trashLoading}
                title="되돌릴 수 없습니다"
                onClick={() => (armed === j.id ? (setArmed(null), onPurge(j.id)) : setArmed(j.id))}
                onBlur={() => armed === j.id && setArmed(null)}
              >
                {armed === j.id ? '정말 영구 삭제' : '영구 삭제'}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
