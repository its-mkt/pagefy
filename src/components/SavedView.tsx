import { useEffect, useRef, useState } from 'react';
import type { Job } from '../lib/jobs';
import { download } from '../lib/util';

interface Props {
  job: Job;
  onClose: () => void;
}

/**
 * PSD 원본 없이 저장된 결과 보기 (다른 PC·다른 주소에서 연 작업)
 * 저장해 둔 완성 HTML 만 보여 준다. 이미지는 이미지 서버 주소를 가리키므로 서버에 올린 뒤에만 보인다
 * 수정 요청·이미지 받기·위치 대조는 PSD 가 있어야 하므로 「PSD 골라 열기」로 안내한다
 */
export default function SavedView({ job, onClose }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(800);
  const [copied, setCopied] = useState(false);
  const html = job.html ?? '';
  const name = job.settings.productName || job.fileName.replace(/\.psd$/i, '');

  useEffect(() => {
    const f = frame.current;
    if (!f) return;
    // srcdoc 은 load 가 effect 보다 먼저 끝날 수 있고 이미지가 늦게 뜨면 높이가 바뀐다 → 잠시 주기적으로 잰다
    const measure = () => {
      const d = f.contentDocument;
      const h = d?.body ? Math.max(Math.ceil(d.documentElement.getBoundingClientRect().height), d.body.scrollHeight) : undefined;
      if (h) setHeight(h);
    };
    let n = 0;
    const timer = window.setInterval(() => {
      measure();
      if (++n > 30) window.clearInterval(timer);
    }, 300);
    f.addEventListener('load', measure);
    return () => {
      f.removeEventListener('load', measure);
      window.clearInterval(timer);
    };
  }, [html]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(html);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 복사가 막히면 받기 버튼을 쓰면 된다
    }
  }

  return (
    <section className="panel saved" aria-label="저장된 결과 보기">
      <h2 className="panel__title">
        저장된 결과 보기 <small>{name} · rev {job.meta?.rev ?? job.settings.rev}</small>
      </h2>
      <p className="hint saved__note">
        PSD 원본 없이 저장된 HTML만 보여 줍니다. 이미지는 이미지 서버에 올린 뒤에만 보이고, 수정 요청·이미지 받기는 「PSD 골라 열기」로 같은 PSD를 열어야 할 수 있습니다.
      </p>
      <div className="actions saved__acts">
        <button className="btn btn--sm" onClick={copy}>
          {copied ? '복사됨' : 'HTML 복사'}
        </button>
        <button className="btn btn--sm" onClick={() => download(new Blob([html], { type: 'text/html' }), `${name}.html`)}>
          HTML 받기
        </button>
        <button className="btn btn--sm btn--ghost" onClick={onClose}>
          닫기
        </button>
      </div>
      <div className="saved__frame">
        <iframe ref={frame} title="저장된 HTML 미리보기" sandbox="allow-same-origin" scrolling="no" srcDoc={html} style={{ height }} />
      </div>
    </section>
  );
}
