// 복사 — 모든 「복사」 버튼이 같이 쓴다 (결과 화면 · 저장된 결과 보기 …)
import { useEffect, useRef, useState } from 'react';

/** 클립보드에 쓴다. http 주소·권한 거부 등으로 막히면 옛 방식(execCommand)으로 한 번 더, 그래도 안 되면 false */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

/**
 * 복사 버튼 상태 — 누르면 잠깐 「복사됨」(copied = 누른 버튼 key), 실패하면 'fail:key'
 * copyLater: 글이 나중에 준비될 때 (이미지 업로드 뒤 HTML 복사). 클릭 직후 ClipboardItem 에 약속(Promise)을 넘겨야
 * 업로드가 오래 걸려도 브라우저가 복사를 막지 않는다. 글이 null(업로드 실패)이면 아무것도 복사하지 않는다
 */
export function useCopy(): [string | null, (key: string, text: string) => Promise<void>, (key: string, text: Promise<string | null>) => Promise<void>] {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const mark = (v: string, ms = 1500) => {
    setCopied(v);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(null), ms);
  };
  const copy = async (key: string, text: string) => mark((await copyText(text)) ? key : `fail:${key}`);
  const copyLater = async (key: string, text: Promise<string | null>) => {
    try {
      if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) throw new Error('no ClipboardItem');
      const blob = text.then((t) => {
        if (t == null) throw new Error('skip');
        return new Blob([t], { type: 'text/plain' });
      });
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
      mark(key, 4000);
    } catch {
      const t = await text.catch(() => null);
      if (t == null) return; // 업로드 실패 — 안내는 업로드 상태 줄에
      mark((await copyText(t)) ? key : `fail:${key}`, 4000);
    }
  };
  return [copied, copy, copyLater];
}
