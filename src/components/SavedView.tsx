import { useEffect, useRef, useState } from 'react';
import { Button } from './Button';
import type { Job } from '../lib/jobs';
import { download } from '../lib/util';
import { useCopy } from '../lib/clipboard';
import { useFrameHeight } from '../lib/useFrameHeight';
import { when } from '../lib/time';
import { copySection } from '../lib/output';
import { filesInHtml } from '../lib/imageDelete';
import { imageBaseUrl } from '../../shared/types';
import GodoCheckBox from './GodoCheckBox';
import { Tip, TipWrap } from './ui';
import { uploadCheck } from '../lib/api';

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
}

type ImgCheck = { state: 'checking'; done: number; total: number } | { state: 'ok'; total: number } | { state: 'missing'; total: number; missing: string[] } | { state: 'unknown' };

/**
 * 이미지 서버에 없는 파일 — 이미지 서버 연결이 설정돼 있으면 제품 폴더 목록을 한 번 받아 대조하고(「이미지 서버에서 지우기」와 같은 기준, 그림을 내려받지 않음),
 * 연결이 없거나 예전 주소(날짜 폴더) 결과면 공개 주소를 브라우저에서 열어 본다
 */
async function findMissing(job: Job, base: string, files: string[], server: boolean, onProgress: (done: number) => void, signal: AbortSignal): Promise<string[]> {
  if (server && job.meta && imageBaseUrl(job.meta) === base) {
    try {
      const { files: listed } = await uploadCheck({ channel: job.meta.channel, slug: job.meta.slug, publicRoot: job.meta.publicRoot }, signal);
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
 * 빠진 게 있으면 복사를 막고 「PSD 고르기」로 안내한다 (이 PC 에서는 이미지를 다시 만들 수 없음)
 * 다시 만들기·수정 요청·이미지 다시 올리기·zip·위치 대조는 PSD 가 있어야 하므로 「PSD 고르기」로 작업 화면에서 연다
 */
export default function SavedView({ job, onClose, godo, onOpenTester, onPickPsd, imageServer }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const html = job.html ?? '';
  const name = job.settings.productName || job.fileName.replace(/\.psd$/i, '');
  const base = (job.baseUrl || (job.meta ? imageBaseUrl(job.meta) : '')).replace(/\/+$/, '');

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
  const copyBtn = (
    <button className={`btn${img.state === 'ok' ? ' btn--primary' : ''}`} disabled={blocked || !html} onClick={() => copy('html', copySection(html))}>
      {copied === 'html' ? '복사됨' : 'HTML 복사'}
    </button>
  );

  return (
    <section className="panel saved" aria-label="저장된 결과">
      <h2 className="panel__title">
        {name} <small>{when(job.updatedAt)} 저장 · 이 PC에 PSD 없음</small>
      </h2>

      {/* 이미지가 서버에 다 있는지가 「바로 붙여넣어도 되는가」의 답 */}
      <div className={`saved__status saved__status--${img.state}`} role="status">
        {img.state === 'checking' && (
          <>
            <span className="spinner" aria-hidden="true" /> 이미지 서버 확인 중… {img.done}/{img.total}
          </>
        )}
        {img.state === 'ok' && <b>이미지 {img.total}장이 모두 이미지 서버에 있습니다 — 「HTML 복사」 후 쇼핑몰 상세설명에 붙여넣으면 끝입니다.</b>}
        {img.state === 'missing' && (
          <>
            <b>
              이미지 {img.total}장 중 {img.missing.length}장이 이미지 서버에서 열리지 않습니다 ({img.missing.slice(0, 3).join(', ')}
              {img.missing.length > 3 ? ' …' : ''}).
            </b>
            <span>그대로 붙여넣으면 그 자리가 빈칸이 됩니다. 이 PC에는 PSD가 없어 이미지를 다시 올릴 수 없으니 「PSD 고르기」로 같은 PSD를 열어 「이미지 올리고 HTML 복사」를 눌러 주세요.</span>
            <button type="button" className="link-btn" onClick={() => setRound((n) => n + 1)}>
              다시 확인
            </button>
          </>
        )}
        {img.state === 'unknown' && <span>이 HTML은 이미지 서버 주소를 쓰지 않아 확인할 이미지가 없습니다.</span>}
      </div>

      <div className="actions saved__acts">
        <TipWrap disabled={blocked} content={blocked ? (img.state === 'checking' ? '이미지 서버 확인이 끝나면 누를 수 있습니다' : '서버에 없는 이미지가 있어 복사를 막았습니다') : undefined}>
          {copyBtn}
        </TipWrap>
        <Tip content={`공유 폴더의 같은 PSD를 고르면 작업 화면에서 열립니다 — 다시 만들기·수정 요청·이미지 다시 올리기·zip은 PSD가 있어야 합니다.`}>
          <Button variant="soft" onClick={() => picker.current?.click()}>
            PSD 고르기
          </Button>
        </Tip>
        <Button  onClick={() => download(new Blob([html], { type: 'text/html' }), `${name}.html`)}>
          HTML 받기
        </Button>
        <Button className="saved__close" onClick={onClose}>
          닫기
        </Button>
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
      {copied === 'fail:html' && <p className="msg msg--error">이 브라우저에서 복사가 막혔습니다. 「HTML 받기」로 파일을 받아 여세요.</p>}
      {onOpenTester && (
        <p className="hint saved__more">
          <button type="button" className="link-btn" onClick={onOpenTester}>
            붙여넣기 전에 에디터에서 어떻게 바뀌는지 보기 →
          </button>
        </p>
      )}
      {godo && job.meta && <GodoCheckBox html={copySection(html)} folder={`/${job.meta.channel}/${job.meta.slug}/`} />}
      <div className="saved__frame">
        <iframe ref={frame} title="저장된 HTML 미리보기" sandbox="allow-same-origin" scrolling="no" srcDoc={html} style={{ height }} />
      </div>
    </section>
  );
}
