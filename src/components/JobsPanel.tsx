import { useState } from 'react';
import type { Job, JobState } from '../lib/jobs';
import { fmtBytes } from '../lib/util';

interface Props {
  jobs: Job[];
  currentId: string | null;
  /** 생성 중엔 다른 작업을 열거나 지우지 않는다 */
  busy: boolean;
  onOpen: (job: Job) => void;
  onRemove: (id: string) => void;
}

const STATE: Record<JobState, { label: string; tone: string }> = {
  ready: { label: '준비', tone: '' },
  running: { label: '만드는 중', tone: 'acc' },
  stopped: { label: '중단됨', tone: 'warn' },
  error: { label: '오류', tone: 'error' },
  done: { label: '완료', tone: 'ok' },
};

function ago(t: number) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}시간 전`;
  return new Date(t).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
}

function progress(j: Job) {
  if (!j.plan) return j.state === 'ready' ? '-' : '계획 전';
  // 코드 생성 방식은 섹션을 따로 요청하지 않는다 (계획만 있으면 마크업을 다시 만들 수 있음)
  if (j.plan.bundle.plan.engine === 'code') return `섹션 ${j.plan.bundle.plan.sections.length}개`;
  const total = j.plan.bundle.plan.sections.length;
  return `섹션 ${Object.keys(j.sections).length}/${total}`;
}

/** 이 브라우저에 저장된 작업 목록 — 새로고침·탭 닫힘 뒤에도 이어서 할 수 있다 */
export default function JobsPanel({ jobs, currentId, busy, onOpen, onRemove }: Props) {
  // 지우기는 두 번 눌러 확정 (브라우저 확인 창 대신)
  const [armed, setArmed] = useState<string | null>(null);
  if (!jobs.length) return null;

  return (
    <section className="panel jobs">
      <h2 className="panel__title">
        최근 작업 <small>이 브라우저에만 저장 · 최근 8개</small>
      </h2>
      <ul className="jobs__list">
        {jobs.map((j) => {
          const st = STATE[j.state];
          const cur = j.id === currentId;
          return (
            <li key={j.id} className={`jobs__row ${cur ? 'is-cur' : ''}`}>
              <span className="jobs__name" title={j.error}>
                <b>{j.settings.productName || j.fileName}</b>
                <small>
                  {j.fileName} · {fmtBytes(j.fileSize)}
                  {j.noFile ? ' · PSD 미저장(다시 올려야 함)' : ''}
                </small>
              </span>
              <span className={`badge ${st.tone ? `badge--${st.tone}` : ''}`}>{st.label}</span>
              <span className="jobs__prog">{progress(j)}</span>
              <span className="jobs__time">{ago(j.updatedAt)}</span>
              <span className="jobs__acts">
                {cur ? (
                  <span className="jobs__cur">열려 있음</span>
                ) : (
                  <button className="btn btn--sm" disabled={busy || j.noFile} onClick={() => onOpen(j)} title={j.noFile ? 'PSD 원본이 저장되지 않아 같은 PSD를 다시 올려야 합니다' : undefined}>
                    열기
                  </button>
                )}
                <button
                  className={`btn btn--sm btn--ghost ${armed === j.id ? 'is-danger' : ''}`}
                  disabled={busy && cur}
                  onClick={() => (armed === j.id ? (setArmed(null), onRemove(j.id)) : setArmed(j.id))}
                  onBlur={() => armed === j.id && setArmed(null)}
                >
                  {armed === j.id ? '정말 지우기' : '지우기'}
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
