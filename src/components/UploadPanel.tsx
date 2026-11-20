import { useRef, useState } from 'react';

interface Props {
  onFile: (f: File) => void;
  loading: string | null;
  error: string | null;
  fileName?: string;
}

export default function UploadPanel({ onFile, loading, error, fileName }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const pick = (files: FileList | null) => {
    const f = files?.[0];
    if (f) onFile(f);
  };

  return (
    <section className="panel">
      <h2 className="panel__title">1. PSD 올리기</h2>
      <div
        className={`drop ${over ? 'drop--over' : ''} ${loading ? 'drop--busy' : ''}`}
        onClick={() => !loading && input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!loading) pick(e.dataTransfer.files);
        }}
      >
        {loading ? (
          <p className="drop__msg">
            <span className="spinner" /> {loading}
          </p>
        ) : (
          <>
            <p className="drop__msg">{fileName ? `현재: ${fileName} — 다른 PSD를 놓으면 바꿉니다` : 'PSD 파일을 여기에 끌어다 놓거나 클릭해서 고르세요'}</p>
            <p className="drop__hint">파일은 이 PC 브라우저 안에서만 읽습니다. 서버로는 레이어 정보와 축소 렌더 이미지만 보냅니다.</p>
          </>
        )}
        <input ref={input} type="file" accept=".psd" hidden onChange={(e) => pick(e.target.files)} />
      </div>
      {error && <p className="msg msg--error">{error}</p>}
    </section>
  );
}
