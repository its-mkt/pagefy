// HTML 미리보기 iframe 높이를 내용에 맞춘다 (결과 화면 미리보기 · 저장된 결과 보기)
import { useEffect, useState, type DependencyList, type RefObject } from 'react';

/**
 * srcdoc 은 load 가 effect 보다 먼저 끝날 수 있고, 이미지가 늦게 뜨면 높이가 바뀐다 → 잠시(약 9초) 주기적으로 잰다.
 * documentElement.scrollHeight 는 iframe 높이보다 작아지지 않아 내용 높이인 body 로 잰다.
 * deps 가 바뀌면(내용·폭·보이기) 다시 잰다
 */
export function useFrameHeight(frame: RefObject<HTMLIFrameElement | null>, initial: number, deps: DependencyList) {
  const [height, setHeight] = useState(initial);
  useEffect(() => {
    const f = frame.current;
    if (!f) return;
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
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return height;
}
