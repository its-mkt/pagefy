// 「PSD 교체」 확인 창 (2026-11-27) — 같은 제품에 디자인을 고친 PSD 를 넣을 때
// - 변환 내역 「⋯ → PSD 교체…」: 고른 작업 하나 (jobs 1개, onNew 없음)
// - 새 PSD 를 올렸는데 같은 제품명 작업이 있을 때: 그 작업들 중 하나를 골라 교체 · 같은 PSD 면 그 작업 열기 · 새 작업으로 만들기
import { useEffect, useState } from 'react';
import { Dialog } from 'radix-ui';
import { FileUp } from 'lucide-react';
import { Button } from './Button';
import { listInfo, platformLabel, sameFile, type Job } from '../lib/jobs';
import { fmtBytes } from '../lib/util';
import { listDate } from '../lib/time';

interface Props {
  /** 새로 넣을 PSD — null 이면 닫힘 */
  file: File | null;
  /** 교체할 수 있는 작업 (최근 순) */
  jobs: Job[];
  onClose: () => void;
  onReplace: (job: Job, file: File) => void;
  /** 고른 PSD 가 그 작업의 PSD 와 같을 때(이름·크기) — 교체 대신 그 작업을 연다 */
  onOpen?: (job: Job, file: File) => void;
  /** 새 작업으로 만들기 (업로드 때만) */
  onNew?: (file: File) => void;
}

const nameOf = (j: Job) => j.settings?.productName || j.fileName;

export default function ReplacePsdDialog({ file, jobs, onClose, onReplace, onOpen, onNew }: Props) {
  const [pick, setPick] = useState<string | null>(null);
  useEffect(() => {
    if (file) setPick(jobs[0]?.id ?? null);
  }, [file, jobs]);
  const job = jobs.find((j) => j.id === pick) ?? null;
  const same = !!(job && file && sameFile(job, file));
  const many = jobs.length > 1;
  const info = job ? listInfo(job) : null;
  const run = (fn: () => void) => {
    onClose();
    fn();
  };
  return (
    <Dialog.Root open={!!file && !!jobs.length} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dlg__overlay" />
        <Dialog.Content className="dlg psdswap">
          <Dialog.Title className="dlg__title">{onNew ? '같은 제품의 작업이 있습니다' : 'PSD 교체'}</Dialog.Title>
          <Dialog.Description className="dlg__sub">
            새 PSD: {file?.name} · {file ? fmtBytes(file.size) : ''}
          </Dialog.Description>
          {many && <p className="hint">PSD 를 바꿀 작업을 고르세요. 고르지 않은 작업(다른 판매처용 복제 등)은 옛 PSD 그대로 남습니다.</p>}
          <ul className="psdswap__list">
            {jobs.map((j) => (
              <li key={j.id}>
                <label className={`psdswap__job${pick === j.id ? ' is-on' : ''}`}>
                  {many && <input type="radio" name="psdswap" checked={pick === j.id} onChange={() => setPick(j.id)} />}
                  <span className="psdswap__name">
                    <b>{nameOf(j)}</b>
                    <small>
                      {j.settings?.channel ? platformLabel({ channel: j.settings.channel, market: j.settings.market }) : ''} · {listDate(j.updatedAt)} · 지금 PSD {j.fileName} ({fmtBytes(j.fileSize)})
                      {j.note?.link ? ' · 등록됨' : ''}
                    </small>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {job && file && same ? (
            <p className="hint">이 작업의 PSD 와 이름·크기가 같습니다 — 바꿀 것이 없으니 그 작업을 이어서 엽니다.</p>
          ) : (
            job && (
              <div className="psdswap__what">
                <p>
                  <b>그대로:</b> 제품명 · 판매처 · 서버 폴더(슬러그) · 이미지 주소 · 담당 · 메모 · 등록 링크
                </p>
                <p>
                  <b>지움:</b> 옛 PSD 로 만든 구조 계획·결과·HTML{job.edited ? '·손보기 저장본' : ''}
                  {info?.html ? ' — 새 PSD 로 「마크업 만들기」를 다시 눌러야 합니다 (Claude 1회)' : ''}
                </p>
                {(job.uploadedAt || job.note?.link) && (
                  <p className="hint">
                    이미지 서버·쇼핑몰의 옛 결과는 그대로 있습니다. 새로 만든 뒤 「이미지 올리고 HTML 복사」를 누르면 바뀐 이미지만 덮어쓰고(옛 파일은 백업), 쇼핑몰에는 새 HTML 을 다시 붙여넣어야 합니다.
                  </p>
                )}
              </div>
            )
          )}
          <div className="dlg__actions">
            {job && file && (same && onOpen ? (
              <Button type="button" size="sm" variant="primary" onClick={() => run(() => onOpen(job, file))}>
                이 작업 열기
              </Button>
            ) : (
              !same && (
                <Button type="button" size="sm" variant="primary" onClick={() => run(() => onReplace(job, file))}>
                  <FileUp className="btn__ico" />
                  {many ? '고른 작업의 PSD 교체' : 'PSD 교체'}
                </Button>
              )
            ))}
            {onNew && file && (
              <Button type="button" size="sm" onClick={() => run(() => onNew(file))}>
                새 작업으로 만들기
              </Button>
            )}
            <Dialog.Close asChild>
              <Button type="button" size="sm">
                취소
              </Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
