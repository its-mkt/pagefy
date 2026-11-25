// 변환 내역 「⋯ → 작업 정보 편집…」 — 담당자 · 메모 · 테스트 표시만 PSD 를 열지 않고 고친다 (마크업 결과에는 영향 없음)
import { useEffect, useState } from 'react';
import { Button } from './Button';
import { Dialog } from 'radix-ui';
import type { Job, JobNote } from '../lib/jobs';
import JobInfoFields from './JobInfoFields';

export default function JobInfoDialog({ job, onClose, onSave }: { job: Job | null; onClose: () => void; onSave: (job: Job, note: JobNote) => Promise<void> }) {
  const [info, setInfo] = useState<JobNote>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!job) return;
    setInfo({ assignee: job.note?.assignee ?? '', memo: job.note?.memo ?? '', test: !!job.note?.test });
    setSaving(false);
    setError(null);
  }, [job]);

  const save = async () => {
    if (!job) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(job, { assignee: info.assignee?.trim() ?? '', memo: info.memo?.trim() ?? '', test: !!info.test });
      onClose();
    } catch (e) {
      setError(`저장하지 못했습니다: ${(e as Error).message}`);
      setSaving(false);
    }
  };

  const name = job ? job.settings?.productName || job.fileName : '';
  // 담당자 칸을 비우면 「만든 사람」이 담당 (예전 작업은 만든 사람 기록이 없다)
  const creator = job?.creator;
  return (
    <Dialog.Root open={!!job} onOpenChange={(o) => !o && !saving && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dlg__overlay" />
        <Dialog.Content className="dlg jobinfo" onEscapeKeyDown={(e) => saving && e.preventDefault()} onPointerDownOutside={(e) => saving && e.preventDefault()}>
          <Dialog.Title className="dlg__title">작업 정보 편집</Dialog.Title>
          <Dialog.Description className="dlg__sub">
            {name}
            {creator ? ` · 만든 사람 ${creator}` : ''} · 변환 내역에만 보이고 마크업에는 영향 없음
          </Dialog.Description>
          <form
            className="jobinfo__form"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <fieldset className="form jobinfo__fields" disabled={saving}>
              <JobInfoFields value={info} onChange={setInfo} me={creator} />
            </fieldset>
            {error && (
              <p className="msg msg--error" role="alert">
                {error}
              </p>
            )}
            <div className="dlg__actions">
              <Dialog.Close asChild>
                <Button type="button" size="sm" disabled={saving}>
                  취소
                </Button>
              </Dialog.Close>
              <Button type="submit" size="sm" variant="primary" disabled={saving}>
                {saving && <span className="spinner" aria-hidden="true" />}
                저장
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
