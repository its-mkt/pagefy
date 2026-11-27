import { useEffect, useRef, useState } from 'react';
import { Button } from './Button';
import { savedEditFor, type Job } from '../lib/jobs';
import { editorIdOf, editorOf } from '../lib/editorSim';
import { download } from '../lib/util';
import { useCopy } from '../lib/clipboard';
import { useFrameHeight } from '../lib/useFrameHeight';
import { when } from '../lib/time';
import { copySection } from '../lib/output';
import { filesInHtml } from '../lib/imageDelete';
import { imageBaseUrl } from '../../shared/types';
import GodoCheckBox from './GodoCheckBox';
import { Tip, TipWrap } from './ui';
import { SeEditBox } from './SeEditor';
import { Check, CircleAlert, CircleCheck, Copy, Download, Ellipsis, Eye, FileUp, FolderOpen, FolderSearch, X } from 'lucide-react';
import { DropdownMenu, Tabs } from 'radix-ui';
import { uploadCheck, uploadTargetFor } from '../lib/api';
import { findSharedPsd } from '../lib/sharedFolder';

/** 공유 폴더에서 찾은 PSD 상태 — 작업을 열 때 한 번 확인한다 (권한이 없으면 찾지 못한 것으로 본다) */
type SharedPsd = { state: 'checking' } | { state: 'found'; file: File } | { state: 'none' };

interface Props {
  job: Job;
  onClose: () => void;
  /** 고도몰 등록 확인 상자 보이기 (고도몰 오픈 API 설정 + 아이티켓) */
  godo?: boolean;
  /** 「붙여넣기 전에 에디터에서 어떻게 바뀌는지 보기」 — 에디터 테스트로 넘어가 이 HTML 을 불러 둔다 */
  onOpenTester?: () => void;
  /** 같은 PSD 를 골라 작업 화면에서 열기 (다시 만들기·수정 요청·이미지 다시 올리기) */
  onPickPsd: (file: File) => void;
  /** 이미지 서버 연결이 설정돼 있음 (health.upload) — 있으면 이미지 확인을 폴더 목록 한 번으로 */
  imageServer?: boolean;
  /** 「수정」에서 저장한 고침 (null = 고침 되돌리기) — 작업에 남고 HTML 복사에 쓰인다. PSD 없이도 된다 */
  onSaveEdit: (html: string | null) => void;
  /** 고도몰 등록 확인이 맞으면 그 상품 페이지 주소를 작업 기록(link)에 저장 */
  onSaveLink?: (url: string) => void;
}

type ImgCheck = { state: 'checking'; done: number; total: number } | { state: 'ok'; total: number } | { state: 'missing'; total: number; missing: string[] } | { state: 'unknown' };

/**
 * 이미지 서버에 없는 파일 — 이미지 서버 연결이 설정돼 있으면 제품 폴더 목록을 한 번 받아 대조하고(「이미지 서버에서 지우기」와 같은 기준, 그림을 내려받지 않음),
 * 연결이 없거나 예전 주소(날짜 폴더) 결과면 공개 주소를 브라우저에서 열어 본다
 */
async function findMissing(job: Job, base: string, files: string[], server: boolean, onProgress: (done: number) => void, signal: AbortSignal): Promise<string[]> {
  if (server && job.meta && imageBaseUrl(job.meta) === base) {
    try {
      const { files: listed } = await uploadCheck(uploadTargetFor(job.meta), signal); // 오픈마켓 플랫폼·게시판 폴더까지 (shared/types imageFolder 와 같은 규칙)
      const have = new Set(listed.map((f) => f.file));
      return files.filter((f) => !have.has(f));
    } catch (e) {
      if (signal.aborted) throw e;
      console.warn('[saved] 이미지 서버 목록을 받지 못해 브라우저로 확인합니다', e);
    }
  }
  return probeImages(base, files, onProgress, signal);
}

/** 공개 주소의 그림을 실제로 열어 본다 (브라우저 캐시를 피하려고 주소 뒤에 확인용 값을 붙임). 6장씩 동시에 */
async function probeImages(base: string, files: string[], onProgress: (done: number) => void, signal: AbortSignal): Promise<string[]> {
  const stamp = Date.now();
  const missing: string[] = [];
  let done = 0;
  const one = (file: string) =>
    new Promise<void>((res) => {
      const img = new Image();
      const timer = window.setTimeout(() => finish(false), 15_000);
      const finish = (ok: boolean) => {
        window.clearTimeout(timer);
        img.onload = img.onerror = null;
        if (!ok) missing.push(file);
        onProgress(++done);
        res();
      };
      img.onload = () => finish(img.naturalWidth > 0);
      img.onerror = () => finish(false);
      img.src = `${base}/${file}?chk=${stamp}`;
    });
  for (let i = 0; i < files.length && !signal.aborted; i += 6) await Promise.all(files.slice(i, i + 6).map(one));
  return files.filter((f) => missing.includes(f));
}

/**
 * PSD 원본 없이 연 작업 (다른 PC·다른 주소에서 연 작업) — 저장해 둔 완성 HTML 로 할 수 있는 일을 모은다.
 * 먼저 HTML 이 쓰는 이미지가 이미지 서버에 모두 있는지 열어 보고, 다 있으면 「HTML 복사」 → 붙여넣기로 끝,
 * 빠진 게 있으면 복사를 막고 「PSD 선택」로 안내한다 (이 PC 에서는 이미지를 다시 만들 수 없음)
 * 다시 만들기·수정 요청·이미지 다시 올리기·zip·위치 대조는 PSD 가 있어야 하므로 「PSD 선택」로 작업 화면에서 연다
 */
export default function SavedView({ job, onClose, godo, onOpenTester, onPickPsd, imageServer, onSaveEdit, onSaveLink }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const html = job.html ?? '';
  const name = job.settings.productName || job.fileName.replace(/\.psd$/i, '');
  const base = (job.baseUrl || (job.meta ? imageBaseUrl(job.meta) : '')).replace(/\/+$/, '');

  // PSD 원본: 공유 폴더(채널\제품명)에 있는지 연 순간 확인 — 있으면 「PSD 열기」, 없으면 「PSD 선택」
  const [shared, setShared] = useState<SharedPsd>({ state: 'checking' });
  const psdInput = { channel: job.settings.channel, productName: job.settings.productName, fileName: job.fileName };
  useEffect(() => {
    let alive = true;
    setShared({ state: 'checking' });
    findSharedPsd(psdInput).then((f) => alive && setShared(f ? { state: 'found', file: f } : { state: 'none' }));
    return () => {
      alive = false;
    };
  }, [job.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const findOnShare = () => {
    setShared({ state: 'checking' });
    findSharedPsd(psdInput, true).then((f) => setShared(f ? { state: 'found', file: f } : { state: 'none' }));
  };

  // 「수정」 — 복사 구간을 편집기로 고친다 (결과 화면 「수정」 탭과 같은 상자·같은 저장 규칙)
  const original = copySection(html);
  const edited = savedEditFor(job, original);
  // 결과 화면(ResultPanel)과 같은 탭 — 「수정」은 동작이 아니라 보는 화면이라 탭으로 (고친 내용은 탭을 옮겨도 남는다)
  const [tab, setTab] = useState<'preview' | 'edit'>('preview');
  const [draft, setDraft] = useState<string | null>(null);
  const [editKey, setEditKey] = useState(0);
  const dirty = draft !== null;
  const dropDraft = () => {
    setDraft(null);
    setEditKey((k) => k + 1);
  };
  const saveDraft = () => {
    if (draft === null) return;
    onSaveEdit(draft === original ? null : draft);
    dropDraft();
  };

  const height = useFrameHeight(frame, 800, [html]);
  // 결과 화면과 같은 복사 (막히면 옛 방식으로 한 번 더 — 그래도 안 되면 「HTML 받기」로 안내)
  const [copied, copy] = useCopy();

  const [img, setImg] = useState<ImgCheck>({ state: 'unknown' });
  const [round, setRound] = useState(0);
  useEffect(() => {
    const files = base ? filesInHtml(html, base) : [];
    if (!files.length) return setImg({ state: 'unknown' });
    const ac = new AbortController();
    setImg({ state: 'checking', done: 0, total: files.length });
    findMissing(job, base, files, !!imageServer, (done) => !ac.signal.aborted && setImg({ state: 'checking', done, total: files.length }), ac.signal).then(
      (missing) => {
        if (ac.signal.aborted) return;
        setImg(missing.length ? { state: 'missing', total: files.length, missing } : { state: 'ok', total: files.length });
      },
      () => {},
    );
    return () => ac.abort();
  }, [html, base, round, imageServer]); // eslint-disable-line react-hooks/exhaustive-deps

  const blocked = img.state === 'missing' || img.state === 'checking';
  const copyHtml = () => copy('html', savedEditFor(job, copySection(html)) ?? copySection(html));
  const pickPsd = () => (shared.state === 'found' ? onPickPsd(shared.file) : picker.current?.click());

  return (
    <section className="panel saved" aria-label="저장된 결과">
      {/* 머리 — 제품명 · 저장 시각 · (오른쪽) 닫기 아이콘 */}
      <div className="saved__head">
        <h2 className="panel__title">
          {name} <small>{when(job.updatedAt)} 저장 · 이 PC에 PSD 없음</small>
        </h2>
        <Tip content="닫기">
          <Button icon aria-label="저장된 결과 닫기" onClick={onClose}>
            <X className="btn__ico" />
          </Button>
        </Tip>
      </div>

      {/* 상태 한 줄 — 이미지가 서버에 다 있는지(= 바로 붙여넣어도 되는지) · 공유 폴더 PSD. 문제가 있을 때만 아래에 자세한 안내 */}
      <div className="saved__chips" role="status">
        {img.state === 'checking' && (
          <span className="badge">
            <span className="spinner" aria-hidden="true" /> 이미지 서버 확인 중 {img.done}/{img.total}
          </span>
        )}
        {img.state === 'ok' && (
          <span className="badge badge--ok">
            <CircleCheck className="btn__ico" /> 이미지 {img.total}장 서버 확인
          </span>
        )}
        {img.state === 'missing' && (
          <span className="badge badge--error">
            <CircleAlert className="btn__ico" /> 이미지 {img.missing.length}/{img.total}장 없음
          </span>
        )}
        {img.state === 'unknown' && <span className="badge">확인할 서버 이미지 없음</span>}
        {shared.state === 'checking' && <span className="badge">공유 폴더 PSD 확인 중</span>}
        {shared.state === 'found' && (
          <Tip content={shared.file.name}>
            <span className="badge badge--ok">
              <CircleCheck className="btn__ico" /> 공유 폴더 PSD 있음
            </span>
          </Tip>
        )}
        {shared.state === 'none' && (
          <Tip content="사내망 · 크롬/엣지에서 열어야 확인됩니다. 「⋯」 메뉴에서 다시 찾을 수 있습니다.">
            <span className="badge">공유 폴더 PSD 못 찾음</span>
          </Tip>
        )}
        {edited !== null && (
          <Tip content={`「수정」에서 저장한 고침이 들어간 HTML을 복사합니다 (${when(job.edited!.at)} 저장)`}>
            <span className="badge badge--acc">고친 내용으로 복사</span>
          </Tip>
        )}
      </div>
      {img.state === 'missing' && (
        <div className="saved__status saved__status--missing" role="alert">
          <b>
            이미지 서버에서 열리지 않는 이미지: {img.missing.slice(0, 3).join(', ')}
            {img.missing.length > 3 ? ` 외 ${img.missing.length - 3}장` : ''}
          </b>
          <span>그대로 붙여넣으면 그 자리가 빈칸이 됩니다. 이 PC에는 PSD가 없어 이미지를 다시 올릴 수 없으니 「⋯ → PSD {shared.state === 'found' ? '열기' : '선택'}」로 같은 PSD를 열어 「이미지 올리고 HTML 복사」를 눌러 주세요.</span>
          <button type="button" className="link-btn" onClick={() => setRound((n) => n + 1)}>
            다시 확인
          </button>
        </div>
      )}

      <Tabs.Root value={tab} onValueChange={(v) => setTab(v as 'preview' | 'edit')}>
        {/* 탭 줄 — 왼쪽 보기 전환, 오른쪽 동작 (주 동작 「HTML 복사」만 밖에 강조, 에디터 미리보기·파일 받기·PSD 는 「⋯」 안으로 — 2026-11-26 사용자) */}
        <div className="saved__bar">
          <Tabs.List className="tabs" aria-label="저장된 결과 보기">
            <Tabs.Trigger value="preview" className="tabs__tab">
              미리보기
            </Tabs.Trigger>
            <Tabs.Trigger value="edit" className="tabs__tab" disabled={!html}>
              {dirty ? '수정 · 저장 안 함' : edited !== null ? '수정 · 저장됨' : '수정'}
            </Tabs.Trigger>
          </Tabs.List>
          <div className="saved__acts">
            <DropdownMenu.Root modal={false}>
              <Tip content="더 보기 — 에디터 미리보기 · HTML 파일 받기 · PSD 열기">
                <DropdownMenu.Trigger className="btn btn--icon" aria-label="더 보기">
                  <Ellipsis className="btn__ico" />
                </DropdownMenu.Trigger>
              </Tip>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="profile__pop jobs__rowmenu" align="end" sideOffset={6} collisionPadding={8}>
                  {/* HTML 로 하는 일 — 붙여넣기 전 확인 · 파일로 받기 */}
                  {onOpenTester && (
                    <DropdownMenu.Item className="profile__item" disabled={!html} onSelect={onOpenTester}>
                      <span className="jobs__rowmenu-ico">
                        <Eye className="btn__ico" />
                        에디터 미리보기
                      </span>
                      <small className="jobs__rowmenu-sub">쇼핑몰 에디터가 바꾸는 모양</small>
                    </DropdownMenu.Item>
                  )}
                  <DropdownMenu.Item className="profile__item" disabled={!html} onSelect={() => download(new Blob([html], { type: 'text/html' }), `${name}.html`)}>
                    <span className="jobs__rowmenu-ico">
                      <Download className="btn__ico" />
                      HTML 파일 받기
                    </span>
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator className="profile__sep" />
                  {/* PSD 가 있어야 하는 일(다시 만들기·수정 요청·이미지 다시 올리기·zip)은 작업 화면에서 한다 */}
                  <DropdownMenu.Item className="profile__item" onSelect={pickPsd}>
                    <span className="jobs__rowmenu-ico">
                      {shared.state === 'found' ? <FolderOpen className="btn__ico" /> : <FileUp className="btn__ico" />}
                      {shared.state === 'found' ? 'PSD 열기' : 'PSD 선택…'}
                    </span>
                    <small className="jobs__rowmenu-sub">다시 만들기 · 이미지 다시 올리기</small>
                  </DropdownMenu.Item>
                  {shared.state === 'none' && (
                    <DropdownMenu.Item className="profile__item" onSelect={findOnShare}>
                      <span className="jobs__rowmenu-ico">
                        <FolderSearch className="btn__ico" />
                        공유 폴더에서 PSD 찾기
                      </span>
                    </DropdownMenu.Item>
                  )}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
            <TipWrap disabled={blocked} content={blocked ? (img.state === 'checking' ? '이미지 서버 확인이 끝나면 누를 수 있습니다' : '서버에 없는 이미지가 있어 복사를 막았습니다') : undefined}>
              <Button variant="primary" disabled={blocked || !html} onClick={copyHtml}>
                {copied === 'html' ? <Check className="btn__ico" /> : <Copy className="btn__ico" />}
                {copied === 'html' ? '복사됨' : 'HTML 복사'}
              </Button>
            </TipWrap>
          </div>
          <input
            ref={picker}
            type="file"
            accept=".psd"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) onPickPsd(f);
            }}
          />
        </div>
        {copied === 'fail:html' && <p className="msg msg--error">이 브라우저에서 복사가 막혔습니다. 「⋯ → HTML 파일 받기」로 파일을 받아 여세요.</p>}

        <Tabs.Content value="preview">
          {godo && job.meta && job.meta.target !== 'board' && <GodoCheckBox html={copySection(html)} folder={`/${job.meta.channel}/${job.meta.slug}/`} link={job.note?.link} onLink={onSaveLink} />}
          <div className="saved__frame">
            <iframe ref={frame} title="저장된 HTML 미리보기" sandbox="allow-same-origin" scrolling="no" srcDoc={html} style={{ height }} />
          </div>
        </Tabs.Content>
        <Tabs.Content value="edit">
          <div className="fixit">
            <p className="hint fixit__note">
              글자·글꼴·크기·정렬·링크를 손볼 수 있습니다. 「저장」해야 「HTML 복사」에 들어가고 작업에도 남습니다. PSD 없이 고칠 수 있지만, 다시 만들기로 결과가 새로 만들어지면 저장한 고침은 사라집니다.
            </p>
            <div className={`fixit__bar${dirty ? ' is-dirty' : ''}`} role="status">
              <span className="fixit__state">{dirty ? '저장하지 않은 고침이 있습니다' : edited !== null ? '저장한 고침이 복사에 쓰입니다' : '고친 내용 없음 — 만든 결과 그대로 복사합니다'}</span>
              {dirty && (
                <>
                  <Button type="button" size="sm" variant="primary" onClick={saveDraft}>
                    저장
                  </Button>
                  <Button type="button" size="sm" onClick={dropDraft}>
                    변경점 되돌리기
                  </Button>
                </>
              )}
              {!dirty && edited !== null && (
                <Button type="button" size="sm" onClick={() => onSaveEdit(null)}>
                  원래 결과로 되돌리기
                </Button>
              )}
            </div>
            <SeEditBox
              title="복사 전에 수정"
              resetKey={editKey}
              note={job.meta?.channel === 'openmarket' ? '오픈마켓 HTML' : '고도몰 상세설명'}
              common={job.meta?.channel === 'openmarket'}
              html={draft ?? edited ?? original}
              onChange={(h) => setDraft(h === (edited ?? original) ? null : h)}
              p={editorOf(job.meta ? editorIdOf(job.meta) : 'godo')}
            />
          </div>
        </Tabs.Content>
      </Tabs.Root>
    </section>
  );
}
