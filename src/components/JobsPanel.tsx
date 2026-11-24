import { Fragment, useEffect, useRef, useState } from 'react';
import { filterOn, listInfo, TRASH_DAYS, type Job, type JobFilter, type JobState } from '../lib/jobs';
import { CHANNEL_LABEL } from '../../shared/types';
import { MARKETS, normMarket, type Market } from '../../shared/markets';
import { fmtBytes } from '../lib/util';
import { SHARED_ROOT } from '../lib/sharedFolder';
import Select from './Select';
import { Tip, TipWrap } from './ui';
import { TrashIcon } from './icons';
import { ago, clock, dayLabel, dayStart, timeOf, when } from '../lib/time';

/** 다른 PC 에서 열 PSD 가 있는 곳 (「공유 폴더에 저장」이 PSD 를 넣는 폴더) */
const PSD_DIR = String.raw`${SHARED_ROOT}\채널\제품명`;

interface Props {
  jobs: Job[];
  /** 변환 내역 거르기 (채널·플랫폼·상태·기간·검색) — 서버에서 거른 뒤 20개씩 */
  filter: JobFilter;
  onFilter: (f: JobFilter) => void;
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
  /**
   * 'recent' = 만들기 화면의 「최근 작업」(최근 5건·거르기/휴지통/더 보기 없음 + 「전체 보기」),
   * 'page' = 머리말 메뉴 「변환 내역」 화면 (#jobs — 거르기·휴지통·더 보기, 비어 있어도 그린다)
   */
  mode: 'recent' | 'page';
  /** 'recent' 의 「전체 보기」 — 변환 내역 화면으로 */
  onShowAll?: () => void;
  /** 'page' 에서 지금 열린 작업 줄의 「작업 화면으로」 — 만들기 화면으로 돌아간다 (열린 작업은 거기 그대로 있음) */
  onGoCurrent?: () => void;
}

type SortKey = 'name' | 'channel' | 'state' | 'time';
/** 변환 내역 표 머리 (누르면 정렬) — [기준, 이름, 칸 class] */
const SORT_COLS: [SortKey, string, string][] = [
  ['name', '제품명', 'jtable__c-name'],
  ['channel', '판매처', 'jtable__c-ch'],
  ['state', '상태', 'jtable__c-state'],
  ['time', '날짜', 'jtable__c-time'],
];
/** 정렬 방향 화살표 (오름차순 위 · 내림차순 아래) — 정렬하지 않은 칸은 ↕ 글자 그대로 */
function SortArrow({ up }: { up: boolean }) {
  return (
    <svg className="jtable__dir" viewBox="0 0 12 12" aria-hidden="true">
      <path d={up ? 'M6 10V2.5M2.5 6L6 2.5L9.5 6' : 'M6 2v7.5M2.5 6L6 9.5L9.5 6'} fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
/** 표 날짜 칸 — 오늘 14:05 · 어제 09:12 · 그 전은 11. 20. 14:05 */
function dateCell(t: number) {
  const d = dayLabel(t);
  return d === '오늘' || d === '어제' ? `${d} ${clock(t)}` : when(t);
}
/** 상태 정렬 순서: 손볼 것(오류·중단) 먼저 */
const STATE_ORDER: Record<JobState, number> = { error: 0, stopped: 1, running: 2, ready: 3, done: 4 };
function sortCmp(k: SortKey, x: Job, y: Job) {
  if (k === 'time') return x.updatedAt - y.updatedAt;
  if (k === 'state') return STATE_ORDER[x.state] - STATE_ORDER[y.state] || y.updatedAt - x.updatedAt;
  const a = k === 'name' ? x.settings.productName || x.fileName : channelOf(x);
  const b = k === 'name' ? y.settings.productName || y.fileName : channelOf(y);
  return a.localeCompare(b, 'ko') || y.updatedAt - x.updatedAt;
}

/** 만들기 화면에 보여 줄 최근 작업 수 (사용자 지시 2026-11-24) */
export const RECENT_COUNT = 5;

const STATE: Record<JobState, { label: string; tone: string }> = {
  ready: { label: '준비', tone: '' },
  running: { label: '만드는 중', tone: 'acc' },
  stopped: { label: '중단됨', tone: 'warn' },
  error: { label: '오류', tone: 'error' },
  done: { label: '완료', tone: 'ok' },
};

/** 스켈레톤 줄의 제목 자리 — 길이를 조금씩 달리해 실제 목록처럼 보이게 */
const SKEL_NAMES = ['상세페이지 제품명 자리', '제품명 자리 표시', '상세페이지 제품 이름 자리 표시'];

/** 채널 · 플랫폼 (예전 작업엔 settings 가 비어 있을 수 있다) */
function channelOf(j: Job) {
  const c = j.settings?.channel;
  if (!c || !CHANNEL_LABEL[c]) return '';
  return c === 'openmarket' ? `오픈마켓 · ${MARKETS[normMarket(j.settings.market)].label}` : CHANNEL_LABEL[c].replace(/\s*\(.*\)$/, '');
}

const PERIODS: { days?: number; label: string }[] = [{ label: '전체 기간' }, { days: 1, label: '오늘' }, { days: 7, label: '최근 7일' }, { days: 30, label: '최근 30일' }];

/** 변환 내역 거르기 막대 */
function FilterBar({ filter: f, onFilter, count, more }: { filter: JobFilter; onFilter: (f: JobFilter) => void; count: number; more: boolean }) {
  // 검색은 입력이 멈춘 뒤에 보낸다 (글자마다 계정을 다시 읽지 않게)
  const [q, setQ] = useState(f.q ?? '');
  const latest = useRef(f);
  latest.current = f;
  useEffect(() => {
    if (q.trim() === (latest.current.q ?? '').trim()) return;
    const t = window.setTimeout(() => onFilter({ ...latest.current, q: q.trim() || undefined }), 350);
    return () => window.clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  // 「조건 지우기」로 검색어가 빠지면 입력칸도 비운다
  useEffect(() => {
    if (!f.q) setQ('');
  }, [f.q]);
  const on = filterOn(f);
  return (
    <div className="jobs__filter" role="search" aria-label="변환 내역 거르기">
      <input className="jobs__q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="제품명·파일명 검색" aria-label="제품명·파일명 검색" />
      {/* 판매처는 한 칸에서 고른다: 고도몰(아이티켓·온코어) / 오픈마켓(플랫폼별). 값 = 채널 또는 openmarket:<플랫폼> */}
      <Select
        size="md"
        aria-label="판매처"
        value={f.channel === 'openmarket' && f.market ? `openmarket:${f.market}` : f.channel ?? ''}
        onChange={(v) => {
          const [ch, mk] = v.split(':');
          onFilter({ ...f, channel: (ch || undefined) as JobFilter['channel'], market: (mk || undefined) as Market | undefined });
        }}
        options={[
          { value: '', label: '전체 판매처' },
          {
            group: '고도몰',
            options: [
              { value: 'godo', label: '고도몰 전체' },
              { value: 'itket', label: '아이티켓' },
              { value: 'oncore', label: '온코어' },
            ],
          },
          {
            group: '오픈마켓',
            options: [{ value: 'openmarket', label: '오픈마켓 전체' }, ...(Object.keys(MARKETS) as Market[]).map((m) => ({ value: `openmarket:${m}`, label: MARKETS[m].label }))],
          },
        ]}
      />
      <Select
        size="md"
        aria-label="상태"
        value={f.state ?? ''}
        onChange={(v) => onFilter({ ...f, state: (v || undefined) as JobFilter['state'] })}
        options={[
          { value: '', label: '전체 상태' },
          { value: 'done', label: '완료' },
          { value: 'problem', label: '오류·중단' },
        ]}
      />
      {/* 기간도 판매처·상태와 같은 선택 상자로 — 한 줄에 같은 모양 칸만 나란히 (2026-11-24, 세그먼트 단추가 어색하다는 의견) */}
      <Select
        size="md"
        className="jobs__period"
        aria-label="기간"
        value={String(f.days ?? 'all')}
        onChange={(v) => onFilter({ ...f, days: v === 'all' ? undefined : Number(v) })}
        options={PERIODS.map((p) => ({ value: String(p.days ?? 'all'), label: p.label }))}
      />
      {/* 글자 길이가 바뀌면 검색 칸 폭이 흔들리므로 늘 「N개」만 — 거른 상태라는 뜻은 화면 읽기·마우스 올림 글로 */}
      <span className="jobs__count" aria-live="polite" title={on ? '조건에 맞는 작업 수' : '전체 작업 수'}>
        <span className="sr-only">{on ? '조건에 맞는 작업 ' : '전체 작업 '}</span>
        {count}
        {more ? '+' : ''}개
      </span>
      {/* 필터 줄 밖(오른쪽 아래)에 띄운다 — 나타나고 사라질 때 필터 칸들이 밀리지 않게. 결과가 0개면 빈 안내 안의 「조건 지우기」만 */}
      {on && count > 0 && (
        <button type="button" className="link-btn jobs__clear" onClick={() => onFilter({})}>
          조건 지우기
        </button>
      )}
    </div>
  );
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
  const { filter, onFilter, currentId, busy, account, loading, onMore, onOpen, onRemove, onView, trash, trashN, onTrashOpen, onRestore, mode, onShowAll, onGoCurrent } = props;
  const recent = mode === 'recent';
  // 최근 작업은 거르기 없이 읽은 목록의 앞 5건만 (거르기는 변환 내역 화면에서만 — App 이 화면에 따라 거르기를 빼고 읽는다)
  const jobs = recent ? props.jobs.slice(0, RECENT_COUNT) : props.jobs;
  const more = recent ? false : props.more;
  const hasMore = recent && (props.jobs.length > RECENT_COUNT || props.more);
  const filtered = !recent && filterOn(filter);
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
  /** 줄 하나의 작업 단추 (열기·PSD 고르기·결과 보기·작업 화면으로·지우기) — 최근 작업 목록과 변환 내역 표가 같이 쓴다 */
  const acts = (j: Job, cur: boolean) => (
        <span className="jobs__acts">
          {cur ? (
            // 변환 내역 화면에서는 열린 작업으로 돌아갈 길이 있어야 한다 (만들기 화면에 그대로 열려 있음)
            onGoCurrent ? (
              <button type="button" className="btn btn--sm btn--primary" onClick={onGoCurrent}>
                작업 화면으로
              </button>
            ) : (
              <span className="jobs__cur">열려 있음</span>
            )
          ) : (
            j.noFile ? (
              <>
              {listInfo(j).html && (
                <TipWrap disabled={busy} content="PSD 원본 없이 저장된 HTML을 봅니다.">
                <button className="btn btn--sm" disabled={busy} onClick={() => onView(j)}>
                  {busy && <span className="spinner" aria-hidden="true" />}
                  결과 보기
                </button>
                </TipWrap>
              )}
              <TipWrap disabled={busy} content={`이 PC 브라우저에 PSD 원본이 없습니다. 공유 폴더(${PSD_DIR})의 같은 PSD를 고르면 이어서 열립니다.`}>
              <button
                className="btn btn--sm btn--soft"
                disabled={busy}
                onClick={() => {
                  setPickFor(j);
                  picker.current?.click();
                }}
              >
                {busy && <span className="spinner" aria-hidden="true" />}
                PSD 고르기
              </button>
              </TipWrap>
              </>
            ) : (
              <button className="btn btn--sm btn--soft" disabled={busy} onClick={() => onOpen(j)}>
                {/* 만드는 중·여는 중이라 못 누를 때는 왼쪽에 도는 표시 — 멈춘 게 아니라 기다리는 중임을 알린다 */}
                {busy && <span className="spinner" aria-hidden="true" />}
                열기
              </button>
            )
          )}
          {/* 휴지통으로 옮기기만 하므로(기간 안에 복원 가능) 한 번에 누르면 된다 */}
          {/* 글자 대신 휴지통 아이콘 (줄마다 반복 — 자리 절약). 뜻은 툴팁·화면 읽기 이름으로 (2026-11-24) */}
          <TipWrap disabled={busy && cur} content={busy && cur ? '만드는 중인 작업은 휴지통으로 옮길 수 없습니다' : `휴지통으로 옮기기 (${TRASH_DAYS}일 안에 복원 가능)`}>
          <button className="btn btn--sm btn--ghost btn--icon btn--trash" aria-label={`「${j.settings.productName || j.fileName}」 휴지통으로 옮기기`} disabled={busy && cur} onClick={() => remove(j)}>
            <TrashIcon className="btn__ico" />
          </button>
          </TipWrap>
        </span>
  );
  // 변환 내역 표 정렬 (읽어 온 작업 안에서) — 기본 최근 순. 날짜는 묶음 줄 대신 날짜 칸에 (오늘 14:05 · 어제 09:12 · 11. 20. 14:05)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'time', dir: -1 });
  const rows = recent || (sort.key === 'time' && sort.dir === -1) ? jobs : [...jobs].sort((x, y) => sortCmp(sort.key, x, y) * sort.dir);
  if (trash && !recent) return <TrashView {...props} trash={trash} />;
  // 최근 작업은 비면 숨기고, 변환 내역 화면은 비어 있어도 그린다 (안내 글)
  if (recent && !jobs.length && !loading) return null;

  return (
    <section className={`panel jobs${recent ? ' jobs--recent' : ''}`}>
      <div className="jobs__head">
        <h2 className="panel__title">
          {recent ? '최근 작업' : '변환 내역'}{' '}
          {!recent && <small>{account ? '내 계정에 저장 (다른 PC에서도 보임) · PSD 원본은 이 PC에만' : '이 브라우저에만 저장 · 최근 8개'}</small>}
          {loading && jobs.length > 0 && (
            <span className="jobs__loading" role="status">
              <span className="spinner" aria-hidden="true" /> 불러오는 중…
            </span>
          )}
        </h2>
        {recent && onShowAll && (
          <button type="button" className="link-btn jobs__all" onClick={onShowAll}>
            전체 보기{hasMore ? '' : ` (${jobs.length})`} <span aria-hidden="true">→</span>
          </button>
        )}
        {!recent && trashN > 0 && (
          <Tip content={`지운 작업 — ${TRASH_DAYS}일 안에 복원할 수 있습니다`}>
          <button type="button" className="btn btn--sm btn--ghost jobs__trash" onClick={onTrashOpen}>
            <TrashIcon className="jobs__ico" /> 휴지통 {trashN}
          </button>
          </Tip>
        )}
      </div>
      {/* 목록은 계정에 저장돼 어느 PC 에서나 보이지만 PSD 원본은 만든 PC 에만 있다 → 다른 PC 에선 공유 폴더의 PSD 로 연다 */}
      {!recent && account && jobs.length > 0 && (
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
      {!recent && (jobs.length > 0 || filtered) && <FilterBar filter={filter} onFilter={onFilter} count={jobs.length} more={more} />}
      {busy && jobs.length > 0 && <p className="hint jobs__busy">만드는 중에는 다른 작업을 열거나 지울 수 없습니다. 끝나면 다시 누를 수 있습니다.</p>}
      {!jobs.length && !loading && !filtered && <p className="hint jobs__empty">변환 내역이 없습니다. 「만들기」에서 PSD를 올려 마크업을 만들면 여기에 쌓입니다.</p>}
      {!jobs.length && !loading && filtered && (
        <p className="hint jobs__empty">
          조건에 맞는 작업이 없습니다.{' '}
          <button type="button" className="link-btn" onClick={() => onFilter({})}>
            조건 지우기
          </button>
        </p>
      )}
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
                <span className="btn btn--sm btn--ghost btn--icon skel">&nbsp;</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {/* 최근 작업(만들기 첫 화면)만 목록 — 변환 내역 화면은 아래 표 (hidden 속성은 .jobs__list 의 display 가 이겨서 아예 그리지 않는다) */}
      {recent && jobs.length > 0 && (
      <ul className="jobs__list">
        {jobs.map((j, i) => {
          const st = STATE[j.state];
          const cur = j.id === currentId;
          // 목록은 최근 수정순 → 날짜가 바뀌는 줄 앞에 날짜 머리를 끼운다 (같은 표 칸을 쓰도록 같은 ul 안에)
          const newDay = i === 0 || dayStart(jobs[i - 1].updatedAt) !== dayStart(j.updatedAt);
          const ch = channelOf(j);
          return (
            <Fragment key={j.id}>
            {newDay && (
              <li className="jobs__day" role="presentation">
                {dayLabel(j.updatedAt)}
              </li>
            )}
            <li className={`jobs__row ${cur ? 'is-cur' : ''}`}>
              <Tip content={j.error}>
              <span className="jobs__name">
                <b>{j.settings.productName || j.fileName}</b>
                <small>
                  {ch && <span className="jobs__ch">{ch}</span>}
                  {j.fileName} · {fmtBytes(j.fileSize)}
                  {j.noFile ? ' · 이 PC에 PSD 없음' : ''}
                </small>
              </span>
              </Tip>
              <span className={`badge ${st.tone ? `badge--${st.tone}` : ''}`}>{st.label}</span>
              <span className="jobs__prog">{progress(j)}</span>
              <Tip content={when(j.updatedAt)}>
                <span className="jobs__time">{timeOf(j.updatedAt)}</span>
              </Tip>
              {acts(j, cur)}
            </li>
            </Fragment>
          );
        })}
      </ul>
      )}
      {!recent && jobs.length > 0 && (
        <div className="jtable__wrap">
          <table className="jtable">
            <thead>
              <tr>
                {SORT_COLS.map(([key, label, cls]) => (
                  <th key={key} className={cls} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                    <button
                      type="button"
                      className={`jtable__sort${sort.key === key ? ' is-on' : ''}`}
                      onClick={() => setSort((v) => (v.key === key ? { key, dir: v.dir === 1 ? -1 : 1 } : { key, dir: key === 'time' ? -1 : 1 }))}
                    >
                      {label}
                      <span className="jtable__arrow" aria-hidden="true">{sort.key === key ? <SortArrow up={sort.dir === 1} /> : '↕'}</span>
                    </button>
                  </th>
                ))}
                <th className="jtable__c-prog">섹션</th>
                <th className="jtable__c-acts"><span className="sr-only">작업</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((j) => {
                const st = STATE[j.state];
                const cur = j.id === currentId;
                return (
                  <Fragment key={j.id}>
                    <tr className={cur ? 'is-cur' : ''}>
                      <td className="jtable__c-name">
                        <Tip content={j.error}>
                          <span className="jobs__name">
                            <b>{j.settings.productName || j.fileName}</b>
                            <small>
                              {j.fileName}
                              <span className="jtable__size"> · {fmtBytes(j.fileSize)}</span>
                              {j.noFile ? ' · 이 PC에 PSD 없음' : ''}
                            </small>
                          </span>
                        </Tip>
                      </td>
                      <td className="jtable__c-ch">{channelOf(j) || '—'}</td>
                      <td className="jtable__c-state">
                        <span className={`badge ${st.tone ? `badge--${st.tone}` : ''}`}>{st.label}</span>
                      </td>
                      <td className="jtable__c-time">
                        <Tip content={`${dayLabel(j.updatedAt)} ${clock(j.updatedAt)} · ${ago(j.updatedAt)}`}>
                          <span className="jobs__time">{dateCell(j.updatedAt)}</span>
                        </Tip>
                      </td>
                      <td className="jtable__c-prog">{progress(j)}</td>
                      <td className="jtable__c-acts">{acts(j, cur)}</td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
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

/** 휴지통 — 최근 작업 자리를 바꿔 보여 준다. 복원 / 영구 삭제(두 번 눌러 확정) */
function TrashView({ trash, trashLoading, busy, onTrashClose, onRestore, onPurge }: Props & { trash: Job[] }) {
  const [armed, setArmed] = useState<string | null>(null);
  return (
    <section className="panel jobs jobs--trash">
      <div className="jobs__head">
        <h2 className="panel__title">
          <TrashIcon className="jobs__ico" /> 휴지통 <small>{TRASH_DAYS}일 지나면 자동으로 영구 삭제됩니다</small>
          {trashLoading && (
            <span className="jobs__loading" role="status">
              <span className="spinner" aria-hidden="true" /> 불러오는 중…
            </span>
          )}
        </h2>
        <button type="button" className="btn btn--sm btn--ghost" onClick={onTrashClose}>
          ← 변환 내역
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
