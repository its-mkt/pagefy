import { useRef, useState, type DragEvent } from 'react';
import { fmtBytes } from '../lib/util';
import { Check, FileUp } from 'lucide-react';
import { useElapsed } from '../lib/time';

/** PSD 열기 단계 — 워커·App 이 보내는 진행 문구의 앞부분으로 몇 번째 단계인지 안다 (psd.worker.ts · App.openPsd) */
const STEPS = [
  { key: 'PSD 읽는 중', label: 'PSD 읽기' },
  { key: '레이어 정보 정리 중', label: '레이어 정리' },
  { key: '글자 뺀 배경 합성 중', label: '글자 뺀 배경 합성' },
  { key: '미리보기 만드는 중', label: '미리보기' },
];

/** 진행 문구 + 단계 표시 + 걸린 시간 (큰 PSD 는 오래 걸려 멈춘 것처럼 보이지 않게) */
function LoadSteps({ message }: { message: string }) {
  const [since] = useState(Date.now);
  const sec = Math.floor(useElapsed(since) / 1000);
  const at = STEPS.findIndex((s) => message.startsWith(s.key));
  return (
    <div className="upload__busy" role="status" aria-live="polite">
      <p className="upload__now">
        <span className="spinner" /> {message}
        {sec >= 3 && <span className="upload__sec">{sec}초</span>}
      </p>
      {at >= 0 && (
        <ol className="upload__steps" aria-label="PSD 여는 단계">
          {STEPS.map((s, i) => (
            <li key={s.key} className={i < at ? 'is-done' : i === at ? 'is-cur' : ''} aria-current={i === at ? 'step' : undefined}>
              {i < at && <Check className="upload__ico" aria-hidden="true" />}
              {s.label}
            </li>
          ))}
        </ol>
      )}
      {sec >= 15 && <p className="upload__slow">PSD 가 크면 1분 넘게 걸릴 수 있습니다. 창을 닫지 말고 기다려 주세요.</p>}
    </div>
  );
}

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
      e.preventDefault(); // 여기서 받았다는 표시 — 화면 나머지(DropGuard)는 「놓을 수 없음」
      e.dataTransfer.dropEffect = blocked ? 'none' : 'copy';
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

  const busy = loading && <LoadSteps message={loading} />;

  if (file) {
    return (
      <section className="panel panel--tight">
        {/* PSD 확인 카드(PSD 확인)와 짝을 맞춰 제목을 단다 — 가로로 나란히 놓일 때 두 카드의 머리가 같은 높이에 있게 */}
        <h2 className="panel__title">PSD 파일</h2>
        {/* 다른 PSD 는 머리의 「새 PSD」 버튼으로 연다 — 화면에 끌어다 놓기는 실수 방지로 받지 않음 (DropGuard, 2026-11-25) */}
        <div className={`filecard ${blocked ? 'is-busy' : ''}`}>
          <img className="filecard__thumb" src={file.thumbUrl} alt="" />
          <div className="filecard__info">
            <b>{file.name}</b>
            <small>{fmtBytes(file.size)} · {file.width}×{file.height} px</small>
            {busy}
          </div>
          {/* 다른 PSD 를 여는 길 안내 (만드는 중엔 열 수 없으므로 숨김) */}
          {!blocked && <p className="filecard__hint">다른 PSD 는 위의 「새 PSD」로 엽니다</p>}
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
            {/* 파일을 올리는 칸 — 일반 「업로드」 화살표 대신 파일 모양 아이콘 (PSD 파일을 놓는 자리라는 뜻) */}
            <FileUp className="drop__icon" />
            <p className="drop__msg">PSD 파일을 여기에 끌어다 놓으세요</p>
            <p className="drop__sub">또는 파일 선택</p>
            <p className="drop__hint">PSD 원본은 서버에 올리지 않습니다. 구조 분석에 필요한 레이어 정보와 작은 미리보기만 보냅니다.</p>
          </>
        )}
        {fileInput}
      </div>
      {error && <p className="msg msg--error">{error}</p>}
    </section>
  );
}
