import { useEffect, useRef, useState } from 'react';
import { Button } from './Button';
import { Dialog } from 'radix-ui';
import { imageBaseUrl } from '../../shared/types';
import { fullJob, jobsInFolder, setUploaded, type Job } from '../lib/jobs';
import { uploadCheck, uploadDelete, uploadTargetFor, uploadVerify, type UploadTarget } from '../lib/api';
import { planDelete } from '../lib/imageDelete';

/** 이미지 폴더 하나에서 지울 계획 — 같은 폴더(채널·플랫폼·슬러그)를 쓰는 고른 작업은 하나로 묶는다 */
interface Plan {
  key: string;
  names: string[];
  target: UploadTarget;
  base: string;
  del: string[];
  missing: string[];
  keep: { file: string; by: string[] }[];
  noFile: boolean;
}

type Step =
  | { kind: 'loading' }
  | { kind: 'blocked'; message: string }
  | { kind: 'ready'; plans: Plan[]; skipped: { name: string; reason: string }[]; scope: 'account' | 'browser' }
  | { kind: 'deleting'; done: number; total: number }
  | { kind: 'done'; removed: number; backups: number; missing: number; failed: string[]; still: string[]; foldersRemoved: number; backupFailed: string[] }
  | { kind: 'error'; message: string };

const nameOf = (j: Job) => `${j.settings?.productName || j.fileName}${j.settings?.rev ? ` (${j.settings.rev})` : ''}`;
/** 지우기 전에 직접 입력해야 하는 확인 문구 */
const CONFIRM_WORD = '제거합니다';
const keyOf = (t: UploadTarget) => `${t.channel}/${t.market ?? ''}/${t.board ?? ''}/${t.year ?? ''}/${t.slug}`;
const uniq = <T,>(a: T[]) => [...new Set(a)];

/**
 * 변환 내역 「이미지 서버에서 지우기」 — 고른 작업(한 개 또는 여러 개)의 HTML 이 가리키는 이미지를 이미지 서버(제품 폴더)에서 지운다.
 * 고르지 않은 다른 작업도 가리키는 파일은 남기고, 쇼핑몰에 붙여넣었으면 그림이 빈칸이 된다는 확인을 한 번 받은 뒤에만 지운다.
 * 지운 뒤 공개 주소를 다시 열어 정말 안 열리는지 본다. 지울 수 없는 작업(HTML 없음·예전 주소 규칙)은 건너뛰고 이유를 보여 준다
 */
/**
 * 이미지를 지운 뒤 이어서 할 일 — 휴지통으로 옮기기 / 휴지통에서 영구 삭제.
 * 이미지를 실패 없이 다 지우면 run 을 부른다. 일부 실패하면 부르지 않는다 (다시 지울 기회를 남김).
 * only = 이미지는 두고 작업만 처리하는 단추 — onlyAlways 면 늘, 아니면 지울 것이 없거나 확인할 수 없거나 실패했을 때만
 */
export interface DeleteAfter {
  run: () => void;
  title: string;
  action: (n: number) => string;
  only: string;
  onlyAlways?: boolean;
  done: string;
  /** 작업도 없어진다 (지운 뒤 다시 올릴 수 없음) */
  gone?: boolean;
  note?: string;
}

/** onChanged: 지운 작업의 「올림」 기록을 비운 뒤 (목록을 다시 그리게) */
export default function ImageDeleteDialog({ jobs, onClose, after, onChanged }: { jobs: Job[] | null; onClose: () => void; after?: DeleteAfter; onChanged?: () => void }) {
  const [step, setStep] = useState<Step>({ kind: 'loading' });
  const [trashed, setTrashed] = useState(false);
  useEffect(() => {
    if (jobs?.length) setTrashed(false);
  }, [jobs]);
  // 다 지웠으면 이어서 할 일 (한 번만)
  useEffect(() => {
    if (step.kind === 'done' && after && !trashed && !step.failed.length) {
      after.run();
      setTrashed(true);
    }
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps
  const onlyRun = after
    ? () => {
        after.run();
        onClose();
      }
    : undefined;
  // 되돌릴 수 없는 삭제라 확인 문구를 직접 입력해야 단추가 켜진다 (체크박스는 습관적으로 누르기 쉬움, 2026-11-26 사용자)
  const [typed, setTyped] = useState('');
  const sure = typed.trim() === CONFIRM_WORD;
  const acRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!jobs?.length) return;
    const ac = new AbortController();
    acRef.current = ac;
    setStep({ kind: 'loading' });
    setTyped('');
    const picked = new Set(jobs.map((j) => j.id));
    (async (): Promise<Step> => {
      const skipped: { name: string; reason: string }[] = [];
      const plans = new Map<string, Plan>();
      const remoteOf = new Map<string, Promise<Set<string>>>();
      let scope: 'account' | 'browser' = 'account';
      for (const job of jobs) {
        const j = await fullJob(job);
        const meta = j.meta;
        if (!meta || !j.html) {
          skipped.push({ name: nameOf(job), reason: '저장된 HTML이 없어 어떤 이미지를 올렸는지 알 수 없습니다' });
          continue;
        }
        const base = imageBaseUrl(meta);
        if (j.baseUrl && j.baseUrl.replace(/\/+$/, '') !== base) {
          skipped.push({ name: nameOf(job), reason: '예전 주소 규칙(날짜 폴더 등)으로 만든 결과라 여기서는 지울 수 없습니다' });
          continue;
        }
        const target: UploadTarget = uploadTargetFor(meta);
        const key = keyOf(target);
        if (!remoteOf.has(key)) remoteOf.set(key, uploadCheck(target, ac.signal).then((r) => new Set(r.files.map((f) => f.file))));
        // 같은 폴더를 쓰는 다른 작업 — 이번에 같이 고른 작업은 「남겨야 할 이유」에서 뺀다 (같이 지우니까)
        const [{ jobs: others, scope: sc }, onServer] = await Promise.all([jobsInFolder(meta.slug, j.id), remoteOf.get(key)!]);
        if (sc === 'browser') scope = 'browser';
        const plan = planDelete(
          j.html,
          base,
          others.filter((o) => !picked.has(o.id)).map((o) => ({ name: nameOf(o), html: o.html })),
        );
        const prev = plans.get(key);
        const next: Plan = {
          key,
          names: [...(prev?.names ?? []), nameOf(j)],
          target,
          base,
          del: uniq([...(prev?.del ?? []), ...plan.del.filter((f) => onServer.has(f))]),
          missing: uniq([...(prev?.missing ?? []), ...plan.del.filter((f) => !onServer.has(f))]),
          keep: [...(prev?.keep ?? []), ...plan.keep.filter((k) => onServer.has(k.file))],
          noFile: (prev?.noFile ?? false) || !!j.noFile,
        };
        plans.set(key, next);
      }
      // 한 작업에서는 남기는 파일이 다른 작업에서는 지울 파일일 수 있다 → 남기는 쪽이 이긴다 (다른 작업이 쓰고 있음)
      const out = [...plans.values()].map((p) => {
        const keepSet = new Set(p.keep.map((k) => k.file));
        return { ...p, del: p.del.filter((f) => !keepSet.has(f)) };
      });
      if (!out.length) {
        return { kind: 'blocked', message: skipped.length === 1 ? `${skipped[0].reason}.` : '지울 수 있는 작업이 없습니다 — 고른 작업 모두 HTML이 없거나 예전 주소 규칙입니다.' };
      }
      if (!out.some((p) => p.del.length || p.keep.length) && !skipped.length) return { kind: 'blocked', message: '고른 작업의 HTML이 가리키는 이미지가 없습니다.' };
      return { kind: 'ready', plans: out, skipped, scope };
    })()
      .then((s) => !ac.signal.aborted && setStep(s))
      .catch((e) => !ac.signal.aborted && setStep({ kind: 'error', message: `확인하지 못했습니다: ${(e as Error).message}` }));
    return () => ac.abort();
  }, [jobs]);

  async function run() {
    if (step.kind !== 'ready') return;
    const plans = step.plans.filter((p) => p.del.length);
    const total = plans.reduce((n, p) => n + p.del.length, 0);
    if (!total) return;
    const ac = acRef.current ?? new AbortController();
    let removedAll = 0;
    let missing = 0;
    let backups = 0;
    let foldersRemoved = 0;
    const failed: string[] = [];
    const backupFailed: string[] = [];
    const still: string[] = [];
    try {
      setStep({ kind: 'deleting', done: 0, total });
      // 폴더 하나씩 차례로 — 한 폴더 안에서는 함수 시간 제한으로 남긴 것이 있으면 이어서 요청 (조금도 못 하면 멈춤)
      for (const plan of plans) {
        let files = plan.del;
        let removed: string[] = [];
        let folderRemoved = false;
        for (let i = 0; i < 10 && files.length; i++) {
          const out = await uploadDelete(plan.target, files, ac.signal);
          removed = [...removed, ...out.removed];
          missing += out.missing.length;
          backups += out.backups;
          folderRemoved = out.folderRemoved;
          failed.push(...out.failed.map((f) => `${f.file}(${f.error})`));
          backupFailed.push(...(out.backupFailed ?? []));
          setStep({ kind: 'deleting', done: removedAll + removed.length + missing, total });
          // 남은 것만 다음 요청으로 — 이번에 실패한 것은 남은 것으로 다시 세지 않는다
          const progressed = out.removed.length + out.missing.length + out.failed.length > 0;
          files = out.left;
          if (files.length && !progressed) break;
        }
        if (files.length) failed.push(`${plan.names[0]}: 서버 시간 안에 다 지우지 못한 ${files.length}장`);
        if (folderRemoved) foldersRemoved++;
        removedAll += removed.length;
        // 지운 주소가 정말 안 열리는지 (이미지 서버 캐시 때문에 잠시 열릴 수 있음)
        for (let i = 0; i < removed.length; i += 12) {
          const r = await uploadVerify(plan.target, removed.slice(i, i + 12).map((file) => ({ file, size: 0 })), ac.signal);
          still.push(...r.results.filter((x) => x.status === 200).map((x) => x.file));
        }
      }
      // 이미지를 지웠으면 고른 작업은 「올리기 전」으로 (변환 내역 상태)
      if (removedAll) {
        for (const j of jobs ?? []) await setUploaded(j, undefined).catch(() => {});
        onChanged?.();
      }
      setStep({ kind: 'done', removed: removedAll, backups, missing, failed, still, foldersRemoved, backupFailed });
    } catch (e) {
      if (!ac.signal.aborted) setStep({ kind: 'error', message: `지우기 실패: ${(e as Error).message}${removedAll ? ` (그 전에 ${removedAll}장은 지웠습니다)` : ''}` });
    }
  }

  const busy = step.kind === 'deleting';
  const many = (jobs?.length ?? 0) > 1;
  const title = !jobs?.length ? '' : many ? `고른 작업 ${jobs.length}개` : nameOf(jobs[0]);
  const ready = step.kind === 'ready' ? step : null;
  const delTotal = ready ? ready.plans.reduce((n, p) => n + p.del.length, 0) : 0;
  const keepTotal = ready ? ready.plans.reduce((n, p) => n + uniq(p.keep.map((k) => k.file)).length, 0) : 0;
  const missTotal = ready ? ready.plans.reduce((n, p) => n + p.missing.length, 0) : 0;
  const keepBy = ready ? uniq(ready.plans.flatMap((p) => p.keep.flatMap((k) => k.by))) : [];
  const noFile = ready ? ready.plans.some((p) => p.noFile && p.del.length) : false;
  return (
    <Dialog.Root open={!!jobs?.length} onOpenChange={(o) => !o && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dlg__overlay" />
        <Dialog.Content className="dlg imgdel" onEscapeKeyDown={(e) => busy && e.preventDefault()} onPointerDownOutside={(e) => busy && e.preventDefault()}>
          <Dialog.Title className="dlg__title">{after ? after.title : '이미지 서버에서 지우기'}</Dialog.Title>
          <Dialog.Description className="dlg__sub">{title}</Dialog.Description>

          {step.kind === 'loading' && (
            <p className="imgdel__wait">
              <span className="spinner" aria-hidden="true" /> 서버에 올라간 이미지와 같은 폴더를 쓰는 작업을 확인하는 중…
            </p>
          )}
          {(step.kind === 'blocked' || step.kind === 'error') && <p className="msg msg--error" role="alert">{step.message}</p>}

          {ready && (
            <>
              {/* 폴더가 하나면 경로만, 여러 개면 폴더마다 지울 장수 */}
              {ready.plans.length === 1 ? (
                <p className="imgdel__path">
                  <code>{ready.plans[0].base}/</code>
                </p>
              ) : (
                <ul className="imgdel__plans">
                  {ready.plans.map((p) => (
                    <li key={p.key}>
                      <b>{p.names.join(', ')}</b> <small>지울 {p.del.length}장</small>
                      <code>{p.base}/</code>
                    </li>
                  ))}
                </ul>
              )}
              <ul className="imgdel__sum">
                <li>
                  <b>지울 이미지 {delTotal}장</b>
                  {ready.plans.length > 1 && ` (폴더 ${ready.plans.filter((p) => p.del.length).length}곳)`} — 덮어쓰기 때 남겨 둔 예전 파일(백업)도 함께 지웁니다.
                </li>
                {keepTotal > 0 && (
                  <li>
                    <b>남기는 이미지 {keepTotal}장</b> — 고르지 않은 다른 작업도 씁니다 ({keepBy.slice(0, 3).join(', ')}
                    {keepBy.length > 3 ? ' 등' : ''}).
                  </li>
                )}
                {missTotal > 0 && <li>이미 서버에 없는 이미지 {missTotal}장은 건너뜁니다.</li>}
                {ready.skipped.length > 0 && (
                  <li>
                    <b>건너뛰는 작업 {ready.skipped.length}개</b> — {ready.skipped.map((s) => `${s.name}: ${s.reason}`).join(' / ')}
                  </li>
                )}
              </ul>
              {after?.note && <p className="hint">{after.note}</p>}
              {/* 다른 사람의 작업은 볼 수 없다 — 무엇까지 확인했는지 밝혀 둔다 */}
              <p className="hint imgdel__scope">
                {ready.scope === 'account' ? '같은 폴더를 쓰는지는 내 계정의 작업만 확인했습니다.' : '같은 폴더를 쓰는지는 이 브라우저의 작업만 확인했습니다.'} 다른 사람이 같은 제품 폴더로 만든 작업이 있다면 지우지 마세요.
              </p>
              {delTotal > 0 ? (
                <>
                  <div className="imgdel__warn" role="note">
                    <b>이미 쇼핑몰 상세설명에 붙여넣었다면 그 페이지의 그림이 빈칸이 됩니다.</b>
                    {after?.gone ? (
                      <span>작업 기록도 영구 삭제되므로 지운 이미지를 다시 올릴 수 없습니다.</span>
                    ) : noFile ? (
                      <span>이 브라우저에 PSD 원본이 없는 작업은 지운 뒤 이미지를 다시 만들 수 없습니다. 공유 폴더의 PSD를 다시 골라야 합니다.</span>
                    ) : (
                      <span>지운 뒤에도 작업을 열어 「이미지 올리고 HTML 복사」를 누르면 다시 올릴 수 있습니다.</span>
                    )}
                  </div>
                  <label className="imgdel__confirm">
                    <span>
                      {many ? '고른 작업 모두 쇼핑몰에 붙여넣지 않았거나 이미 내린 상품일 때만 지우세요.' : '쇼핑몰에 붙여넣지 않았거나 이미 내린 상품일 때만 지우세요.'} 계속하려면 <b>{CONFIRM_WORD}</b>를 입력하세요.
                    </span>
                    <input
                      value={typed}
                      onChange={(e) => setTyped(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && sure && void run()}
                      placeholder={CONFIRM_WORD}
                      aria-label={`확인 문구 「${CONFIRM_WORD}」 입력`}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
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
                {step.foldersRemoved > 0 && ` · 비어 있게 된 폴더 ${step.foldersRemoved}곳도 지웠습니다`}.
              </p>
              {step.backupFailed.length > 0 && <p className="hint">예전 파일(백업) {step.backupFailed.length}개는 지우지 못해 서버에 남아 있습니다 (이미지 주소에는 영향 없음).</p>}
              {step.still.length > 0 && <p className="hint">{step.still.length}장은 아직 주소가 열립니다. 이미지 서버 캐시 때문일 수 있으니 잠시 뒤 다시 확인해 주세요.</p>}
              {step.failed.length > 0 && <p className="msg msg--error">일부 실패: {step.failed.join(', ')}</p>}
              {after && (trashed ? <p><b>{after.done}</b></p> : step.failed.length > 0 && <p className="hint">일부 이미지를 지우지 못해 작업은 그대로 두었습니다. 다시 지우거나 「{after.only}」를 누르세요.</p>)}
            </div>
          )}

          <div className="dlg__actions">
            {ready && delTotal > 0 && (
              <Button type="button" size="sm" variant="danger" disabled={!sure} onClick={run}>
                {after ? after.action(delTotal) : `${delTotal}장 지우기`}
              </Button>
            )}
            {/* 이미지는 두고 작업만 (휴지통으로 / 영구 삭제) — onlyAlways 가 아니면 지울 것이 없거나 확인할 수 없거나 실패했을 때만 */}
            {after && onlyRun && !trashed && !busy && ((after.onlyAlways && step.kind !== 'done' && step.kind !== 'loading') || (ready && delTotal === 0) || step.kind === 'blocked' || step.kind === 'error' || (step.kind === 'done' && step.failed.length > 0)) && (
              <Button type="button" size="sm" onClick={onlyRun}>
                {after.only}
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
