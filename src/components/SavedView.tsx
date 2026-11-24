import { useRef } from 'react';
import type { Job } from '../lib/jobs';
import { download } from '../lib/util';
import { useCopy } from '../lib/clipboard';
import { useFrameHeight } from '../lib/useFrameHeight';
import { when } from '../lib/time';

interface Props {
  job: Job;
  onClose: () => void;
}

/**
 * PSD 원본 없이 저장된 결과 보기 (다른 PC·다른 주소에서 연 작업)
 * 저장해 둔 완성 HTML 만 보여 준다. 이미지는 이미지 서버 주소를 가리키므로 서버에 올린 뒤에만 보인다
 * 수정 요청·이미지 받기·위치 대조는 PSD 가 있어야 하므로 「PSD 고르기」로 안내한다
 */
export default function SavedView({ job, onClose }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const html = job.html ?? '';
  const name = job.settings.productName || job.fileName.replace(/\.psd$/i, '');

  const height = useFrameHeight(frame, 800, [html]);
  // 결과 화면과 같은 복사 (막히면 옛 방식으로 한 번 더 — 그래도 안 되면 「HTML 받기」로 안내)
  const [copied, copy] = useCopy();

  return (
    <section className="panel saved" aria-label="저장된 결과 보기">
      <h2 className="panel__title">
        저장된 결과 보기 <small>{name} · {when(job.updatedAt)} 저장</small>
      </h2>
      <p className="hint saved__note">
        PSD 원본 없이 저장된 HTML만 보여 줍니다. 이미지는 이미지 서버에 올린 뒤에만 보이고, 수정 요청·이미지 받기는 「PSD 고르기」로 같은 PSD를 열어야 할 수 있습니다.
      </p>
      <div className="actions saved__acts">
        <button className="btn btn--sm" onClick={() => copy('html', html)}>
          {copied === 'html' ? '복사됨' : 'HTML 복사'}
        </button>
        <button className="btn btn--sm" onClick={() => download(new Blob([html], { type: 'text/html' }), `${name}.html`)}>
          HTML 받기
        </button>
        <button className="btn btn--sm btn--ghost" onClick={onClose}>
          닫기
        </button>
      </div>
      {copied === 'fail:html' && <p className="msg msg--error">이 브라우저에서 복사가 막혔습니다. 「HTML 받기」로 파일을 받아 여세요.</p>}
      <div className="saved__frame">
        <iframe ref={frame} title="저장된 HTML 미리보기" sandbox="allow-same-origin" scrolling="no" srcDoc={html} style={{ height }} />
      </div>
    </section>
  );
}
