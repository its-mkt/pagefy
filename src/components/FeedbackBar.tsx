// 결과 평가 — 「수정 없이 그대로 썼어요 / 고쳐서 썼어요」 한 번 누르기 (도입 주 지표 = 그대로 붙여넣기 가능 비율)
// 고쳐서 썼으면 어디를 고쳤는지 고르게 해 다음 개선 대상을 정한다. 같은 작업을 다시 누르면 마지막 것으로 바뀐다
import { useEffect, useState } from 'react';
import { FEEDBACK_AREAS, type FeedbackArea, type FeedbackVerdict } from '../../shared/ops';
import { sendFeedback } from '../lib/api';
import { readLocal, writeLocal } from '../lib/util';

const KEY = 'pagefy.feedback';
type Saved = Record<string, { verdict: FeedbackVerdict; areas: FeedbackArea[] }>;

export default function FeedbackBar({ jobId, product }: { jobId: string; product: string }) {
  const [saved, setSaved] = useState(() => readLocal<Saved>(KEY, {})[jobId] ?? null);
  const [editing, setEditing] = useState(false);
  const [areas, setAreas] = useState<FeedbackArea[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSaved(readLocal<Saved>(KEY, {})[jobId] ?? null);
    setEditing(false);
    setAreas([]);
    setNote('');
    setError(null);
  }, [jobId]);

  const submit = async (verdict: FeedbackVerdict) => {
    setBusy(true);
    setError(null);
    try {
      const a = verdict === 'edited' ? areas : [];
      await sendFeedback({ jobId, product, verdict, areas: a, note: verdict === 'edited' ? note.trim() || undefined : undefined });
      const all = readLocal<Saved>(KEY, {});
      all[jobId] = { verdict, areas: a };
      // 최근 200건만 기억 (이 브라우저에서 이미 평가했는지 보여 주는 용도)
      writeLocal(KEY, Object.fromEntries(Object.entries(all).slice(-200)));
      setSaved(all[jobId]);
      setEditing(false);
    } catch (e) {
      setError(`평가를 저장하지 못했습니다: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  if (saved && !editing) {
    return (
      <div className="feedback feedback--done" role="status">
        <span>
          {saved.verdict === 'asis' ? '「수정 없이 그대로 썼어요」로 평가했습니다.' : `「고쳐서 썼어요」로 평가했습니다${saved.areas.length ? ` (${saved.areas.map((a) => FEEDBACK_AREAS.find((x) => x.id === a)?.label).join(', ')})` : ''}.`} 고맙습니다.
        </span>
        <button type="button" className="link-btn" onClick={() => (setAreas(saved.areas), setEditing(true))}>
          평가 바꾸기
        </button>
      </div>
    );
  }

  return (
    <div className="feedback" role="group" aria-label="결과 평가">
      <div className="feedback__row">
        <span className="feedback__q">
          <b>붙여넣은 뒤 어땠나요?</b> 쇼핑몰에 붙여넣고 확인한 뒤 눌러 주세요 — 품질 개선에 씁니다.
        </span>
        <span className="feedback__actions">
          <button type="button" className="btn btn--sm" disabled={busy} onClick={() => submit('asis')}>
            수정 없이 그대로 썼어요
          </button>
          <button type="button" className={`btn btn--sm${areas.length || editing ? ' is-on' : ''}`} disabled={busy} aria-expanded={editing} onClick={() => setEditing((v) => !v)}>
            고쳐서 썼어요…
          </button>
        </span>
      </div>
      {editing && (
        <div className="feedback__more">
          <span className="feedback__label">어디를 고쳤나요? (여러 개 선택)</span>
          <span className="feedback__areas">
            {FEEDBACK_AREAS.map((a) => (
              <label key={a.id} className={`chip${areas.includes(a.id) ? ' is-on' : ''}`}>
                <input type="checkbox" checked={areas.includes(a.id)} onChange={(e) => setAreas((v) => (e.target.checked ? [...v, a.id] : v.filter((x) => x !== a.id)))} />
                {a.label}
              </label>
            ))}
          </span>
          <input className="feedback__note" type="text" maxLength={500} placeholder="한 줄 메모 (선택) — 예: 둘째 섹션 제목 줄바꿈" value={note} onChange={(e) => setNote(e.target.value)} />
          <span className="feedback__actions">
            <button type="button" className="btn btn--sm btn--primary" disabled={busy || !areas.length} title={areas.length ? undefined : '고친 곳을 하나 이상 고르세요'} onClick={() => submit('edited')}>
              {busy ? '저장 중…' : '평가 보내기'}
            </button>
            <button type="button" className="btn btn--sm btn--ghost" disabled={busy} onClick={() => setEditing(false)}>
              취소
            </button>
          </span>
        </div>
      )}
      {error && <p className="msg msg--error" role="alert">{error}</p>}
    </div>
  );
}
