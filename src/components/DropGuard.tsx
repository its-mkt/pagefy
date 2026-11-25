import { useEffect } from 'react';

const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');

/**
 * 놓는 칸(UploadPanel 의 .drop) 밖에 떨어뜨린 파일은 받지 않는다 — 실수로 다른 PSD 가 열리지 않게 (2026-11-25 사용자 지시, 예전엔 화면 어디에 놓아도 열렸음).
 * - 놓는 칸이 먼저 받으면(preventDefault) 건드리지 않는다
 * - 그 밖에서는 커서를 「놓을 수 없음」으로 보이고, 떨어뜨려도 브라우저가 파일을 새 화면으로 열어 버리지 않게 막기만 한다
 */
export default function DropGuard() {
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (!hasFiles(e) || e.defaultPrevented) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e) || e.defaultPrevented) return;
      e.preventDefault();
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);
  return null;
}
