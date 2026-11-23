import { useRef, useState, type DragEvent } from 'react';
import { fmtBytes } from '../lib/util';

interface Props {
  onFile: (f: File) => void;
  loading: string | null;
  error: string | null;
  file?: { name: string; size: number; width: number; height: number; thumbUrl: string } | null;
  disabled?: boolean;
}


export default function UploadPanel({ onFile, loading, error, file, disabled }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const blocked = !!loading || !!disabled;

  const pick = (files: FileList | null) => {
    const f = files?.[0];
    if (f && !blocked) onFile(f);
  };
  const open = () => {
    if (!blocked) input.current?.click();
  };

  const dnd = {
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      if (!blocked) setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setOver(false);
      pick(e.dataTransfer.files);
    },
  };

  const fileInput = (
    <input
      ref={input}
      type="file"
      accept=".psd"
      hidden
      onChange={(e) => {
        pick(e.target.files);
        e.target.value = '';
      }}
    />
  );

  const busy = loading && (
    <p className="upload__busy">
      <span className="spinner" /> {loading}
    </p>
  );

  if (file) {
    return (
      <section className="panel panel--tight">
        {/* 다른 PSD 는 머리의 「새 PSD」 버튼이나 화면 어디에 끌어다 놓기로 연다 (DropOverlay) */}
        <div className={`filecard ${blocked ? 'is-busy' : ''}`}>
          <img className="filecard__thumb" src={file.thumbUrl} alt="" />
          <div className="filecard__info">
            <b>{file.name}</b>
            <small>{fmtBytes(file.size)} · {file.width}×{file.height} px</small>
            {busy}
          </div>
          {/* 끌어다 놓기는 눈에 안 보이는 기능이라 예전 버튼 자리에서 알려 준다 (만드는 중엔 받지 않으므로 숨김) */}
          {!blocked && <p className="filecard__hint">다른 PSD 는 화면에 끌어다 놓아도 열립니다</p>}
        </div>
        {error && <p className="msg msg--error">{error}</p>}
      </section>
    );
  }

  return (
    <section className="panel">
      <h2 className="panel__title">PSD 올리기</h2>
      <div
        className={`drop ${over ? 'is-over' : ''} ${blocked ? 'is-busy' : ''}`}
        role="button"
        tabIndex={blocked ? -1 : 0}
        aria-disabled={blocked}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open();
          }
        }}
        {...dnd}
      >
        {loading ? (
          busy
        ) : (
          <>
            <svg className="drop__icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" />
            </svg>
            <p className="drop__msg">PSD 파일을 여기에 끌어다 놓으세요</p>
            <p className="drop__sub">또는 클릭해서 고르기</p>
            <p className="drop__hint">파일은 이 PC 브라우저 안에서만 읽습니다. 서버로는 레이어 정보와 축소 렌더 이미지만 보냅니다.</p>
          </>
        )}
        {fileInput}
      </div>
      {error && <p className="msg msg--error">{error}</p>}
    </section>
  );
}
