// 관리 화면 (주소 #admin, 광고 인사이트 역할 admin 만) — 이번 달 비용·월 상한, 사용·실패 기록, 결과 평가
// 숫자는 함수가 DB(pagefy_runs·feedback·settings)에서 모은다 (core/ops.ts). 로컬은 MOCK=1 일 때 예시 숫자
import { useCallback, useEffect, useState } from 'react';
import { type AdminStats, BUDGET_WARN_RATIO, FEEDBACK_AREAS, monthKST, nextMonth } from '../../shared/ops';
import { fetchAdminStats, saveAdminSettings } from '../lib/api';

const usd = (n: number) => `$${n.toFixed(2)}`;
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
const when = (iso: string) => new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const KIND: Record<string, string> = { timeout: '시간 초과', refusal: '모델 거절', api: 'Claude API', other: '기타' };

/** onChanged: 상한을 바꾸거나 풀면 불린다 — App 이 머리말·경고 띠의 사용액을 다시 읽게 */
export default function AdminPanel({ onChanged }: { onChanged?: () => void }) {
  const [month, setMonth] = useState(monthKST());
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [capInput, setCapInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const load = useCallback(async (m: string) => {
    setLoading(true);
    setError(null);
    try {
      const s = await fetchAdminStats(m);
      setStats(s);
      setCapInput(String(s.budget.capUsd));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => void load(month), [load, month]);

  const save = async (req: { capUsd?: number; unblock?: boolean }, done: string) => {
    setSaving(true);
    setSaveMsg(null);
    try {
      await saveAdminSettings(req);
      setSaveMsg(done);
      onChanged?.();
      await load(month);
    } catch (e) {
      setSaveMsg(`저장하지 못했습니다: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const thisMonth = month === monthKST();
  const b = stats?.budget;
  const ratio = b ? Math.min(1, b.spentUsd / b.capUsd) : 0;
  const cap = Number(capInput);
  const capValid = Number.isFinite(cap) && cap >= 1 && cap <= 10000;
  const maxMonth = Math.max(1, ...(stats?.months.map((m) => m.costUsd) ?? [1]));

  return (
    <section className="panel admin" aria-labelledby="admin-title" aria-busy={loading}>
      <div className="admin__head">
        <h2 id="admin-title" className="panel__title">관리</h2>
        <div className="admin__month" role="group" aria-label="달 고르기">
          <button type="button" className="btn btn--sm btn--ghost" aria-label="이전 달" onClick={() => setMonth((m) => nextMonth(m, -1))}>
            ‹
          </button>
          <b>{month.replace('-', '년 ')}월</b>
          <button type="button" className="btn btn--sm btn--ghost" aria-label="다음 달" disabled={thisMonth} onClick={() => setMonth((m) => nextMonth(m, 1))}>
            ›
          </button>
          <button type="button" className="btn btn--sm" disabled={loading} onClick={() => load(month)}>
            {loading ? '불러오는 중…' : '새로고침'}
          </button>
        </div>
      </div>

      {error && <p className="msg msg--error" role="alert">{error}</p>}
      {!stats && !error && <p className="hint">불러오는 중…</p>}

      {stats && b && (
        <>
          {/* 핵심 숫자 4개 */}
          <div className="admin__tiles">
            <div className={`admin__tile${b.blocked ? ' is-err' : ratio >= BUDGET_WARN_RATIO ? ' is-warn' : ''}`}>
              <span>사용액 / 월 상한</span>
              <b>
                {usd(b.spentUsd)} <small>/ {usd(b.capUsd)}</small>
              </b>
              <span className="admin__bar" aria-hidden="true">
                <i style={{ width: `${ratio * 100}%` }} />
              </span>
              <small>{b.blocked ? '상한 도달 — 새 생성이 막혀 있습니다' : b.unblocked ? '이번 달 상한 해제됨' : `${pct(b.spentUsd, b.capUsd)} 사용`}</small>
            </div>
            <div className="admin__tile">
              <span>그대로 붙여넣기 비율</span>
              <b>{pct(stats.feedback.asis, stats.feedback.total)}</b>
              <small>
                평가 {stats.feedback.total}건 · 그대로 {stats.feedback.asis} · 고쳐서 {stats.feedback.edited}
              </small>
            </div>
            <div className="admin__tile">
              <span>Claude 호출</span>
              <b>{stats.runs.total}회</b>
              <small>
                성공 {stats.runs.ok} · 실패 {stats.runs.failed} · 취소 {stats.runs.cancelled}
                {stats.runs.avgPlanMs ? ` · 평균 ${Math.round(stats.runs.avgPlanMs / 1000)}초` : ''}
              </small>
            </div>
            <div className={`admin__tile${stats.runs.timeouts ? ' is-warn' : ''}`}>
              <span>시간 초과 (150초 제한)</span>
              <b>{stats.runs.timeouts}회</b>
              <small>{stats.runs.timeouts ? '잦으면 Supabase 유료 전환 검토' : '무료 플랜으로 충분'}</small>
            </div>
          </div>

          {/* 월 상한 */}
          {thisMonth && (
            <div className="admin__box">
              <h3 className="admin__h">월 상한</h3>
              <div className="admin__row">
                <label className="admin__cap">
                  $
                  <input type="number" min={1} max={10000} step={10} value={capInput} onChange={(e) => setCapInput(e.target.value)} aria-label="월 상한 (달러)" />
                </label>
                <button type="button" className="btn btn--sm" disabled={saving || !capValid || cap === b.capUsd} onClick={() => save({ capUsd: cap }, `월 상한을 $${cap} 로 바꿨습니다.`)}>
                  상한 바꾸기
                </button>
                {b.blocked && (
                  <button type="button" className="btn btn--sm btn--primary" disabled={saving} onClick={() => save({ unblock: true }, '이번 달 상한을 풀었습니다. 다음 달 1일에 다시 적용됩니다.')}>
                    이번 달만 상한 풀기
                  </button>
                )}
                {b.unblocked && (
                  <button type="button" className="btn btn--sm" disabled={saving} onClick={() => save({ unblock: false }, '상한을 다시 적용했습니다.')}>
                    상한 다시 적용
                  </button>
                )}
                <span className="hint">사용액이 상한의 {BUDGET_WARN_RATIO * 100}% 를 넘으면 모든 사용자 화면에 경고가 뜨고, 100% 가 되면 새 생성이 막힙니다.</span>
              </div>
              {saveMsg && <p className="hint" role="status">{saveMsg}</p>}
            </div>
          )}

          <div className="admin__cols">
            {/* 최근 6개월 */}
            <div className="admin__box">
              <h3 className="admin__h">최근 6개월 비용</h3>
              <ul className="admin__months">
                {stats.months.map((m) => (
                  <li key={m.month} className={m.month === month ? 'is-on' : ''}>
                    <span>{m.month.slice(2).replace('-', '.')}</span>
                    <span className="admin__bar" aria-hidden="true">
                      <i style={{ width: `${(m.costUsd / maxMonth) * 100}%` }} />
                    </span>
                    <b>{usd(m.costUsd)}</b>
                    <small>{m.plans}건</small>
                  </li>
                ))}
              </ul>
            </div>

            {/* 고친 곳 */}
            <div className="admin__box">
              <h3 className="admin__h">「고쳐서 썼어요」 고친 곳</h3>
              {Object.keys(stats.feedback.areas).length ? (
                <ul className="admin__months">
                  {FEEDBACK_AREAS.filter((a) => stats.feedback.areas[a.id]).map((a) => (
                    <li key={a.id}>
                      <span>{a.label}</span>
                      <span className="admin__bar" aria-hidden="true">
                        <i style={{ width: `${(stats.feedback.areas[a.id] / Math.max(...Object.values(stats.feedback.areas))) * 100}%` }} />
                      </span>
                      <b>{stats.feedback.areas[a.id]}건</b>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="hint">아직 없습니다.</p>
              )}
            </div>
          </div>

          {/* 사람별 */}
          <div className="admin__box">
            <h3 className="admin__h">사람별</h3>
            {stats.users.length ? (
              <table className="admin__table">
                <thead>
                  <tr>
                    <th>계정</th>
                    <th>호출</th>
                    <th>실패</th>
                    <th>비용</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.users.map((u) => (
                    <tr key={u.email}>
                      <td>{u.email}</td>
                      <td>{u.runs}</td>
                      <td className={u.failed ? 'is-err' : ''}>{u.failed}</td>
                      <td>{usd(u.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="hint">이 달 사용 기록이 없습니다.</p>
            )}
          </div>

          {/* 실패 */}
          <div className="admin__box">
            <h3 className="admin__h">최근 실패 {stats.failures.length ? `${stats.failures.length}건` : ''}</h3>
            {stats.failures.length ? (
              <ul className="admin__list">
                {stats.failures.map((f, i) => (
                  <li key={i}>
                    <span className="admin__when">{when(f.at)}</span>
                    <span className="badge badge--error">{KIND[f.kind ?? 'other'] ?? f.kind}</span>
                    <span>
                      <b>{f.product || '(제품명 없음)'}</b> · {f.email} · {f.action === 'plan' ? '구조 계획' : '섹션'}
                      {f.durationMs ? ` · ${Math.round(f.durationMs / 1000)}초` : ''}
                      <small>{f.error}</small>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">실패가 없습니다.</p>
            )}
          </div>

          {/* 최근 평가 */}
          <div className="admin__box">
            <h3 className="admin__h">최근 평가</h3>
            {stats.recentFeedback.length ? (
              <ul className="admin__list">
                {stats.recentFeedback.map((f, i) => (
                  <li key={i}>
                    <span className="admin__when">{when(f.at)}</span>
                    <span className={`badge ${f.verdict === 'asis' ? 'badge--ok' : 'badge--warn'}`}>{f.verdict === 'asis' ? '그대로' : '고쳐서'}</span>
                    <span>
                      <b>{f.product || '(제품명 없음)'}</b> · {f.email}
                      {f.areas.length > 0 && ` · ${f.areas.map((a) => FEEDBACK_AREAS.find((x) => x.id === a)?.label ?? a).join(', ')}`}
                      {f.note && <small>{f.note}</small>}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">아직 평가가 없습니다. 결과 화면 아래 「붙여넣은 뒤 어땠나요?」에서 평가할 수 있습니다.</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
