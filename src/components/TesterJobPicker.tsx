// 에디터 테스트 「변환 내역에서 불러오기」 — 저장된 HTML 이 있는 작업을 검색·더 보기로 골라 불러온다 (2026-11-25 사용자: 20개 넘는 경우도)
// 열고 닫기·바깥 클릭·Esc·포커스 되돌리기는 Radix Popover 가 맡는다 (PeriodPicker 와 같은 방식)
import { useEffect, useRef, useState } from 'react';
import { Popover } from 'radix-ui';
import { platformLabel, type Job } from '../lib/jobs';
import { ChevronDown } from 'lucide-react';

const PAGE = 20;

const dateOf = (t: number) => new Date(t).toLocaleDateString('ko-KR', { year: '2-digit', month: 'numeric', day: 'numeric' });

/** value: 지금 불러와 있는 결과 이름 (제품명 · 판매처) — 있으면 단추에 보인다. 없으면 「작업을 골라 불러오기」 */
export default function TesterJobPicker({ search, onPick, busy, value }: { search: (q: string, offset: number, limit: number) => Promise<{ jobs: Job[]; more: boolean }>; onPick: (job: Job) => void; busy: boolean; value?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [list, setList] = useState<Job[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const run = useRef(0);

  // 열 때·검색어가 바뀔 때 처음부터 (입력이 멈춘 뒤에 — 글자마다 계정을 읽지 않게)
  useEffect(() => {
    if (!open) return;
    const id = ++run.current;
    const t = window.setTimeout(
      () => {
        setLoading(true);
        setError('');
        search(q.trim(), 0, PAGE)
          .then((r) => {
            if (id !== run.current) return;
            setList(r.jobs);
            setMore(r.more);
          })
          .catch((e) => id === run.current && setError((e as Error).message))
          .finally(() => id === run.current && setLoading(false));
      },
      q ? 300 : 0,
    );
    return () => window.clearTimeout(t);
  }, [open, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = () => {
    const id = ++run.current;
    setLoading(true);
    search(q.trim(), list.length, PAGE)
      .then((r) => {
        if (id !== run.current) return;
        setList((l) => [...l, ...r.jobs.filter((j) => !l.some((x) => x.id === j.id))]);
        setMore(r.more);
      })
      .catch((e) => id === run.current && setError((e as Error).message))
      .finally(() => id === run.current && setLoading(false));
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className={`sel sel--sm tester__pick${value ? ' is-on' : ''}`} disabled={busy} aria-label={`변환 내역에서 불러오기: ${value || '고른 작업 없음'}`} title={value}>
        <span className="sel__value">{busy ? '불러오는 중…' : value || '작업을 골라 불러오기'}</span>
        <span className="sel__chev">
          <ChevronDown />
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="jpick" align="start" sideOffset={4} collisionPadding={8} aria-label="불러올 작업 고르기">
          <input className="jpick__q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="제품명·파일명·담당·메모 검색" aria-label="작업 검색" autoFocus />
          <ul className="jpick__list" aria-busy={loading}>
            {list.map((j) => (
              <li key={j.id}>
                <button
                  type="button"
                  className="jpick__item"
                  onClick={() => {
                    setOpen(false);
                    onPick(j);
                  }}
                >
                  <b>{j.settings?.productName || j.fileName}</b>
                  <small>
                    {j.settings?.channel ? platformLabel(j.settings) : ''} · {dateOf(j.updatedAt)}
                  </small>
                </button>
              </li>
            ))}
          </ul>
          {!loading && !error && !list.length && <p className="jpick__empty">{q.trim() ? `「${q.trim()}」에 맞는 작업이 없습니다.` : '저장된 HTML이 있는 작업이 없습니다.'}</p>}
          {error && <p className="msg msg--error">{error}</p>}
          <div className="jpick__foot">
            <span>{loading ? '불러오는 중…' : `${list.length}개${more ? ' 이상' : ''}`}</span>
            {more && (
              <button type="button" className="link-btn" disabled={loading} onClick={loadMore}>
                더 보기
              </button>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
