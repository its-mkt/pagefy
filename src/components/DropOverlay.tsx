import { useEffect, useState, type DragEvent } from 'react';

interface Props {
  /** 끌어다 놓기를 받을지 (로그인·권한 확인 뒤에만) */
  enabled: boolean;
  /** 끌고 있는 동안 화면 전체 안내판을 띄울지 — PSD 를 연 뒤에만 (첫 화면은 큰 놓는 칸이 있음) */
  cover: boolean;
  /** 만드는 중·읽는 중엔 받지 않는다 (만드는 중에 다른 PSD 를 열면 하던 작업이 멈춤) */
  disabled: boolean;
  onFile: (f: File) => void;
}

const hasFiles = (e: { dataTransfer: DataTransfer | null }) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');

/**
 * 화면 어디에 PSD 를 놓아도 연다.
 * - 평소엔 자리를 차지하지 않고, 파일을 끌고 들어올 때만 안내판을 띄운다
 * - 안내판이 미리보기 iframe 까지 덮어야 iframe 위에서도 놓을 수 있다
 * - 놓는 칸 밖에 떨어뜨려도 브라우저가 PSD 를 새 화면으로 열어 버리지 않게 막는다
 */
export default function DropOverlay({ enabled, cover, disabled, onFile }: Props) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const enter = (e: globalThis.DragEvent) => {
      if (hasFiles(e) && cover) setShow(true);
    };
    const over = (e: globalThis.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
    };
    const drop = (e: globalThis.DragEvent) => {
      setShow(false);
      // 놓는 칸·안내판이 이미 받았으면(preventDefault) 두 번 열지 않는다
      if (!hasFiles(e) || e.defaultPrevented) return;
      e.preventDefault();
      const f = e.dataTransfer?.files[0];
      if (f && !disabled) onFile(f);
    };
    const end = () => setShow(false);
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    window.addEventListener('dragend', end);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
      window.removeEventListener('dragend', end);
    };
  }, [enabled, cover, disabled, onFile]);

  if (!enabled || !cover || !show) return null;

  return (
    <div
      className={`dropcover ${disabled ? 'is-busy' : ''}`}
      onDragOver={(e: DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
      }}
      // 안의 글자는 끌기 이벤트를 받지 않으므로 여기서 떠나면 = 창 밖으로 나감
      onDragLeave={(e: DragEvent) => e.target === e.currentTarget && setShow(false)}
      onDrop={(e: DragEvent) => {
        e.preventDefault();
        setShow(false);
        const f = e.dataTransfer.files[0];
        if (f && !disabled) onFile(f);
      }}
    >
      <div className="dropcover__box">
        <svg className="dropcover__icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" />
        </svg>
        {disabled ? (
          <p className="dropcover__msg">만드는 중에는 다른 PSD 를 열 수 없습니다</p>
        ) : (
          <>
            <p className="dropcover__msg">여기에 놓으면 새 PSD 로 엽니다</p>
            <p className="dropcover__sub">지금 작업은 「최근 작업」에 저장돼 있습니다</p>
          </>
        )}
      </div>
    </div>
  );
}
