import { useEffect, useRef, useState } from 'react';
import { Button } from './Button';
import { Dialog } from 'radix-ui';
import { imageBaseUrl } from '../../shared/types';
import { normMarket } from '../../shared/markets';
import { fullJob, jobsInFolder, type Job } from '../lib/jobs';
import { uploadCheck, uploadDelete, uploadVerify, type UploadTarget } from '../lib/api';
import { planDelete } from '../lib/imageDelete';
import { CheckField } from './ui';

type Step =
  | { kind: 'loading' }
  | { kind: 'blocked'; message: string }
  | { kind: 'ready'; target: UploadTarget; base: string; del: string[]; missing: string[]; keep: { file: string; by: string[] }[]; noFile: boolean; scope: 'account' | 'browser' }
  | { kind: 'deleting'; done: number; total: number }
  | { kind: 'done'; removed: number; backups: number; missing: number; failed: string[]; still: string[]; folderRemoved: boolean; backupFailed: string[] }
  | { kind: 'error'; message: string };

const nameOf = (j: Job) => `${j.settings?.productName || j.fileName}${j.settings?.rev ? ` (${j.settings.rev})` : ''}`;

/**
 * 변환 내역 「이미지 서버에서 지우기」 — 이 작업의 HTML 이 가리키는 이미지를 이미지 서버(제품 폴더)에서 지운다.
 * 같은 폴더를 쓰는 다른 작업도 가리키는 파일은 남기고, 쇼핑몰에 붙여넣었으면 그림이 빈칸이 된다는 확인을 받은 뒤에만 지운다.
 * 지운 뒤 공개 주소를 다시 열어 정말 안 열리는지 본다
 */
export default function ImageDeleteDialog({ job, onClose }: { job: Job | null; onClose: () => void }) {
  const [step, setStep] = useState<Step>({ kind: 'loading' });
  const [sure, setSure] = useState(false);
  const acRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!job) return;
    const ac = new AbortController();
    acRef.current = ac;
    setStep({ kind: 'loading' });
    setSure(false);
    (async () => {
      const j = await fullJob(job);
      const meta = j.meta;
      if (!meta || !j.html) return { kind: 'blocked', message: '저장된 HTML이 없어 어떤 이미지를 올렸는지 알 수 없습니다. 마크업을 만든 작업에서만 지울 수 있습니다.' } as Step;
      const base = imageBaseUrl(meta);
      if (j.baseUrl && j.baseUrl.replace(/\/+$/, '') !== base)
        return { kind: 'blocked', message: '예전 주소 규칙(날짜 폴더, 플랫폼 폴더 없는 오픈마켓 등)으로 만든 결과라 여기서는 지울 수 없습니다. PSD로 열면 지금 규칙의 주소로 다시 만들어집니다.' } as Step;
      const target: UploadTarget = { channel: meta.channel, slug: meta.slug, ...(meta.channel === 'openmarket' ? { market: normMarket(meta.market) } : {}), publicRoot: meta.publicRoot };
      const [{ jobs: others, scope }, remote] = await Promise.all([jobsInFolder(meta.slug, j.id), uploadCheck(target, ac.signal)]);
      const plan = planDelete(j.html, base, others.map((o) => ({ name: nameOf(o), html: o.html })));
      if (!plan.del.length && !plan.keep.length) return { kind: 'blocked', message: '이 작업의 HTML이 가리키는 이미지가 없습니다.' } as Step;
      const onServer = new Set(remote.files.map((f) => f.file));
      return {
        kind: 'ready',
        target,
        base,
        del: plan.del.filter((f) => onServer.has(f)),
        missing: plan.del.filter((f) => !onServer.has(f)),
        keep: plan.keep.filter((k) => onServer.has(k.file)),
        noFile: !!j.noFile,
        scope,
      } as Step;
    })()
      .then((s) => !ac.signal.aborted && setStep(s))
      .catch((e) => !ac.signal.aborted && setStep({ kind: 'error', message: `확인하지 못했습니다: ${(e as Error).message}` }));
    return () => ac.abort();
  }, [job]);

  async function run() {
    if (step.kind !== 'ready' || !step.del.length) return;
    const { target, del } = step;
    const ac = acRef.current ?? new AbortController();
    let files = del;
    let removed: string[] = [];
    let missing = 0;
    let backups = 0;
    let folderRemoved = false;
    const failed: string[] = [];
    const backupFailed: string[] = [];
    try {
      setStep({ kind: 'deleting', done: 0, total: del.length });
      // 함수 시간 제한으로 남긴 것이 있으면 이어서 요청 (조금도 못 하면 멈춤)
      for (let i = 0; i < 10 && files.length; i++) {
        const out = await uploadDelete(target, files, ac.signal);
        removed = [...removed, ...out.removed];
        missing += out.missing.length;
        backups += out.backups;
        folderRemoved = out.folderRemoved;
        failed.push(...out.failed.map((f) => `${f.file}(${f.error})`));
        backupFailed.push(...(out.backupFailed ?? []));
        setStep({ kind: 'deleting', done: removed.length + missing, total: del.length });
        // 남은 것만 다음 요청으로 — 이번에 실패한 것은 남은 것으로 다시 세지 않는다
        const progressed = out.removed.length + out.missing.length + out.failed.length > 0;
        files = out.left;
        if (files.length && !progressed) break;
      }
      if (files.length) failed.push(`서버 시간 안에 다 지우지 못한 ${files.length}장`);
      // 지운 주소가 정말 안 열리는지 (이미지 서버 캐시 때문에 잠시 열릴 수 있음)
      const still: string[] = [];
      for (let i = 0; i < removed.length; i += 12) {
        const r = await uploadVerify(target, removed.slice(i, i + 12).map((file) => ({ file, size: 0 })), ac.signal);
        still.push(...r.results.filter((x) => x.status === 200).map((x) => x.file));
      }
      setStep({ kind: 'done', removed: removed.length, backups, missing, failed, still, folderRemoved, backupFailed });
    } catch (e) {
      if (!ac.signal.aborted) setStep({ kind: 'error', message: `지우기 실패: ${(e as Error).message}${removed.length ? ` (그 전에 ${removed.length}장은 지웠습니다)` : ''}` });
    }
  }

  const busy = step.kind === 'deleting';
  const title = job ? nameOf(job) : '';
  return (
    <Dialog.Root open={!!job} onOpenChange={(o) => !o && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dlg__overlay" />
        <Dialog.Content className="dlg imgdel" onEscapeKeyDown={(e) => busy && e.preventDefault()} onPointerDownOutside={(e) => busy && e.preventDefault()}>
          <Dialog.Title className="dlg__title">이미지 서버에서 지우기</Dialog.Title>
          <Dialog.Description className="dlg__sub">{title}</Dialog.Description>

          {step.kind === 'loading' && (
            <p className="imgdel__wait">
              <span className="spinner" aria-hidden="true" /> 서버에 올라간 이미지와 같은 폴더를 쓰는 작업을 확인하는 중…
            </p>
          )}
          {(step.kind === 'blocked' || step.kind === 'error') && <p className="msg msg--error" role="alert">{step.message}</p>}

          {step.kind === 'ready' && (
            <>
              <p className="imgdel__path">
                <code>{step.base}/</code>
              </p>
              <ul className="imgdel__sum">
                <li>
                  <b>지울 이미지 {step.del.length}장</b> — 덮어쓰기 때 남겨 둔 예전 파일(백업)도 함께 지웁니다.
                </li>
                {step.keep.length > 0 && (
                  <li>
                    <b>남기는 이미지 {step.keep.length}장</b> — 같은 폴더를 쓰는 다른 작업도 씁니다 ({[...new Set(step.keep.flatMap((k) => k.by))].slice(0, 3).join(', ')}).
                  </li>
                )}
                {step.missing.length > 0 && <li>이미 서버에 없는 이미지 {step.missing.length}장은 건너뜁니다.</li>}
              </ul>
              {/* 다른 사람의 작업은 볼 수 없다 — 무엇까지 확인했는지 밝혀 둔다 */}
              <p className="hint imgdel__scope">
                {step.scope === 'account' ? '같은 폴더를 쓰는지는 내 계정의 작업만 확인했습니다.' : '같은 폴더를 쓰는지는 이 브라우저의 작업만 확인했습니다.'} 다른 사람이 같은 제품 폴더로 만든 작업이 있다면 지우지 마세요.
              </p>
              {step.del.length > 0 ? (
                <>
                  <div className="imgdel__warn" role="note">
                    <b>이미 쇼핑몰 상세설명에 붙여넣었다면 그 페이지의 그림이 빈칸이 됩니다.</b>
                    {step.noFile ? (
                      <span>이 브라우저에 PSD 원본이 없어 지운 뒤에는 이미지를 다시 만들 수 없습니다. 공유 폴더의 PSD를 다시 골라야 합니다.</span>
                    ) : (
                      <span>지운 뒤에도 이 작업을 열어 「이미지 올리고 HTML 복사」를 누르면 다시 올릴 수 있습니다.</span>
                    )}
                  </div>
                  <CheckField checked={sure} onChange={setSure}>
                    쇼핑몰에 붙여넣지 않았거나, 이미 내린 상품입니다
                  </CheckField>
                </>
              ) : (
                <p className="hint">지울 이미지가 없습니다.</p>
              )}
            </>
          )}

          {step.kind === 'deleting' && (
            <p className="imgdel__wait">
              <span className="spinner" aria-hidden="true" /> 지우는 중… {step.done}/{step.total}
            </p>
          )}

          {step.kind === 'done' && (
            <div className="imgdel__done" role="status">
              <p>
                <b>이미지 {step.removed}장을 지웠습니다</b>
                {step.backups > 0 && ` (백업 ${step.backups}개 포함 정리)`}
                {step.missing > 0 && ` · 이미 없던 ${step.missing}장`}
                {step.folderRemoved && ' · 폴더가 비어 폴더도 지웠습니다'}.
              </p>
              {step.backupFailed.length > 0 && <p className="hint">예전 파일(백업) {step.backupFailed.length}개는 지우지 못해 서버에 남아 있습니다 (이미지 주소에는 영향 없음).</p>}
              {step.still.length > 0 && <p className="hint">{step.still.length}장은 아직 주소가 열립니다. 이미지 서버 캐시 때문일 수 있으니 잠시 뒤 다시 확인해 주세요.</p>}
              {step.failed.length > 0 && <p className="msg msg--error">일부 실패: {step.failed.join(', ')}</p>}
            </div>
          )}

          <div className="dlg__actions">
            {step.kind === 'ready' && step.del.length > 0 && (
              <Button type="button" size="sm" variant="danger" disabled={!sure} onClick={run}>
                {step.del.length}장 지우기
              </Button>
            )}
            <Dialog.Close asChild>
              <Button type="button" size="sm" disabled={busy}>
                {step.kind === 'done' ? '닫기' : '취소'}
              </Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
