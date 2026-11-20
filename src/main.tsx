import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/main.scss';

// 이름 변경(psd-markup → pagefy, 2026-11-20): 예전 저장 키(psdmk.*)가 있으면 새 키로 한 번 옮긴다
try {
  for (const k of ['channel', 'publicRoot', 'slugs']) {
    const old = localStorage.getItem(`psdmk.${k}`);
    if (old != null && localStorage.getItem(`pagefy.${k}`) == null) localStorage.setItem(`pagefy.${k}`, old);
    localStorage.removeItem(`psdmk.${k}`);
  }
} catch {
  // 저장소를 못 써도 동작에는 지장 없음
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
